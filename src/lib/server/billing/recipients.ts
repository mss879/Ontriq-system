import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who an invoice goes to by default: the client's contacts marked to receive
 * invoices, and their portal users who may see invoices. Read with the
 * service role because portal users' emails live in profiles; call only
 * after the caller is known to have invoice access.
 */
export async function invoiceRecipients(clientId: string): Promise<{ email: string; name: string; source: "contact" | "portal"; preselected: boolean }[]> {
  const admin = createAdminClient();
  const [{ data: contacts }, { data: members }] = await Promise.all([
    admin.from("client_contacts").select("name, email, receives_invoices").eq("client_id", clientId).not("email", "is", null),
    admin.from("memberships").select("user_id, role_id").eq("client_id", clientId).eq("kind", "client").eq("status", "active"),
  ]);
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", userIds) : { data: [] };
  const profileOf = new Map((profiles ?? []).map((p) => [p.id, p]));
  const roleIds = [...new Set((members ?? []).map((m) => m.role_id))];
  const { data: perms } = roleIds.length
    ? await admin.from("role_permissions").select("role_id").in("role_id", roleIds).eq("permission", "portal.invoices.view")
    : { data: [] };
  const viewers = new Set((perms ?? []).map((p) => p.role_id));
  const out = new Map<string, { email: string; name: string; source: "contact" | "portal"; preselected: boolean }>();
  for (const c of contacts ?? []) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (email) out.set(email, { email, name: c.name, source: "contact", preselected: c.receives_invoices });
  }
  for (const m of members ?? []) {
    const p = profileOf.get(m.user_id);
    const email = (p?.email ?? "").trim().toLowerCase();
    if (!email || out.has(email)) continue;
    if (!viewers.has(m.role_id)) continue;
    out.set(email, { email, name: p?.full_name || email, source: "portal", preselected: true });
  }
  return [...out.values()];
}
