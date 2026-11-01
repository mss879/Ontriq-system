import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin } from "@/lib/env";
import { emailBrand } from "@/lib/server/email-brand";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { reportReleasedEmail } from "@/domain/email/templates";

/**
 * A released report reaches portal users as a notification. A client's contacts
 * marked "Receives verification reports" may not have a portal login, so they
 * get an email too. Portal users aren't told twice. Best effort: the report is
 * already released, and a failed notice mustn't undo that.
 */
export async function noticeToReportContacts(caseId: string, actorId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data: c } = await admin.from("cases").select("id, org_id, reference, client_id, client_visible, org:orgs(name, branding)").eq("id", caseId).maybeSingle();
    if (!c?.client_visible) return 0;
    const [{ data: contacts }, { data: members }] = await Promise.all([
      admin.from("client_contacts").select("name, email").eq("client_id", c.client_id).eq("receives_reports", true).not("email", "is", null),
      admin.from("memberships").select("user_id").eq("client_id", c.client_id).eq("kind", "client").eq("status", "active"),
    ]);
    const ids = (members ?? []).map((m) => m.user_id);
    const { data: people } = ids.length ? await admin.from("profiles").select("email").in("id", ids) : { data: [] };
    const told = new Set((people ?? []).map((p) => p.email?.toLowerCase()));
    const org = c.org as { name: string; branding: Record<string, string> | null } | null;
    const orgName = org?.branding?.display_name || org?.name || "Ontriq";
    let sent = 0;
    for (const contact of contacts ?? []) {
      if (!contact.email || told.has(contact.email.toLowerCase())) continue;
      told.add(contact.email.toLowerCase());
      const mail = reportReleasedEmail({ contactName: contact.name ?? "", reference: c.reference, orgName, portalUrl: `${appOrigin()}/portal/cases/${c.id}`, hasPortal: ids.length > 0 }, emailBrand());
      await queueEmail({ to: [contact.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "report.released", entityType: "case", entityId: c.id, createdBy: actorId, orgId: c.org_id });
      sent += 1;
    }
    return sent;
  } catch (error) {
    console.warn("[report release] contact notice failed", error);
    return 0;
  }
}
