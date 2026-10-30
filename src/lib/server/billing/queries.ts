import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { displayStatus, type InvoiceStatus, type TaxRate } from "@/domain/pricing/invoice-core";
import { issuerFromBranding, type Issuer } from "@/domain/documents/model";

/**
 * Invoicing and payments reads for staff (0015). Row level security decides
 * who sees what (finance roles via can_read_invoices). Server Components only.
 */

const num = (v: unknown) => Number(v ?? 0);
const colomboToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export type InvoiceFilters = { q?: string; status?: string; client?: string; from?: string; to?: string; page?: number };
export const INVOICE_PAGE_SIZE = 30;

export type InvoiceListRow = {
  id: string;
  number: string | null;
  kind: string;
  status: InvoiceStatus;
  client_id: string;
  client_name: string;
  client_code: string;
  issue_date: string | null;
  due_date: string | null;
  period_from: string | null;
  period_to: string | null;
  total: number;
  balance: number;
  currency: string;
  created_at: string;
};

const OPEN = ["sent", "viewed", "partially_paid"];

export async function listInvoices(f: InvoiceFilters): Promise<{ rows: InvoiceListRow[]; total: number }> {
  const supabase = await createRequestClient();
  const today = colomboToday();
  let q = supabase
    .from("invoices")
    .select("id, number, kind, status, client_id, issue_date, due_date, period_from, period_to, total, balance, currency, created_at, client:clients(name, code)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (f.client) q = q.eq("client_id", f.client);
  if (f.status === "overdue") q = q.in("status", OPEN).lt("due_date", today);
  else if (f.status === "open") q = q.in("status", ["confirmed", ...OPEN]);
  else if (f.status) q = q.eq("status", f.status);
  if (f.from) q = q.gte("issue_date", f.from);
  if (f.to) q = q.lte("issue_date", f.to);
  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) q = q.ilike("number", `%${term}%`);
  }
  const page = Math.max(1, f.page ?? 1);
  const { data, count, error } = await q.range((page - 1) * INVOICE_PAGE_SIZE, page * INVOICE_PAGE_SIZE - 1);
  if (error) throw new Error(`invoices: ${error.message}`);
  return {
    total: count ?? 0,
    rows: (data ?? []).map((r) => {
      const client = r.client as unknown as { name: string; code: string } | null;
      return {
        id: r.id,
        number: r.number,
        kind: r.kind,
        status: displayStatus(r.status, r.due_date),
        client_id: r.client_id,
        client_name: client?.name ?? "",
        client_code: client?.code ?? "",
        issue_date: r.issue_date,
        due_date: r.due_date,
        period_from: r.period_from,
        period_to: r.period_to,
        total: num(r.total),
        balance: num(r.balance),
        currency: r.currency,
        created_at: r.created_at,
      };
    }),
  };
}

/** Headline figures across every invoice the viewer can see. */
export async function invoiceHeadline(): Promise<{ outstanding: number; overdue: number; drafts: number }> {
  const supabase = await createRequestClient();
  const today = colomboToday();
  const { data: open } = await supabase.from("invoices").select("status, balance, due_date").in("status", ["draft", "confirmed", ...OPEN]);
  let outstanding = 0;
  let overdue = 0;
  let drafts = 0;
  for (const r of open ?? []) {
    if (r.status === "draft") drafts++;
    else outstanding += num(r.balance);
    if (OPEN.includes(r.status) && r.due_date && r.due_date < today) overdue += num(r.balance);
  }
  return { outstanding, overdue, drafts };
}

export async function billingClients(): Promise<{ id: string; name: string; code: string; billing_policy: string }[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("clients").select("id, name, code, billing_policy").neq("status", "archived").order("name");
  return data ?? [];
}

export async function getIssuer(orgId: string): Promise<Issuer> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("orgs").select("name, branding").eq("id", orgId).maybeSingle();
  return issuerFromBranding({ name: data?.name ?? "Ontriq", branding: (data?.branding ?? {}) as Record<string, unknown> });
}

export async function activeTaxRates(): Promise<TaxRate[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("tax_rates").select("code, name, rate, inclusive").eq("is_active", true).order("sort");
  return (data ?? []).map((t) => ({ code: t.code, name: t.name, rate: num(t.rate), inclusive: t.inclusive }));
}

export async function allTaxRates() {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("tax_rates").select("id, code, name, rate, inclusive, is_active, sort, updated_at").order("sort");
  return (data ?? []).map((t) => ({ ...t, rate: num(t.rate) }));
}

export type InvoiceLine = { id: string; sort: number; description: string; quantity: number; unit_price: number; discount_pct: number; total: number; case_id: string | null; case_reference: string | null };

export type InvoiceDetail = {
  invoice: {
    id: string; number: string | null; kind: string; status: string; display_status: InvoiceStatus; template_key: string; currency: string;
    issue_date: string | null; due_date: string | null; period_from: string | null; period_to: string | null; message: string; internal_notes: string;
    subtotal: number; discount_total: number; net_total: number; tax_lines: { code: string; name: string; rate: number; inclusive: boolean; amount: number }[];
    tax_total: number; total: number; amount_paid: number; amount_credited: number; balance: number; reminders_paused: boolean;
    sent_at: string | null; viewed_at: string | null; paid_at: string | null; confirmed_at: string | null; voided_at: string | null; void_reason: string | null;
    contact_id: string | null; document_id: string | null; document_status: string | null; created_at: string;
  };
  client: { id: string; name: string; code: string; address: Record<string, string> | null; email: string | null; phone: string | null; payment_terms_days: number };
  contacts: { id: string; name: string; title: string | null; email: string | null; receives_invoices: boolean }[];
  lines: InvoiceLine[];
  payments: { id: string; amount: number; method: string; reference: string | null; paid_on: string; receipt_number: string | null; receipt_document_id: string | null; receipt_ready: boolean; voided_at: string | null; void_reason: string | null; notes: string | null }[];
  credit_notes: { id: string; number: string; amount: number; reason: string; status: string; document_id: string | null; document_ready: boolean; created_at: string }[];
  events: { id: number; kind: string; body: string | null; amount: number | null; actor_kind: string; actor: string | null; at: string }[];
  reminders: { step: string; sent_at: string; to_emails: string[] }[];
  slips: { id: string; filename: string; status: string; created_at: string; rejection_reason: string | null }[];
};

/** One invoice with everything the page shows. Deduped per request (header and body share it). */
export const getInvoice = cache(async (id: string): Promise<InvoiceDetail | null> => {
  const supabase = await createRequestClient();
  const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return null;
  const [client, contacts, items, payments, notes, events, reminders, slips, doc] = await Promise.all([
    supabase.from("clients").select("id, name, code, address, email, phone, payment_terms_days").eq("id", inv.client_id).single(),
    supabase.from("client_contacts").select("id, name, title, email, receives_invoices").eq("client_id", inv.client_id).order("is_primary", { ascending: false }).order("name"),
    supabase.from("invoice_items").select("id, sort, description, quantity, unit_price, discount_pct, total, case_id, case:cases(reference)").eq("invoice_id", id).order("sort"),
    supabase.from("payments").select("id, amount, method, reference, paid_on, receipt_number, receipt_document_id, voided_at, void_reason, notes").eq("invoice_id", id).order("paid_on"),
    supabase.from("credit_notes").select("id, number, amount, reason, status, document_id, created_at").eq("invoice_id", id).order("created_at"),
    supabase.from("invoice_events").select("id, kind, body, amount, actor_kind, actor_id, at").eq("invoice_id", id).order("at", { ascending: false }),
    supabase.from("invoice_reminders").select("step, sent_at, to_emails").eq("invoice_id", id).order("sent_at"),
    supabase.from("payment_slips").select("id, filename, status, created_at, rejection_reason").eq("invoice_id", id).neq("status", "pending_upload").order("created_at", { ascending: false }),
    inv.document_id ? supabase.from("generated_documents").select("status").eq("id", inv.document_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const docIds = [...(payments.data ?? []).map((p) => p.receipt_document_id), ...(notes.data ?? []).map((n) => n.document_id)].filter(Boolean) as string[];
  const { data: docs } = docIds.length ? await supabase.from("generated_documents").select("id, status").in("id", docIds) : { data: [] };
  const ready = new Set((docs ?? []).filter((d) => d.status === "ready").map((d) => d.id));
  const actorIds = [...new Set((events.data ?? []).map((e) => e.actor_id).filter(Boolean) as string[])];
  const { data: people } = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return {
    invoice: {
      ...inv,
      display_status: displayStatus(inv.status, inv.due_date),
      subtotal: num(inv.subtotal),
      discount_total: num(inv.discount_total),
      net_total: num(inv.net_total),
      tax_total: num(inv.tax_total),
      total: num(inv.total),
      amount_paid: num(inv.amount_paid),
      amount_credited: num(inv.amount_credited),
      balance: num(inv.balance),
      tax_lines: ((inv.tax_lines ?? []) as InvoiceDetail["invoice"]["tax_lines"]).map((t) => ({ ...t, rate: num(t.rate), amount: num(t.amount) })),
      document_status: (doc.data as { status: string } | null)?.status ?? null,
    },
    client: client.data as unknown as InvoiceDetail["client"],
    contacts: contacts.data ?? [],
    lines: (items.data ?? []).map((l) => ({
      id: l.id,
      sort: l.sort,
      description: l.description,
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      discount_pct: num(l.discount_pct),
      total: num(l.total),
      case_id: l.case_id,
      case_reference: (l.case as unknown as { reference: string } | null)?.reference ?? null,
    })),
    payments: (payments.data ?? []).map((p) => ({ ...p, amount: num(p.amount), receipt_ready: Boolean(p.receipt_document_id && ready.has(p.receipt_document_id)) })),
    credit_notes: (notes.data ?? []).map((n) => ({ ...n, amount: num(n.amount), document_ready: Boolean(n.document_id && ready.has(n.document_id)) })),
    events: (events.data ?? []).map((e) => ({ id: e.id, kind: e.kind, body: e.body, amount: e.amount === null ? null : num(e.amount), actor_kind: e.actor_kind, actor: e.actor_id ? (nameOf.get(e.actor_id) ?? null) : null, at: e.at })),
    reminders: reminders.data ?? [],
    slips: slips.data ?? [],
  };
});

export type SlipRow = {
  id: string; client_id: string; client_name: string; invoice_id: string | null; invoice_number: string | null; invoice_balance: number | null; currency: string;
  filename: string; mime: string; size_bytes: number; status: string; client_note: string | null; created_at: string; rejection_reason: string | null;
  ai: { amount?: number | null; paid_on?: string | null; reference?: string | null; bank?: string | null; confidence?: string; notes?: string | null; skipped?: string; is_payment_slip?: boolean } | null;
};

export async function listSlips(status: "pending" | "done"): Promise<SlipRow[]> {
  const supabase = await createRequestClient();
  let q = supabase
    .from("payment_slips")
    .select("id, client_id, invoice_id, filename, mime, size_bytes, status, client_note, created_at, rejection_reason, ai_extraction, client:clients(name), invoice:invoices(number, balance, currency)")
    .order("created_at", { ascending: status === "pending" });
  q = status === "pending" ? q.eq("status", "pending") : q.in("status", ["matched", "rejected"]).limit(20);
  const { data, error } = await q;
  if (error) throw new Error(`payment_slips: ${error.message}`);
  return (data ?? []).map((s) => {
    const inv = s.invoice as unknown as { number: string | null; balance: number; currency: string } | null;
    const ai = (s.ai_extraction ?? {}) as SlipRow["ai"];
    return {
      id: s.id,
      client_id: s.client_id,
      client_name: (s.client as unknown as { name: string } | null)?.name ?? "",
      invoice_id: s.invoice_id,
      invoice_number: inv?.number ?? null,
      invoice_balance: inv ? num(inv.balance) : null,
      currency: inv?.currency ?? "LKR",
      filename: s.filename,
      mime: s.mime,
      size_bytes: s.size_bytes,
      status: s.status,
      client_note: s.client_note,
      created_at: s.created_at,
      rejection_reason: s.rejection_reason,
      ai: ai && Object.keys(ai).length ? ai : null,
    };
  });
}

/** Open invoices a slip could pay, for clients that have pending slips. */
export async function openInvoicesFor(clientIds: string[]): Promise<{ id: string; client_id: string; number: string | null; balance: number; currency: string; due_date: string | null }[]> {
  if (!clientIds.length) return [];
  const supabase = await createRequestClient();
  const { data } = await supabase.from("invoices").select("id, client_id, number, balance, currency, due_date").in("client_id", clientIds).in("status", ["confirmed", ...OPEN]).order("due_date");
  return (data ?? []).map((i) => ({ ...i, balance: num(i.balance) }));
}

export async function recentPayments() {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("payments")
    .select("id, amount, method, reference, paid_on, receipt_number, voided_at, created_at, client:clients(name), invoice:invoices(id, number, currency)")
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []).map((p) => {
    const inv = p.invoice as unknown as { id: string; number: string | null; currency: string } | null;
    return {
      id: p.id,
      amount: num(p.amount),
      method: p.method,
      reference: p.reference,
      paid_on: p.paid_on,
      receipt_number: p.receipt_number,
      voided_at: p.voided_at,
      client_name: (p.client as unknown as { name: string } | null)?.name ?? "",
      invoice_id: inv?.id ?? null,
      invoice_number: inv?.number ?? null,
      currency: inv?.currency ?? "LKR",
    };
  });
}

export type ClientBalance = { outstanding: number; overdue: number; open_invoices: number; currency: string };

export async function clientBilling(clientId: string): Promise<{ balance: ClientBalance; invoices: InvoiceListRow[] } | null> {
  const supabase = await createRequestClient();
  const { data: balance, error } = await supabase.rpc("client_balance", { p_client: clientId });
  if (error) return null;
  const { data } = await supabase
    .from("invoices")
    .select("id, number, kind, status, client_id, issue_date, due_date, period_from, period_to, total, balance, currency, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(6);
  const b = (balance ?? {}) as Record<string, unknown>;
  return {
    balance: { outstanding: num(b.outstanding), overdue: num(b.overdue), open_invoices: num(b.open_invoices), currency: String(b.currency ?? "LKR") },
    invoices: (data ?? []).map((r) => ({ ...r, status: displayStatus(r.status, r.due_date), client_name: "", client_code: "", total: num(r.total), balance: num(r.balance) })),
  };
}

// ---------------------------------------------------------------- AI settings

export type AiCapabilityRow = { key: string; label: string; description: string; model: string; effort: string; max_tokens: number; enabled: boolean; sort: number };
export type AiBudgetRow = { id: string; capability: string | null; daily_usd: number | null; monthly_usd: number | null; action: string };

export async function aiSettings() {
  const supabase = await createRequestClient();
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [caps, budgets, byCap, byDay, month, monthCap, runs, rates] = await Promise.all([
    supabase.from("ai_capabilities").select("key, label, description, model, effort, max_tokens, enabled, sort").order("sort"),
    supabase.from("ai_budgets").select("id, capability, daily_usd, monthly_usd, action").order("capability", { nullsFirst: true }),
    supabase.rpc("ai_cost_summary", { p_from: from, p_to: to, p_group: "capability" }),
    supabase.rpc("ai_cost_summary", { p_from: from, p_to: to, p_group: "day" }),
    supabase.rpc("ai_cost_summary", { p_from: monthStart, p_to: to, p_group: "model" }),
    supabase.rpc("ai_cost_summary", { p_from: monthStart, p_to: to, p_group: "capability" }),
    supabase.from("ai_runs").select("id, capability, model, status, input_tokens, output_tokens, cost_usd, duration_ms, created_at, error").order("created_at", { ascending: false }).limit(15),
    supabase.from("ai_cost_rates").select("model, unit, input_rate, output_rate, effective_from").order("effective_from", { ascending: false }),
  ]);
  const usageRow = (r: { group_key: string; runs: number; input_tokens: number; output_tokens: number; cost_usd: number }) => ({
    key: r.group_key,
    runs: num(r.runs),
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
    cost_usd: num(r.cost_usd),
  });
  const seenModel = new Set<string>();
  return {
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    capabilities: (caps.data ?? []) as AiCapabilityRow[],
    budgets: (budgets.data ?? []).map((b) => ({ ...b, daily_usd: b.daily_usd === null ? null : num(b.daily_usd), monthly_usd: b.monthly_usd === null ? null : num(b.monthly_usd) })) as AiBudgetRow[],
    usageByCapability: (byCap.data ?? []).map(usageRow),
    usageByDay: (byDay.data ?? []).map(usageRow).sort((a, b) => a.key.localeCompare(b.key)),
    today: colomboToday(),
    monthByModel: (month.data ?? []).map(usageRow),
    monthByCapability: (monthCap.data ?? []).map(usageRow),
    runs: (runs.data ?? []).map((r) => ({ ...r, cost_usd: num(r.cost_usd) })),
    rates: (rates.data ?? [])
      .filter((r) => (seenModel.has(r.model) ? false : (seenModel.add(r.model), true)))
      .map((r) => ({ ...r, input_rate: num(r.input_rate), output_rate: num(r.output_rate) })),
  };
}
