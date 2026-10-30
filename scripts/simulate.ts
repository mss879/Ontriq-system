/**
 * End-to-end simulation of every live feature against a real Supabase project.
 *
 *   npm run simulate                         # the hosted project in .env.hosted
 *   npm run simulate -- --env .env.staging   # any other real Supabase project
 *   npm run simulate -- --report docs/verification/simulation.md
 *   npm run simulate -- --keep               # leave the data for inspection
 *   npm run simulate -- --env .env.hosted --app http://localhost:3200
 *                                            # also drive a running build of the app
 *
 * It creates a throwaway person for every designation, two client companies
 * and supporting rows, all tagged with a run id. Everyone signs in for real
 * (staff with a TOTP second factor), then it checks what each role can and
 * cannot see or change, walks the invitation, recovery and magic-link flows,
 * runs the real job worker, exercises storage, live updates, numbering, the AI
 * cost ledger and the audit trail, and finally deletes everything it made.
 * Exit code 1 when any check fails.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { totp } from "./local-stack/totp";
import { parseNic } from "../src/domain/nic-core";
import { parseCheckTypeSchema } from "../src/domain/check-types/schema";
import { validateCheckValues } from "../src/domain/check-types/validate";

type DB = SupabaseClient<Database>;
type RoleKey =
  | "super_admin"
  | "admin"
  | "operations_manager"
  | "client_relations"
  | "qc_officer"
  | "verification_officer"
  | "data_entry_officer"
  | "viewer"
  | "client_admin"
  | "client_user"
  | "client_viewer";

type Person = {
  label: string;
  role: RoleKey;
  kind: "staff" | "client";
  company?: "A" | "B";
  email: string;
  password: string;
  id: string;
  db: DB;
  membershipId?: string;
};

const ORG_ID = "00000000-0000-4000-8000-000000000001";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------- results

type Result = { area: string; name: string; ok: boolean; detail?: string };
const results: Result[] = [];
let area = "";

function section(name: string) {
  area = name;
  console.log(`\n${name}`);
}

/** A check passes when it returns true or nothing; a string is the failure reason. */
async function check(name: string, fn: () => Promise<boolean | string | void> | boolean | string | void) {
  try {
    const r = await fn();
    const ok = r === undefined || r === true;
    const detail = typeof r === "string" ? r : ok ? undefined : "returned false";
    results.push({ area, name, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ area, name, ok: false, detail });
    console.log(`  ✗ ${name} — ${detail}`);
  }
}

const expectEq = (actual: unknown, expected: unknown, what = "value") =>
  JSON.stringify(actual) === JSON.stringify(expected) ? true : `${what} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;

type Res = { error: { code?: string; message: string } | null; data?: unknown };
/** Refused by the database: a permission error, or a write that matched no rows. */
function refused(res: Res): true | string {
  if (res.error) return ["42501", "P0001", "PGRST301"].includes(res.error.code ?? "") || /permission|not allowed|row-level security/i.test(res.error.message) ? true : `unexpected error ${res.error.code}: ${res.error.message}`;
  if (Array.isArray(res.data) && res.data.length === 0) return true;
  if (res.data === null) return true;
  return "the action was allowed";
}
function allowed(res: Res): true | string {
  if (res.error) return `${res.error.code ?? ""} ${res.error.message}`.trim();
  if (Array.isArray(res.data) && res.data.length === 0) return "no rows were affected";
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jwtPayload = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as Record<string, unknown>;
const jwtHeader = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()) as Record<string, unknown>;
const strongPassword = () => `${randomBytes(12).toString("base64url")}Aa1!`;

async function main() {
  // Needs a real Supabase project: the local stand-in has no realtime or storage.
  const envFile = arg("env") ?? ".env.hosted";
  loadEnvFile(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) throw new Error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL, the publishable key and SUPABASE_SECRET_KEY.`);
  const { drainJobs } = await import("../src/jobs/run-job");

  const RUN = Date.now().toString(36).slice(-6);
  const TAG = `SIM-${RUN.toUpperCase()}`;
  const domain = arg("domain") ?? "sim.ontriq.test";
  const keep = process.argv.includes("--keep");
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
  const service: DB = createClient<Database>(url, secret, opts);
  const anon = (): DB => createClient<Database>(url, publishable, opts);
  const startedAt = new Date();

  console.log(`Ontriq CRM simulation ${TAG} against ${new URL(url).host} (${envFile})`);

  // Everything created, for clean-up.
  const made = {
    users: [] as string[],
    clients: [] as string[],
    roles: [] as string[],
    invitations: [] as string[],
    jobs: [] as string[],
    outbox: [] as string[],
    aiRuns: [] as string[],
    objects: [] as { bucket: string; path: string }[],
    entityIds: [] as string[],
    cases: [] as string[],
    candidates: [] as string[],
    checkTypes: [] as string[],
  };

  const { data: roleRows, error: roleError } = await service.from("roles").select("id, key, kind").eq("org_id", ORG_ID);
  if (roleError || !roleRows?.length) throw new Error(`cannot read roles: ${roleError?.message ?? "none"}`);
  const roleId = (key: string) => {
    const r = roleRows.find((x) => x.key === key);
    if (!r) throw new Error(`role ${key} missing`);
    return r.id;
  };
  const { data: org } = await service.from("orgs").select("name, mfa_required_for_staff").eq("id", ORG_ID).single();
  if (!org) throw new Error("Ontriq org row missing");

  // ---------------------------------------------------------------- people

  async function createPerson(label: string, role: RoleKey, company?: "A" | "B"): Promise<Person> {
    const kind = (["client_admin", "client_user", "client_viewer"] as RoleKey[]).includes(role) ? "client" : "staff";
    const email = `sim-${RUN}-${label}@${domain}`.toLowerCase();
    const password = strongPassword();
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Sim ${label}` },
      app_metadata: { kind, org_id: ORG_ID },
    });
    if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
    made.users.push(data.user.id);
    return { label, role, kind, company, email, password, id: data.user.id, db: anon() };
  }

  async function signIn(p: Person) {
    const { error } = await p.db.auth.signInWithPassword({ email: p.email, password: p.password });
    if (error) throw new Error(`sign-in ${p.label}: ${error.message}`);
  }

  async function enrollTotp(p: Person) {
    const { data, error } = await p.db.auth.mfa.enroll({ factorType: "totp", friendlyName: `sim-${RUN}` });
    if (error || !data) throw new Error(`enrol ${p.label}: ${error?.message}`);
    const verify = await p.db.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
    if (verify.error) throw new Error(`verify ${p.label}: ${verify.error.message}`);
    return { factorId: data.id, secret: data.totp.secret };
  }

  const token = async (p: Person) => (await p.db.auth.getSession()).data.session?.access_token ?? "";

  section("Setting up a throwaway team and two client companies");

  const superAdmin = await createPerson("super", "super_admin");
  const admin = await createPerson("admin", "admin");
  for (const p of [superAdmin, admin]) {
    // The bootstrap path: the service creates the first active staff.
    const { data, error } = await service
      .from("memberships")
      .insert({ org_id: ORG_ID, user_id: p.id, kind: "staff", role_id: roleId(p.role), status: "active" })
      .select("id")
      .single();
    if (error) throw new Error(`membership ${p.label}: ${error.message}`);
    p.membershipId = data.id;
    made.entityIds.push(data.id);
    await signIn(p);
    await enrollTotp(p);
  }

  let clientA = "";
  let clientB = "";
  await check("Admin creates two client companies", async () => {
    const res = await admin.db
      .from("clients")
      .insert([
        { org_id: ORG_ID, name: `${TAG} Alpha Holdings`, code: `${TAG}-A` },
        { org_id: ORG_ID, name: `${TAG} Beta Finance`, code: `${TAG}-B` },
      ])
      .select("id, code");
    if (res.error) return res.error.message;
    clientA = res.data.find((c) => c.code.endsWith("-A"))!.id;
    clientB = res.data.find((c) => c.code.endsWith("-B"))!.id;
    made.clients.push(clientA, clientB);
    made.entityIds.push(clientA, clientB);
  });
  if (!clientA || !clientB) throw new Error("cannot continue without client companies");

  await check("Client settings are created automatically", async () => {
    const { data } = await service.from("client_settings").select("client_id").in("client_id", [clientA, clientB]);
    return expectEq(data?.length, 2, "settings rows");
  });

  await check("Admin adds a contact to each company", async () => {
    const res = await admin.db
      .from("client_contacts")
      .insert([
        { org_id: ORG_ID, client_id: clientA, name: "Alpha HR Lead", email: `hr-a-${RUN}@${domain}`, is_primary: true },
        { org_id: ORG_ID, client_id: clientB, name: "Beta HR Lead", email: `hr-b-${RUN}@${domain}`, is_primary: true },
      ])
      .select("id");
    if (res.error) return res.error.message;
    made.entityIds.push(...res.data.map((r) => r.id));
  });

  const team: Person[] = [
    await createPerson("ops", "operations_manager"),
    await createPerson("relations", "client_relations"),
    await createPerson("qc", "qc_officer"),
    await createPerson("verifier", "verification_officer"),
    await createPerson("dataentry", "data_entry_officer"),
    await createPerson("viewer", "viewer"),
    await createPerson("alpha-admin", "client_admin", "A"),
    await createPerson("alpha-user", "client_user", "A"),
    await createPerson("alpha-viewer", "client_viewer", "A"),
    await createPerson("beta-user", "client_user", "B"),
  ];
  const by = (label: string) => [superAdmin, admin, ...team].find((p) => p.label === label)!;
  const ops = by("ops");
  const viewer = by("viewer");
  const alphaAdmin = by("alpha-admin");
  const alphaUser = by("alpha-user");
  const betaUser = by("beta-user");

  await check("Admin adds every designation to the team as an invitation", async () => {
    const res = await admin.db
      .from("memberships")
      .insert(
        team.map((p) => ({
          org_id: ORG_ID,
          user_id: p.id,
          kind: p.kind,
          client_id: p.company === "A" ? clientA : p.company === "B" ? clientB : null,
          role_id: roleId(p.role),
          status: "invited" as const,
          invited_by: admin.id,
          invited_at: new Date().toISOString(),
        })),
      )
      .select("id, user_id");
    if (res.error) return res.error.message;
    for (const row of res.data) {
      const p = team.find((t) => t.id === row.user_id)!;
      p.membershipId = row.id;
      made.entityIds.push(row.id);
    }
    return expectEq(res.data.length, team.length, "memberships");
  });

  // ---------------------------------------------------------------- authentication

  section("Authentication and two-step verification");

  await check("Everyone signs in with their password", async () => {
    for (const p of team) await signIn(p);
  });

  await check("An invited person has no access until they accept", async () => {
    const { data } = await alphaUser.db.from("clients").select("id");
    return expectEq(data?.length ?? 0, 0, "visible clients");
  });

  await check("Everyone accepts their invitation", async () => {
    for (const p of team) {
      const { data, error } = await p.db.rpc("accept_my_invitation");
      if (error || data !== true) return `${p.label}: ${error?.message ?? data}`;
    }
  });

  // Two-step for staff is an org setting (Settings → Security); the checks follow it.
  const mfaOn = org.mfa_required_for_staff;
  await check(mfaOn ? "Staff without a second factor see no data" : "Two-step is off: staff work without a code", async () => {
    const { data: m } = await ops.db.rpc("my_membership");
    const { data } = await ops.db.from("clients").select("id").in("id", [clientA, clientB]);
    const flagged = (m as { mfa_required?: boolean } | null)?.mfa_required === true;
    if (flagged !== mfaOn) return `my_membership says mfa_required=${flagged}, the org setting is ${mfaOn}`;
    return expectEq(data?.length ?? 0, mfaOn ? 0 : 2, "clients visible at aal1");
  });

  await check("A wrong authenticator code is rejected", async () => {
    const { data, error } = await viewer.db.auth.mfa.enroll({ factorType: "totp", friendlyName: `sim-wrong-${RUN}` });
    if (error || !data) return error?.message ?? "enrol failed";
    const bad = String((Number(totp(data.totp.secret)) + 1) % 1_000_000).padStart(6, "0");
    const res = await viewer.db.auth.mfa.challengeAndVerify({ factorId: data.id, code: bad });
    await viewer.db.auth.mfa.unenroll({ factorId: data.id });
    return res.error ? true : "a wrong code was accepted";
  });

  await check("Every staff member enrols an authenticator and reaches aal2", async () => {
    for (const p of team.filter((t) => t.kind === "staff")) {
      await enrollTotp(p);
      const claims = jwtPayload(await token(p));
      if (claims.aal !== "aal2") return `${p.label} is at ${String(claims.aal)}`;
    }
  });

  await check("Tokens carry the routing kind the proxy relies on", async () => {
    const staffKind = (jwtPayload(await token(ops)).app_metadata as { kind?: string })?.kind;
    const clientKind = (jwtPayload(await token(alphaUser)).app_metadata as { kind?: string })?.kind;
    return expectEq([staffKind, clientKind], ["staff", "client"], "kinds");
  });

  await check("Tokens verify through getClaims", async () => {
    const { data, error } = await ops.db.auth.getClaims();
    if (error || !data) return error?.message ?? "no claims";
    return expectEq(data.claims.sub, ops.id, "sub");
  });

  let jwtAlg = "";
  await check("JWT signing algorithm recorded", async () => {
    jwtAlg = String(jwtHeader(await token(ops)).alg);
  });

  await check("Public sign-up is turned off", async () => {
    const res = await anon().auth.signUp({ email: `sim-${RUN}-stranger@${domain}`, password: strongPassword() });
    if (res.data.user) made.users.push(res.data.user.id);
    return res.error ? true : "a stranger could sign up";
  });

  await check("A wrong password is rejected", async () => {
    const res = await anon().auth.signInWithPassword({ email: alphaUser.email, password: "Wrong-password-123" });
    return res.error ? true : "signed in with a wrong password";
  });

  await check("Passwords shorter than 10 characters are refused", async () => {
    const res = await by("alpha-viewer").db.auth.updateUser({ password: "Short1!a" });
    return res.error ? true : "a 8-character password was accepted";
  });

  // The app's own invitation flow: invite link → /auth/confirm → set password → accept → MFA.
  const invitee: Person = { label: "invitee", role: "viewer", kind: "staff", email: `sim-${RUN}-invitee@${domain}`, password: strongPassword(), id: "", db: anon() };
  await check("Team invite: setup link, set password, accept, enrol, then access", async () => {
    const link = await service.auth.admin.generateLink({ type: "invite", email: invitee.email, options: { data: { full_name: "Sim Invitee" } } });
    if (link.error) return `generateLink: ${link.error.message}`;
    invitee.id = link.data.user.id;
    made.users.push(invitee.id);
    await service.auth.admin.updateUserById(invitee.id, { app_metadata: { kind: "staff", org_id: ORG_ID } });
    const m = await admin.db
      .from("memberships")
      .insert({ org_id: ORG_ID, user_id: invitee.id, kind: "staff", role_id: roleId("viewer"), status: "invited", invited_by: admin.id, invited_at: new Date().toISOString() })
      .select("id")
      .single();
    if (m.error) return `membership: ${m.error.message}`;
    invitee.membershipId = m.data.id;
    made.entityIds.push(m.data.id);
    const inv = await admin.db
      .from("invitations")
      .insert({ org_id: ORG_ID, email: invitee.email, full_name: "Sim Invitee", kind: "staff", role_id: roleId("viewer"), auth_user_id: invitee.id, invited_by: admin.id })
      .select("id")
      .single();
    if (inv.error) return `invitation: ${inv.error.message}`;
    made.invitations.push(inv.data.id);
    made.entityIds.push(inv.data.id);

    const otp = await invitee.db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "invite" });
    if (otp.error) return `verifyOtp: ${otp.error.message}`;
    const pw = await invitee.db.auth.updateUser({ password: invitee.password });
    if (pw.error) return `set password: ${pw.error.message}`;
    const accepted = await invitee.db.rpc("accept_my_invitation");
    if (accepted.error || accepted.data !== true) return `accept: ${accepted.error?.message ?? accepted.data}`;
    const before = await invitee.db.from("clients").select("id").in("id", [clientA, clientB]);
    if (mfaOn && (before.data?.length ?? 0) !== 0) return "saw clients before enrolling a second factor";
    await enrollTotp(invitee);
    const after = await invitee.db.from("clients").select("id").in("id", [clientA, clientB]);
    return expectEq(after.data?.length, 2, "clients visible after MFA");
  });

  await check("Re-inviting an existing person falls back to a magic link", async () => {
    const again = await service.auth.admin.generateLink({ type: "invite", email: invitee.email });
    if (!again.error) return "a second invite link was issued for an existing user";
    const magic = await service.auth.admin.generateLink({ type: "magiclink", email: invitee.email });
    if (magic.error) return `magiclink: ${magic.error.message}`;
    const otp = await anon().auth.verifyOtp({ token_hash: magic.data.properties.hashed_token, type: "magiclink" });
    return otp.error ? `verifyOtp: ${otp.error.message}` : true;
  });

  await check("Password recovery link resets the password", async () => {
    const link = await service.auth.admin.generateLink({ type: "recovery", email: betaUser.email });
    if (link.error) return `generateLink: ${link.error.message}`;
    const db = anon();
    const otp = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "recovery" });
    if (otp.error) return `verifyOtp: ${otp.error.message}`;
    const fresh = strongPassword();
    const upd = await db.auth.updateUser({ password: fresh });
    if (upd.error) return `update: ${upd.error.message}`;
    const old = await anon().auth.signInWithPassword({ email: betaUser.email, password: betaUser.password });
    if (!old.error) return "the old password still works";
    betaUser.password = fresh;
    const relog = await betaUser.db.auth.signInWithPassword({ email: betaUser.email, password: fresh });
    return relog.error ? `new password: ${relog.error.message}` : true;
  });

  // ---------------------------------------------------------------- role matrix

  section("Role-based access: what every designation can see and do");

  // Background rows the matrix probes.
  const outbox = await service.rpc("queue_email", { p_to: [`sim-${RUN}-outbox@${domain}`], p_subject: `${TAG} outbox`, p_html: "<p>Simulation</p>", p_text: "Simulation", p_template_key: "sim", p_payload: {} });
  if (outbox.error || !outbox.data) throw new Error(`queue_email: ${outbox.error?.message}`);
  const outboxId = outbox.data as string;
  made.outbox.push(outboxId);
  const { data: emailJob } = await service.from("jobs").select("id").eq("idempotency_key", `email.send:${outboxId}`).single();
  if (emailJob) made.jobs.push(emailJob.id);
  const aiRun = await service
    .from("ai_runs")
    .insert({ org_id: ORG_ID, capability: `sim.${RUN}`, model: "claude-haiku-5-5", input_tokens: 1_000_000, output_tokens: 1_000_000 })
    .select("id, cost_usd")
    .single();
  if (aiRun.error) throw new Error(`ai_runs: ${aiRun.error.message}`);
  made.aiRuns.push(aiRun.data.id);

  const everyone = [superAdmin, admin, ...team];
  const has = (p: Person, ...roles: RoleKey[]) => roles.includes(p.role);
  const own = (p: Person) => (p.company === "A" ? clientA : clientB);

  type Probe = { name: string; expect: (p: Person) => unknown; run: (p: Person) => Promise<unknown> };
  const probes: Probe[] = [
    {
      name: "client companies visible",
      expect: (p) => (p.kind === "client" ? 1 : has(p, "super_admin", "admin", "operations_manager", "client_relations", "qc_officer", "viewer") ? 2 : 0),
      run: async (p) => (await p.db.from("clients").select("id").in("id", [clientA, clientB])).data?.length ?? 0,
    },
    {
      name: "client contacts visible",
      expect: (p) => (p.kind === "client" ? 1 : has(p, "super_admin", "admin", "operations_manager", "client_relations", "viewer") ? 2 : 0),
      run: async (p) => (await p.db.from("client_contacts").select("id").in("client_id", [clientA, clientB])).data?.length ?? 0,
    },
    {
      name: "sees only their own company",
      expect: (p) => (p.kind === "client" ? true : "n/a"),
      run: async (p) => {
        if (p.kind !== "client") return "n/a";
        const { data } = await p.db.from("clients").select("id");
        return (data ?? []).every((c) => c.id === own(p)) && (data?.length ?? 0) === 1;
      },
    },
    {
      name: "can create a client",
      expect: (p) => has(p, "super_admin", "admin", "client_relations"),
      run: async (p) => {
        const res = await p.db.from("clients").insert({ org_id: ORG_ID, name: `${TAG} ${p.label} Co`, code: `${TAG}-X-${p.label}`.toUpperCase().slice(0, 40) }).select("id");
        if (res.data?.length) {
          made.clients.push(res.data[0].id);
          made.entityIds.push(res.data[0].id);
        }
        return allowed(res) === true;
      },
    },
    {
      name: "can edit a client",
      expect: (p) => has(p, "super_admin", "admin", "client_relations"),
      run: async (p) => allowed(await p.db.from("clients").update({ industry: `Sim ${p.label}` }).eq("id", clientA).select("id")) === true,
    },
    {
      name: "reads the audit log",
      expect: (p) => has(p, "super_admin", "admin", "operations_manager"),
      run: async (p) => ((await p.db.from("audit_log").select("id").eq("row_id", clientA)).data?.length ?? 0) > 0,
    },
    {
      name: "reads background jobs",
      expect: (p) => has(p, "super_admin", "admin", "operations_manager"),
      run: async (p) => ((await p.db.from("jobs").select("id").eq("id", emailJob?.id ?? "")).data?.length ?? 0) > 0,
    },
    {
      name: "reads the email outbox",
      expect: (p) => has(p, "super_admin", "admin", "operations_manager"),
      run: async (p) => ((await p.db.from("email_outbox").select("id").eq("id", outboxId)).data?.length ?? 0) > 0,
    },
    {
      name: "reads queue depth",
      expect: (p) => p.kind === "staff",
      run: async (p) => !(await p.db.rpc("queue_depth")).error,
    },
    {
      name: "reads the AI cost ledger",
      expect: (p) => has(p, "super_admin", "admin"),
      run: async (p) => ((await p.db.from("ai_runs").select("id").eq("id", aiRun.data.id)).data?.length ?? 0) > 0,
    },
    {
      name: "gets AI cost totals",
      expect: (p) => has(p, "super_admin", "admin"),
      run: async (p) => {
        const res = await p.db.rpc("ai_cost_summary", { p_from: new Date(Date.now() - 3600_000).toISOString(), p_to: new Date(Date.now() + 3600_000).toISOString(), p_group: "capability" });
        return (res.data ?? []).some((r) => r.group_key === `sim.${RUN}`);
      },
    },
    {
      name: "sees staff designations",
      expect: (p) => p.kind === "staff",
      run: async (p) => ((await p.db.from("roles").select("id").eq("kind", "staff")).data?.length ?? 0) > 0,
    },
    {
      name: "sees team members",
      expect: (p) => (p.kind === "staff" ? team.length + 2 : p.company === "A" ? 3 : 1),
      run: async (p) => (await p.db.from("memberships").select("id").in("user_id", everyone.map((x) => x.id))).data?.length ?? 0,
    },
    {
      name: "can invite a staff member",
      expect: (p) => has(p, "super_admin", "admin"),
      run: async (p) => {
        const res = await p.db
          .from("invitations")
          .insert({ org_id: ORG_ID, email: `sim-${RUN}-inv-${p.label}@${domain}`, kind: "staff", role_id: roleId("viewer"), invited_by: p.id })
          .select("id");
        if (res.data?.length) made.invitations.push(res.data[0].id);
        return allowed(res) === true;
      },
    },
    {
      name: "can invite into their own company",
      expect: (p) => (p.kind === "client" ? p.role === "client_admin" : "n/a"),
      run: async (p) => {
        if (p.kind !== "client") return "n/a";
        const res = await p.db
          .from("invitations")
          .insert({ org_id: ORG_ID, email: `sim-${RUN}-colleague-${p.label}@${domain}`, kind: "client", client_id: own(p), role_id: roleId("client_user"), invited_by: p.id })
          .select("id");
        if (res.data?.length) made.invitations.push(res.data[0].id);
        return allowed(res) === true;
      },
    },
    {
      name: "can create a designation",
      expect: (p) => has(p, "super_admin", "admin"),
      run: async (p) => {
        const res = await p.db.from("roles").insert({ org_id: ORG_ID, key: `sim_${RUN}_${p.label.replace(/-/g, "_")}`, name: `Sim ${p.label}`, kind: "staff" }).select("id");
        if (res.data?.length) made.roles.push(res.data[0].id);
        return allowed(res) === true;
      },
    },
    {
      name: "can change organisation settings",
      expect: (p) => has(p, "super_admin", "admin"),
      run: async (p) => allowed(await p.db.from("orgs").update({ name: org.name }).eq("id", ORG_ID).select("id")) === true,
    },
    {
      name: "can suggest client codes",
      expect: (p) => has(p, "super_admin", "admin", "operations_manager", "client_relations", "viewer"),
      run: async (p) => !(await p.db.rpc("suggest_client_code", { p_name: "Probe Holdings" })).error,
    },
    {
      name: "cannot draw a document number",
      expect: () => true,
      run: async (p) => refused(await p.db.rpc("next_document_number", { p_kind: "invoice" })) === true,
    },
    {
      name: "cannot write the audit log",
      expect: () => true,
      run: async (p) =>
        refused(await p.db.from("audit_log").insert({ org_id: ORG_ID, table_name: "clients", row_id: clientA, op: "UPDATE" } as never).select("id")) === true,
    },
    {
      name: "cannot write jobs directly",
      expect: () => true,
      run: async (p) => refused(await p.db.from("jobs").insert({ org_id: ORG_ID, kind: "email.send", payload: {} } as never).select("id")) === true,
    },
  ];

  for (const p of everyone) {
    const mismatches: string[] = [];
    for (const probe of probes) {
      const want = probe.expect(p);
      if (want === "n/a") continue;
      const got = await probe.run(p);
      if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${probe.name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
    const applicable = probes.filter((x) => x.expect(p) !== "n/a").length;
    const who = p.kind === "client" ? `${p.role.replace(/_/g, " ")}, company ${p.company}` : p.role.replace(/_/g, " ");
    await check(`${who[0].toUpperCase()}${who.slice(1)} (${applicable} rules)`, () => (mismatches.length ? mismatches.join("; ") : true));
  }

  // ---------------------------------------------------------------- guards

  section("Escalation guards and instant revocation");

  await check("Nobody can change their own designation", async () => {
    for (const p of [admin, viewer]) {
      const r = refused(await p.db.from("memberships").update({ role_id: roleId("super_admin") }).eq("id", p.membershipId!).select("id"));
      if (r !== true) return `${p.label}: ${r}`;
    }
  });

  await check("An admin cannot make someone a Super Admin", async () =>
    refused(await admin.db.from("memberships").update({ role_id: roleId("super_admin") }).eq("id", viewer.membershipId!).select("id")),
  );

  await check("A designation change takes effect on the next request", async () => {
    const moved = await admin.db.from("memberships").update({ role_id: roleId("verification_officer") }).eq("id", viewer.membershipId!).select("id");
    if (moved.error) return moved.error.message;
    const during = (await viewer.db.from("clients").select("id").in("id", [clientA, clientB])).data?.length ?? 0;
    await admin.db.from("memberships").update({ role_id: roleId("viewer") }).eq("id", viewer.membershipId!);
    const after = (await viewer.db.from("clients").select("id").in("id", [clientA, clientB])).data?.length ?? 0;
    return expectEq([during, after], [0, 2], "clients visible while moved, then restored");
  });

  await check("Suspending someone cuts access immediately", async () => {
    await admin.db.from("memberships").update({ status: "suspended" }).eq("id", viewer.membershipId!);
    const during = (await viewer.db.from("clients").select("id").in("id", [clientA, clientB])).data?.length ?? 0;
    await admin.db.from("memberships").update({ status: "active" }).eq("id", viewer.membershipId!);
    const after = (await viewer.db.from("clients").select("id").in("id", [clientA, clientB])).data?.length ?? 0;
    return expectEq([during, after], [0, 2], "clients visible while suspended, then restored");
  });

  await check("The command assistant permission cannot be granted", async () => {
    const custom = made.roles[0];
    if (!custom) return "no custom designation to test with";
    return refused(await admin.db.from("role_permissions").insert({ role_id: custom, permission: "ai.super_assistant" }).select("role_id"));
  });

  await check("Portal permissions cannot be given to staff designations", async () => {
    const custom = made.roles[0];
    if (!custom) return "no custom designation to test with";
    return refused(await admin.db.from("role_permissions").insert({ role_id: custom, permission: "portal.quotes.accept" }).select("role_id"));
  });

  await check("Custom designations accept catalogue permissions", async () => {
    const custom = made.roles[0];
    if (!custom) return "no custom designation to test with";
    return allowed(await admin.db.from("role_permissions").insert({ role_id: custom, permission: "checks.verify" }).select("role_id"));
  });

  await check("The Super Admin designation cannot be edited", async () =>
    refused(await admin.db.from("role_permissions").delete().eq("role_id", roleId("super_admin")).select("role_id")),
  );

  await check("A client admin cannot invite into another company", async () =>
    refused(
      await alphaAdmin.db
        .from("invitations")
        .insert({ org_id: ORG_ID, email: `sim-${RUN}-spy@${domain}`, kind: "client", client_id: clientB, role_id: roleId("client_user"), invited_by: alphaAdmin.id })
        .select("id"),
    ),
  );

  await check("A client user cannot read another company's contacts", async () =>
    expectEq((await betaUser.db.from("client_contacts").select("id").eq("client_id", clientA)).data?.length ?? 0, 0, "contacts"),
  );

  await check("A client user cannot probe client codes", async () => refused(await alphaUser.db.rpc("suggest_client_code", { p_name: "Beta Finance" })));

  // ---------------------------------------------------------------- anonymous

  section("Anonymous visitors (no session)");
  const stranger = anon();
  await check("See no clients", async () => expectEq((await stranger.from("clients").select("id")).data?.length ?? 0, 0, "rows"));
  await check("See no audit entries", async () => expectEq((await stranger.from("audit_log").select("id")).data?.length ?? 0, 0, "rows"));
  await check("See no team members", async () => expectEq((await stranger.from("memberships").select("id")).data?.length ?? 0, 0, "rows"));
  await check("Cannot call access helpers", async () => refused(await stranger.rpc("is_staff")));
  await check("Cannot read queue depth", async () => refused(await stranger.rpc("queue_depth")));
  await check("Cannot accept invitations", async () => refused(await stranger.rpc("accept_my_invitation")));

  // ---------------------------------------------------------------- jobs

  section("Background jobs and the email outbox (real worker code)");

  let unknownJob = "";
  await check("Email is queued with its delivery job in one step", async () => (emailJob ? true : "no email.send job was created"));

  await check("Jobs of an unknown kind are accepted for dead-lettering", async () => {
    const res = await service.rpc("enqueue_job", { p_kind: `sim.unknown`, p_payload: {}, p_idempotency_key: `sim:${RUN}:unknown`, p_max_attempts: 1 });
    if (res.error) return `enqueue_job: ${res.error.message}`;
    unknownJob = res.data as string;
    made.jobs.push(unknownJob);
  });

  await check("The worker drains the queue", async () => {
    const r = await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 25, workerId: `sim-${RUN}`, admin: service });
    return r.processed >= 2 ? true : `processed ${r.processed}`;
  });

  await check("The email job succeeded and the outbox row was settled", async () => {
    const { data: job } = await service.from("jobs").select("status").eq("id", emailJob?.id ?? "").single();
    const { data: mail } = await service.from("email_outbox").select("status").eq("id", outboxId).single();
    const expected = process.env.RESEND_API_KEY ? "sent" : "skipped";
    return expectEq([job?.status, mail?.status], ["succeeded", expected], "job and outbox status");
  });

  await check("A job with no handler is dead-lettered with a reason", async () => {
    const { data } = await service.from("jobs").select("status, last_error").eq("id", unknownJob).single();
    if (data?.status !== "dead") return `status ${data?.status}`;
    return /no handler/.test(data.last_error ?? "") ? true : `reason "${data.last_error}"`;
  });

  await check("A viewer cannot retry a job", async () => refused(await viewer.db.rpc("retry_job", { p_id: unknownJob })));

  await check("An operations manager can retry a dead job", async () => {
    const res = await ops.db.rpc("retry_job", { p_id: unknownJob });
    if (res.error || res.data !== true) return res.error?.message ?? `returned ${res.data}`;
    const { data } = await service.from("jobs").select("status").eq("id", unknownJob).single();
    await service.from("jobs").update({ status: "cancelled" }).eq("id", unknownJob);
    return expectEq(data?.status, "queued", "status after retry");
  });

  await check("The sweeper runs", async () => {
    const res = await service.rpc("sweep_jobs");
    return res.error ? res.error.message : true;
  });

  // ---------------------------------------------------------------- notifications + realtime

  section("Notifications and live updates");

  await check("A notification arrives live for its owner only", async () => {
    const received: string[] = [];
    const leaked: string[] = [];
    // Realtime confirms with a system message once the database listener is attached; SUBSCRIBED alone can come first.
    const ready = { own: false, spy: false };
    const system: string[] = [];
    const onSystem = (who: keyof typeof ready) => (m: { message?: string; status?: string }) => {
      system.push(`${who}: ${m.status ?? ""} ${m.message ?? ""}`.trim());
      if (/Subscribed to PostgreSQL/i.test(m.message ?? "")) ready[who] = true;
    };
    const mine = viewer.db
      .channel(`sim-${RUN}-own`)
      .on("system", {}, onSystem("own"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${viewer.id}` }, (m) => received.push(String((m.new as { title?: string }).title)));
    const spy = alphaUser.db
      .channel(`sim-${RUN}-spy`)
      .on("system", {}, onSystem("spy"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${viewer.id}` }, (m) => leaked.push(String((m.new as { title?: string }).title)));
    viewer.db.realtime.setAuth(await token(viewer));
    alphaUser.db.realtime.setAuth(await token(alphaUser));
    const subscribed = async (ch: ReturnType<DB["channel"]>) =>
      new Promise<string>((resolve) => {
        const t = setTimeout(() => resolve("TIMED_OUT"), 15_000);
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(t);
            resolve(status);
          }
        });
      });
    const [a, b] = await Promise.all([subscribed(mine), subscribed(spy)]);
    if (a !== "SUBSCRIBED") return `owner channel ${a}`;
    if (b !== "SUBSCRIBED") return `second channel ${b}`;
    for (let i = 0; i < 40 && !(ready.own && ready.spy); i++) await sleep(250);
    await sleep(500);
    const sent = await service.rpc("notify_users", { p_user_ids: [viewer.id], p_type: "sim", p_title: `${TAG} live`, p_org: ORG_ID });
    if (sent.error) return sent.error.message;
    for (let i = 0; i < 30 && received.length === 0; i++) await sleep(500);
    await sleep(1500);
    await viewer.db.removeAllChannels();
    await alphaUser.db.removeAllChannels();
    if (!received.length) return `no live event reached the owner (realtime said: ${system.join("; ") || "nothing"})`;
    return leaked.length ? "another user received the notification" : true;
  });

  await check("Each person reads only their own notifications", async () => {
    const mine = (await viewer.db.from("notifications").select("id").eq("title", `${TAG} live`)).data?.length ?? 0;
    const theirs = (await alphaUser.db.from("notifications").select("id").eq("user_id", viewer.id)).data?.length ?? 0;
    return expectEq([mine, theirs], [1, 0], "owner and other user");
  });

  await check("Marking notifications read only touches your own", async () => {
    const other = await alphaUser.db.rpc("mark_notifications_read", {});
    const own = await viewer.db.rpc("mark_notifications_read", {});
    if (own.error) return own.error.message;
    const { data } = await service.from("notifications").select("read_at").eq("user_id", viewer.id).eq("title", `${TAG} live`).single();
    return expectEq([other.data, own.data, Boolean(data?.read_at)], [0, 1, true], "counts and read flag");
  });

  // ---------------------------------------------------------------- storage

  section("File storage");

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const docPath = `sim/${RUN}/evidence.pdf`;
  await check("A browser can upload through a signed upload link", async () => {
    const signed = await service.storage.from("documents").createSignedUploadUrl(docPath);
    if (signed.error) return signed.error.message;
    made.objects.push({ bucket: "documents", path: docPath });
    const up = await anon().storage.from("documents").uploadToSignedUrl(docPath, signed.data.token, pdf, { contentType: "application/pdf" });
    return up.error ? up.error.message : true;
  });

  await check("The documents bucket refuses disallowed file types", async () => {
    const path = `sim/${RUN}/notes.txt`;
    const signed = await service.storage.from("documents").createSignedUploadUrl(path);
    if (signed.error) return signed.error.message;
    const up = await anon().storage.from("documents").uploadToSignedUrl(path, signed.data.token, Buffer.from("plain text"), { contentType: "text/plain" });
    if (!up.error) made.objects.push({ bucket: "documents", path });
    return up.error ? true : "a text file was accepted";
  });

  await check("Signed-in users cannot read private files directly", async () => {
    const res = await admin.db.storage.from("documents").download(docPath);
    return res.error ? true : "a staff session downloaded without a signed link";
  });

  await check("Private files are not public", async () => {
    const res = await fetch(`${url}/storage/v1/object/public/documents/${docPath}`);
    return res.ok ? "the file was public" : true;
  });

  await check("A 60-second signed link serves the exact file", async () => {
    const signed = await service.storage.from("documents").createSignedUrl(docPath, 60);
    if (signed.error) return signed.error.message;
    const res = await fetch(signed.data.signedUrl);
    if (!res.ok) return `HTTP ${res.status}`;
    return Buffer.from(await res.arrayBuffer()).equals(pdf) ? true : "content differs";
  });

  await check("Logos in org-assets are publicly served", async () => {
    const path = `sim/${RUN}/logo.svg`;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const up = await service.storage.from("org-assets").upload(path, svg, { contentType: "image/svg+xml" });
    if (up.error) return up.error.message;
    made.objects.push({ bucket: "org-assets", path });
    const res = await fetch(service.storage.from("org-assets").getPublicUrl(path).data.publicUrl);
    return res.ok ? true : `HTTP ${res.status}`;
  });

  // ---------------------------------------------------------------- documents, AI, limits

  section("Document numbering, AI cost ledger and rate limits");

  const simKind = `sim_${RUN}`;
  await check("Numbering is sequential (on a throwaway series)", async () => {
    const s = await service.from("document_series").insert({ org_id: ORG_ID, kind: simKind, prefix: "SIM" });
    if (s.error) return s.error.message;
    const a = await service.rpc("next_document_number", { p_kind: simKind });
    const b = await service.rpc("next_document_number", { p_kind: simKind });
    if (a.error || b.error) return (a.error ?? b.error)!.message;
    return /0001$/.test(String(a.data)) && /0002$/.test(String(b.data)) ? true : `${a.data}, ${b.data}`;
  });

  await check("The three document designs are available to staff", async () => {
    const { data } = await admin.db.from("document_templates").select("key");
    const keys = (data ?? []).map((d) => d.key).sort();
    return expectEq(keys, ["classic", "executive", "modern"], "templates");
  });

  await check("AI calls are priced from the rate table", async () => expectEq(Number(aiRun.data.cost_usd), 0.6, "cost of 1M+1M Haiku tokens"));

  await check("Rate limits stop the third hit in a window", async () => {
    const key = `sim:${RUN}:login`;
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push((await service.rpc("rate_limit_check", { p_key: key, p_window_seconds: 60, p_max: 2 })).data);
    return expectEq(hits, [true, true, false], "hits");
  });

  // ---------------------------------------------------------------- audit

  section("Audit trail");

  await check("Creating a client is recorded with who did it", async () => {
    const { data } = await service.from("audit_log").select("actor_id, op").eq("row_id", clientA).eq("op", "INSERT");
    return expectEq(data?.[0]?.actor_id, admin.id, "actor");
  });

  await check("Designation changes are recorded with the changed field", async () => {
    const { data } = await service.from("audit_log").select("changed_keys").eq("row_id", viewer.membershipId!).eq("op", "UPDATE");
    return (data ?? []).some((r) => (r.changed_keys ?? []).includes("role_id")) ? true : "no role_id change recorded";
  });

  await check("Nobody can delete audit entries", async () => refused(await admin.db.from("audit_log").delete().eq("row_id", clientA).select("id")));

  // ---------------------------------------------------------------- case engine

  section("Case engine: one case from receipt to the final report");
  const verifier = by("verifier");
  const qcOfficer = by("qc");
  const dataEntry = by("dataentry");
  const { data: orgPackages } = await service.from("packages").select("id, code").eq("org_id", ORG_ID).eq("owner_scope", "org");
  const packageId = (code: string) => orgPackages?.find((p) => p.code === code)?.id ?? "";
  // A valid NIC unique to this run: old card for case 1, the same person's new card for case 2.
  const day = 100 + (parseInt(RUN.slice(-2), 36) % 200);
  const serial = String(parseInt(RUN.slice(0, 3), 36) % 1000).padStart(3, "0");
  const oldNic = parseNic(`85${day}${serial}4V`);
  if (!oldNic.valid) throw new Error("could not build a test NIC");
  const candidateName = `Sim Candidate ${RUN}`;
  let case1 = "";
  let case2 = "";
  let reference = "";

  await check("Staff create a case: checks and document requirements come from the package", async () => {
    const { data, error } = await admin.db.rpc("create_case", {
      p: {
        client_id: clientA,
        package_id: packageId("STANDARD"),
        process_type: "client_supplied",
        position_title: "Software Engineer",
        candidate: { full_name: candidateName, nic: oldNic.display, nic_canonical: oldNic.canonical, date_of_birth: oldNic.birthDate, gender: oldNic.gender, district: "Kandy" },
      },
    });
    if (error) return error.message;
    const r = data as { case_id: string; reference: string; candidate_id: string };
    case1 = r.case_id;
    reference = r.reference;
    made.cases.push(case1);
    made.candidates.push(r.candidate_id);
    const checks = (await service.from("case_checks").select("id").eq("case_id", case1)).data?.length;
    const pending = (await service.from("case_check_requirements").select("id").eq("case_id", case1).eq("status", "pending")).data?.length;
    if (!/^ONT-\d{4}-\d{6}$/.test(reference)) return `reference ${reference}`;
    return expectEq([checks, pending], [3, 3], "checks and required documents");
  });

  await check("The same person is matched by NIC whichever card they show", async () => {
    const { data, error } = await admin.db.rpc("create_case", {
      p: { client_id: clientA, package_id: packageId("ESSENTIAL"), candidate: { full_name: "Different spelling", nic: oldNic.canonical, nic_canonical: oldNic.canonical } },
    });
    if (error) return error.message;
    const r = data as { case_id: string; candidate_reused: boolean };
    case2 = r.case_id;
    made.cases.push(case2);
    return expectEq(r.candidate_reused, true, "candidate reused");
  });

  await check("The assignment job gives both cases to the only qualified officer, with reasons", async () => {
    const r = await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 25, workerId: `sim-${RUN}`, admin: service });
    if (r.processed < 2) return `processed ${r.processed}`;
    const { data: cases } = await service.from("cases").select("id, assigned_to").in("id", [case1, case2]);
    const { data: checks } = await service.from("case_checks").select("assigned_to").eq("case_id", case1);
    const { data: why } = await service.from("assignment_events").select("explanation").eq("case_id", case1).eq("mode", "auto").is("case_check_id", null);
    if (!cases?.every((c) => c.assigned_to === verifier.id)) return `owners ${JSON.stringify(cases?.map((c) => c.assigned_to === verifier.id))}`;
    if (!checks?.every((k) => k.assigned_to === verifier.id)) return "checks not assigned to the owner";
    return why?.[0]?.explanation?.startsWith("Sim:") ? true : `explanation "${why?.[0]?.explanation}"`;
  });

  await check("Each role sees the cases it should", async () => {
    const seen = async (p: Person) => (await p.db.from("cases").select("id").in("id", [case1, case2])).data?.length ?? 0;
    return expectEq([await seen(verifier), await seen(dataEntry), await seen(qcOfficer), await seen(viewer), await seen(alphaUser)], [2, 0, 2, 2, 0], "verifier, data entry, QC, viewer, client");
  });

  await check("Missing documents block Pre-QC, with the reason", async () => {
    const { error } = await verifier.db.rpc("case_transition", { p_case: case1, p_event: "submit_pre_qc" });
    return error?.code === "22023" && /still missing/.test(error.message) ? true : `got ${error?.code} ${error?.message}`;
  });

  let policeDoc = "";
  const uploadAs = async (p: Person, category: string, filename: string): Promise<string> => {
    const { data, error } = await p.db.rpc("begin_document_upload", {
      p_case: case1,
      p_check: null as unknown as string,
      p_category: category,
      p_filename: filename,
      p_mime: "application/pdf",
      p_size: pdf.length,
    });
    if (error || !data) throw new Error(`begin upload: ${error?.message}`);
    const d = data as { id: string; bucket: string; path: string };
    made.objects.push({ bucket: d.bucket, path: d.path });
    made.entityIds.push(d.id);
    const signed = await service.storage.from(d.bucket).createSignedUploadUrl(d.path);
    if (signed.error) throw new Error(signed.error.message);
    const up = await anon().storage.from(d.bucket).uploadToSignedUrl(d.path, signed.data.token, pdf, { contentType: "application/pdf" });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const fin = await p.db.rpc("finalize_document_upload", { p_document: d.id });
    if (fin.error) throw new Error(`finalize: ${fin.error.message}`);
    return d.id;
  };

  await check("Documents upload through signed links and count towards requirements", async () => {
    await uploadAs(verifier, "nic_copy", "NIC both sides.pdf");
    const { data } = await service.from("case_check_requirements").select("status, received_count").eq("case_id", case1).eq("category", "nic_copy").single();
    return expectEq([data?.status, data?.received_count], ["received", 1], "NIC requirement");
  });

  await check("Sensitive evidence is hidden from staff without access", async () => {
    policeDoc = await uploadAs(verifier, "police_report", "police clearance.pdf");
    const mine = (await verifier.db.from("documents").select("id").eq("case_id", case1)).data?.length ?? 0;
    const managers = (await ops.db.from("documents").select("id").eq("case_id", case1)).data?.length ?? 0;
    return expectEq([mine, managers], [1, 2], "documents visible to the officer and the operations manager");
  });

  await check("A manager waives the rest and sends the case to Pre-QC", async () => {
    const { data: pending } = await ops.db.from("case_check_requirements").select("id").eq("case_id", case1).eq("status", "pending");
    for (const r of pending ?? []) {
      const { error } = await ops.db.rpc("waive_requirement", { p_requirement: r.id, p_reason: "Client confirmed by email (simulation)" });
      if (error) return error.message;
    }
    const { data, error } = await ops.db.rpc("case_transition", { p_case: case1, p_event: "submit_pre_qc" });
    return error ? error.message : expectEq(data, "pre_qc", "stage");
  });

  await check("Pre-QC can return the case, then approve it", async () => {
    const back = await qcOfficer.db.rpc("record_qc_review", { p_case: case1, p_kind: "pre", p_decision: "returned", p_remarks: "NIC copy is blurred" });
    if (back.error) return back.error.message;
    const { data: c } = await service.from("cases").select("stage, status_key").eq("id", case1).single();
    if (c?.stage !== "documents" || c.status_key !== "returned_for_correction") return `after return ${JSON.stringify(c)}`;
    const again = await ops.db.rpc("case_transition", { p_case: case1, p_event: "submit_pre_qc" });
    if (again.error) return again.error.message;
    const ok = await qcOfficer.db.rpc("record_qc_review", { p_case: case1, p_kind: "pre", p_decision: "approved", p_checklist: [{ item: "Readable", ok: true }] });
    if (ok.error) return ok.error.message;
    return expectEq((await service.from("cases").select("stage").eq("id", case1).single()).data?.stage, "data_entry", "stage");
  });

  const goodValues: Record<string, Record<string, unknown>> = {
    nic: { nic_number: oldNic.display, name_on_nic: candidateName, validation_source: "drp" },
    education: { candidate_name: candidateName, qualification_level: "degree", qualification: "BSc Computer Science", institution: "University of Moratuwa", student_number: "CS2015001", year_of_completion: 2019 },
    employment: {
      candidate_name: candidateName,
      employers: [{ company: "Dialog Axiata", designation: "Engineer", period: { from: "2019-07-01", to: "2023-06-30" }, employee_code: "D1234", employment_type: "permanent" }],
    },
  };
  await check("Data entry checks every field against the check's form before verification", async () => {
    const { data: checks } = await dataEntry.db.from("case_checks").select("id, check_type:check_types(key), version:check_type_versions(schema)").eq("case_id", case1);
    if ((checks?.length ?? 0) !== 3) return "the data entry officer cannot see the case's checks";
    // First a half-finished form: verification must refuse to start.
    const first = checks![0];
    const firstSchema = parseCheckTypeSchema((first.version as { schema: unknown }).schema);
    const partial = validateCheckValues(firstSchema.fields, { candidate_name: candidateName }, "draft");
    await dataEntry.db.rpc("save_check_values", { p_check: first.id, p_values: partial.values as never, p_valid: validateCheckValues(firstSchema.fields, partial.values, "submit").ok });
    const early = await dataEntry.db.rpc("case_transition", { p_case: case1, p_event: "start_verification" });
    if (!early.error) return "verification started with missing details";
    for (const k of checks ?? []) {
      const key = (k.check_type as { key: string }).key;
      const schema = parseCheckTypeSchema((k.version as { schema: unknown }).schema);
      const submit = validateCheckValues(schema.fields, goodValues[key] ?? {}, "submit");
      if (!submit.ok) return `${key} values invalid: ${JSON.stringify(submit.errors)}`;
      const { error } = await dataEntry.db.rpc("save_check_values", { p_check: k.id, p_values: submit.values as never, p_valid: true });
      if (error) return error.message;
    }
    const { data, error } = await dataEntry.db.rpc("case_transition", { p_case: case1, p_event: "start_verification" });
    return error ? error.message : expectEq(data, "verification", "stage");
  });

  const checkId = async (label: string) => (await service.from("case_checks").select("id").eq("case_id", case1).eq("label", label).single()).data?.id ?? "";
  await check("Verification: results are recorded by the officer, and a red result cannot be marked clear", async () => {
    const nicCheck = await checkId("NIC verification");
    const wrong = await verifier.db.rpc("set_check_state", { p_check: nicCheck, p_state: "completed", p_result: "discrepancy" });
    if (!wrong.error) return "a discrepancy was recorded as completed";
    const notMine = await dataEntry.db.rpc("set_check_state", { p_check: nicCheck, p_state: "completed", p_result: "clear" });
    if (!notMine.error) return "the data entry officer recorded a result";
    const ok = await verifier.db.rpc("set_check_state", { p_check: nicCheck, p_state: "completed", p_result: "clear", p_client_note: "Confirmed with the DRP" });
    if (ok.error) return ok.error.message;
    const { data: c } = await service.from("cases").select("status_key").eq("id", case1).single();
    if (c?.status_key !== "partially_completed") return `status ${c?.status_key}`;
    const early = await verifier.db.rpc("case_transition", { p_case: case1, p_event: "submit_post_qc" });
    if (!early.error) return "Post-QC accepted open checks";
    for (const label of ["Education", "Employment"]) {
      const r = await verifier.db.rpc("set_check_state", { p_check: await checkId(label), p_state: "completed", p_result: "clear" });
      if (r.error) return r.error.message;
    }
    const proposed = (await service.from("cases").select("proposed_result").eq("id", case1).single()).data?.proposed_result;
    const moved = await verifier.db.rpc("case_transition", { p_case: case1, p_event: "submit_post_qc" });
    return moved.error ? moved.error.message : expectEq([proposed, moved.data], ["green", "post_qc"], "proposed result and stage");
  });

  await check("Post-QC sends a check back, then approves the case for the report", async () => {
    const employment = await checkId("Employment");
    const back = await qcOfficer.db.rpc("record_qc_review", { p_case: case1, p_kind: "post", p_decision: "returned", p_remarks: "Second employer not confirmed", p_return_checks: [employment] });
    if (back.error) return back.error.message;
    const redo = await verifier.db.rpc("set_check_state", { p_check: employment, p_state: "discrepancy", p_note: "Dates differ by eight months", p_client_note: "The employment dates differ from the employer's records." });
    if (redo.error) return redo.error.message;
    const again = await verifier.db.rpc("case_transition", { p_case: case1, p_event: "submit_post_qc" });
    if (again.error) return again.error.message;
    const ok = await qcOfficer.db.rpc("record_qc_review", { p_case: case1, p_kind: "post", p_decision: "approved" });
    if (ok.error) return ok.error.message;
    const { data: c } = await service.from("cases").select("stage, proposed_result, completed_at").eq("id", case1).single();
    return expectEq([c?.stage, c?.proposed_result, Boolean(c?.completed_at)], ["report", "red", true], "stage, proposed result, completed");
  });

  await check("The timeline and stage history record every step", async () => {
    const events = (await service.from("case_events").select("id").eq("case_id", case1)).data?.length ?? 0;
    const stages = (await service.from("stage_history").select("id").eq("case_id", case1)).data?.length ?? 0;
    const returnsNoticed = (await service.from("notifications").select("id").eq("user_id", verifier.id).eq("type", "case.returned")).data?.length ?? 0;
    return events >= 15 && stages >= 9 && returnsNoticed === 2 ? true : `events ${events}, stage changes ${stages}, owner told of returns ${returnsNoticed}`;
  });

  await check("Hold and cancel follow permissions", async () => {
    const viewerHold = await viewer.db.rpc("set_case_hold", { p_case: case2, p_hold: true, p_reason: "test" });
    if (!viewerHold.error) return "a viewer put a case on hold";
    const hold = await ops.db.rpc("set_case_hold", { p_case: case2, p_hold: true, p_reason: "Client asked to pause" });
    if (hold.error) return hold.error.message;
    const blocked = await ops.db.rpc("case_transition", { p_case: case2, p_event: "submit_pre_qc" });
    if (!blocked.error || !/on hold/.test(blocked.error.message)) return "a case on hold moved";
    await ops.db.rpc("set_case_hold", { p_case: case2, p_hold: false });
    const cancel = await ops.db.rpc("cancel_case", { p_case: case2, p_reason: "Candidate withdrew" });
    if (cancel.error) return cancel.error.message;
    return expectEq((await service.from("cases").select("stage").eq("id", case2).single()).data?.stage, "cancelled", "stage");
  });

  await check("Client portal requests start at intake, for their own company only", async () => {
    const other = await alphaAdmin.db.rpc("create_case", { p: { client_id: clientB, package_id: packageId("ESSENTIAL"), candidate: { full_name: "Spy" } } });
    if (!other.error) return "a client created a case for another company";
    const { data, error } = await alphaAdmin.db.rpc("create_case", { p: { client_id: clientA, package_id: packageId("ESSENTIAL"), candidate: { full_name: `Portal Person ${RUN}` } } });
    if (error) return error.message;
    const r = data as { case_id: string; candidate_id: string };
    made.cases.push(r.case_id);
    made.candidates.push(r.candidate_id);
    const { data: c } = await service.from("cases").select("stage, created_via").eq("id", r.case_id).single();
    return expectEq([c?.stage, c?.created_via], ["intake", "portal"], "stage and source");
  });

  await check("Search finds cases for staff and nothing for clients", async () => {
    const staffHits = ((await viewer.db.rpc("search_everything", { p_query: reference })).data ?? []) as { kind: string; id: string }[];
    const clientHits = (await alphaUser.db.rpc("search_everything", { p_query: reference })).data ?? [];
    return staffHits.some((h) => h.kind === "case" && h.id === case1) && clientHits.length === 0 ? true : `staff ${staffHits.length}, client ${clientHits.length}`;
  });

  await check("Check type drafts can be saved and discarded without touching published versions", async () => {
    const ins = await admin.db.from("check_types").insert({ org_id: ORG_ID, key: `sim_${RUN}`, name: `Sim check ${RUN}` }).select("id").single();
    if (ins.error) return ins.error.message;
    made.checkTypes.push(ins.data.id);
    made.entityIds.push(ins.data.id);
    const draft = await admin.db.rpc("save_check_type_draft", { p_check_type: ins.data.id, p_schema: { fields: [{ key: "notes", label: "Notes", type: "textarea" }] } });
    if (draft.error) return draft.error.message;
    made.entityIds.push(draft.data as string);
    const viewerTry = await viewer.db.rpc("save_check_type_draft", { p_check_type: ins.data.id, p_schema: { fields: [] } });
    if (!viewerTry.error) return "a viewer edited a check type";
    const discard = await admin.db.rpc("discard_check_type_draft", { p_check_type: ins.data.id });
    if (discard.error) return discard.error.message;
    return expectEq((await service.from("check_type_versions").select("id").eq("check_type_id", ins.data.id)).data?.length, 0, "versions left");
  });

  await check("Client-built packages always carry Ontriq's price", async () => {
    const pkg = await alphaAdmin.db.from("packages").insert({ org_id: ORG_ID, owner_scope: "client", client_id: clientA, name: "Driver onboarding", code: `${TAG}-DRIVER` }).select("id").single();
    if (pkg.error) return pkg.error.message;
    made.entityIds.push(pkg.data.id);
    const nicType = (await service.from("check_types").select("id").eq("org_id", ORG_ID).eq("key", "nic").single()).data?.id ?? "";
    const listPrice = Math.max(0, ...((await service.from("package_items").select("unit_price, package:packages!inner(owner_scope)").eq("check_type_id", nicType).eq("package.owner_scope", "org")).data ?? []).map((r) => Number(r.unit_price)));
    const item = await alphaAdmin.db.from("package_items").insert({ org_id: ORG_ID, package_id: pkg.data.id, check_type_id: nicType, unit_price: 1 }).select("id, unit_price").single();
    if (item.error) return item.error.message;
    made.entityIds.push(item.data.id);
    return expectEq(Number(item.data.unit_price), listPrice, "price stored");
  });


  // ---------------------------------------------------------------- Phase 2: candidate link and client portal

  section("Candidate link and client portal");
  const { hashLinkSecret, newLinkSecret, sealLinkSecret, isCandidateSecretConfigured } = await import("../src/lib/crypto/candidate-token");
  const relations = by("relations");
  const alphaViewer = by("alpha-viewer");
  const sealed = (secret: string) => (isCandidateSecretConfigured() ? sealLinkSecret(secret) : null);
  const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const putFile = async (begun: { bucket: string; path: string }) => {
    made.objects.push({ bucket: begun.bucket, path: begun.path });
    const signed = await service.storage.from(begun.bucket).createSignedUploadUrl(begun.path);
    if (signed.error) return signed.error.message;
    const sent = await anon().storage.from(begun.bucket).uploadToSignedUrl(begun.path, signed.data.token, tinyPdf, { contentType: "application/pdf" });
    return sent.error ? sent.error.message : true;
  };
  const linkSecret = newLinkSecret();
  let portalLinkSecret = "";
  let case3 = "";
  let linkId = "";

  await check("Staff open a candidate-collected case and issue the candidate's link", async () => {
    const { data, error } = await admin.db.rpc("create_case", {
      p: {
        client_id: clientA,
        package_id: packageId("STANDARD"),
        process_type: "candidate_collected",
        position_title: "Accountant",
        candidate: { full_name: `Sim Link Candidate ${RUN}`, email: `sim-${RUN}-candidate@${domain}`, preferred_language: "si" },
      },
    });
    if (error) return error.message;
    const r = data as { case_id: string; candidate_id: string };
    case3 = r.case_id;
    made.cases.push(case3);
    made.candidates.push(r.candidate_id);
    const issued = await admin.db.rpc("issue_candidate_link", { p_case: case3, p_token_hash: hashLinkSecret(linkSecret), p_token_enc: sealed(linkSecret) as string, p_language: "si", p_days: 14 });
    if (issued.error) return issued.error.message;
    linkId = issued.data as string;
    // Let auto-assignment give the case an owner, who hears about the candidate's activity
    // (the queue also holds the AI reading of earlier uploads, so drain until it is done).
    for (let i = 0; i < 5; i++) {
      await drainJobs({ budgetMs: 30_000, reserveMs: 0, maxJobs: 25, workerId: `sim-${RUN}`, admin: service });
      const { data: owner } = await service.from("cases").select("assigned_to").eq("id", case3).single();
      if (owner?.assigned_to) break;
    }
    const sent = await admin.db.rpc("record_candidate_link_sent", { p_link: linkId, p_channels: ["email"] });
    if (sent.error) return sent.error.message;
    const secretColumn = await admin.db.from("candidate_links").select("token_hash").eq("id", linkId);
    if (!secretColumn.error) return "staff could read the link's secret hash";
    const viewerTry = await viewer.db.rpc("issue_candidate_link", { p_case: case3, p_token_hash: "0".repeat(64), p_token_enc: "" });
    return viewerTry.error ? true : "a viewer issued a candidate link";
  });

  await check("The link opens for the candidate and shows only what they may see", async () => {
    await admin.db.rpc("add_case_note", { p_case: case3, p_check: null as unknown as string, p_body: `${TAG} INTERNAL NOTE` });
    const opened = await service.rpc("candidate_open_link", { p_token_hash: hashLinkSecret(linkSecret) });
    if (opened.error || !(opened.data as { ok: boolean }).ok) return opened.error?.message ?? JSON.stringify(opened.data);
    const unknown = await service.rpc("candidate_open_link", { p_token_hash: hashLinkSecret(newLinkSecret()) });
    if ((unknown.data as { ok: boolean }).ok) return "an unknown secret opened a link";
    const { data: view, error } = await service.rpc("candidate_link_view", { p_link: linkId });
    if (error) return error.message;
    const text = JSON.stringify(view);
    const v = view as { requirements: { category: string; min_count: number }[]; checks: unknown[]; link: { language: string } };
    if (text.includes("INTERNAL NOTE")) return "an internal note reached the candidate";
    if (v.requirements.some((r) => ["field_verification", "sanction_report"].includes(r.category))) return "staff-only document slots reached the candidate";
    if (/result_tone|assigned_to/.test(text)) return "results or assignees reached the candidate";
    const signedIn = await alphaAdmin.db.rpc("candidate_link_view", { p_link: linkId });
    if (!signedIn.error) return "a signed-in client called the candidate view";
    // Standard: NIC, certificates and service letters are required; transcript and resignation letters are optional.
    return expectEq([v.requirements.filter((r) => r.min_count > 0).length, v.requirements.length, v.checks.length, v.link.language], [3, 5, 3, "si"], "required slots, all slots, checks and language");
  });

  await check("The candidate uploads into a document slot straight to private storage", async () => {
    const { data: slot } = await service.from("case_check_requirements").select("id").eq("case_id", case3).eq("category", "nic_copy").single();
    const begun = await service.rpc("candidate_begin_upload", { p_link: linkId, p_requirement: slot!.id, p_category: null as unknown as string, p_filename: "My NIC.pdf", p_mime: "application/pdf", p_size: tinyPdf.length });
    if (begun.error) return begun.error.message;
    const b = begun.data as { id: string; bucket: string; path: string };
    const put = await putFile(b);
    if (put !== true) return put;
    const fin = await service.rpc("candidate_finalize_upload", { p_link: linkId, p_document: b.id });
    if (fin.error) return fin.error.message;
    const { data: req } = await service.from("case_check_requirements").select("received_count").eq("id", slot!.id).single();
    const { data: doc } = await service.from("documents").select("uploaded_by_kind, status").eq("id", b.id).single();
    const told = (await service.from("notifications").select("id").eq("type", "candidate.upload").eq("entity_id", case3)).data?.length ?? 0;
    return expectEq([req?.received_count, doc?.uploaded_by_kind, doc?.status, told > 0], [1, "candidate", "uploaded", true], "slot count, source, status, owner told");
  });

  await check("A link can never reach another case", async () => {
    const { data: other } = await service.from("case_check_requirements").select("id").eq("case_id", case1).limit(1).single();
    const r = await service.rpc("candidate_begin_upload", { p_link: linkId, p_requirement: other!.id, p_category: null as unknown as string, p_filename: "x.pdf", p_mime: "application/pdf", p_size: 10 });
    return r.error?.code === "P0002" ? true : `got ${r.error?.code ?? "no error"}`;
  });

  await check("Staff ask the candidate a question, the candidate answers, staff accept it", async () => {
    const asked = await relations.db.rpc("create_candidate_request", { p_case: case3, p: { kind: "question", title: "When did you join ABC Ltd?", help: "Month and year" } });
    if (asked.error) return asked.error.message;
    made.entityIds.push(asked.data as string);
    const answered = await service.rpc("candidate_answer_request", { p_link: linkId, p_request: asked.data as string, p_answer: { value: "March 2021" } });
    if (answered.error) return answered.error.message;
    const accepted = await admin.db.rpc("review_candidate_request", { p_request: asked.data as string, p_decision: "accept" });
    if (accepted.error) return accepted.error.message;
    const msg = await service.rpc("candidate_post_message", { p_link: linkId, p_body: "Uploaded my NIC" });
    if (msg.error) return msg.error.message;
    const { data: q } = await service.from("candidate_requests").select("status, answer").eq("id", asked.data as string).single();
    return expectEq([q?.status, (q?.answer as { value?: string })?.value], ["accepted", "March 2021"], "status and answer");
  });

  await check("Pre-QC waits for the candidate's consent", async () => {
    const { data: pending } = await service.from("case_check_requirements").select("id").eq("case_id", case3).eq("status", "pending");
    for (const r of pending ?? []) await ops.db.rpc("waive_requirement", { p_requirement: r.id, p_reason: "simulation" });
    const blocked = await ops.db.rpc("case_transition", { p_case: case3, p_event: "submit_pre_qc" });
    if (!blocked.error || !/consent/.test(blocked.error.message)) return `got ${blocked.error?.message ?? "no error"}`;
    const signed = await service.rpc("candidate_submit_consent", { p_link: linkId, p_method: "esign", p_signed_name: `Sim Link Candidate ${RUN}`, p_document: null as unknown as string, p_ip: "203.0.113.10", p_user_agent: "simulation" });
    if (signed.error) return signed.error.message;
    const { data: consent } = await service.from("consent_forms").select("id").eq("case_id", case3).single();
    made.entityIds.push(consent!.id);
    const moved = await ops.db.rpc("case_transition", { p_case: case3, p_event: "submit_pre_qc" });
    return moved.error ? moved.error.message : expectEq(moved.data, "pre_qc", "stage");
  });

  await check("Turning the link off ends the candidate's access at once", async () => {
    const off = await admin.db.rpc("revoke_candidate_link", { p_link: linkId, p_reason: "simulation" });
    if (off.error) return off.error.message;
    const view = await service.rpc("candidate_link_view", { p_link: linkId });
    const reopen = await service.rpc("candidate_open_link", { p_token_hash: hashLinkSecret(linkSecret) });
    return view.error?.code === "P0002" && (reopen.data as { reason?: string }).reason === "revoked" ? true : `view ${view.error?.code ?? "still works"}, reopen ${JSON.stringify(reopen.data)}`;
  });

  let case4 = "";
  let case4Reference = "";
  let sharedDoc = "";
  let internalDoc = "";
  await check("Clients see their own cases through the portal, without internal notes", async () => {
    const { data, error } = await admin.db.rpc("create_case", {
      p: { client_id: clientA, package_id: packageId("ESSENTIAL"), process_type: "client_supplied", candidate: { full_name: `Sim Portal Candidate ${RUN}` } },
    });
    if (error) return error.message;
    const r = data as { case_id: string; reference: string; candidate_id: string };
    case4 = r.case_id;
    case4Reference = r.reference;
    made.cases.push(case4);
    made.candidates.push(r.candidate_id);
    await admin.db.rpc("add_case_note", { p_case: case4, p_check: null as unknown as string, p_body: `${TAG} INTERNAL NOTE` });
    const list = await alphaAdmin.db.rpc("portal_cases", { p: { q: RUN } });
    if (list.error) return list.error.message;
    const ids = ((list.data as { rows: { id: string }[] }).rows ?? []).map((x) => x.id);
    if (!ids.includes(case3) || !ids.includes(case4)) return "the client's cases are missing from the portal";
    const detail = await alphaAdmin.db.rpc("portal_case_detail", { p_case: case3 });
    if (detail.error) return detail.error.message;
    const text = JSON.stringify(detail.data);
    if (text.includes("INTERNAL NOTE")) return "an internal note reached the client";
    if ((detail.data as { checks: { result_tone: string | null }[] }).checks.some((k) => k.result_tone)) return "results shown before release";
    const other = await betaUser.db.rpc("portal_case_detail", { p_case: case3 });
    if (other.error?.code !== "P0002") return "another company opened the case";
    const direct = (await alphaAdmin.db.from("cases").select("id").in("id", [case3, case4])).data?.length ?? 0;
    return expectEq(direct, 0, "cases readable directly");
  });

  await check("Clients upload into a slot Ontriq shared with them, and only there", async () => {
    const asked = await admin.db.rpc("request_case_document", { p_case: case4, p_check: null as unknown as string, p_category: "cv", p_label: "Latest CV", p_note: "Please send the latest CV" });
    if (asked.error) return asked.error.message;
    const detail = await alphaAdmin.db.rpc("portal_case_detail", { p_case: case4 });
    const slot = (detail.data as { requirements: { id: string; category: string }[] }).requirements.find((x) => x.category === "cv");
    if (!slot) return "the requested slot is not shown to the client";
    const viewerTry = await alphaViewer.db.rpc("portal_begin_upload", { p_case: case4, p_requirement: slot.id, p_category: null as unknown as string, p_filename: "cv.pdf", p_mime: "application/pdf", p_size: tinyPdf.length });
    if (!viewerTry.error) return "a client viewer uploaded";
    const anyCategory = await alphaAdmin.db.rpc("portal_begin_upload", { p_case: case4, p_requirement: null as unknown as string, p_category: "police_report", p_filename: "x.pdf", p_mime: "application/pdf", p_size: 10 });
    if (!anyCategory.error) return "a client chose an arbitrary document category";
    const begun = await alphaAdmin.db.rpc("portal_begin_upload", { p_case: case4, p_requirement: slot.id, p_category: null as unknown as string, p_filename: "cv.pdf", p_mime: "application/pdf", p_size: tinyPdf.length });
    if (begun.error) return begun.error.message;
    const b = begun.data as { id: string; bucket: string; path: string };
    const put = await putFile(b);
    if (put !== true) return put;
    const fin = await alphaAdmin.db.rpc("portal_finalize_upload", { p_document: b.id });
    if (fin.error) return fin.error.message;
    const { data: req } = await service.from("case_check_requirements").select("received_count").eq("id", slot.id).single();
    const ownVisible = (await alphaAdmin.db.from("documents").select("id").eq("id", b.id)).data?.length ?? 0;
    return expectEq([req?.received_count, ownVisible], [1, 1], "slot count and own upload visible");
  });

  await check("Clients open documents Ontriq shared, never internal ones", async () => {
    for (const [name, share] of [["shared.pdf", true], ["internal.pdf", false]] as const) {
      const begun = await admin.db.rpc("begin_document_upload", { p_case: case4, p_check: null as unknown as string, p_category: "other", p_filename: name, p_mime: "application/pdf", p_size: tinyPdf.length });
      if (begun.error) return begun.error.message;
      const b = begun.data as { id: string; bucket: string; path: string };
      const put = await putFile(b);
      if (put !== true) return put;
      await admin.db.rpc("finalize_document_upload", { p_document: b.id });
      if (share) {
        await admin.db.rpc("set_document_visibility", { p_document: b.id, p_visibility: "client" });
        sharedDoc = b.id;
      } else internalDoc = b.id;
    }
    const seen = (await alphaAdmin.db.from("documents").select("id").in("id", [sharedDoc, internalDoc])).data?.map((d) => d.id) ?? [];
    const otherCompany = (await betaUser.db.from("documents").select("id").in("id", [sharedDoc, internalDoc])).data?.length ?? 0;
    return expectEq([seen.includes(sharedDoc), seen.includes(internalDoc), otherCompany], [true, false, 0], "shared, internal, other company");
  });

  await check("Client users hear about documents Ontriq needs, by email too", async () => {
    const { data: notes } = await service.from("notifications").select("id, user_id").eq("type", "portal.documents_needed").eq("entity_id", case4);
    const toAlpha = (notes ?? []).filter((n) => [alphaAdmin.id, alphaUser.id, alphaViewer.id].includes(n.user_id)).length;
    const toBeta = (notes ?? []).filter((n) => n.user_id === betaUser.id).length;
    const emails = (await service.from("jobs").select("id").eq("kind", "notify.email").in("entity_id", (notes ?? []).map((n) => n.id))).data ?? [];
    made.jobs.push(...emails.map((j) => j.id));
    return expectEq([toAlpha, toBeta, emails.length], [3, 0, 3], "client A users told, client B told, email copies queued");
  });

  await check("Staff can't use the portal functions, and visibility settings apply", async () => {
    const staffTry = await admin.db.rpc("portal_cases", { p: {} });
    if (staffTry.error?.code !== "42501") return "staff used the portal functions";
    const hide = await admin.db.from("client_settings").update({ visibility: { show_timeline: false, show_documents: false } }).eq("client_id", clientA);
    if (hide.error) return hide.error.message;
    const detail = await alphaAdmin.db.rpc("portal_case_detail", { p_case: case4 });
    const d = detail.data as { timeline: unknown[]; documents: unknown[] };
    const hiddenDoc = (await alphaAdmin.db.from("documents").select("id").eq("id", sharedDoc)).data?.length ?? 0;
    await admin.db.from("client_settings").update({ visibility: {} }).eq("client_id", clientA);
    return expectEq([d.timeline.length, d.documents.length, hiddenDoc], [0, 0, 0], "timeline, documents, download");
  });

  await check("Reminders pick up candidates who still owe something", async () => {
    const secret2 = newLinkSecret();
    const issued = await admin.db.rpc("issue_candidate_link", { p_case: case4, p_token_hash: hashLinkSecret(secret2), p_token_enc: sealed(secret2) as string, p_language: "en", p_days: 14 });
    if (issued.error) return issued.error.message;
    await admin.db.rpc("record_candidate_link_sent", { p_link: issued.data as string, p_channels: ["email"] });
    portalLinkSecret = secret2;
    const { data } = await service.rpc("candidate_reminder_candidates");
    const row = ((data ?? []) as { link_id: string; missing_documents: number; consent_missing: boolean }[]).find((r) => r.link_id === issued.data);
    return row ? expectEq([row.consent_missing, row.missing_documents > 0], [true, true], "consent and documents owed") : "the link is not in the reminder list";
  });


  // ---------------------------------------------------------------- Phase 3: reports, quotations, invoices

  section("Final report, quotations, invoices and payments");
  const { currentSnapshot } = await import("../src/jobs/report/load");
  const money = { quotes: [] as string[], invoices: [] as string[], numbered: false };
  // Document numbers must stay gap-free. With real quotations or invoices present, skip the numbered steps.
  const liveDocs =
    ((await service.from("invoices").select("id", { count: "exact", head: true })).count ?? 0) +
    ((await service.from("quotes").select("id", { count: "exact", head: true })).count ?? 0);
  money.numbered = liveDocs === 0;
  let finalId = "";
  let draftId = "";
  let quoteId = "";
  let invoiceId = "";

  await check("Ontriq drafts the report: the real render job builds the PDF with its fingerprint", async () => {
    const viewerTry = await dataEntry.db.rpc("request_report_draft", { p_case: case1 });
    if (!viewerTry.error) return "someone without report access made a draft";
    const { data, error } = await admin.db.rpc("request_report_draft", { p_case: case1 });
    if (error) return error.message;
    draftId = data as string;
    await drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
    const { data: v } = await service.from("report_versions").select("status, storage_path, sha256, page_count, snapshot_hash, error").eq("id", draftId).single();
    if (v?.status !== "ready") return `draft ${v?.status}: ${v?.error ?? ""}`;
    if (v.storage_path) made.objects.push({ bucket: "reports", path: v.storage_path });
    const file = await service.storage.from("reports").download(v.storage_path!);
    const head = file.data ? Buffer.from(await file.data.arrayBuffer()).subarray(0, 5).toString() : "";
    return head === "%PDF-" && (v.page_count ?? 0) >= 2 && /^[0-9a-f]{64}$/.test(v.sha256 ?? "") ? true : `pdf ${head}, pages ${v.page_count}`;
  });

  await check("Approval checks the case didn't change after the draft, and a green result needs every check clear", async () => {
    const sent = await verifier.db.rpc("submit_report", { p_case: case1 });
    if (sent.error) return sent.error.message;
    const wrong = await ops.db.rpc("approve_report", { p_case: case1, p_draft: draftId, p_final_result: "red", p_current_hash: "0".repeat(64) });
    if (!wrong.error || !/changed/.test(wrong.error.message)) return "approved a draft against a changed case";
    const { hash } = await currentSnapshot(service, case1);
    const green = await ops.db.rpc("approve_report", { p_case: case1, p_draft: draftId, p_final_result: "green", p_current_hash: hash });
    if (!green.error) return "approved green with a discrepancy on the case";
    const ok = await ops.db.rpc("approve_report", { p_case: case1, p_draft: draftId, p_final_result: "red", p_current_hash: hash });
    if (ok.error) return ok.error.message;
    finalId = ok.data as string;
    await drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
    const { data: f } = await service.from("report_versions").select("status, storage_path").eq("id", finalId).single();
    if (f?.storage_path) made.objects.push({ bucket: "reports", path: f.storage_path });
    return expectEq(f?.status, "ready", "final status");
  });

  await check("A second person releases it; the client can download it and the public can verify it", async () => {
    const self = await ops.db.rpc("release_report", { p_case: case1, p_recipients: [] });
    if (!self.error) return "the approver released their own report";
    const rel = await admin.db.rpc("release_report", { p_case: case1, p_recipients: [alphaAdmin.id] });
    if (rel.error) return rel.error.message;
    const mine = await alphaAdmin.db.rpc("report_download", { p_version: finalId });
    const theirs = await betaUser.db.rpc("report_download", { p_version: finalId });
    const draft = await alphaAdmin.db.rpc("report_download", { p_version: draftId });
    const v = (await service.rpc("verify_report", { p_version: finalId })).data as { status?: string } | null;
    return mine.data && theirs.error && draft.error && v?.status === "valid" ? true : `client ${Boolean(mine.data)}, other ${!theirs.error}, draft ${!draft.error}, verify ${v?.status}`;
  });

  await check("Per-case billing drafts the invoice on release, priced from the case", async () => {
    await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
    const { data: inv } = await service.from("invoices").select("id, status, net_total").eq("source_key", `case:${case1}`).maybeSingle();
    if (!inv) return "no invoice draft after release";
    invoiceId = inv.id;
    money.invoices.push(inv.id);
    return expectEq(inv.status, "draft", "status");
  });

  if (money.numbered) {
    await check("A quotation is confirmed, rendered, sent and accepted by the client; it sets their prices", async () => {
      const nicType = (await service.from("check_types").select("id").eq("org_id", ORG_ID).eq("key", "nic").single()).data!.id;
      const q = await relations.db.from("quotes").insert({ org_id: ORG_ID, client_id: clientA, title: `${TAG} services`, intro: "Thank you." }).select("id").single();
      if (q.error) return q.error.message;
      quoteId = q.data.id;
      money.quotes.push(quoteId);
      const item = await relations.db.from("quote_items").insert({ org_id: ORG_ID, quote_id: quoteId, kind: "check", check_type_id: nicType, description: "NIC verification", quantity: 1, unit_price: 2500, discount_pct: 20 });
      if (item.error) return item.error.message;
      const conf = await relations.db.rpc("confirm_quote", { p_quote: quoteId });
      if (conf.error) return conf.error.message;
      await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
      const sent = await relations.db.rpc("mark_quote_sent", { p_quote: quoteId, p_to: [] });
      if (sent.error) return sent.error.message;
      const other = await betaUser.db.rpc("portal_quote", { p_quote: quoteId });
      if (!other.error) return "another company opened the quotation";
      const acc = await alphaAdmin.db.rpc("portal_accept_quote", { p_quote: quoteId, p_name: "Sim Alpha Admin", p_ip: "203.0.113.7" });
      if (acc.error) return acc.error.message;
      const { data: doc } = await service.from("generated_documents").select("status, storage_path").eq("entity_id", quoteId).eq("kind", "quote").single();
      if (doc?.storage_path) made.objects.push({ bucket: "documents", path: doc.storage_path });
      const price = (await service.rpc("contracted_price", { p_client: clientA, p_check: nicType, p_package: null as unknown as string })).data;
      return expectEq([doc?.status, Number(price)], ["ready", 2000], "PDF and contracted NIC price");
    });

    await check("The invoice is confirmed, sent, paid by an uploaded slip, and the statement balances", async () => {
      // Packages may not be priced yet on this project: finance prices any zero line on the draft, as the invoice screen does.
      const { data: lines } = await admin.db.from("invoice_items").select("id, unit_price").eq("invoice_id", invoiceId);
      for (const l of lines ?? []) {
        if (Number(l.unit_price) > 0) continue;
        const priced = await admin.db.from("invoice_items").update({ unit_price: 2500 }).eq("id", l.id).eq("invoice_id", invoiceId);
        if (priced.error) return `pricing the draft: ${priced.error.message}`;
      }
      const conf = await admin.db.rpc("confirm_invoice", { p_invoice: invoiceId });
      if (conf.error) return conf.error.message;
      await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
      const sent = await admin.db.rpc("mark_invoice_sent", { p_invoice: invoiceId, p_to: [] });
      if (sent.error) return sent.error.message;
      const viewerTry = await alphaViewer.db.rpc("portal_invoices");
      if (!viewerTry.error) return "a client viewer opened invoices";
      const { data: inv } = await alphaAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
      const total = Number((inv as { total?: number } | null)?.total ?? 0);
      const begun = await alphaAdmin.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "slip.pdf", p_mime: "application/pdf", p_size: tinyPdf.length });
      if (begun.error) return begun.error.message;
      const b = begun.data as { id: string; bucket: string; path: string };
      const put = await putFile(b);
      if (put !== true) return put;
      const fin = await alphaAdmin.db.rpc("portal_finalize_slip", { p_slip: b.id });
      if (fin.error) return fin.error.message;
      const pay = await relations.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: total, p_method: "bank_transfer", p_reference: `SIM-${RUN}`, p_slip: b.id });
      if (pay.error) return pay.error.message;
      await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 10, workerId: `sim-${RUN}`, admin: service });
      const { data: after } = await service.from("invoices").select("status, balance").eq("id", invoiceId).single();
      const st = await alphaAdmin.db.rpc("client_statement", { p_client: clientA, p_from: "2020-01-01", p_to: "2100-01-01" });
      const theirs = await betaUser.db.rpc("client_statement", { p_client: clientA, p_from: "2020-01-01", p_to: "2100-01-01" });
      return expectEq([after?.status, Number(after?.balance), Number((st.data as { closing?: number } | null)?.closing), Boolean(theirs.error)], ["paid", 0, 0, true], "status, balance, statement closing, other company refused");
    });
  } else {
    await check("Live quotations or invoices exist: numbered quotation and invoice steps skipped to keep numbers gap-free", () => true);
  }

  // ---------------------------------------------------------------- Phase 4 and 5

  section("AI review, performance and nudges, the assistant, analytics and data protection");
  const extra = { suggestions: [] as string[] };

  await check("Uploads queued the AI document reading, and it finishes cleanly with or without an AI key", async () => {
    const docs = ((await service.from("documents").select("id").in("case_id", made.cases)).data ?? []).map((d) => d.id);
    if (!docs.length) return "no documents to check";
    const { data: jobs } = await service.from("jobs").select("id, status").eq("kind", "ai.classify_document").in("entity_id", docs);
    if (!jobs?.length) return "no AI reading was queued for the uploads";
    made.jobs.push(...jobs.map((j) => j.id));
    await drainJobs({ budgetMs: 60_000, reserveMs: 0, maxJobs: 20, workerId: `sim-${RUN}`, admin: service });
    const { data: after } = await service.from("jobs").select("status").in("id", jobs.map((j) => j.id));
    const bad = (after ?? []).filter((j) => !["done", "succeeded", "completed"].includes(String(j.status)));
    return bad.length ? `jobs not finished: ${bad.map((b) => b.status).join(", ")}` : true;
  });

  await check("AI suggestions wait for the right person: QC decides the Pre-QC review, data entry can't, nobody edits one directly", async () => {
    const { data: sug, error } = await service
      .from("ai_suggestions")
      .insert({ org_id: ORG_ID, capability: "case.preqc", entity_type: "case", entity_id: case1, value: { summary: `${TAG} review`, checklist: [], requests: [] } })
      .select("id")
      .single();
    if (error || !sug) return error?.message ?? "no suggestion";
    extra.suggestions.push(sug.id);
    const forged = await qcOfficer.db.from("ai_suggestions").update({ value: { summary: "forged" } }).eq("id", sug.id).select("id");
    if (forged.data?.length) return "a staff member rewrote an AI suggestion";
    const wrong = await dataEntry.db.rpc("decide_ai_suggestion", { p_suggestion: sug.id, p_decision: "accepted" });
    if (!wrong.error) return "data entry decided a Pre-QC review";
    const client = await alphaAdmin.db.rpc("decide_ai_suggestion", { p_suggestion: sug.id, p_decision: "accepted" });
    if (!client.error) return "a client decided an AI suggestion";
    const ok = await qcOfficer.db.rpc("decide_ai_suggestion", { p_suggestion: sug.id, p_decision: "accepted" });
    if (ok.error) return ok.error.message;
    const twice = await qcOfficer.db.rpc("decide_ai_suggestion", { p_suggestion: sug.id, p_decision: "rejected" });
    return twice.error ? true : "a suggestion was decided twice";
  });

  await check("Managers see the leaderboard; officers see only their own work", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const board = await ops.db.rpc("performance_board", { p_from: weekAgo, p_to: today });
    if (board.error) return board.error.message;
    if (!((board.data ?? []) as { user_id: string }[]).some((r) => r.user_id === verifier.id)) return "the verifier is missing from the leaderboard";
    const officerBoard = await verifier.db.rpc("performance_board", { p_from: weekAgo, p_to: today });
    if (!officerBoard.error) return "an officer opened the leaderboard";
    const own = await verifier.db.rpc("my_open_items", {});
    if (own.error) return own.error.message;
    const other = await verifier.db.rpc("my_open_items", { p_user: dataEntry.id });
    return other.error ? true : "an officer read a colleague's work";
  });

  await check("A manager pushes an officer, who acknowledges and replies; others can't push", async () => {
    const denied = await dataEntry.db.rpc("send_nudge", { p_to: verifier.id, p_message: "Hurry" });
    if (!denied.error) return "data entry pushed a colleague";
    const sent = await ops.db.rpc("send_nudge", { p_to: verifier.id, p_message: `${TAG}: a couple of items are running late. What help do you need?`, p_channels: ["in_app", "email"] });
    if (sent.error) return sent.error.message;
    const id = sent.data as string;
    const notice = await verifier.db.from("notifications").select("id, urgent").eq("entity_id", id).maybeSingle();
    if (!notice.data?.urgent) return "the officer got no urgent notice";
    const stranger = await qcOfficer.db.rpc("acknowledge_nudge", { p_nudge: id });
    if (!stranger.error) return "someone else acknowledged the push";
    const ack = await verifier.db.rpc("acknowledge_nudge", { p_nudge: id, p_reply: "On it today." });
    if (ack.error) return ack.error.message;
    const reply = await ops.db.from("notifications").select("id").eq("entity_id", id).eq("type", "nudge.reply");
    const { data: emailJobs } = await service.from("jobs").select("id").eq("kind", "notify.email").in("entity_id", [notice.data.id]);
    made.jobs.push(...(emailJobs ?? []).map((j) => j.id));
    return reply.data?.length ? true : "the manager didn't hear the reply";
  });

  await check("Conversations with the assistant are private, and only the Super Admin gets the command assistant", async () => {
    const mine = await admin.db.from("assistant_threads").insert({ org_id: ORG_ID, user_id: admin.id, kind: "staff", title: `${TAG} thread` }).select("id").single();
    if (mine.error) return mine.error.message;
    const command = await admin.db.from("assistant_threads").insert({ org_id: ORG_ID, user_id: admin.id, kind: "command", title: "x" }).select("id");
    if (!command.error) return "an admin opened a command conversation";
    const superCmd = await superAdmin.db.from("assistant_threads").insert({ org_id: ORG_ID, user_id: superAdmin.id, kind: "command", title: `${TAG} command` }).select("id").single();
    if (superCmd.error) return superCmd.error.message;
    const peek = await verifier.db.from("assistant_threads").select("id").eq("id", mine.data.id);
    if (peek.data?.length) return "someone read another person's conversation";
    const write = await admin.db.from("assistant_messages").insert({ org_id: ORG_ID, thread_id: mine.data.id, user_id: admin.id, role: "assistant", content: [] }).select("id");
    if (!write.error) return "a person wrote the assistant's reply themselves";
    const voice = await admin.db.rpc("begin_voice_note", { p_thread: mine.data.id, p_mime: "audio/webm", p_duration: 5 });
    return voice.error ? true : "an admin started a command voice note";
  });

  await check("Analytics: operations for managers, money for finance only", async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const opsView = await ops.db.rpc("analytics_operations", { p_from: from, p_to: to });
    if (opsView.error) return opsView.error.message;
    const opsMoney = await ops.db.rpc("analytics_revenue", { p_from: from, p_to: to });
    if (!opsMoney.error) return "an operations manager read revenue";
    const finance = await by("relations").db.rpc("analytics_revenue", { p_from: from, p_to: to });
    if (finance.error) return finance.error.message;
    const officer = await verifier.db.rpc("analytics_operations", { p_from: from, p_to: to });
    if (!officer.error) return "an officer opened analytics";
    const client = await alphaAdmin.db.rpc("analytics_operations", { p_from: from, p_to: to });
    return client.error ? true : "a client opened analytics";
  });

  await check("Only a case's owner, a stage manager or an approver can generate its report draft", async () => {
    const r = await viewer.db.rpc("request_report_draft", { p_case: case1 });
    return r.error ? true : "the read-only viewer generated a report draft";
  });

  await check("Erasing a cancelled case removes its personal data but keeps a candidate another case needs", async () => {
    const denied = await admin.db.rpc("erase_case", { p_case: case2, p_reason: "Candidate asked for deletion" });
    if (!denied.error) return "an admin erased personal data";
    const { data: live } = await service.from("cases").select("id").in("id", made.cases).not("stage", "in", "(released,cancelled)").limit(1).maybeSingle();
    if (!live) return "no case in progress to try";
    const open = await superAdmin.db.rpc("erase_case", { p_case: live.id, p_reason: "Candidate asked for deletion" });
    if (!open.error) return "a case still in progress was erased";
    const r = await superAdmin.db.rpc("erase_case", { p_case: case2, p_reason: `${TAG} erasure request` });
    if (r.error) return r.error.message;
    const c = (await service.from("cases").select("candidate_name, erased_at, reference, candidate_id").eq("id", case2).single()).data;
    if (c?.candidate_name !== "Erased candidate" || !c.erased_at) return "the case still shows the candidate";
    const shared = (await service.from("candidates").select("full_name, erased_at").eq("id", c.candidate_id).single()).data;
    if (shared?.erased_at || shared?.full_name !== candidateName) return "the candidate shared with a live case was erased";
    const logged = await service.from("system_events").select("id").eq("kind", "data.erased").contains("context", { case_id: case2 });
    return logged.data?.length ? true : "the erasure was not recorded";
  });

  // ---------------------------------------------------------------- the app itself

  const appOrigin = arg("app")?.replace(/\/+$/, "");
  if (appOrigin) {
    section(`The app at ${appOrigin} against this backend`);
    const { createServerClient } = await import("@supabase/ssr");
    // Session cookies exactly as @supabase/ssr writes them in the app.
    const cookieHeader = async (db: DB) => {
      const session = (await db.auth.getSession()).data.session;
      if (!session) throw new Error("no session");
      const jar = new Map<string, string>();
      const ssr = createServerClient(url, publishable, {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (list) => {
            for (const c of list) {
              if (c.value) jar.set(c.name, c.value);
              else jar.delete(c.name);
            }
          },
        },
      });
      const { error } = await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      if (error) throw new Error(error.message);
      return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
    };
    const get = (path: string, cookie?: string) => fetch(`${appOrigin}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const isRedirect = (res: Response, path: string) =>
      res.status >= 300 && res.status < 400 && new URL(res.headers.get("location") ?? "/", appOrigin).pathname === path;
    const streamedRedirect = (html: string, path: string) => html.includes("NEXT_REDIRECT") && html.includes(path);
    const where = (res: Response) => `HTTP ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}`;

    await check("The sign-in page renders with the Ontriq brand", async () => {
      const res = await get("/login");
      const html = await res.text();
      return res.status === 200 && /Ontriq/i.test(html) ? true : where(res);
    });

    await check("Private pages send signed-out visitors to sign in", async () => {
      const res = await get("/app/team");
      return isRedirect(res, "/login") ? true : where(res);
    });

    await check("The scheduler endpoint refuses callers without the secret", async () => {
      const res = await fetch(`${appOrigin}/api/jobs/tick`, { method: "POST" });
      return expectEq(res.status, 401, "status");
    });

    await check("The scheduler endpoint runs with the secret", async () => {
      const res = await fetch(`${appOrigin}/api/jobs/tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
      return res.ok ? true : where(res);
    });

    await check("The health check passes", async () => {
      const res = await get("/api/health");
      const body = await res.text();
      return res.ok ? true : `${where(res)} ${body.slice(0, 300)}`;
    });

    await check("An emailed invite link signs the person in and opens account setup", async () => {
      const email = `sim-${RUN}-invitee2@${domain}`;
      const link = await service.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: "Sim Invitee Two" } } });
      if (link.error) return link.error.message;
      made.users.push(link.data.user.id);
      await service.auth.admin.updateUserById(link.data.user.id, { app_metadata: { kind: "staff", org_id: ORG_ID } });
      const m = await admin.db
        .from("memberships")
        .insert({ org_id: ORG_ID, user_id: link.data.user.id, kind: "staff", role_id: roleId("viewer"), status: "invited", invited_by: admin.id })
        .select("id")
        .single();
      if (m.error) return m.error.message;
      made.entityIds.push(m.data.id);
      const res = await get(`/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=invite&next=/accept-invite`);
      if (!isRedirect(res, "/accept-invite")) return where(res);
      const cookies = res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .filter((c) => c.startsWith("sb-"));
      if (!cookies.length) return "no session cookie was set";
      const page = await get("/accept-invite", cookies.join("; "));
      const html = await page.text();
      return page.status === 200 && /password/i.test(html) && !html.includes("NEXT_REDIRECT") ? true : where(page);
    });

    await check(mfaOn ? "Staff without a second factor are sent to verify" : "Two-step is off: staff open the app with a password alone", async () => {
      const db = anon();
      const s = await db.auth.signInWithPassword({ email: ops.email, password: ops.password });
      if (s.error) return s.error.message;
      const cookie = await cookieHeader(db);
      const res = await get("/app", cookie);
      const html = await res.text();
      if (!mfaOn) {
        const mfaPage = await get("/mfa?next=%2Fapp", cookie);
        const sendsOn = isRedirect(mfaPage, "/app") || streamedRedirect(await mfaPage.text(), "/app");
        return res.status === 200 && !html.includes("NEXT_REDIRECT") && sendsOn ? true : `${where(res)}; /mfa forwards: ${sendsOn}`;
      }
      if (isRedirect(res, "/mfa")) return true;
      return streamedRedirect(html, "/mfa") ? true : where(res);
    });

    await check("Staff with two-step verification open the dashboard", async () => {
      const res = await get("/app", await cookieHeader(ops.db));
      const html = await res.text();
      if (res.status !== 200 || html.includes("NEXT_REDIRECT")) return where(res);
      return html.includes("Sim ops") ? true : "the dashboard did not show who is signed in";
    });

    await check("Admins see the whole team on the Team page", async () => {
      const res = await get("/app/team", await cookieHeader(admin.db));
      const html = await res.text();
      const missing = team.filter((p) => p.kind === "staff").map((p) => `Sim ${p.label}`).filter((n) => !html.includes(n));
      return missing.length ? `${where(res)}, missing ${missing.join(", ")}` : true;
    });

    await check("The Team page stays closed to a viewer", async () => {
      const html = await (await get("/app/team", await cookieHeader(viewer.db))).text();
      return html.includes("Sim relations") ? "the member list was rendered" : true;
    });

    await check("Admins open Settings", async () => {
      const res = await get("/app/settings", await cookieHeader(admin.db));
      const html = await res.text();
      return res.status === 200 && !html.includes("NEXT_REDIRECT") ? true : where(res);
    });

    await check("Settings stay closed to a viewer", async () => {
      const res = await get("/app/settings", await cookieHeader(viewer.db));
      const html = await res.text();
      return isRedirect(res, "/app") || streamedRedirect(html, "/app") ? true : where(res);
    });

    await check("Client users are routed to their own portal", async () => {
      const cookie = await cookieHeader(alphaUser.db);
      const res = await get("/app", cookie);
      if (!isRedirect(res, "/portal")) return `/app gave ${where(res)}`;
      const html = await (await get("/portal", cookie)).text();
      if (!html.includes(`${TAG} Alpha Holdings`)) return "the portal did not show their company";
      return html.includes(`${TAG} Beta Finance`) ? "the portal showed another company" : true;
    });

    await check("Staff are kept out of the portal", async () => {
      const res = await get("/portal", await cookieHeader(admin.db));
      return isRedirect(res, "/app") ? true : where(res);
    });

    await check("A case document opens only for staff allowed to see it", async () => {
      if (!policeDoc) return "no document to open";
      const manager = await get(`/api/files/${policeDoc}`, await cookieHeader(ops.db));
      const officer = await get(`/api/files/${policeDoc}`, await cookieHeader(verifier.db));
      const okRedirect = manager.status === 302 && /\/storage\/v1\/object\/sign\//.test(manager.headers.get("location") ?? "");
      return okRedirect && officer.status === 404 ? true : `manager ${manager.status}, officer ${officer.status}`;
    });

    await check("The case page opens for its officer", async () => {
      const res = await get(`/app/cases/${case1}`, await cookieHeader(verifier.db));
      const html = await res.text();
      return res.status === 200 && html.includes(reference) && !html.includes("NEXT_REDIRECT") ? true : where(res);
    });

    await check("Global search answers staff over the API", async () => {
      const res = await get(`/api/search?q=${encodeURIComponent(reference)}`, await cookieHeader(viewer.db));
      const body = (await res.json()) as { hits?: { id: string }[] };
      return res.ok && body.hits?.some((h) => h.id === case1) ? true : `${where(res)} ${JSON.stringify(body).slice(0, 120)}`;
    });

    await check("A candidate link opens the private page and leaves the address bar", async () => {
      if (!portalLinkSecret) return "no link to open";
      const res = await get(`/c/${portalLinkSecret}`);
      if (!isRedirect(res, "/c/session")) return where(res);
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("ontriq_candidate="));
      if (!cookie) return "no candidate session cookie";
      const page = await get("/c/session", cookie);
      const html = await page.text();
      if (page.status !== 200 || !html.includes(`${TAG} Alpha Holdings`)) return `${where(page)}: the page did not show the client`;
      const bare = await (await get("/c/session")).text();
      return bare.includes(`${TAG} Alpha Holdings`) ? "the page opened without a session" : true;
    });

    await check("An unknown candidate link shows the expired page", async () => {
      const res = await get(`/c/${newLinkSecret()}`);
      return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/c/expired") ? true : where(res);
    });

    await check("Clients open their case in the portal; other companies can't", async () => {
      const mine = await get(`/portal/cases/${case4}`, await cookieHeader(alphaAdmin.db));
      const html = await mine.text();
      if (mine.status !== 200 || !html.includes(case4Reference)) return where(mine);
      if (html.includes("INTERNAL NOTE")) return "an internal note reached the portal page";
      const theirs = await (await get(`/portal/cases/${case4}`, await cookieHeader(betaUser.db))).text();
      return theirs.includes(case4Reference) ? "another company saw the case" : true;
    });

    await check("Staff see the candidate panel and the client's portal settings", async () => {
      const cookie = await cookieHeader(admin.db);
      const casePage = await (await get(`/app/cases/${case3}`, cookie)).text();
      if (!casePage.includes("Candidate") || !casePage.includes("Turned off")) return "the case page did not show the candidate link panel";
      const clientPage = await (await get(`/app/clients/${clientA}`, cookie)).text();
      const missing = ["Client portal", "They can see", "Sim alpha-admin"].filter((t) => !clientPage.includes(t));
      return missing.length ? `the client page is missing ${missing.join(", ")}` : true;
    });

    await check("Every portal page opens for a client admin with their own data", async () => {
      const cookie = await cookieHeader(alphaAdmin.db);
      const pages: [string, string][] = [
        ["/portal", `${TAG} Alpha Holdings`],
        [`/portal/cases?q=${RUN}`, case4Reference],
        ["/portal/cases/new", "New request"],
        ["/portal/packages", "Packages"],
        ["/portal/templates", "Templates"],
        ["/portal/reports", "Reports"],
        ["/portal/team", "Sim alpha-user"],
        ["/portal/settings", "Settings"],
      ];
      const bad: string[] = [];
      for (const [path, expect] of pages) {
        const res = await get(path, cookie);
        const html = await res.text();
        if (res.status !== 200 || html.includes("NEXT_REDIRECT") || !html.includes(expect)) bad.push(`${path} (${where(res)})`);
        if (html.includes(`${TAG} Beta Finance`)) bad.push(`${path} showed another company`);
      }
      return bad.length ? bad.join("; ") : true;
    });

    await check("A client viewer can't open team management or new requests", async () => {
      const cookie = await cookieHeader(alphaViewer.db);
      const team = await get("/portal/team", cookie);
      const teamHtml = await team.text();
      const fresh = await get("/portal/cases/new", cookie);
      const freshHtml = await fresh.text();
      const teamOut = isRedirect(team, "/portal") || streamedRedirect(teamHtml, "/portal");
      const newOut = isRedirect(fresh, "/portal/cases") || streamedRedirect(freshHtml, "/portal/cases");
      return teamOut && newOut && !teamHtml.includes("Sim alpha-user") ? true : `team ${where(team)}, new request ${where(fresh)}`;
    });

    await check("The candidate downloads their consent form", async () => {
      const res = await get(`/c/${portalLinkSecret}`);
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("ontriq_candidate="));
      if (!cookie) return "no candidate session";
      const pdf = await get("/c/session/consent-form", cookie);
      const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString();
      return pdf.status === 200 && head === "%PDF-" ? true : `${where(pdf)} ${pdf.headers.get("content-type")}`;
    });


    await check("The public verify page confirms a released report", async () => {
      const res = await get(`/verify/${finalId}`);
      const html = await res.text();
      return res.status === 200 && html.includes(reference) && !html.includes("NEXT_REDIRECT") ? true : where(res);
    });

    await check("Report and invoice PDFs open for the client and stay closed to others", async () => {
      const mine = await get(`/api/reports/${finalId}`, await cookieHeader(alphaAdmin.db));
      const theirs = await get(`/api/reports/${finalId}`, await cookieHeader(betaUser.db));
      if (mine.status !== 302 || theirs.status !== 404) return `report: client ${mine.status}, other ${theirs.status}`;
      if (!money.numbered) return true;
      const { data: doc } = await service.from("generated_documents").select("id").eq("entity_id", invoiceId).eq("kind", "invoice").eq("status", "ready").maybeSingle();
      if (!doc) return "the invoice PDF was not ready";
      const inv = await get(`/api/documents/${doc.id}`, await cookieHeader(alphaAdmin.db));
      const other = await get(`/api/documents/${doc.id}`, await cookieHeader(betaUser.db));
      const statement = await get(`/api/statements/${clientA}?from=2020-01-01&to=2100-01-01`, await cookieHeader(alphaAdmin.db));
      return inv.status === 302 && other.status === 404 && statement.status === 200 && statement.headers.get("content-type") === "application/pdf"
        ? true
        : `invoice ${inv.status}, other ${other.status}, statement ${statement.status}`;
    });

    await check("Clients open a shared document; internal ones stay closed", async () => {
      const cookie = await cookieHeader(alphaAdmin.db);
      const shared = await get(`/api/files/${sharedDoc}`, cookie);
      const internal = await get(`/api/files/${internalDoc}`, cookie);
      return shared.status === 302 && internal.status === 404 ? true : `shared ${shared.status}, internal ${internal.status}`;
    });

    await check("Phase 4 and 5 pages open for the right people", async () => {
      const bad: string[] = [];
      const page = async (who: Person, path: string, expect: string) => {
        const res = await get(path, await cookieHeader(who.db));
        const html = await res.text();
        if (res.status !== 200 || html.includes("NEXT_REDIRECT") || !html.includes(expect)) bad.push(`${who.label} ${path} (${where(res)})`);
      };
      await page(ops, "/app/team/performance", "Sim verifier");
      await page(verifier, "/app/team/performance", "scorecard");
      await page(ops, "/app/analytics", "Operations");
      await page(superAdmin, "/app/command", "Command");
      await page(admin, "/app/cases/import", "Import");
      const officer = await get("/app/analytics", await cookieHeader(verifier.db));
      const officerHtml = await officer.text();
      if (!(isRedirect(officer, "/app") || streamedRedirect(officerHtml, "/app"))) bad.push(`verifier /app/analytics (${where(officer)})`);
      const cmd = await get("/app/command", await cookieHeader(admin.db));
      const cmdHtml = await cmd.text();
      if (!(isRedirect(cmd, "/app") || streamedRedirect(cmdHtml, "/app"))) bad.push(`admin /app/command (${where(cmd)})`);
      return bad.length ? bad.join("; ") : true;
    });

    await check("The cases CSV export works for staff and is refused to clients", async () => {
      const csv = await get(`/api/exports/cases?stage=all&q=${encodeURIComponent(reference)}`, await cookieHeader(admin.db));
      const body = await csv.text();
      if (csv.status !== 200 || !/text\/csv/.test(csv.headers.get("content-type") ?? "") || !body.includes(reference)) return `admin ${where(csv)}`;
      const client = await get("/api/exports/cases", await cookieHeader(alphaUser.db));
      return client.status === 403 || isRedirect(client, "/portal") ? true : `client ${where(client)}`;
    });

    await check("Ask Ontriq answers over its stream (or says AI isn't set up) and stores the conversation", async () => {
      const res = await fetch(`${appOrigin}/api/assistant/chat`, {
        method: "POST",
        headers: { cookie: await cookieHeader(verifier.db), "content-type": "application/json" },
        body: JSON.stringify({ kind: "staff", text: "Which of my cases are overdue?" }),
      });
      const text = await res.text();
      if (res.status !== 200 || !text.includes("event: thread") || !text.includes("event: done")) return `HTTP ${res.status} ${text.slice(0, 120)}`;
      const { data: runs } = await service.from("ai_runs").select("id").eq("created_by", verifier.id);
      made.aiRuns.push(...(runs ?? []).map((r) => r.id));
      const stored = await verifier.db.from("assistant_messages").select("role").order("created_at");
      const roles = (stored.data ?? []).map((m) => m.role);
      if (!roles.includes("user") || !roles.includes("assistant")) return `stored ${roles.join(",")}`;
      const command = await fetch(`${appOrigin}/api/assistant/chat`, {
        method: "POST",
        headers: { cookie: await cookieHeader(verifier.db), "content-type": "application/json" },
        body: JSON.stringify({ kind: "command", text: "Show unpaid invoices" }),
      });
      return command.status === 403 ? true : `an officer reached the command assistant (HTTP ${command.status})`;
    });
  }

  // ---------------------------------------------------------------- clean-up

  section(keep ? "Leaving the simulation data in place (--keep)" : "Cleaning up everything the simulation created");
  if (!keep) {
    await check("Remove quotations, invoices, payments and reset document numbers", async () => {
      const inv = money.invoices;
      if (inv.length) {
        const pays = (await service.from("payments").select("id, slip_id").in("invoice_id", inv)).data ?? [];
        const notes = (await service.from("credit_notes").select("id").in("invoice_id", inv)).data ?? [];
        const slips = (await service.from("payment_slips").select("id").eq("client_id", clientA)).data ?? [];
        const items = (await service.from("invoice_items").select("id").in("invoice_id", inv)).data ?? [];
        made.entityIds.push(...inv, ...pays.map((p) => p.id), ...notes.map((n) => n.id), ...slips.map((x) => x.id), ...items.map((x) => x.id));
        const gd = (await service.from("generated_documents").select("id, storage_path").in("entity_id", [...inv, ...pays.map((p) => p.id), ...notes.map((n) => n.id)])).data ?? [];
        made.entityIds.push(...gd.map((g) => g.id));
        for (const g of gd) if (g.storage_path) made.objects.push({ bucket: "documents", path: g.storage_path });
        await service.from("payments").delete().in("invoice_id", inv);
        await service.from("credit_notes").delete().in("invoice_id", inv);
        await service.from("payment_slips").delete().eq("client_id", clientA);
        await service.from("invoices").delete().in("id", inv);
        await service.from("generated_documents").delete().in("id", gd.map((g) => g.id));
        const jobs = (await service.from("jobs").select("id").in("entity_id", gd.map((g) => g.id))).data ?? [];
        made.jobs.push(...jobs.map((j) => j.id));
      }
      if (money.quotes.length) {
        const items = (await service.from("quote_items").select("id").in("quote_id", money.quotes)).data ?? [];
        const prices = (await service.from("client_price_lists").select("id").in("source_quote_id", money.quotes)).data ?? [];
        const gd = (await service.from("generated_documents").select("id, storage_path").in("entity_id", money.quotes)).data ?? [];
        made.entityIds.push(...money.quotes, ...items.map((x) => x.id), ...prices.map((x) => x.id), ...gd.map((g) => g.id));
        for (const g of gd) if (g.storage_path) made.objects.push({ bucket: "documents", path: g.storage_path });
        const jobs = (await service.from("jobs").select("id").in("entity_id", gd.map((g) => g.id))).data ?? [];
        made.jobs.push(...jobs.map((j) => j.id));
        await service.from("client_price_lists").delete().in("source_quote_id", money.quotes);
        await service.from("generated_documents").delete().in("id", gd.map((g) => g.id));
        await service.from("quotes").delete().in("id", money.quotes);
      }
      const reports = (await service.from("report_versions").select("id, storage_path, job_id").in("case_id", made.cases)).data ?? [];
      made.entityIds.push(...reports.map((r) => r.id));
      made.jobs.push(...(reports.map((r) => r.job_id).filter(Boolean) as string[]));
      for (const r of reports) if (r.storage_path) made.objects.push({ bucket: "reports", path: r.storage_path });
      if (money.numbered) {
        // Give the numbers back: nothing real exists in these series (checked before numbering).
        const year = new Date().getFullYear();
        for (const kind of ["quote", "invoice", "receipt", "credit_note"]) await service.from("document_counters").delete().eq("org_id", ORG_ID).eq("kind", kind).eq("year", year);
      }
    });
    await check("Remove case data and reset the case counter", async () => {
      const ids = made.cases;
      if (ids.length) {
        for (const t of ["case_checks", "case_check_requirements", "documents"] as const) {
          const { data } = await service.from(t).select("id").in("case_id", ids);
          made.entityIds.push(...(data ?? []).map((r) => r.id));
        }
        made.entityIds.push(...ids, ...made.candidates);
        const { data: jobs } = await service.from("jobs").select("id").in("entity_id", ids);
        made.jobs.push(...(jobs ?? []).map((j) => j.id));
        // Email copies of the throwaway people's notifications.
        const { data: notes } = await service.from("notifications").select("id").in("user_id", made.users);
        const noteIds = (notes ?? []).map((n) => n.id);
        for (let i = 0; i < noteIds.length; i += 100) {
          const { data: nj } = await service.from("jobs").select("id").in("entity_id", noteIds.slice(i, i + 100));
          made.jobs.push(...(nj ?? []).map((j) => j.id));
          const { data: no } = await service.from("email_outbox").select("id").eq("entity_type", "notification").in("entity_id", noteIds.slice(i, i + 100));
          made.outbox.push(...(no ?? []).map((o) => o.id));
        }
        await service.from("cases").delete().in("id", ids);
        await service.from("candidates").delete().in("id", made.candidates);
      }
      if (made.checkTypes.length) await service.from("check_types").delete().in("id", made.checkTypes);
      // Give the numbers back so real cases start where they would have.
      const year = new Date().getFullYear();
      const { data: rest } = await service.from("cases").select("reference").eq("org_id", ORG_ID).like("reference", `ONT-${year}-%`);
      const max = Math.max(0, ...(rest ?? []).map((r) => Number(r.reference.split("-").pop())));
      if (max === 0) await service.from("case_counters").delete().eq("org_id", ORG_ID).eq("year", year);
      else await service.from("case_counters").update({ value: max }).eq("org_id", ORG_ID).eq("year", year);
    });
    await check("Remove files", async () => {
      for (const bucket of ["documents", "org-assets", "case-files", "reports"]) {
        const paths = made.objects.filter((o) => o.bucket === bucket).map((o) => o.path);
        if (paths.length) await service.storage.from(bucket).remove(paths);
      }
    });
    await check("Remove AI suggestions, pushes, conversations and erasure records", async () => {
      const ids = made.cases;
      if (extra.suggestions.length) await service.from("ai_suggestions").delete().in("id", extra.suggestions);
      if (ids.length) {
        await service.from("ai_suggestions").delete().eq("entity_type", "case").in("entity_id", ids);
        await service.from("system_events").delete().eq("kind", "data.erased").in("context->>case_id", ids);
      }
      await service.from("nudges").delete().in("to_user", made.users);
      await service.from("assistant_threads").delete().in("user_id", made.users);
      await service.from("assistant_memories").delete().in("user_id", made.users);
      for (const u of made.users) await service.from("rate_limit_hits").delete().like("key", `assistant:${u}%`);
    });
    await check("Remove jobs, outbox, AI runs, counters and limits", async () => {
      await service.from("job_failures").delete().in("job_id", made.jobs);
      await service.from("jobs").delete().in("id", made.jobs);
      await service.from("communications").delete().in("email_outbox_id", made.outbox);
      await service.from("email_outbox").delete().in("id", made.outbox);
      await service.from("ai_runs").delete().in("id", made.aiRuns);
      await service.from("document_counters").delete().eq("kind", simKind);
      await service.from("document_series").delete().eq("kind", simKind);
      await service.from("rate_limit_hits").delete().like("key", `sim:${RUN}%`);
      await service.from("job_workers").delete().eq("worker_id", `sim-${RUN}`);
    });
    await check("Remove invitations, designations and client companies", async () => {
      await service.from("invitations").delete().like("email", `%${RUN}%`);
      await service.from("roles").delete().in("id", made.roles);
      await service.from("clients").delete().in("id", made.clients);
    });
    await check("Remove the throwaway people", async () => {
      for (const id of made.users) {
        const { error } = await service.auth.admin.deleteUser(id);
        if (error && !/not found/i.test(error.message)) return error.message;
      }
    });
    await check("Remove the simulation's audit entries", async () => {
      await service.from("audit_log").delete().in("actor_id", made.users);
      const ids = [...made.entityIds, ...made.clients, ...made.roles, ...made.invitations];
      for (let i = 0; i < ids.length; i += 50) await service.from("audit_log").delete().in("row_id", ids.slice(i, i + 50));
      // Tables audited under composite keys: document_series (org_id:kind), role_permissions (role_id:permission).
      await service.from("audit_log").delete().eq("row_id", `${ORG_ID}:${simKind}`);
      for (const role of made.roles) await service.from("audit_log").delete().like("row_id", `${role}:%`);
    });
    await check("Nothing from the simulation is left behind", async () => {
      const left = {
        users: (await service.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => u.email?.includes(RUN)).length,
        clients: (await service.from("clients").select("id").like("code", `${TAG}%`)).data?.length ?? 0,
        roles: (await service.from("roles").select("id").like("key", `sim_${RUN}%`)).data?.length ?? 0,
        invitations: (await service.from("invitations").select("id").like("email", `%${RUN}%`)).data?.length ?? 0,
        jobs: (await service.from("jobs").select("id").in("id", made.jobs)).data?.length ?? 0,
        audit:
          ((await service.from("audit_log").select("id").in("actor_id", made.users)).data?.length ?? 0) +
          ((await service.from("audit_log").select("id").eq("row_id", `${ORG_ID}:${simKind}`)).data?.length ?? 0) +
          ((await service.from("audit_log").select("id").in("row_id", [...made.clients, ...made.roles, ...made.entityIds].slice(0, 100))).data?.length ?? 0),
        files: (await service.storage.from("documents").list(`sim/${RUN}`)).data?.length ?? 0,
        cases: (await service.from("cases").select("id").in("id", made.cases)).data?.length ?? 0,
        candidates: (await service.from("candidates").select("id").in("id", made.candidates)).data?.length ?? 0,
        caseFiles: (await Promise.all(made.objects.filter((o) => o.bucket === "case-files").map((o) => service.storage.from("case-files").exists(o.path)))).filter((e) => e.data).length,
      };
      return Object.values(left).every((n) => n === 0) ? true : `left behind ${JSON.stringify(left)}`;
    });
  }

  // ---------------------------------------------------------------- report

  const failed = results.filter((r) => !r.ok);
  const areas = [...new Set(results.map((r) => r.area))];
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. JWT alg ${jwtAlg || "unknown"}.`);
  if (failed.length) console.log(`Failed:\n${failed.map((f) => `  - [${f.area}] ${f.name}: ${f.detail}`).join("\n")}`);

  const reportPath = arg("report");
  if (reportPath) {
    const lines = [
      `# Simulation ${TAG}`,
      "",
      `Target: \`${new URL(url).host}\`. Run: ${startedAt.toISOString()}. Result: **${results.length - failed.length} of ${results.length} checks passed**.`,
      "",
      ...areas.flatMap((a) => [
        `## ${a}`,
        "",
        "| Check | Result |",
        "|---|---|",
        ...results.filter((r) => r.area === a).map((r) => `| ${r.name} | ${r.ok ? "Pass" : `**Fail**: ${r.detail?.replace(/\|/g, "/")}`} |`),
        "",
      ]),
    ];
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, lines.join("\n"));
    console.log(`Report written to ${reportPath}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
