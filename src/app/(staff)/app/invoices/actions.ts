"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { emailBrand } from "@/lib/server/email-brand";
import { appOrigin } from "@/lib/env";
import { invoiceEmail } from "@/domain/email/commercial-templates";
import type { Permission } from "@/domain/permissions";

/**
 * Invoice actions. Drafts are edited through row level security (invoices.manage,
 * drafts only: a trigger refuses changes to confirmed invoices); every status
 * change goes through the 0015 functions, which check permission and the rules.
 */

async function guarded<T extends object>(permission: Permission, run: (viewer: Viewer) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const viewer = await requireViewer({ kind: "staff", permission });
    return await run(viewer);
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const uuid = z.uuid();
const orNull = (v: string | null | undefined) => (v ?? null) as unknown as string;

// ---------------------------------------------------------------- drafting

const monthlySchema = z.object({ clientId: z.uuid("Choose a client."), month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month.") });

/** Every released, unbilled case of a client in a month, on one draft invoice. */
export async function draftMonthlyInvoice(input: z.input<typeof monthlySchema>): Promise<ActionResult<{ invoiceId: string }>> {
  return guarded("invoices.manage", async () => {
    const parsed = monthlySchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("draft_monthly_invoice", { p_client: parsed.data.clientId, p_month: `${parsed.data.month}-01` });
    if (error) return fail(rpcErrorMessage(error));
    if (!data) return fail("There are no released, unbilled cases for that client in that month.");
    refresh();
    return { ok: true, invoiceId: data };
  });
}

/** An empty manual invoice (for extra work, corrections, or anything not tied to a case). */
export async function createManualInvoice(clientId: string): Promise<ActionResult<{ invoiceId: string }>> {
  return guarded("invoices.manage", async (viewer) => {
    if (!uuid.safeParse(clientId).success) return fail("Choose a client.");
    const supabase = await createClient();
    const { data: client } = await supabase.from("clients").select("id, default_template").eq("id", clientId).maybeSingle();
    if (!client) return fail("That client no longer exists.");
    const { data: contact } = await supabase
      .from("client_contacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("receives_invoices", true)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const template = ["executive", "modern", "classic"].includes(client.default_template) ? client.default_template : "executive";
    const { data, error } = await supabase
      .from("invoices")
      .insert({ org_id: viewer.orgId, client_id: clientId, kind: "manual", status: "draft", template_key: template, contact_id: contact?.id ?? null })
      .select("id")
      .single();
    if (error || !data) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, invoiceId: data.id };
  });
}

const lineSchema = z.object({
  id: z.uuid().optional(),
  description: z.string().trim().min(1, "Describe each line.").max(500),
  quantity: z.coerce.number().positive("Quantity must be more than 0.").max(100000),
  unit_price: z.coerce.number().min(0, "Prices can't be negative.").max(100_000_000),
  discount_pct: z.coerce.number().min(0).max(100),
});
const draftSchema = z.object({
  lines: z.array(lineSchema).max(500),
  message: z.string().trim().max(2000),
  internal_notes: z.string().trim().max(4000),
  contact_id: z.uuid().nullable(),
  template_key: z.enum(["executive", "modern", "classic"]),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type InvoiceDraftInput = z.input<typeof draftSchema>;

/** Save a draft: details plus lines (kept lines are updated so their case links survive). */
export async function saveInvoiceDraft(invoiceId: string, input: InvoiceDraftInput): Promise<ActionResult> {
  return guarded("invoices.manage", async (viewer) => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the invoice lines.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: inv } = await supabase.from("invoices").select("id, status").eq("id", invoiceId).maybeSingle();
    if (!inv) return fail("That invoice no longer exists.");
    if (inv.status !== "draft") return fail("This invoice is confirmed; issue a credit note or void it instead.");

    const { error: upd } = await supabase
      .from("invoices")
      .update({ message: v.message, internal_notes: v.internal_notes, contact_id: v.contact_id, template_key: v.template_key, issue_date: v.issue_date })
      .eq("id", invoiceId);
    if (upd) return fail(rpcErrorMessage(upd));

    const { data: existing } = await supabase.from("invoice_items").select("id").eq("invoice_id", invoiceId);
    const current = new Set((existing ?? []).map((e) => e.id));
    const keep = new Set(v.lines.map((l) => l.id).filter((id): id is string => Boolean(id && current.has(id))));
    const gone = [...current].filter((id) => !keep.has(id));
    if (gone.length) {
      const { error } = await supabase.from("invoice_items").delete().in("id", gone);
      if (error) return fail(rpcErrorMessage(error));
    }
    for (const [i, l] of v.lines.entries()) {
      const row = { description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, sort: (i + 1) * 10 };
      const { error } = l.id && keep.has(l.id)
        ? await supabase.from("invoice_items").update(row).eq("id", l.id).eq("invoice_id", invoiceId)
        : await supabase.from("invoice_items").insert({ ...row, org_id: viewer.orgId, invoice_id: invoiceId });
      if (error) return fail(rpcErrorMessage(error));
    }
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- transitions

export async function confirmInvoice(invoiceId: string): Promise<ActionResult<{ number: string }>> {
  return guarded("invoices.manage", async () => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_invoice", { p_invoice: invoiceId });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker(); // render the PDF now
    refresh();
    return { ok: true, number: String((data as { number?: string } | null)?.number ?? "") };
  });
}

const sendSchema = z.object({
  to: z.array(z.email("One of the addresses is not valid.")).min(1, "Add at least one recipient.").max(20),
  message: z.string().trim().max(2000).optional(),
});

/** Email the client a link to the invoice in their portal, then mark it sent. */
export async function sendInvoice(invoiceId: string, input: z.input<typeof sendSchema>): Promise<ActionResult<{ sentTo: number }>> {
  return guarded("invoices.send", async (viewer) => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const parsed = sendSchema.safeParse({ ...input, to: (input.to ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean) });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the recipients.");
    const supabase = await createClient();
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, number, status, total, balance, currency, due_date, contact_id, client:clients(name)")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!inv) return fail("That invoice no longer exists.");
    if (inv.status === "draft" || inv.status === "void" || !inv.number) return fail("Confirm the invoice before sending it.");
    const { data: contact } = inv.contact_id ? await supabase.from("client_contacts").select("name").eq("id", inv.contact_id).maybeSingle() : { data: null };
    const clientName = (inv.client as unknown as { name: string } | null)?.name ?? "";
    const mail = invoiceEmail(
      {
        contactName: contact?.name ?? null,
        clientName,
        orgName: viewer.orgName.replace(/\s*\(Pvt\) Ltd$/i, ""),
        number: inv.number,
        total: Number(inv.balance > 0 ? inv.balance : inv.total),
        currency: inv.currency,
        dueDate: inv.due_date ?? new Date().toISOString().slice(0, 10),
        url: `${appOrigin()}/portal/invoices/${inv.id}`,
        message: parsed.data.message || null,
      },
      emailBrand(),
    );
    await queueEmail({ to: parsed.data.to, subject: mail.subject, html: mail.html, text: mail.text, templateKey: "invoice.send", entityType: "invoice", entityId: inv.id, createdBy: viewer.userId, orgId: viewer.orgId });
    const { error } = await supabase.rpc("mark_invoice_sent", { p_invoice: inv.id, p_to: parsed.data.to });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, sentTo: parsed.data.to.length };
  });
}

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount received."),
  method: z.enum(["bank_transfer", "cheque", "cash", "card", "online", "other"]),
  reference: z.string().trim().max(120).optional(),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the payment date."),
  notes: z.string().trim().max(1000).optional(),
});
export type PaymentInput = z.input<typeof paymentSchema>;

export async function recordPayment(invoiceId: string, input: PaymentInput): Promise<ActionResult> {
  return guarded("payments.record", async () => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the payment.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_payment", {
      p_invoice: invoiceId,
      p_amount: v.amount,
      p_method: v.method,
      p_reference: orNull(v.reference || null),
      p_paid_on: v.paid_on,
      p_slip: orNull(null),
      p_notes: orNull(v.notes || null),
    });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker(); // the receipt PDF
    refresh();
    return { ok: true };
  });
}

export async function voidPayment(paymentId: string, reason: string): Promise<ActionResult> {
  return guarded("payments.record", async () => {
    if (!uuid.safeParse(paymentId).success) return fail("Unknown payment.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("void_payment", { p_payment: paymentId, p_reason: reason.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  return guarded("invoices.manage", async () => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("void_invoice", { p_invoice: invoiceId, p_reason: reason.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const creditSchema = z.object({ amount: z.coerce.number().positive("Enter the credit amount."), reason: z.string().trim().min(3, "Say why the credit is given.").max(1000) });

export async function issueCreditNote(invoiceId: string, input: z.input<typeof creditSchema>): Promise<ActionResult> {
  return guarded("invoices.manage", async () => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const parsed = creditSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the credit note.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { error } = await supabase.rpc("issue_credit_note", { p_invoice: invoiceId, p_amount: parsed.data.amount, p_reason: parsed.data.reason });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker(); // the credit note PDF
    refresh();
    return { ok: true };
  });
}

/** Stop or restart the automatic payment reminders for one invoice. */
export async function setRemindersPaused(invoiceId: string, paused: boolean): Promise<ActionResult> {
  return guarded("invoices.manage", async () => {
    if (!uuid.safeParse(invoiceId).success) return fail("Unknown invoice.");
    const supabase = await createClient();
    const { error } = await supabase.from("invoices").update({ reminders_paused: paused }).eq("id", invoiceId);
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
