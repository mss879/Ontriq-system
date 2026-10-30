import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { issuerFromBranding, TEMPLATE_KEYS, type Issuer, type TemplateKey } from "@/domain/documents/model";
import { documentAddress, type DocClient, type QuoteStatus } from "@/components/quotes/types";

/**
 * Quotations in the client portal. Clients read them only through
 * portal_quotes / portal_quote (0014), which keep to their company, leave out
 * Ontriq's internal notes, and mark a sent quotation as viewed.
 */

export type PortalQuoteRow = {
  id: string;
  number: string;
  version: number;
  title: string;
  status: QuoteStatus;
  currency: string;
  issue_date: string;
  valid_until: string;
  payment_terms_days: number;
  subtotal: number;
  discount_total: number;
  total: number;
  template_key: TemplateKey;
  sent_at: string | null;
  accepted_at: string | null;
  accepted_name: string | null;
  declined_at: string | null;
  document_ready: boolean;
};

export type PortalQuote = PortalQuoteRow & {
  intro: string;
  scope: string;
  assumptions: string;
  tat_text: string;
  closing: string;
  declined_reason: string | null;
  expected_monthly_volume: number | null;
  can_accept: boolean;
  client_name: string;
  items: { description: string; kind: string; quantity: number; unit_price: number; discount_pct: number; total: number }[];
  tiers: { min_volume: number; max_volume: number | null; discount_pct: number; note: string }[];
};

const num = (v: unknown) => Number(v ?? 0);
const normalize = <T extends Record<string, unknown>>(r: T) => ({
  ...r,
  subtotal: num(r.subtotal),
  discount_total: num(r.discount_total),
  total: num(r.total),
  template_key: ((TEMPLATE_KEYS as readonly string[]).includes(String(r.template_key)) ? r.template_key : "executive") as TemplateKey,
});

export async function portalQuotes(): Promise<PortalQuoteRow[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_quotes");
  if (error) throw new Error(`portal_quotes: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => normalize(r) as unknown as PortalQuoteRow);
}

/** One quotation, or null when it isn't theirs. Opening it marks it viewed. */
export const portalQuote = cache(async (quoteId: string): Promise<PortalQuote | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_quote", { p_quote: quoteId });
  if (error) {
    if (error.code === "P0002" || error.code === "22P02") return null;
    throw new Error(`portal_quote: ${error.message}`);
  }
  const r = normalize(data as Record<string, unknown>) as unknown as PortalQuote;
  return {
    ...r,
    items: (r.items ?? []).map((i) => ({ ...i, quantity: num(i.quantity), unit_price: num(i.unit_price), discount_pct: num(i.discount_pct), total: num(i.total) })),
    tiers: (r.tiers ?? []).map((t) => ({ ...t, discount_pct: num(t.discount_pct) })),
  };
});

/** What the document preview needs besides the quotation: Ontriq's details, the client's own address, the PDF. */
export async function portalQuoteContext(quoteId: string, orgId: string, clientId: string): Promise<{ issuer: Issuer; client: DocClient; documentId: string | null }> {
  const supabase = await createRequestClient();
  const [{ data: org }, { data: client }, { data: doc }] = await Promise.all([
    supabase.from("orgs").select("name, branding").eq("id", orgId).single(),
    supabase.from("clients").select("name, address, email, phone").eq("id", clientId).single(),
    supabase.from("generated_documents").select("id").eq("entity_type", "quote").eq("entity_id", quoteId).eq("status", "ready").order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    issuer: issuerFromBranding({ name: org?.name ?? "Ontriq", branding: (org?.branding ?? {}) as Record<string, unknown> }),
    client: { name: client?.name ?? "", address: documentAddress(client?.address), email: client?.email ?? null, phone: client?.phone ?? null },
    documentId: doc?.id ?? null,
  };
}
