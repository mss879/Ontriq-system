/**
 * One description of a business document (quotation, invoice, receipt,
 * credit note, statement) that two renderers draw: react-pdf in the
 * document.render job (src/jobs/documents/templates.tsx) and HTML for live
 * previews (src/components/documents/document-preview.tsx). Builders turn
 * database rows into the model. Pure module (tests/unit/documents.test.ts).
 */
import { formatAmount, formatMoney } from "../pricing/money";
import { reportDate } from "../reports/compile-core";

export const TEMPLATE_KEYS = ["executive", "modern", "classic"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATE_LABELS: Record<TemplateKey, { name: string; description: string }> = {
  executive: { name: "Executive", description: "Navy header band, serif headings, summary box." },
  modern: { name: "Modern", description: "White page, thin accent rule, airy tables, totals card." },
  classic: { name: "Classic", description: "Formal bordered tables, compact rows, letterhead feel." },
};

export type Issuer = {
  name: string;
  legal_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registration_no?: string;
  vat_no?: string;
  bank?: { bank: string; branch?: string; account_name: string; account_no: string; swift?: string } | null;
};

export type DocumentLine = { description: string; quantity: number; unit_price: number; discount_pct: number; total: number };

export type DocumentModel = {
  kind: "quote" | "invoice" | "receipt" | "credit_note" | "statement";
  title: string;
  /** A line under the title, e.g. the quotation's subject. */
  subtitle: string | null;
  number: string;
  badge: string | null;
  currency: string;
  issuer: Issuer;
  to: { name: string; lines: string[] };
  meta: { label: string; value: string }[];
  intro: string | null;
  sections: { heading: string; body: string }[];
  lines: DocumentLine[];
  showDiscount: boolean;
  tiers: { range: string; discount: string; note: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  statement: { rows: { date: string; kind: string; reference: string; debit: string; credit: string; balance: string }[] } | null;
  note: string | null;
  closing: string | null;
  payment: string[];
  acceptance: string | null;
  footer: string;
};

type Client = { name: string; address?: Record<string, string> | null; email?: string | null; phone?: string | null };
type Contact = { name: string; title?: string | null; email?: string | null } | null;

/** Client addresses are stored either as structured lines or as one free-text block ({ text }). */
function addressLines(a: Record<string, string> | null | undefined): string[] {
  if (!a) return [];
  if (typeof a.text === "string" && !a.line1) return a.text.split(/\n|,\s*/).map((x) => x.trim()).filter(Boolean);
  return [a.line1, a.line2, [a.city, a.postcode].filter(Boolean).join(" "), a.country].map((x) => (x ?? "").trim()).filter(Boolean);
}

function party(client: Client, contact: Contact): DocumentModel["to"] {
  return {
    name: client.name,
    lines: [
      ...(contact ? [`Attn: ${contact.name}${contact.title ? `, ${contact.title}` : ""}`] : []),
      ...addressLines(client.address),
      ...(contact?.email ? [contact.email] : client.email ? [client.email] : []),
    ],
  };
}

function bankLines(issuer: Issuer): string[] {
  const b = issuer.bank;
  if (!b?.account_no) return ["Pay by bank transfer and upload the slip in the client portal, or contact us for bank details."];
  return [
    `Bank: ${b.bank}${b.branch ? `, ${b.branch}` : ""}`,
    `Account name: ${b.account_name}`,
    `Account number: ${b.account_no}`,
    ...(b.swift ? [`SWIFT: ${b.swift}`] : []),
    "Please quote the invoice number as the payment reference and upload the slip in the client portal.",
  ];
}

const footerOf = (i: Issuer) => [i.legal_name, i.address, i.phone, i.email, i.website].filter(Boolean).join(" · ");

export function quoteModel(input: {
  issuer: Issuer;
  client: Client;
  contact: Contact;
  quote: {
    number: string | null; version: number; status: string; title: string; currency: string; issue_date: string; valid_until: string;
    payment_terms_days: number; intro: string; scope: string; assumptions: string; tat_text: string; closing: string;
    subtotal: number; discount_total: number; total: number; accepted_name?: string | null; accepted_at?: string | null;
  };
  items: DocumentLine[];
  tiers: { min_volume: number; max_volume: number | null; discount_pct: number; note: string }[];
}): DocumentModel {
  const q = input.quote;
  const draft = !q.number || q.status === "draft";
  return {
    kind: "quote",
    title: "Quotation",
    subtitle: q.title.trim() || null,
    number: draft ? "Draft" : `${q.number}${q.version > 1 ? ` (v${q.version})` : ""}`,
    badge: draft ? "DRAFT" : q.status === "accepted" ? "ACCEPTED" : q.status === "expired" ? "EXPIRED" : null,
    currency: q.currency,
    issuer: input.issuer,
    to: party(input.client, input.contact),
    meta: [
      { label: "Date", value: reportDate(q.issue_date) ?? "" },
      { label: "Valid until", value: reportDate(q.valid_until) ?? "" },
      { label: "Payment terms", value: q.payment_terms_days === 0 ? "Due on receipt" : `${q.payment_terms_days} days` },
    ],
    intro: q.intro.trim() || null,
    sections: [
      { heading: "Scope", body: q.scope },
      { heading: "Turnaround", body: q.tat_text },
      { heading: "Assumptions", body: q.assumptions },
    ].filter((sct) => sct.body.trim()),
    lines: input.items,
    showDiscount: input.items.some((l) => l.discount_pct > 0),
    tiers: input.tiers.map((t) => ({
      range: t.max_volume ? `${t.min_volume}–${t.max_volume} cases a month` : `${t.min_volume}+ cases a month`,
      discount: `${t.discount_pct}% off`,
      note: t.note,
    })),
    totals: [
      ...(q.discount_total > 0 ? [{ label: "Subtotal", value: formatAmount(q.subtotal) }, { label: "Discount", value: `−${formatAmount(q.discount_total)}` }] : []),
      { label: `Total (${q.currency})`, value: formatAmount(q.total), strong: true },
    ],
    statement: null,
    note: null,
    closing: q.closing.trim() || null,
    payment: [],
    acceptance: q.accepted_name && q.accepted_at ? `Accepted by ${q.accepted_name} on ${reportDate(q.accepted_at)}` : null,
    footer: footerOf(input.issuer),
  };
}

export function invoiceModel(input: {
  issuer: Issuer;
  client: Client;
  contact: Contact;
  invoice: {
    number: string | null; status: string; currency: string; issue_date: string | null; due_date: string | null; period_from: string | null; period_to: string | null;
    message: string; subtotal: number; discount_total: number; net_total: number; tax_lines: { name: string; code: string; rate: number; inclusive: boolean; amount: number }[];
    total: number; amount_paid: number; amount_credited: number; balance: number;
  };
  items: DocumentLine[];
}): DocumentModel {
  const i = input.invoice;
  const draft = !i.number || i.status === "draft";
  const hasTax = i.tax_lines.length > 0;
  return {
    kind: "invoice",
    title: hasTax ? "Tax invoice" : "Invoice",
    subtitle: null,
    number: draft ? "Draft" : (i.number ?? ""),
    badge: draft ? "DRAFT" : i.status === "paid" ? "PAID" : i.status === "void" ? "VOID" : null,
    currency: i.currency,
    issuer: input.issuer,
    to: party(input.client, input.contact),
    meta: [
      { label: "Invoice date", value: reportDate(i.issue_date) ?? "On confirmation" },
      { label: "Due date", value: reportDate(i.due_date) ?? "—" },
      ...(i.period_from && i.period_to ? [{ label: "Period", value: `${reportDate(i.period_from)} – ${reportDate(i.period_to)}` }] : []),
      ...(input.issuer.vat_no && hasTax ? [{ label: "VAT reg. no.", value: input.issuer.vat_no }] : []),
    ],
    intro: null,
    sections: [],
    lines: input.items,
    showDiscount: input.items.some((l) => l.discount_pct > 0),
    tiers: [],
    totals: [
      { label: "Subtotal", value: formatAmount(i.subtotal) },
      ...(i.discount_total > 0 ? [{ label: "Discount", value: `−${formatAmount(i.discount_total)}` }] : []),
      ...i.tax_lines.map((t) => ({ label: `${t.name} ${t.rate}%${t.inclusive ? " (included)" : ""}`, value: formatAmount(t.amount) })),
      { label: `Total (${i.currency})`, value: formatAmount(i.total), strong: true },
      ...(i.amount_paid > 0 ? [{ label: "Paid", value: `−${formatAmount(i.amount_paid)}` }] : []),
      ...(i.amount_credited > 0 ? [{ label: "Credited", value: `−${formatAmount(i.amount_credited)}` }] : []),
      ...(i.amount_paid > 0 || i.amount_credited > 0 ? [{ label: "Balance due", value: formatAmount(i.balance), strong: true }] : []),
    ],
    statement: null,
    note: i.message.trim() || null,
    closing: null,
    payment: i.status === "paid" ? [] : bankLines(input.issuer),
    acceptance: null,
    footer: footerOf(input.issuer),
  };
}

export function receiptModel(input: {
  issuer: Issuer;
  client: Client;
  payment: { receipt_number: string; amount: number; method: string; reference: string | null; paid_on: string; voided: boolean };
  invoice: { number: string; currency: string; total: number; balance: number };
}): DocumentModel {
  const p = input.payment;
  const methods: Record<string, string> = { bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", card: "Card", online: "Online payment", other: "Other" };
  return {
    kind: "receipt",
    title: "Payment receipt",
    subtitle: null,
    number: p.receipt_number,
    badge: p.voided ? "VOID" : null,
    currency: input.invoice.currency,
    issuer: input.issuer,
    to: party(input.client, null),
    meta: [
      { label: "Received on", value: reportDate(p.paid_on) ?? "" },
      { label: "For invoice", value: input.invoice.number },
      { label: "Method", value: methods[p.method] ?? p.method },
      ...(p.reference ? [{ label: "Reference", value: p.reference }] : []),
    ],
    intro: `Thank you. We received ${formatMoney(p.amount, input.invoice.currency)} against invoice ${input.invoice.number}.`,
    sections: [],
    lines: [],
    showDiscount: false,
    tiers: [],
    totals: [
      { label: "Amount received", value: formatAmount(p.amount), strong: true },
      { label: "Invoice total", value: formatAmount(input.invoice.total) },
      { label: "Balance remaining", value: formatAmount(input.invoice.balance) },
    ],
    statement: null,
    note: null,
    closing: null,
    payment: [],
    acceptance: null,
    footer: footerOf(input.issuer),
  };
}

export function creditNoteModel(input: {
  issuer: Issuer;
  client: Client;
  note: { number: string; amount: number; reason: string; created_at: string; status: string };
  invoice: { number: string; currency: string };
}): DocumentModel {
  return {
    kind: "credit_note",
    title: "Credit note",
    subtitle: null,
    number: input.note.number,
    badge: input.note.status === "void" ? "VOID" : null,
    currency: input.invoice.currency,
    issuer: input.issuer,
    to: party(input.client, null),
    meta: [
      { label: "Date", value: reportDate(input.note.created_at) ?? "" },
      { label: "Against invoice", value: input.invoice.number },
    ],
    intro: null,
    sections: [{ heading: "Reason", body: input.note.reason }],
    lines: [{ description: `Credit against ${input.invoice.number}`, quantity: 1, unit_price: input.note.amount, discount_pct: 0, total: input.note.amount }],
    showDiscount: false,
    tiers: [],
    totals: [{ label: `Credit (${input.invoice.currency})`, value: formatAmount(input.note.amount), strong: true }],
    statement: null,
    note: null,
    closing: null,
    payment: [],
    acceptance: null,
    footer: footerOf(input.issuer),
  };
}

export function statementModel(input: {
  issuer: Issuer;
  client: Client;
  statement: { from: string; to: string; opening: number; closing: number; lines: { date: string; kind: string; reference: string; debit: number; credit: number; balance: number }[] };
  currency: string;
}): DocumentModel {
  const kinds: Record<string, string> = { invoice: "Invoice", payment: "Payment", credit_note: "Credit note" };
  const st = input.statement;
  return {
    kind: "statement",
    title: "Statement of account",
    subtitle: null,
    number: `${reportDate(st.from)} – ${reportDate(st.to)}`,
    badge: null,
    currency: input.currency,
    issuer: input.issuer,
    to: party(input.client, null),
    meta: [
      { label: "Opening balance", value: formatAmount(st.opening) },
      { label: "Closing balance", value: formatAmount(st.closing) },
    ],
    intro: null,
    sections: [],
    lines: [],
    showDiscount: false,
    tiers: [],
    totals: [{ label: `Amount due (${input.currency})`, value: formatAmount(st.closing), strong: true }],
    statement: {
      rows: st.lines.map((l) => ({
        date: reportDate(l.date) ?? l.date,
        kind: kinds[l.kind] ?? l.kind,
        reference: l.reference ?? "",
        debit: l.debit ? formatAmount(l.debit) : "",
        credit: l.credit ? formatAmount(l.credit) : "",
        balance: formatAmount(l.balance),
      })),
    },
    note: null,
    closing: null,
    payment: st.closing > 0 ? bankLines(input.issuer) : [],
    acceptance: null,
    footer: footerOf(input.issuer),
  };
}

/** The issuer block from orgs.branding (Settings → Branding). */
export function issuerFromBranding(org: { name: string; branding: Record<string, unknown> | null }): Issuer {
  const b = (org.branding ?? {}) as Record<string, string | undefined> & { bank?: Issuer["bank"] };
  return {
    name: b.display_name || org.name,
    legal_name: b.legal_name || org.name,
    address: b.address ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    website: b.website ?? "",
    registration_no: b.registration_no || undefined,
    vat_no: b.vat_no || undefined,
    bank: b.bank ?? null,
  };
}
