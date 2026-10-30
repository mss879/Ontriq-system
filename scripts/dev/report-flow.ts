/**
 * Development check: walk a local case through the whole report flow as the
 * real roles, the way the case page's actions do, and print what happened.
 *
 *   npx tsx --env-file=.env.local scripts/dev/report-flow.ts ONT-2026-000001
 *
 * Local stack only. Uses the throwaway users of scripts/dev/as-user.ts
 * (created on first use, passwords never printed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { totp } from "../local-stack/totp";
import { createServiceClient } from "../../src/jobs/admin-client";
import { drainJobs } from "../../src/jobs/run-job";
import { currentSnapshot } from "../../src/jobs/report/load";

const ORG = "00000000-0000-4000-8000-000000000001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local stack only");
const store = path.join(homedir(), ".ontiq/local-stack/dev-users.json");
type Saved = Record<string, { email: string; password: string; id: string; totp?: string }>;
const saved: Saved = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {};
const admin = createServiceClient();

async function as(role: string, clientId?: string): Promise<{ db: SupabaseClient; id: string }> {
  const key = `${role}:${clientId ?? ""}`;
  const staff = !role.startsWith("client_") || role === "client_relations";
  if (!saved[key]) {
    const email = `dev-${role}-${randomBytes(3).toString("hex")}@dev.ontriq.test`;
    const password = `${randomBytes(12).toString("base64url")}Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Dev ${role.replace(/_/g, " ")}` }, app_metadata: { kind: staff ? "staff" : "client", org_id: ORG } });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    const { data: r } = await admin.from("roles").select("id").eq("org_id", ORG).eq("key", role).single();
    await admin.from("memberships").insert({ org_id: ORG, user_id: data.user.id, kind: staff ? "staff" : "client", client_id: staff ? null : clientId, role_id: r!.id, status: "active" });
    saved[key] = { email, password, id: data.user.id };
    mkdirSync(path.dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  const u = saved[key];
  const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await db.auth.signInWithPassword({ email: u.email, password: u.password });
  if (s.error) throw new Error(`sign-in ${role}: ${s.error.message}`);
  if (staff) {
    if (!u.totp) {
      const f = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "dev" });
      if (f.error || !f.data) throw new Error(`enroll: ${f.error?.message}`);
      await db.auth.mfa.challengeAndVerify({ factorId: f.data.id, code: totp(f.data.totp.secret) });
      saved[key] = { ...u, totp: f.data.totp.secret };
      writeFileSync(store, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } else {
      const factor = (await db.auth.mfa.listFactors()).data?.totp?.[0];
      if (factor) await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(u.totp) });
    }
  }
  return { db, id: u.id };
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "ok " : "BAD"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const drain = () => drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 20, workerId: "dev-report-flow", admin });

async function main() {
  const reference = process.argv[2] ?? "ONT-2026-000001";
  const { data: c } = await admin.from("cases").select("id, stage, client_id").eq("reference", reference).single();
  if (!c) throw new Error(`no case ${reference}`);
  if (c.stage !== "report") throw new Error(`${reference} is at ${c.stage}; put it at the report stage first`);

  const adminUser = await as("admin");
  const ops = await as("operations_manager");
  const entry = await as("data_entry_officer");
  const clientAdmin = await as("client_admin", c.client_id);
  const otherClient = c.client_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const stranger = await as("client_admin", otherClient);

  // Someone without reports.preview cannot draft.
  const denied = await entry.db.rpc("request_report_draft", { p_case: c.id });
  check("A data entry officer can't make a draft", Boolean(denied.error), denied.error?.code ?? "no error");

  const sendEarly = await adminUser.db.rpc("submit_report", { p_case: c.id });
  check("Can't send for approval without a ready draft", Boolean(sendEarly.error), sendEarly.error?.message ?? "");

  const draft = await adminUser.db.rpc("request_report_draft", { p_case: c.id });
  check("Admin generates a draft", !draft.error, draft.error?.message ?? "");
  await drain();
  const { data: d1 } = await admin.from("report_versions").select("id, status, page_count, snapshot_hash, error").eq("id", draft.data as string).single();
  check("The draft renders", d1?.status === "ready", `${d1?.status} ${d1?.page_count ?? 0} pages ${d1?.error ?? ""}`);

  const sent = await adminUser.db.rpc("submit_report", { p_case: c.id });
  check("Admin sends it for approval", !sent.error, sent.error?.message ?? "");

  // Stale approval: change the case after the draft, then approve with the current hash.
  const { data: k } = await admin.from("case_checks").select("id, client_note").eq("case_id", c.id).order("sort").limit(1).single();
  await admin.from("case_checks").update({ client_note: `${k?.client_note ?? ""} (edited)` }).eq("id", k!.id);
  const staleHash = (await currentSnapshot(admin, c.id)).hash;
  const stale = await adminUser.db.rpc("approve_report", { p_case: c.id, p_draft: d1!.id, p_final_result: "amber", p_current_hash: staleHash });
  check("Approval is refused when the case changed after the draft", /changed after this draft/.test(stale.error?.message ?? ""), stale.error?.message ?? "approved!");
  await admin.from("case_checks").update({ client_note: k?.client_note ?? null }).eq("id", k!.id);

  const { hash } = await currentSnapshot(admin, c.id);
  check("The recompiled snapshot matches the draft again", hash === d1?.snapshot_hash, `${hash.slice(0, 8)} vs ${d1?.snapshot_hash?.slice(0, 8)}`);
  const { data: checks } = await admin.from("case_checks").select("state, result_tone").eq("case_id", c.id).neq("state", "waived");
  const allGreen = (checks ?? []).every((x) => x.state === "completed" && x.result_tone === "green");
  const result = allGreen ? "green" : "amber";
  if (!allGreen) {
    const g = await adminUser.db.rpc("approve_report", { p_case: c.id, p_draft: d1!.id, p_final_result: "green", p_current_hash: hash });
    check("Green is refused while a check isn't clear", Boolean(g.error), g.error?.message ?? "approved green!");
  }
  const approved = await adminUser.db.rpc("approve_report", { p_case: c.id, p_draft: d1!.id, p_final_result: result, p_current_hash: hash });
  check(`Admin approves as ${result}`, !approved.error, approved.error?.message ?? "");
  await drain();
  const { data: f } = await admin.from("report_versions").select("id, status, page_count, sha256, error").eq("id", approved.data as string).single();
  check("The final renders with a fingerprint", f?.status === "ready" && Boolean(f?.sha256), `${f?.status} ${f?.page_count ?? 0} pages ${f?.error ?? ""}`);

  const own = await adminUser.db.rpc("release_report", { p_case: c.id, p_recipients: [] });
  check("The approver can't release their own report", Boolean(own.error), own.error?.message ?? "released!");
  const released = await ops.db.rpc("release_report", { p_case: c.id, p_recipients: [clientAdmin.id] });
  check("An operations manager releases it", !released.error, released.error?.message ?? "");
  const { data: after } = await admin.from("cases").select("stage, final_result").eq("id", c.id).single();
  check("The case is released with its result", after?.stage === "released" && after?.final_result === result, `${after?.stage} ${after?.final_result}`);

  const dl = await clientAdmin.db.rpc("report_download", { p_version: f!.id, p_ip: "127.0.0.1" });
  check("The client admin can download the released report", Boolean((dl.data as { path?: string } | null)?.path), dl.error?.message ?? "");
  const pr = await clientAdmin.db.rpc("portal_report", { p_case: c.id });
  check("The portal sees the released version", (pr.data as { version_id?: string } | null)?.version_id === f!.id);
  const draftDl = await clientAdmin.db.rpc("report_download", { p_version: d1!.id });
  check("The client can't download the draft", Boolean(draftDl.error));
  const other = await stranger.db.rpc("report_download", { p_version: f!.id });
  check("Another company can't download it", Boolean(other.error), other.error?.code ?? "downloaded!");

  const verify = await fetch(`http://localhost:3000/verify/${f!.id}`).then((r) => r.text());
  check("/verify shows the report as genuine", verify.includes("Genuine report") && verify.includes(reference), "");
  const bogus = await fetch(`http://localhost:3000/verify/${d1!.id}`).then((r) => r.text());
  check("/verify doesn't vouch for a draft", bogus.includes("can’t find this report") || bogus.includes("can't find this report"), "");

  console.log(JSON.stringify({ caseId: c.id, draft: d1!.id, final: f!.id }));
  const bad = results.filter((r) => !r[1]).length;
  console.log(`${results.length - bad} of ${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
