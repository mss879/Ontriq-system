import "server-only";
import { cacheLife, prefetch } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/domain/permissions";
import { AuthError } from "./errors";
import { ttlMemo } from "./ttl-memo";

/** Who is using the app. A narrow, serialisable DTO: safe to hand to Client Components. */
export type Viewer = {
  userId: string;
  email: string;
  fullName: string;
  orgId: string;
  orgName: string;
  kind: "staff" | "client";
  clientId: string | null;
  clientName: string | null;
  roleKey: string;
  roleName: string;
  permissions: string[];
  status: "active" | "invited";
  mfaRequired: boolean;
  aal: "aal1" | "aal2";
};

export type ViewerState =
  | { state: "signed-out" }
  | { state: "no-access"; email: string }
  | { state: "invited"; viewer: Viewer }
  | { state: "mfa-required"; viewer: Viewer }
  | { state: "ready"; viewer: Viewer };

type MembershipJson = {
  user_id: string;
  org_id: string;
  org_name: string;
  kind: "staff" | "client";
  client_id: string | null;
  client_name?: string | null;
  status: "active" | "invited";
  role_key: string;
  role_name: string;
  permissions: string[];
  mfa_required: boolean;
  aal: string;
  full_name: string;
  email: string;
};

/**
 * Page views reuse a membership for a minute, which saves a database round trip
 * on each click. Row level security still guards their reads, and Server Actions
 * and Route Handlers always read the membership fresh. A page that reads with the
 * service role has no such guard, so it asks `hasFreshPermission` first.
 */
const pageMemberships = ttlMemo<MembershipJson>(60_000, 500);

/**
 * Reads the auth cookie, verifies the JWT and loads the membership in one RPC.
 * Uncached by default: use directly in Server Actions and Route Handlers. A
 * fresh read also drops this session's reused copy, so a change the caller is
 * about to make shows on the next page.
 */
export async function loadViewerState(opts?: { reuseMembership?: boolean }): Promise<ViewerState> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return { state: "signed-out" };

  const sessionKey = `${claims.sub}:${String(claims.session_id ?? "")}`;
  if (!opts?.reuseMembership) pageMemberships.delete(sessionKey);
  let m = opts?.reuseMembership ? pageMemberships.get(sessionKey) : undefined;
  if (!m) {
    const { data, error } = await supabase.rpc("my_membership");
    if (error || !data) return { state: "no-access", email: String(claims.email ?? "") };
    m = data as MembershipJson;
    // Someone invited moves on as soon as they accept, so only settled members are reused.
    if (opts?.reuseMembership && m.status === "active") pageMemberships.set(sessionKey, m);
  }

  const aal = (claims.aal === "aal2" ? "aal2" : "aal1") as Viewer["aal"];
  const viewer: Viewer = {
    userId: m.user_id,
    email: m.email || String(claims.email ?? ""),
    fullName: m.full_name,
    orgId: m.org_id,
    orgName: m.org_name,
    kind: m.kind,
    clientId: m.client_id,
    clientName: m.client_name ?? null,
    roleKey: m.role_key,
    roleName: m.role_name,
    permissions: m.permissions ?? [],
    status: m.status,
    mfaRequired: m.mfa_required,
    aal,
  };

  if (viewer.status === "invited") return { state: "invited", viewer };
  if (viewer.kind === "staff" && viewer.mfaRequired && aal !== "aal2") return { state: "mfa-required", viewer };
  return { state: "ready", viewer };
}

/**
 * Server Components only. Redirects to the right screen when the user is not
 * ready. `prefetch()` keeps the session read out of each route's App Shell, so a
 * link loads the shell as static output. Without it every prefetch ran on a
 * function, and the click that followed had to wait for it or start another.
 */
export async function getViewer(): Promise<Viewer> {
  await prefetch();
  return readyViewer();
}

/** Request-scoped dedupe via `use cache: private` (stale: Infinity so it never lowers the route's client stale time). */
async function readyViewer(): Promise<Viewer> {
  "use cache: private";
  cacheLife({ stale: Infinity });
  const result = await loadViewerState({ reuseMembership: true });
  switch (result.state) {
    case "signed-out":
      redirect("/login");
    case "no-access":
      redirect("/login?error=no-access");
    case "invited":
      redirect("/accept-invite");
    case "mfa-required":
      redirect("/mfa");
    case "ready":
      return result.viewer;
  }
}

export async function getStaffViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.kind !== "staff") redirect("/portal");
  return viewer;
}

export async function getClientViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.kind !== "client") redirect("/app");
  return viewer;
}

/**
 * Server Actions and Route Handlers. Throws AuthError; never redirects.
 * Every action calls this, even when the page already checked.
 */
export async function requireViewer(opts?: { kind?: Viewer["kind"]; permission?: Permission; anyOf?: Permission[] }) {
  const result = await loadViewerState();
  if (result.state === "signed-out" || result.state === "no-access") throw new AuthError("unauthenticated");
  if (result.state === "mfa-required") throw new AuthError("mfa_required");
  if (result.state === "invited") throw new AuthError("inactive");
  const viewer = result.viewer;
  if (opts?.kind && viewer.kind !== opts.kind) throw new AuthError("forbidden");
  if (opts?.permission && !can(viewer, opts.permission)) throw new AuthError("forbidden");
  if (opts?.anyOf && !opts.anyOf.some((p) => can(viewer, p))) throw new AuthError("forbidden");
  return viewer;
}

/** For a page about to read with the service role, which row level security can't stop. */
export async function hasFreshPermission(permission: Permission): Promise<boolean> {
  const result = await loadViewerState();
  return result.state === "ready" && can(result.viewer, permission);
}

/** Where a signed-in person should land. */
export function homeFor(viewer: Pick<Viewer, "kind">): "/app" | "/portal" {
  return viewer.kind === "client" ? "/portal" : "/app";
}
