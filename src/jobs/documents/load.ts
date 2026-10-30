/**
 * Build a DocumentModel for a quote, invoice, receipt or credit note from the
 * database (service role). Used by the document.render job and by the
 * statement route. Plain Node: relative imports only.
 */
import type { ServiceClient } from "../admin-client";
import {
  creditNoteModel,
  invoiceModel,
  issuerFromBranding,
  quoteModel,
  receiptModel,
  type DocumentModel,
  type TemplateKey,
} from "../../domain/documents/model";

type Client = { name: string; address: Record<string, string> | null; email: string | null; phone: string | null };
const num = (v: unknown) => Number(v ?? 0);

async function issuer(admin: ServiceClient, orgId: string) {
  const { data } = await admin.from("orgs").select("name, branding").eq("id", orgId).single();
  return issuerFromBranding({ name: data?.name ?? "Ontriq", branding: (data?.branding ?? {}) as Record<string, unknown> });
}

async function clientAndContact(admin: ServiceClient, clientId: string, contactId: string | null) {
  const { data: client } = await admin.from("clients").select("name, address, email, phone").eq("id", clientId).single();
  const { data: contact } = contactId ? await admin.from("client_contacts").select("name, title, email").eq("id", contactId).maybeSingle() : { data: null };
  return { client: client as unknown as Client, contact: contact ?? null };
}

export async function loadDocumentModel(
  admin: ServiceClient,
  doc: { kind: string; entity_id: string | null; org_id: string; template_key: string | null },
): Promise<{ model: DocumentModel; template: TemplateKey }> {
  const template = (["executive", "modern", "classic"].includes(doc.template_key ?? "") ? doc.template_key : "executive") as TemplateKey;
  const id = doc.entity_id ?? "";
  const iss = await issuer(admin, doc.org_id);

  if (doc.kind === "quote") {
    const { data: q } = await admin.from("quotes").select("*").eq("id", id).single();
    if (!q) throw new Error(`quote ${id} not found`);
    const { data: items } = await admin.from("quote_items").select("description, quantity, unit_price, discount_pct, total, sort").eq("quote_id", id).order("sort");
    const { data: tiers } = await admin.from("quote_tiers").select("min_volume, max_volume, discount_pct, note").eq("quote_id", id).order("min_volume");
    const { client, contact } = await clientAndContact(admin, q.client_id, q.contact_id);
    return {
      template,
      model: quoteModel({
        issuer: iss,
        client,
        contact,
        quote: { ...q, subtotal: num(q.subtotal), discount_total: num(q.discount_total), total: num(q.total) },
        items: (items ?? []).map((i) => ({ description: i.description, quantity: num(i.quantity), unit_price: num(i.unit_price), discount_pct: num(i.discount_pct), total: num(i.total) })),
        tiers: (tiers ?? []).map((t) => ({ min_volume: t.min_volume, max_volume: t.max_volume, discount_pct: num(t.discount_pct), note: t.note })),
      }),
    };
  }

  if (doc.kind === "invoice") {
    const { data: inv } = await admin.from("invoices").select("*").eq("id", id).single();
    if (!inv) throw new Error(`invoice ${id} not found`);
    const { data: items } = await admin.from("invoice_items").select("description, quantity, unit_price, discount_pct, total, sort").eq("invoice_id", id).order("sort");
    const { client, contact } = await clientAndContact(admin, inv.client_id, inv.contact_id);
    return {
      template,
      model: invoiceModel({
        issuer: iss,
        client,
        contact,
        invoice: {
          ...inv,
          subtotal: num(inv.subtotal),
          discount_total: num(inv.discount_total),
          net_total: num(inv.net_total),
          total: num(inv.total),
          amount_paid: num(inv.amount_paid),
          amount_credited: num(inv.amount_credited),
          balance: num(inv.balance),
          tax_lines: ((inv.tax_lines ?? []) as { code: string; name: string; rate: number; inclusive: boolean; amount: number }[]).map((t) => ({ ...t, rate: num(t.rate), amount: num(t.amount) })),
        },
        items: (items ?? []).map((i) => ({ description: i.description, quantity: num(i.quantity), unit_price: num(i.unit_price), discount_pct: num(i.discount_pct), total: num(i.total) })),
      }),
    };
  }

  if (doc.kind === "receipt") {
    const { data: p } = await admin.from("payments").select("*").eq("id", id).single();
    if (!p) throw new Error(`payment ${id} not found`);
    const { data: inv } = await admin.from("invoices").select("number, currency, total, balance").eq("id", p.invoice_id).single();
    const { client } = await clientAndContact(admin, p.client_id, null);
    return {
      template,
      model: receiptModel({
        issuer: iss,
        client,
        payment: { receipt_number: p.receipt_number ?? "", amount: num(p.amount), method: p.method, reference: p.reference, paid_on: p.paid_on, voided: Boolean(p.voided_at) },
        invoice: { number: inv?.number ?? "", currency: inv?.currency ?? "LKR", total: num(inv?.total), balance: num(inv?.balance) },
      }),
    };
  }

  if (doc.kind === "credit_note") {
    const { data: n } = await admin.from("credit_notes").select("*").eq("id", id).single();
    if (!n) throw new Error(`credit note ${id} not found`);
    const { data: inv } = await admin.from("invoices").select("number, currency").eq("id", n.invoice_id).single();
    const { client } = await clientAndContact(admin, n.client_id, null);
    return {
      template,
      model: creditNoteModel({ issuer: iss, client, note: { ...n, amount: num(n.amount) }, invoice: { number: inv?.number ?? "", currency: inv?.currency ?? "LKR" } }),
    };
  }

  throw new Error(`no document builder for ${doc.kind}`);
}
