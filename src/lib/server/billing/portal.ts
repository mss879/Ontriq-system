import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { portalClientProfile } from "@/lib/server/portal/queries";
import { issuerFromBranding, TEMPLATE_KEYS, type Issuer, type TemplateKey } from "@/domain/documents/model";

/**
 * Portal invoice reads through portal_invoices / portal_invoice (0015), which
 * keep to the client's own company and leave out internal notes.
 */

const num = (v: unknown) => Number(v ?? 0);

export type PortalInvoiceRow = {
  id: string; number: string | null; kind: string; status: string; currency: string; issue_date: string | null; due_date: string | null;
  period_from: string | null; period_to: string | null; total: number; amount_paid: number; amount_credited: number; balance: number;
  paid_at: string | null; document_ready: boolean; slip_pending: boolean;
};

export type PortalSlip = { id: string; invoice_id: string | null; filename: string; status: string; rejection_reason: string | null; created_at: string };
export type PortalBalance = { outstanding: number; overdue: number; open_invoices: number; currency: string };

const row = (r: Record<string, unknown>): PortalInvoiceRow => ({
  ...(r as unknown as PortalInvoiceRow),
  total: num(r.total),
  amount_paid: num(r.amount_paid),
  amount_credited: num(r.amount_credited),
  balance: num(r.balance),
});

export async function portalInvoiceList(): Promise<{ invoices: PortalInvoiceRow[]; balance: PortalBalance; slips: PortalSlip[] }> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_invoices");
  if (error) throw new Error(`portal_invoices: ${error.message}`);
  const d = (data ?? {}) as { invoices?: Record<string, unknown>[]; balance?: Record<string, unknown>; slips?: PortalSlip[] };
  const b = d.balance ?? {};
  return {
    invoices: (d.invoices ?? []).map(row),
    balance: { outstanding: num(b.outstanding), overdue: num(b.overdue), open_invoices: num(b.open_invoices), currency: String(b.currency ?? "LKR") },
    slips: d.slips ?? [],
  };
}

export type PortalInvoiceDetail = PortalInvoiceRow & {
  message: string;
  subtotal: number;
  discount_total: number;
  net_total: number;
  tax_lines: { code: string; name: string; rate: number; inclusive: boolean; amount: number }[];
  tax_total: number;
  can_pay: boolean;
  document_id: string | null;
  template_key: TemplateKey;
  contact: { name: string; title: string | null } | null;
  items: { description: string; quantity: number; unit_price: number; discount_pct: number; total: number }[];
  payments: { id: string; amount: number; method: string; paid_on: string; receipt_number: string | null; receipt_ready: boolean; receipt_document_id: string | null }[];
  credit_notes: { number: string; amount: number; reason: string; document_id: string | null }[];
};

/** One invoice. Deduped per request. (The page marks it viewed once shown.) */
export const portalInvoiceDetail = cache(async (id: string): Promise<PortalInvoiceDetail | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_invoice", { p_invoice: id });
  if (error) {
    if (error.code === "P0002" || error.code === "22P02") return null;
    throw new Error(`portal_invoice: ${error.message}`);
  }
  const d = data as Record<string, unknown>;
  return {
    ...row(d),
    message: String(d.message ?? ""),
    subtotal: num(d.subtotal),
    discount_total: num(d.discount_total),
    net_total: num(d.net_total),
    tax_total: num(d.tax_total),
    can_pay: Boolean(d.can_pay),
    document_id: (d.document_id as string | null) ?? null,
    template_key: (TEMPLATE_KEYS as readonly string[]).includes(String(d.template_key)) ? (d.template_key as TemplateKey) : "executive",
    contact: d.contact_name ? { name: String(d.contact_name), title: (d.contact_title as string | null) ?? null } : null,
    tax_lines: ((d.tax_lines ?? []) as PortalInvoiceDetail["tax_lines"]).map((t) => ({ ...t, rate: num(t.rate), amount: num(t.amount) })),
    items: ((d.items ?? []) as PortalInvoiceDetail["items"]).map((i) => ({ ...i, quantity: num(i.quantity), unit_price: num(i.unit_price), discount_pct: num(i.discount_pct), total: num(i.total) })),
    payments: ((d.payments ?? []) as PortalInvoiceDetail["payments"]).map((p) => ({ ...p, amount: num(p.amount) })),
    credit_notes: ((d.credit_notes ?? []) as PortalInvoiceDetail["credit_notes"]).map((n) => ({ ...n, amount: num(n.amount) })),
  };
});

/** The issuer block, the client's own address and their default design (statements and lists). */
export async function portalParties(): Promise<{ issuer: Issuer; client: { name: string; address: Record<string, string> | null; email: string | null }; template: TemplateKey }> {
  const supabase = await createRequestClient();
  const [{ data: profile }, client] = await Promise.all([supabase.rpc("portal_org_profile"), portalClientProfile()]);
  const org = profile as { name?: string; branding?: Record<string, unknown> } | null;
  const template = (TEMPLATE_KEYS as readonly string[]).includes(client?.default_template ?? "") ? (client!.default_template as TemplateKey) : "executive";
  return {
    issuer: issuerFromBranding({ name: org?.name ?? "Ontriq", branding: org?.branding ?? {} }),
    client: { name: client?.name ?? "", address: (client?.address ?? null) as Record<string, string> | null, email: client?.email ?? null },
    template,
  };
}
