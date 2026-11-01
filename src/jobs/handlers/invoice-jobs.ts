import { NonRetryableError, type JobHandler } from "../types";
import { nextInvoiceReminder } from "../../domain/pricing/invoice-core";
import { invoiceReminderEmail } from "../../domain/email/commercial-templates";
import { DEFAULT_BRAND } from "../../domain/email/layout";
import { fileBlock, isAiConfigured, runStructured } from "../../lib/ai/claude";
import { SLIP_SYSTEM, SLIP_VERSION, SlipSchema } from "../../lib/ai/prompts";

const originOf = () => (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** invoice.draft: a case released under per-case billing, or a client's month. */
export const invoiceDraft: JobHandler = async (job, { admin }) => {
  const p = (job.payload ?? {}) as { case_id?: string; client_id?: string; month?: string };
  if (p.case_id) {
    const { data, error } = await admin.rpc("draft_case_invoice", { p_case: p.case_id });
    if (error) throw new Error(`draft_case_invoice: ${error.message}`);
    return { invoice_id: data };
  }
  if (p.client_id && p.month) {
    const { data, error } = await admin.rpc("draft_monthly_invoice", { p_client: p.client_id, p_month: p.month });
    if (error) throw new Error(`draft_monthly_invoice: ${error.message}`);
    return { invoice_id: data };
  }
  throw new NonRetryableError("invoice.draft needs case_id, or client_id and month");
};

/** invoice.reminders (hourly): the ladder in src/domain/pricing/invoice-core.ts. */
export const invoiceReminders: JobHandler = async (_job, { admin }) => {
  const { data, error } = await admin.rpc("invoice_reminder_candidates");
  if (error) throw new Error(`invoice_reminder_candidates: ${error.message}`);
  const now = new Date();
  const origin = originOf();
  const brand = { ...DEFAULT_BRAND, logoUrl: `${origin}/brand/ontriq-logo.png` };
  let sent = 0;
  for (const r of (data ?? []) as {
    invoice_id: string; org_id: string; client_name: string; number: string; currency: string; balance: number; due_date: string; steps_sent: string[]; paused: boolean; to_emails: string[];
  }[]) {
    const step = nextInvoiceReminder({ dueDate: r.due_date, balance: Number(r.balance), stepsSent: r.steps_sent ?? [], paused: r.paused }, now);
    if (!step) continue;
    if (step !== "escalated") {
      if (!r.to_emails?.length) continue;
      const { data: org } = await admin.from("orgs").select("name, branding").eq("id", r.org_id).single();
      const orgName = ((org?.branding ?? {}) as Record<string, string>).display_name || org?.name || "Ontriq";
      const mail = invoiceReminderEmail(
        { step, clientName: r.client_name, orgName, number: r.number, balance: Number(r.balance), currency: r.currency, dueDate: r.due_date, url: `${origin}/portal/invoices/${r.invoice_id}` },
        brand,
      );
      const q = await admin.rpc("queue_email", { p_to: r.to_emails, p_subject: mail.subject, p_html: mail.html, p_text: mail.text, p_template_key: `invoice.${step}`, p_entity_type: "invoice", p_entity_id: r.invoice_id, p_org: r.org_id });
      if (q.error) throw new Error(`queue_email: ${q.error.message}`);
    }
    await admin.rpc("record_invoice_reminder", { p_invoice: r.invoice_id, p_step: step, p_to: r.to_emails ?? [] });
    sent++;
  }
  return { sent };
};

/** ai.slip_read: read a payment slip so finance can match it in one click. Staff always confirm. */
export const aiSlipRead: JobHandler = async (job, { admin }) => {
  const slipId = (job.payload as { slip_id?: string } | null)?.slip_id;
  if (!slipId) throw new NonRetryableError("ai.slip_read job without slip_id");
  const { data: slip } = await admin.from("payment_slips").select("id, org_id, client_id, storage_bucket, storage_path, mime, status").eq("id", slipId).maybeSingle();
  if (!slip || slip.status !== "pending") return { skipped: "not pending" };
  if (!isAiConfigured()) {
    await admin.from("payment_slips").update({ ai_extraction: { skipped: "AI is not set up" } }).eq("id", slip.id);
    return { skipped: "not configured" };
  }
  const file = await admin.storage.from(slip.storage_bucket).download(slip.storage_path);
  if (!file.data) throw new Error("slip file missing");
  const block = fileBlock(new Uint8Array(await file.data.arrayBuffer()), slip.mime);
  if (!block) {
    await admin.from("payment_slips").update({ ai_extraction: { skipped: "file type not readable" } }).eq("id", slip.id);
    return { skipped: "unreadable" };
  }
  const result = await runStructured(admin, "payment.slip", { orgId: slip.org_id, clientId: slip.client_id, jobId: job.id, source: "jobs/ai-slip-read", promptVersion: SLIP_VERSION }, {
    system: SLIP_SYSTEM,
    content: [block, { type: "text", text: "Read this payment slip." }],
    schema: SlipSchema,
  });
  if (!result.ok && result.reason === "unavailable") throw new Error(result.message);
  await admin
    .from("payment_slips")
    .update({ ai_extraction: result.ok ? { ...result.data, model: result.model } : { skipped: result.message } })
    .eq("id", slip.id);
  return result.ok ? { amount: result.data.amount, confidence: result.data.confidence } : { skipped: result.reason };
};
