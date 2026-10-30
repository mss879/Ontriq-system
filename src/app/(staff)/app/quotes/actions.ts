"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { emailBrand } from "@/lib/server/email-brand";
import { appOrigin } from "@/lib/env";
import { runStructured } from "@/lib/ai/claude";
import { quoteEmail } from "@/domain/email/commercial-templates";
import { defaultQuoteText, type QuoteDraftText } from "@/domain/pricing/quote-draft";
import { TEMPLATE_KEYS } from "@/domain/documents/model";
import type { Permission } from "@/domain/permissions";

/**
 * Quotation actions (0014). Drafts are edited through row level security
 * (quotes.manage; only draft columns are writable); confirming, sending and
 * new versions go through the database functions, which re-check everything.
 */

async function guarded<T extends object>(permission: Permission, run: (viewer: Viewer) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run(await requireViewer({ kind: "staff", permission }));
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

// ---------------------------------------------------------------- create

export async function createQuote(clientId: string): Promise<ActionResult<{ id: string }>> {
  return guarded("quotes.manage", async (viewer) => {
    if (!uuid.safeParse(clientId).success) return fail("Choose a client.");
    const supabase = await createClient();
    const { data: client } = await supabase.from("clients").select("id, name, status, default_template, payment_terms_days").eq("id", clientId).maybeSingle();
    if (!client) return fail("That client no longer exists.");
    if (client.status === "archived") return fail("This client is archived.");
    const { data: contact } = await supabase.from("client_contacts").select("id").eq("client_id", clientId).order("is_primary", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from("quotes")
      .insert({
        org_id: viewer.orgId,
        client_id: client.id,
        contact_id: contact?.id ?? null,
        template_key: (TEMPLATE_KEYS as readonly string[]).includes(client.default_template) ? client.default_template : "executive",
        payment_terms_days: client.payment_terms_days,
        title: "Background verification services",
      })
      .select("id")
      .single();
    if (error || !data) return fail(friendlyDbError(error));
    refresh();
    return { ok: true, id: data.id };
  });
}

// ---------------------------------------------------------------- draft autosave

const lineSchema = z
  .object({
    kind: z.enum(["package", "check", "custom"]),
    package_id: uuid.nullable(),
    check_type_id: uuid.nullable(),
    description: z.string().trim().min(1, "Every line needs a description.").max(300),
    quantity: z.number().positive("Quantities must be above zero.").max(100000),
    unit_price: z.number().min(0, "Prices can't be negative.").max(100_000_000),
    discount_pct: z.number().min(0).max(100),
  })
  .refine((l) => (l.kind === "package" ? Boolean(l.package_id) : true) && (l.kind === "check" ? Boolean(l.check_type_id) : true), "A package or check line lost its item.");

const tierSchema = z
  .object({
    min_volume: z.number().int().min(0).max(1_000_000),
    max_volume: z.number().int().min(0).max(1_000_000).nullable(),
    discount_pct: z.number().min(0).max(100),
    note: z.string().trim().max(200),
  })
  .refine((t) => t.max_volume === null || t.max_volume >= t.min_volume, "A tier's upper limit is below its lower limit.");

const text = (max: number) => z.string().max(max);
const draftSchema = z.object({
  contact_id: uuid.nullable(),
  template_key: z.enum(TEMPLATE_KEYS),
  title: z.string().trim().min(1, "Give the quotation a title.").max(200),
  valid_until: isoDate,
  payment_terms_days: z.number().int().min(0).max(180),
  expected_monthly_volume: z.number().int().min(0).max(1_000_000).nullable(),
  intro: text(4000),
  scope: text(4000),
  assumptions: text(4000),
  tat_text: text(2000),
  closing: text(2000),
  internal_notes: text(4000),
  lines: z.array(lineSchema).max(100),
  tiers: z.array(tierSchema).max(10),
});
export type QuoteDraftInput = z.input<typeof draftSchema>;

export async function saveQuoteDraft(quoteId: string, input: QuoteDraftInput): Promise<ActionResult<{ subtotal: number; discount_total: number; total: number; savedAt: string }>> {
  return guarded("quotes.manage", async (viewer) => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the quotation.");
    const v = parsed.data;
    const supabase = await createClient();
    const { data: q } = await supabase.from("quotes").select("id, status, client_id").eq("id", quoteId).maybeSingle();
    if (!q) return fail("That quotation no longer exists.");
    if (q.status !== "draft") return fail("This quotation is confirmed; make a new version to change it.");
    if (v.contact_id) {
      const { data: contact } = await supabase.from("client_contacts").select("id").eq("id", v.contact_id).eq("client_id", q.client_id).maybeSingle();
      if (!contact) return fail("That contact belongs to another client.");
    }

    const { error } = await supabase
      .from("quotes")
      .update({
        contact_id: v.contact_id,
        template_key: v.template_key,
        title: v.title,
        valid_until: v.valid_until,
        payment_terms_days: v.payment_terms_days,
        expected_monthly_volume: v.expected_monthly_volume,
        intro: v.intro,
        scope: v.scope,
        assumptions: v.assumptions,
        tat_text: v.tat_text,
        closing: v.closing,
        internal_notes: v.internal_notes,
      })
      .eq("id", quoteId);
    if (error) return fail(rpcErrorMessage(error));

    // Lines and tiers are replaced whole; the totals trigger recomputes the quote.
    const del = await supabase.from("quote_items").delete().eq("quote_id", quoteId);
    if (del.error) return fail(rpcErrorMessage(del.error));
    if (v.lines.length) {
      const ins = await supabase.from("quote_items").insert(
        v.lines.map((l, i) => ({
          org_id: viewer.orgId,
          quote_id: quoteId,
          sort: (i + 1) * 10,
          kind: l.kind,
          package_id: l.kind === "package" ? l.package_id : null,
          check_type_id: l.kind === "check" ? l.check_type_id : null,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_pct: l.discount_pct,
        })),
      );
      if (ins.error) return fail(rpcErrorMessage(ins.error));
    }
    const delT = await supabase.from("quote_tiers").delete().eq("quote_id", quoteId);
    if (delT.error) return fail(rpcErrorMessage(delT.error));
    if (v.tiers.length) {
      const insT = await supabase.from("quote_tiers").insert(v.tiers.map((t) => ({ org_id: viewer.orgId, quote_id: quoteId, ...t })));
      if (insT.error) return fail(rpcErrorMessage(insT.error));
    }
    const { data: totals } = await supabase.from("quotes").select("subtotal, discount_total, total").eq("id", quoteId).single();
    return { ok: true, subtotal: Number(totals?.subtotal ?? 0), discount_total: Number(totals?.discount_total ?? 0), total: Number(totals?.total ?? 0), savedAt: new Date().toISOString() };
  });
}

// ---------------------------------------------------------------- drafting text

const DraftSchema = z.object({
  intro: z.string().describe("Two or three sentences thanking the client and stating what the quotation covers"),
  scope: z.string().describe("What Ontriq does for each candidate, naming the quoted checks"),
  assumptions: z.string().describe("Conditions the turnaround and pricing rely on, without amounts"),
  tat_text: z.string().describe("The turnaround commitment in working days"),
  closing: z.string().describe("One or two sentences inviting the client to accept in the portal"),
});

const SYSTEM = [
  "You write quotation text for Ontriq (Pvt) Ltd, a Sri Lankan background verification company, in clear British English.",
  "Write only the five sections asked for. Keep each to two or three short sentences; no headings, no bullet characters, no placeholders.",
  "Never state, invent or change prices, discounts, currencies, percentages or totals: the line items carry all pricing.",
  "Describe only the services in the lines given. Do not promise anything Ontriq did not list, legal outcomes, or turnaround faster than the days given.",
  "Mention that reports are released through the client portal and that turnaround counts working days from receipt of all documents.",
  "Tone: professional and warm. 'friendly' means slightly more conversational; 'formal' means more reserved.",
].join("\n");

const MONEY_LIKE = /\b(LKR|Rs\.?|USD|\$)\s?\d|\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+(\.\d{2})?\b/i;

export async function draftQuoteText(
  quoteId: string,
  input: { tone: "formal" | "friendly"; lines: { description: string; kind: "package" | "check" | "custom" }[]; expectedMonthlyVolume: number | null },
): Promise<ActionResult<{ text: QuoteDraftText; source: "ai" | "standard"; note?: string }>> {
  return guarded("quotes.manage", async (viewer) => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const supabase = await createClient();
    const { data: q } = await supabase.from("quotes").select("id, client_id, org_id, status, client:clients(name, industry, sla_days)").eq("id", quoteId).maybeSingle();
    if (!q) return fail("That quotation no longer exists.");
    if (q.status !== "draft") return fail("This quotation is confirmed; make a new version to change it.");
    const client = q.client as unknown as { name: string; industry: string | null; sla_days: number };
    const { data: org } = await supabase.from("orgs").select("name, branding").eq("id", viewer.orgId).single();
    const orgName = ((org?.branding ?? {}) as Record<string, string>).display_name || org?.name || "Ontriq";
    const lines = input.lines.filter((l) => l.description.trim()).slice(0, 40);
    const standard = defaultQuoteText({ orgName, clientName: client.name, lines, tatDays: client.sla_days, expectedMonthlyVolume: input.expectedMonthlyVolume, tone: input.tone });

    const result = await runStructured(
      createAdminClient(),
      "commercial.draft",
      { orgId: viewer.orgId, clientId: q.client_id, userId: viewer.userId, source: "quotes/draft-text", promptVersion: "quote-text-v1" },
      {
        system: SYSTEM,
        content: [
          {
            type: "text",
            text: [
              `Client: ${client.name}${client.industry ? ` (${client.industry})` : ""}`,
              `Company writing the quotation: ${orgName}`,
              `Tone: ${input.tone}`,
              `Turnaround: ${client.sla_days} working days from receipt of all documents`,
              input.expectedMonthlyVolume ? `Expected volume: about ${input.expectedMonthlyVolume} candidates a month` : "Expected volume: not given",
              "Quoted lines (descriptions only):",
              ...(lines.length ? lines.map((l) => `- ${l.description} [${l.kind}]`) : ["- (no lines yet: describe background verification generally)"]),
            ].join("\n"),
          },
        ],
        schema: DraftSchema,
      },
    );
    if (!result.ok) return { ok: true, text: standard, source: "standard", note: `${result.message} Filled from Ontriq's standard wording instead.` };
    const text = result.data;
    // The model must never introduce prices; if it does, use the standard wording.
    if (Object.values(text).some((s) => MONEY_LIKE.test(s))) {
      return { ok: true, text: standard, source: "standard", note: "The AI draft mentioned amounts, so Ontriq's standard wording was used instead." };
    }
    return { ok: true, text, source: "ai" };
  });
}

// ---------------------------------------------------------------- transitions

export async function confirmQuote(quoteId: string): Promise<ActionResult<{ number: string }>> {
  return guarded("quotes.manage", async () => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_quote", { p_quote: quoteId });
    if (error || !data) return fail(rpcErrorMessage(error));
    kickWorker(); // render the PDF
    refresh();
    return { ok: true, number: (data as { number: string }).number };
  });
}

const sendSchema = z.object({
  to: z.array(z.email("One of the email addresses isn't valid.")).min(1, "Choose at least one recipient.").max(10),
  message: z.string().trim().max(2000).optional(),
});

export async function sendQuote(quoteId: string, input: z.input<typeof sendSchema>): Promise<ActionResult<{ sentTo: number }>> {
  return guarded("quotes.send", async (viewer) => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const parsed = sendSchema.safeParse({ ...input, to: (input.to ?? []).map((e) => e.trim().toLowerCase()) });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the recipients.");
    const supabase = await createClient();
    const { data: q } = await supabase
      .from("quotes")
      .select("id, number, title, total, currency, valid_until, status, client:clients(name), contact:client_contacts(name, email)")
      .eq("id", quoteId)
      .maybeSingle();
    if (!q || !q.number) return fail("Confirm the quotation before sending it.");
    if (!["confirmed", "sent", "viewed"].includes(q.status)) return fail("This quotation can't be sent now.");
    const { data: org } = await supabase.from("orgs").select("name, branding").eq("id", viewer.orgId).single();
    const orgName = ((org?.branding ?? {}) as Record<string, string>).display_name || org?.name || "Ontriq";
    const contact = q.contact as unknown as { name: string; email: string | null } | null;
    const to = [...new Set(parsed.data.to)];
    const mail = quoteEmail(
      {
        contactName: to.length === 1 && contact?.email?.toLowerCase() === to[0] ? contact.name : null,
        clientName: (q.client as unknown as { name: string }).name,
        orgName,
        number: q.number,
        title: q.title,
        total: Number(q.total),
        currency: q.currency,
        validUntil: q.valid_until,
        url: `${appOrigin()}/portal/quotes/${q.id}`,
        message: parsed.data.message || null,
      },
      emailBrand(),
    );
    await queueEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, templateKey: "quote.sent", entityType: "quote", entityId: q.id, createdBy: viewer.userId, orgId: viewer.orgId, replyTo: viewer.email || undefined });
    const { error } = await supabase.rpc("mark_quote_sent", { p_quote: q.id, p_to: to });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, sentTo: to.length };
  });
}

export async function reviseQuote(quoteId: string): Promise<ActionResult<{ id: string }>> {
  return guarded("quotes.manage", async () => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("revise_quote", { p_quote: quoteId });
    if (error || !data) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, id: data as string };
  });
}

/** The PDF of a confirmed quotation, re-rendered (e.g. after the template's look changed). */
export async function regenerateQuotePdf(quoteId: string): Promise<ActionResult> {
  return guarded("quotes.manage", async () => {
    if (!uuid.safeParse(quoteId).success) return fail("Unknown quotation.");
    const supabase = await createClient();
    const { data: q } = await supabase.from("quotes").select("document_id, status").eq("id", quoteId).maybeSingle();
    if (!q?.document_id) return fail("Confirm the quotation first.");
    const { data: doc } = await supabase.from("generated_documents").select("status, job_id").eq("id", q.document_id).maybeSingle();
    if (doc?.status === "ready" || doc?.status === "queued") return { ok: true };
    if (doc?.job_id) {
      const { error } = await supabase.rpc("retry_job", { p_id: doc.job_id });
      if (error) return fail(rpcErrorMessage(error));
    }
    kickWorker();
    refresh();
    return { ok: true };
  });
}
