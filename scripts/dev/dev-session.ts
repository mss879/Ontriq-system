/**
 * Throwaway local users for any role, and their session cookies, for the dev
 * scripts (as-user.ts, browser-smoke.ts). Local stack only. Users are created
 * once per role/client and reused; their random password and authenticator
 * secret live in ~/.ontriq/local-stack/dev-users.json (mode 600) and are never
 * printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { totp } from "../local-stack/totp";

export const ORG = "00000000-0000-4000-8000-000000000001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local stack only");

const store = path.join(homedir(), ".ontiq/local-stack/dev-users.json");
type Saved = Record<string, { email: string; password: string; id: string; totp?: string }>;
const saved: Saved = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {};
const save = () => {
  mkdirSync(path.dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify(saved, null, 2), { mode: 0o600 });
};

const isClientRole = (role: string) => role.startsWith("client_") && role !== "client_relations";

export async function ensureUser(role: string, clientId?: string) {
  const key = `${role}:${clientId ?? ""}`;
  if (saved[key]) return { key, ...saved[key] };
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const kind = isClientRole(role) ? "client" : "staff";
  if (kind === "client" && !clientId) throw new Error("client roles need --client <id>");
  const email = `dev-${role}-${randomBytes(3).toString("hex")}@dev.ontriq.test`;
  const password = `${randomBytes(12).toString("base64url")}Aa1!`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Dev ${role.replace(/_/g, " ")}` }, app_metadata: { kind, org_id: ORG } });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const { data: r } = await service.from("roles").select("id").eq("org_id", ORG).eq("key", role).single();
  if (!r) throw new Error(`no role ${role}`);
  const m = await service.from("memberships").insert({ org_id: ORG, user_id: data.user.id, kind, client_id: kind === "client" ? clientId : null, role_id: r.id, status: "active" });
  if (m.error) throw new Error(`membership: ${m.error.message}`);
  saved[key] = { email, password, id: data.user.id };
  save();
  return { key, ...saved[key] };
}

/** Signs the user in (staff reach aal2 with a local authenticator) and returns the @supabase/ssr cookies. */
export async function sessionCookies(role: string, clientId?: string): Promise<{ userId: string; cookies: { name: string; value: string }[] }> {
  const user = await ensureUser(role, clientId);
  const db = createClient(url, anonKey, { auth: { persistSession: false } });
  const s = await db.auth.signInWithPassword({ email: user.email, password: user.password });
  if (s.error || !s.data.session) throw new Error(`sign-in: ${s.error?.message}`);
  if (!isClientRole(role)) {
    if (!saved[user.key].totp) {
      const f = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "dev" });
      if (f.error || !f.data) throw new Error(`mfa enroll: ${f.error?.message}`);
      const v = await db.auth.mfa.challengeAndVerify({ factorId: f.data.id, code: totp(f.data.totp.secret) });
      if (v.error) throw new Error(`mfa verify: ${v.error.message}`);
      saved[user.key] = { ...saved[user.key], totp: f.data.totp.secret };
      save();
    } else {
      const factors = await db.auth.mfa.listFactors();
      const factor = factors.data?.totp?.[0];
      if (!factor) throw new Error("no authenticator enrolled");
      const v = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(saved[user.key].totp!) });
      if (v.error) throw new Error(`mfa verify: ${v.error.message}`);
    }
  }
  const session = (await db.auth.getSession()).data.session!;
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return { userId: user.id, cookies: [...jar].map(([name, value]) => ({ name, value })) };
}

export async function cookieHeader(role: string, clientId?: string): Promise<string> {
  return (await sessionCookies(role, clientId)).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
