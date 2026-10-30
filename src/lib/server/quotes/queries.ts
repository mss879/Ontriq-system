import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { issuerFromBranding, TEMPLATE_KEYS, type Issuer, type TemplateKey } from "@/domain/documents/model";
import { isAiConfigured } from "@/lib/ai/claude";
import { can, canAny } from "@/domain/permissions";
import type { Viewer } from "@/lib/server/viewer";
import {
  colomboToday,
  displayQuoteStatus,
  documentAddress,
  type CatalogItem,
  type QuoteBuilderData,
  type QuoteStatus,
} from "@/components/quotes/types";

/**
 * Quotation reads for staff (0014, row level security: quote readers) and the
 * issuer block for previews. Server Components only.
 */

const num = (v: unknown) => Number(v ?? 0);
const asTemplate = (v: string | null | undefined): TemplateKey => ((TEMPLATE_KEYS as readonly string[]).includes(v ?? "") ? (v as TemplateKey) : "executive");

export const getIssuer = cache(async (orgId: string): Promise<Issuer> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("orgs").select("name, branding").eq("id", orgId).single();
  return issuerFromBranding({ name: data?.name ?? "Ontriq", branding: (data?.branding ?? {}) as Record<string, unknown> });
});

export type QuoteListRow = {
  id: string;
  number: string | null;
  version: number;
  title: string;
  status: QuoteStatus;
  client: { id: string; name: string; code: string };
  total: number;
  currency: string;
  valid_until: string;
  issue_date: string;
  updated_at: string;
};

export async function listQuotes(filters: { q?: string; status?: string; client?: string }): Promise<QuoteListRow[]> {
  const supabase = await createRequestClient();
  let query = supabase
    .from("quotes")
    .select("id, number, version, title, status, total, currency, valid_until, issue_date, updated_at, client:clients(id, name, code)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (filters.client) query = query.eq("client_id", filters.client);
  const today = colomboToday();
  if (filters.status === "expired") query = query.or(`status.eq.expired,and(status.in.(sent,viewed),valid_until.lt.${today})`);
  else if (filters.status === "open") query = query.in("status", ["sent", "viewed"]).gte("valid_until", today);
  else if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  else query = query.neq("status", "superseded");
  const { data } = await query;
  const q = filters.q?.trim().toLowerCase();
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      number: r.number,
      version: r.version,
      title: r.title,
      status: displayQuoteStatus(r.status, r.valid_until, today),
      client: r.client as unknown as QuoteListRow["client"],
      total: num(r.total),
      currency: r.currency,
      valid_until: r.valid_until,
      issue_date: r.issue_date,
      updated_at: r.updated_at,
    }))
    .filter((r) => !q || [r.number ?? "", r.title, r.client?.name ?? "", r.client?.code ?? ""].some((s) => s.toLowerCase().includes(q)));
}

/** Packages and check types with Ontriq's list price and the client's contracted price today. */
export async function getQuoteCatalog(clientId: string): Promise<CatalogItem[]> {
  const supabase = await createRequestClient();
  const today = colomboToday();
  const [{ data: packages }, { data: types }, { data: prices }] = await Promise.all([
    supabase
      .from("packages")
      .select("id, name, description, pricing_mode, fixed_price, tat_days, sort, items:package_items(check_type_id, unit_price, check_type:check_types(name))")
      .eq("owner_scope", "org")
      .eq("is_active", true)
      .order("sort")
      .order("name"),
    supabase.from("check_types").select("id, name, description, sort").is("archived_at", null).not("current_version_id", "is", null).order("sort"),
    supabase
      .from("client_price_lists")
      .select("check_type_id, package_id, unit_price, valid_from")
      .eq("client_id", clientId)
      .lte("valid_from", today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("valid_from", { ascending: false }),
  ]);
  const contracted = new Map<string, number>();
  for (const p of prices ?? []) {
    const key = p.check_type_id ? `check:${p.check_type_id}` : `package:${p.package_id}`;
    if (!contracted.has(key)) contracted.set(key, num(p.unit_price));
  }
  // The price a client-built package item would take (max over Ontriq's active packages), as package_items_price_guard does.
  const listPrice = new Map<string, number>();
  for (const pkg of packages ?? []) {
    for (const it of (pkg.items ?? []) as { check_type_id: string; unit_price: number }[]) {
      listPrice.set(it.check_type_id, Math.max(listPrice.get(it.check_type_id) ?? 0, num(it.unit_price)));
    }
  }
  const pkgItems: CatalogItem[] = (packages ?? []).map((p) => {
    const items = (p.items ?? []) as { unit_price: number; check_type: { name: string } | null }[];
    const sum = items.reduce((a, i) => a + num(i.unit_price), 0);
    return {
      kind: "package",
      id: p.id,
      name: p.name,
      description: p.description,
      list_price: p.pricing_mode === "fixed" && p.fixed_price !== null ? num(p.fixed_price) : sum,
      contracted_price: contracted.get(`package:${p.id}`) ?? null,
      tat_days: p.tat_days,
      checks: items.map((i) => i.check_type?.name ?? "").filter(Boolean),
    };
  });
  const checkItems: CatalogItem[] = (types ?? []).map((t) => ({
    kind: "check",
    id: t.id,
    name: t.name,
    description: t.description,
    list_price: listPrice.get(t.id) ?? 0,
    contracted_price: contracted.get(`check:${t.id}`) ?? null,
    tat_days: null,
    checks: [],
  }));
  return [...pkgItems, ...checkItems];
}

export async function getQuoteBuilder(quoteId: string, viewer: Viewer): Promise<QuoteBuilderData | null> {
  const supabase = await createRequestClient();
  const { data: q } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!q) return null;
  const [{ data: items }, { data: tiers }, { data: client }, { data: contacts }, { data: members }, { data: events }, { data: versions }, issuer, catalog] = await Promise.all([
    supabase.from("quote_items").select("*").eq("quote_id", q.id).order("sort"),
    supabase.from("quote_tiers").select("*").eq("quote_id", q.id).order("min_volume"),
    supabase.from("clients").select("id, name, code, address, email, phone, default_template, payment_terms_days, sla_days").eq("id", q.client_id).single(),
    supabase.from("client_contacts").select("id, name, title, email").eq("client_id", q.client_id).order("is_primary", { ascending: false }).order("name"),
    supabase.from("memberships").select("user_id, role:roles(key)").eq("client_id", q.client_id).eq("kind", "client").eq("status", "active"),
    supabase.from("quote_events").select("id, kind, body, actor_id, actor_kind, at").eq("quote_id", q.id).order("at", { ascending: false }).limit(50),
    q.number ? supabase.from("quotes").select("id, version, status, valid_until").eq("number", q.number).order("version") : Promise.resolve({ data: [] }),
    getIssuer(q.org_id),
    getQuoteCatalog(q.client_id),
  ]);
  if (!client) return null;

  const memberIds = (members ?? []).filter((m) => (m.role as { key: string } | null)?.key === "client_admin").map((m) => m.user_id);
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter(Boolean) as string[])];
  const ids = [...new Set([...memberIds, ...actorIds])];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const person = new Map((profiles ?? []).map((p) => [p.id, p]));
  const { data: doc } = q.document_id ? await supabase.from("generated_documents").select("id, status").eq("id", q.document_id).maybeSingle() : { data: null };

  const recipients: QuoteBuilderData["recipients"] = [];
  const seen = new Set<string>();
  for (const c of contacts ?? []) {
    if (c.email && !seen.has(c.email.toLowerCase())) {
      seen.add(c.email.toLowerCase());
      recipients.push({ name: c.name, email: c.email, source: "contact" });
    }
  }
  for (const id of memberIds) {
    const p = person.get(id);
    if (p?.email && !seen.has(p.email.toLowerCase())) {
      seen.add(p.email.toLowerCase());
      recipients.push({ name: p.full_name || p.email, email: p.email, source: "portal" });
    }
  }

  const today = colomboToday();
  return {
    quote: {
      id: q.id,
      number: q.number,
      version: q.version,
      status: displayQuoteStatus(q.status, q.valid_until, today),
      rawStatus: q.status,
      issue_date: q.issue_date,
      currency: q.currency,
      parent_id: q.parent_id,
      document_id: q.document_id,
      confirmed_at: q.confirmed_at,
      sent_at: q.sent_at,
      viewed_at: q.viewed_at,
      accepted_at: q.accepted_at,
      accepted_name: q.accepted_name,
      declined_at: q.declined_at,
      declined_reason: q.declined_reason,
      subtotal: num(q.subtotal),
      discount_total: num(q.discount_total),
      total: num(q.total),
    },
    draft: {
      contact_id: q.contact_id,
      template_key: asTemplate(q.template_key),
      title: q.title,
      valid_until: q.valid_until,
      payment_terms_days: q.payment_terms_days,
      expected_monthly_volume: q.expected_monthly_volume,
      intro: q.intro,
      scope: q.scope,
      assumptions: q.assumptions,
      tat_text: q.tat_text,
      closing: q.closing,
      internal_notes: q.internal_notes,
      lines: (items ?? []).map((i) => ({
        key: i.id,
        kind: i.kind as "package" | "check" | "custom",
        package_id: i.package_id,
        check_type_id: i.check_type_id,
        description: i.description,
        quantity: num(i.quantity),
        unit_price: num(i.unit_price),
        discount_pct: num(i.discount_pct),
      })),
      tiers: (tiers ?? []).map((t) => ({ key: t.id, min_volume: t.min_volume, max_volume: t.max_volume, discount_pct: num(t.discount_pct), note: t.note })),
    },
    client: {
      id: client.id,
      name: client.name,
      code: client.code,
      default_template: client.default_template,
      payment_terms_days: client.payment_terms_days,
      sla_days: client.sla_days,
    },
    docClient: { name: client.name, address: documentAddress(client.address), email: client.email, phone: client.phone },
    contacts: (contacts ?? []).map((c) => ({ id: c.id, name: c.name, title: c.title, email: c.email })),
    recipients,
    catalog,
    issuer,
    document: doc ? { id: doc.id, status: doc.status } : null,
    events: (events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      actor: e.actor_kind === "system" ? "System" : e.actor_id ? (person.get(e.actor_id)?.full_name || (e.actor_kind === "client" ? "Client" : "Ontriq")) : e.actor_kind === "client" ? "Client" : "Ontriq",
      actor_kind: e.actor_kind,
      at: e.at,
    })),
    versions: ((versions ?? []) as { id: string; version: number; status: string; valid_until: string }[]).map((v) => ({
      id: v.id,
      version: v.version,
      status: displayQuoteStatus(v.status, v.valid_until, today),
    })),
    canEdit: can(viewer, "quotes.manage"),
    canSend: can(viewer, "quotes.send"),
    aiConfigured: isAiConfigured(),
  };
}

export function canReadQuotes(viewer: Viewer) {
  return canAny(viewer, ["quotes.manage", "quotes.send"]);
}

export async function getClientQuotes(clientId: string) {
  return listQuotes({ client: clientId, status: "all" });
}

export type PriceListRow = { id: string; name: string; kind: "check" | "package"; unit_price: number; currency: string; valid_from: string; valid_to: string | null; quote_number: string | null };

export async function getClientPriceList(clientId: string): Promise<PriceListRow[]> {
  const supabase = await createRequestClient();
  const today = colomboToday();
  const { data } = await supabase
    .from("client_price_lists")
    .select("id, unit_price, currency, valid_from, valid_to, check_type:check_types(name), package:packages(name), quote:quotes(number)")
    .eq("client_id", clientId)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("valid_from", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    name: (r.check_type as { name: string } | null)?.name ?? (r.package as { name: string } | null)?.name ?? "—",
    kind: r.check_type ? "check" : "package",
    unit_price: num(r.unit_price),
    currency: r.currency,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    quote_number: (r.quote as { number: string | null } | null)?.number ?? null,
  }));
}

/** Clients a quotation may be made for (any status but archived). */
export async function quoteClientOptions(): Promise<{ id: string; name: string; code: string; status: string }[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("clients").select("id, name, code, status").neq("status", "archived").order("name");
  return data ?? [];
}
