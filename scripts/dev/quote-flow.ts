/**
 * Development check: walk a quotation from draft to acceptance as the real
 * roles, the way the quote builder and portal actions do, and print what happened.
 *
 *   npx tsx --env-file=.env.local scripts/dev/quote-flow.ts [client-id]
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
const drain = () => drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 20, workerId: "dev-quote-flow", admin });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const plusDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const clientId = process.argv[2] ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherClient = clientId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).single();
  if (!client) throw new Error(`no client ${clientId}`);

  const staff = await as("admin");
  const entry = await as("data_entry_officer");
  const clientAdmin = await as("client_admin", clientId);
  const viewer = await as("client_viewer", clientId);
  const stranger = await as("client_admin", otherClient);

  const { data: pkg } = await admin.from("packages").select("id, name").eq("org_id", ORG).eq("is_active", true).is("client_id", null).limit(1).single();
  const { data: chk } = await admin.from("check_types").select("id, name").eq("org_id", ORG).is("archived_at", null).limit(1).single();
  if (!pkg || !chk) throw new Error("the catalog needs an active package and check");

  // Draft, as the builder's createQuote/saveQuoteDraft do.
  const { data: q, error: insErr } = await staff.db
    .from("quotes")
    .insert({ org_id: ORG, client_id: clientId, title: "Dev quote flow", valid_until: plusDays(30) })
    .select("id, status, created_by")
    .single();
  check("Admin creates a draft", Boolean(q) && q?.status === "draft" && q?.created_by === staff.id, insErr?.message ?? "");
  if (!q) throw new Error("no draft");
  const denied = await entry.db.from("quotes").insert({ org_id: ORG, client_id: clientId }).select("id");
  check("A data entry officer can't create one", Boolean(denied.error) || !denied.data?.length, denied.error?.code ?? "created!");

  const upd = await staff.db.from("quotes").update({ intro: "Thank you.", scope: `${pkg.name} and ${chk.name}.`, expected_monthly_volume: 40 }).eq("id", q.id);
  check("Admin edits the wording", !upd.error, upd.error?.message ?? "");
  const items = await staff.db.from("quote_items").insert([
    { org_id: ORG, quote_id: q.id, sort: 10, kind: "package", package_id: pkg.id, description: `${pkg.name} package, per candidate`, quantity: 1, unit_price: 18000, discount_pct: 10 },
    { org_id: ORG, quote_id: q.id, sort: 20, kind: "check", check_type_id: chk.id, description: chk.name, quantity: 1, unit_price: 2500, discount_pct: 0 },
    { org_id: ORG, quote_id: q.id, sort: 30, kind: "custom", description: "Courier of originals", quantity: 2, unit_price: 750, discount_pct: 0 },
  ]);
  check("Admin adds three lines", !items.error, items.error?.message ?? "");
  const tiers = await staff.db.from("quote_tiers").insert({ org_id: ORG, quote_id: q.id, min_volume: 50, max_volume: null, discount_pct: 5, note: "50+ a month" });
  check("Admin adds a volume tier", !tiers.error, tiers.error?.message ?? "");
  const { data: totals } = await admin.from("quotes").select("subtotal, discount_total, total").eq("id", q.id).single();
  check("Totals are recomputed", Number(totals?.subtotal) === 22000 && Number(totals?.discount_total) === 1800 && Number(totals?.total) === 20200, JSON.stringify(totals));

  const seenEarly = await clientAdmin.db.rpc("portal_quote", { p_quote: q.id });
  check("The client can't see a draft", Boolean(seenEarly.error), seenEarly.error?.code ?? "visible!");
  const noConfirm = await entry.db.rpc("confirm_quote", { p_quote: q.id });
  check("A data entry officer can't confirm", Boolean(noConfirm.error), noConfirm.error?.code ?? "confirmed!");

  const confirmed = await staff.db.rpc("confirm_quote", { p_quote: q.id });
  const c = confirmed.data as { number?: string; document_id?: string } | null;
  check("Admin confirms it with a number", Boolean(c?.number), confirmed.error?.message ?? c?.number ?? "");
  const frozen = await staff.db.from("quotes").update({ intro: "changed" }).eq("id", q.id).select("id");
  check("A confirmed quotation can't be edited", Boolean(frozen.error) || !frozen.data?.length, frozen.error?.message ?? "edited!");
  const frozenItem = await staff.db.from("quote_items").update({ unit_price: 1 }).eq("quote_id", q.id).select("id");
  check("Its lines can't be edited", Boolean(frozenItem.error) || !frozenItem.data?.length, frozenItem.error?.message ?? "edited!");

  await drain();
  const { data: doc } = await admin.from("generated_documents").select("id, status, storage_path, page_count").eq("id", c!.document_id!).single();
  check("The PDF renders", doc?.status === "ready" && Boolean(doc?.storage_path), `${doc?.status} ${doc?.page_count ?? 0} pages`);

  const notSent = await clientAdmin.db.rpc("portal_quote", { p_quote: q.id });
  check("The client can't see it before it is sent", Boolean(notSent.error), notSent.error?.code ?? "visible!");
  const sent = await staff.db.rpc("mark_quote_sent", { p_quote: q.id, p_to: ["hr@example.test"] });
  check("Admin marks it sent", !sent.error, sent.error?.message ?? "");
  const { count: notes } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("entity_id", q.id).eq("user_id", clientAdmin.id);
  check("The client admin is notified", (notes ?? 0) > 0, `${notes}`);

  const list = await clientAdmin.db.rpc("portal_quotes");
  check("It shows in the client's portal list", ((list.data as { id: string }[] | null) ?? []).some((r) => r.id === q.id), list.error?.message ?? "");
  const read = await clientAdmin.db.rpc("portal_quote", { p_quote: q.id });
  check("Reading it doesn't mark it viewed", (read.data as { status?: string } | null)?.status === "sent", read.error?.message ?? "");
  const shown = await clientAdmin.db.rpc("portal_mark_quote_viewed", { p_quote: q.id });
  check("Showing it marks it viewed", !shown.error, shown.error?.message ?? "");
  const pq = await clientAdmin.db.rpc("portal_quote", { p_quote: q.id });
  const pqd = pq.data as { status?: string; items?: unknown[]; internal_notes?: unknown } | null;
  check("The client opens it (marked viewed)", pqd?.status === "viewed" && (pqd?.items?.length ?? 0) === 3, pq.error?.message ?? pqd?.status ?? "");
  check("Internal notes are not exposed", pqd?.internal_notes === undefined);
  const docSeen = await clientAdmin.db.from("generated_documents").select("id").eq("id", c!.document_id!);
  check("The client can read its PDF record", (docSeen.data?.length ?? 0) === 1, docSeen.error?.message ?? "");

  const strangerSees = await stranger.db.rpc("portal_quote", { p_quote: q.id });
  check("Another company's client can't open it", strangerSees.error?.code === "P0002" || Boolean(strangerSees.error), strangerSees.error?.code ?? "opened!");
  const strangerDoc = await stranger.db.from("generated_documents").select("id").eq("id", c!.document_id!);
  check("Another company's client can't see its PDF", (strangerDoc.data?.length ?? 0) === 0);
  const strangerAccept = await stranger.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: "Someone Else", p_ip: "127.0.0.1" });
  check("Another company's client can't accept it", Boolean(strangerAccept.error), strangerAccept.error?.code ?? "accepted!");
  const viewerAccept = await viewer.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: "Client Viewer", p_ip: "127.0.0.1" });
  check("A client viewer can't accept it", Boolean(viewerAccept.error), viewerAccept.error?.code ?? "accepted!");
  const shortName = await clientAdmin.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: "ab", p_ip: "127.0.0.1" });
  check("Accepting needs a typed name", Boolean(shortName.error), shortName.error?.message ?? "accepted!");

  const question = await clientAdmin.db.rpc("portal_respond_quote", { p_quote: q.id, p_action: "question", p_text: "Does the package include the police report?" });
  check("The client asks a question", !question.error, question.error?.message ?? "");

  const accepted = await clientAdmin.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: "Dev Client Admin", p_ip: "127.0.0.1" });
  check("The client admin accepts it", !accepted.error, accepted.error?.message ?? "");
  const { data: after } = await admin.from("quotes").select("status, accepted_name, accepted_ip").eq("id", q.id).single();
  check("Acceptance is recorded with name and IP", after?.status === "accepted" && after?.accepted_name === "Dev Client Admin" && after?.accepted_ip === "127.0.0.1", JSON.stringify(after));
  const { data: prices } = await admin.from("client_price_lists").select("package_id, check_type_id, unit_price, valid_to").eq("source_quote_id", q.id);
  const pkgPrice = prices?.find((p) => p.package_id === pkg.id);
  const chkPrice = prices?.find((p) => p.check_type_id === chk.id);
  check("Contracted prices are written for the package and the check", prices?.length === 2 && Number(pkgPrice?.unit_price) === 16200 && Number(chkPrice?.unit_price) === 2500, JSON.stringify(prices));
  const cp = await staff.db.rpc("contracted_price", { p_client: clientId, p_check: null, p_package: pkg.id });
  check("contracted_price returns the new package price", Number(cp.data) === 16200, cp.error?.message ?? String(cp.data));
  const again = await clientAdmin.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: "Dev Client Admin", p_ip: "127.0.0.1" });
  check("It can't be accepted twice", Boolean(again.error), again.error?.message ?? "accepted again!");
  const { data: events } = await admin.from("quote_events").select("kind").eq("quote_id", q.id).order("at");
  check("The timeline has every step", ["confirmed", "sent", "viewed", "question", "accepted"].every((k) => events?.some((e) => e.kind === k)), (events ?? []).map((e) => e.kind).join(" → "));

  // A new version of the accepted quotation starts as a draft and leaves the accepted one alone.
  const rev = await staff.db.rpc("revise_quote", { p_quote: q.id });
  const { data: v2 } = await admin.from("quotes").select("status, version, parent_id").eq("id", rev.data as string).single();
  const { data: v1 } = await admin.from("quotes").select("status").eq("id", q.id).single();
  check("A new version is a draft copy", v2?.status === "draft" && v2?.version === 2 && v1?.status === "accepted", rev.error?.message ?? JSON.stringify({ v1, v2 }));

  const page = await fetch(`http://localhost:3000/api/documents/${c!.document_id}`, { redirect: "manual" });
  check("The PDF route sends anonymous visitors to sign in", page.status >= 300 && page.status < 500 && !page.headers.get("content-type")?.includes("pdf"), String(page.status));

  console.log(JSON.stringify({ quoteId: q.id, number: c?.number, documentId: c?.document_id, revision: rev.data }));
  const bad = results.filter((r) => !r[1]).length;
  console.log(`${results.length - bad} of ${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
