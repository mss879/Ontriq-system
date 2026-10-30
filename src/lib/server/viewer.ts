import "server-only";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/domain/permissions";
import { AuthError } from "./errors";

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
 * Uncached. Reads the auth cookie, verifies the JWT and loads the membership
 * in one RPC. Use directly in Server Actions and Route Handlers.
 */
export async function loadViewerState(): Promise<ViewerState> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return { state: "signed-out" };

  const { data, error } = await supabase.rpc("my_membership");
  const m = data as MembershipJson | null;
  if (error || !m) return { state: "no-access", email: String(claims.email ?? "") };

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
 * Server Components only. Request-scoped dedupe via `use cache: private`
 * (stale: Infinity so it never lowers the route's client stale time).
 * Redirects to the right screen when the user is not ready.
 */
export async function getViewer(): Promise<Viewer> {
  "use cache: private";
  cacheLife({ stale: Infinity });
  const result = await loadViewerState();
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

/** Where a signed-in person should land. */
export function homeFor(viewer: Pick<Viewer, "kind">): "/app" | "/portal" {
  return viewer.kind === "client" ? "/portal" : "/app";
}
