import "server-only";
import { invoiceReminderEmail } from "@/domain/email/commercial-templates";
import { appOrigin } from "@/lib/env";
import { emailBrand } from "@/lib/server/email-brand";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { invoiceRecipients } from "@/lib/server/billing/recipients";
import type { ToolContext } from "./tools";

/**
 * A payment reminder sent now, at someone's request (the assistant's bulk
 * card). The invoice is read as the person, so they must be able to see it;
 * the copy follows how late it is. Returns false when nobody can receive it.
 */
export async function sendInvoiceReminderNow(ctx: ToolContext, invoiceId: string): Promise<boolean> {
  const { data: inv } = await ctx.supabase
    .from("invoices")
    .select("id, number, status, balance, currency, due_date, client_id, client:clients(name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv || !inv.number || !["sent", "viewed", "partially_paid"].includes(inv.status) || Number(inv.balance) <= 0) return false;
  const to = (await invoiceRecipients(inv.client_id)).filter((r) => r.preselected).map((r) => r.email);
  if (!to.length) return false;
  const late = inv.due_date ? Math.floor((Date.now() - Date.parse(`${inv.due_date}T00:00:00+05:30`)) / 86_400_000) : 0;
  const step = late >= 14 ? "late_14" : late >= 7 ? "late_7" : late >= 0 ? "due" : "before_due";
  const mail = invoiceReminderEmail(
    {
      step,
      clientName: (inv.client as unknown as { name: string }).name,
      orgName: ctx.viewer.orgName,
      number: inv.number,
      balance: Number(inv.balance),
      currency: inv.currency,
      dueDate: inv.due_date ?? "",
      url: `${appOrigin()}/portal/invoices/${inv.id}`,
    },
    emailBrand(),
  );
  await queueEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, templateKey: "invoice.manual_reminder", entityType: "invoice", entityId: inv.id, createdBy: ctx.viewer.userId, orgId: ctx.viewer.orgId });
  return true;
}
