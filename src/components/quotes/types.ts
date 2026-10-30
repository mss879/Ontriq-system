/**
 * Shapes shared by the quotation screens (server queries, the builder and the
 * portal). Types and tiny pure helpers only, so client components can import it.
 */
import type { Issuer, TemplateKey } from "@/domain/documents/model";

export const QUOTE_STATUSES = ["draft", "confirmed", "sent", "viewed", "accepted", "declined", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  superseded: "Replaced",
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, "neutral" | "info" | "progress" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "info",
  sent: "progress",
  viewed: "progress",
  accepted: "success",
  declined: "danger",
  expired: "warning",
  superseded: "neutral",
};

/** Today's date in Sri Lanka as YYYY-MM-DD. */
export function colomboToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Sent quotations past their date read as expired, even before the nightly job marks them. */
export function displayQuoteStatus(status: string, validUntil: string, today = colomboToday()): QuoteStatus {
  if ((status === "sent" || status === "viewed") && validUntil < today) return "expired";
  return (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : "draft";
}

export type QuoteLine = {
  key: string;
  kind: "package" | "check" | "custom";
  package_id: string | null;
  check_type_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
};

export type QuoteTier = { key: string; min_volume: number; max_volume: number | null; discount_pct: number; note: string };

export type QuoteDraft = {
  contact_id: string | null;
  template_key: TemplateKey;
  title: string;
  valid_until: string;
  payment_terms_days: number;
  expected_monthly_volume: number | null;
  intro: string;
  scope: string;
  assumptions: string;
  tat_text: string;
  closing: string;
  internal_notes: string;
  lines: QuoteLine[];
  tiers: QuoteTier[];
};

export type CatalogItem = {
  kind: "package" | "check";
  id: string;
  name: string;
  description: string;
  /** Ontriq's price without a contract. */
  list_price: number;
  /** The client's contracted price today, if any. */
  contracted_price: number | null;
  tat_days: number | null;
  checks: string[];
};

export type DocClient = { name: string; address: Record<string, string> | null; email: string | null; phone: string | null };

export type QuoteEvent = { id: number; kind: string; body: string | null; actor: string; actor_kind: string; at: string };

export type QuoteBuilderData = {
  quote: {
    id: string;
    number: string | null;
    version: number;
    status: QuoteStatus;
    rawStatus: string;
    issue_date: string;
    currency: string;
    parent_id: string | null;
    document_id: string | null;
    confirmed_at: string | null;
    sent_at: string | null;
    viewed_at: string | null;
    accepted_at: string | null;
    accepted_name: string | null;
    declined_at: string | null;
    declined_reason: string | null;
    subtotal: number;
    discount_total: number;
    total: number;
  };
  draft: QuoteDraft;
  client: { id: string; name: string; code: string; default_template: string; payment_terms_days: number; sla_days: number };
  docClient: DocClient;
  contacts: { id: string; name: string; title: string | null; email: string | null }[];
  recipients: { name: string; email: string; source: "contact" | "portal" }[];
  catalog: CatalogItem[];
  issuer: Issuer;
  document: { id: string; status: string } | null;
  events: QuoteEvent[];
  versions: { id: string; version: number; status: QuoteStatus }[];
  canEdit: boolean;
  canSend: boolean;
  aiConfigured: boolean;
};

/** A client address stored as free text ({ text }) as line fields the document model prints. */
export function documentAddress(address: unknown): Record<string, string> | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  if (typeof a.line1 === "string") return a as Record<string, string>;
  if (typeof a.text === "string" && a.text.trim()) {
    const parts = a.text.split(/\n|,\s*/).map((p) => p.trim()).filter(Boolean);
    return { line1: parts.slice(0, 2).join(", "), line2: parts.slice(2).join(", ") };
  }
  return null;
}
