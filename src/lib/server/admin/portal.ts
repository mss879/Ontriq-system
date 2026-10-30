import "server-only";
import { createRequestClient } from "@/lib/supabase/server";
import { DEFAULT_PORTAL_VISIBILITY, type PortalVisibility } from "@/domain/portal/types";

/**
 * Staff reads for a client's portal: who has access, what Ontriq lets them
 * see (client_settings.visibility, applied by the portal functions in 0021),
 * portal options, and the packages the client built themselves.
 */

export type PortalUser = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: "active" | "invited" | "suspended";
  invitedAt: string | null;
  activatedAt: string | null;
  lastSentAt: string | null;
};

export async function getClientPortalUsers(clientId: string): Promise<PortalUser[]> {
  const supabase = await createRequestClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, status, invited_at, activated_at, role:roles(id, key, name)").eq("client_id", clientId).eq("kind", "client"),
    supabase.from("invitations").select("auth_user_id, last_sent_at").eq("client_id", clientId).eq("status", "pending"),
  ]);
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const sent = new Map((invites ?? []).map((i) => [i.auth_user_id, i.last_sent_at]));
  const order = { active: 0, invited: 1, suspended: 2 } as const;
  return (members ?? [])
    .map((m) => {
      const role = m.role as { id: string; key: string; name: string } | null;
      const p = byId.get(m.user_id);
      return {
        membershipId: m.id,
        userId: m.user_id,
        name: p?.full_name || p?.email || "Portal user",
        email: p?.email ?? "",
        roleId: role?.id ?? "",
        roleKey: role?.key ?? "",
        roleName: role?.name ?? "",
        status: m.status as PortalUser["status"],
        invitedAt: m.invited_at,
        activatedAt: m.activated_at,
        lastSentAt: sent.get(m.user_id) ?? null,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export async function getClientRoles(): Promise<{ id: string; key: string; name: string; description: string }[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("roles").select("id, key, name, description").eq("kind", "client").order("created_at");
  const rank: Record<string, number> = { client_admin: 0, client_user: 1, client_viewer: 2 };
  return (data ?? []).sort((a, b) => (rank[a.key] ?? 9) - (rank[b.key] ?? 9));
}

export type PortalOptions = { bulk_upload: boolean; client_packages: boolean; client_packages_need_approval: boolean };

export async function getClientPortalSettings(clientId: string): Promise<{ visibility: PortalVisibility; portal: PortalOptions }> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("client_settings").select("visibility, portal").eq("client_id", clientId).maybeSingle();
  const v = (data?.visibility ?? {}) as Partial<PortalVisibility>;
  const p = (data?.portal ?? {}) as Partial<PortalOptions>;
  return {
    visibility: { ...DEFAULT_PORTAL_VISIBILITY, ...v, hidden_check_types: Array.isArray(v.hidden_check_types) ? v.hidden_check_types : [] },
    portal: { bulk_upload: p.bulk_upload !== false, client_packages: p.client_packages !== false, client_packages_need_approval: p.client_packages_need_approval === true },
  };
}

export type ClientBuiltPackage = {
  id: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  needsApproval: boolean;
  currency: string;
  total: number;
  createdAt: string;
  items: { checkTypeId: string; name: string; unitPrice: number }[];
};

export async function getClientBuiltPackages(clientId: string): Promise<ClientBuiltPackage[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("packages")
    .select("id, name, code, description, is_active, needs_approval, currency, pricing_mode, fixed_price, created_at, items:package_items(check_type_id, unit_price, sort, check_type:check_types(name))")
    .eq("owner_scope", "client")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((p) => {
    const items = ((p.items ?? []) as { check_type_id: string; unit_price: number; sort: number; check_type: { name: string } | null }[])
      .sort((a, b) => a.sort - b.sort)
      .map((i) => ({ checkTypeId: i.check_type_id, name: i.check_type?.name ?? "Check", unitPrice: Number(i.unit_price) }));
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      isActive: p.is_active,
      needsApproval: p.needs_approval,
      currency: p.currency,
      total: p.pricing_mode === "fixed" && p.fixed_price !== null ? Number(p.fixed_price) : items.reduce((a, i) => a + i.unitPrice, 0),
      createdAt: p.created_at,
      items,
    };
  });
}
