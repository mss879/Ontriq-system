import "server-only";
import { createRequestClient } from "@/lib/supabase/server";

/** The audit trail viewer (audit.read). Rows are insert-only, written by database triggers. */

export const AUDIT_PAGE_SIZE = 50;

/** Tables with an audit trigger, and how to name them for people. */
export const AUDITED_TABLES: Record<string, string> = {
  orgs: "Organisation",
  roles: "Designations",
  role_permissions: "Designation permissions",
  memberships: "Team membership",
  invitations: "Invitations",
  clients: "Clients",
  client_contacts: "Client contacts",
  client_settings: "Client settings",
  client_check_type_access: "Client check access",
  candidates: "Candidates",
  cases: "Cases",
  case_checks: "Checks",
  case_check_requirements: "Document requirements",
  documents: "Documents",
  check_types: "Check types",
  check_type_versions: "Check type versions",
  document_categories: "Document categories",
  packages: "Packages",
  package_items: "Package checks",
  package_client_visibility: "Package visibility",
  request_templates: "Request templates",
  staff_skills: "Staff skills",
  staff_capacity: "Staff capacity",
  staff_availability: "Staff leave",
  assignment_rules: "Assignment rules",
  client_status_catalog: "Status wording",
  qc_reviews: "QC reviews",
  report_versions: "Reports",
  candidate_requests: "Candidate requests",
  consent_forms: "Consent forms",
  client_requests: "Questions to clients",
  requirement_files: "Combined files",
  quotes: "Quotations",
  quote_items: "Quotation lines",
  client_price_lists: "Client price lists",
  invoices: "Invoices",
  invoice_items: "Invoice lines",
  payments: "Payments",
  payment_slips: "Payment slips",
  credit_notes: "Credit notes",
  tax_rates: "Tax rates",
  templates: "Message templates",
  tasks: "Tasks",
  document_templates: "Document designs",
  document_series: "Numbering series",
  generated_documents: "Generated documents",
  ai_capabilities: "AI capabilities",
  ai_budgets: "AI budgets",
  ai_cost_rates: "AI prices",
};

export type AuditFilters = { table?: string; op?: string; actor?: string; from?: string; to?: string; caseRef?: string; page?: number };

export type AuditRow = {
  id: number;
  table: string;
  rowId: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  actorId: string | null;
  actorKind: string;
  changedKeys: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  at: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything recorded against one case: the case, and every row that carries its id. */
export const caseAuditFilter = (caseId: string) => `row_id.eq.${caseId},after->>case_id.eq.${caseId},before->>case_id.eq.${caseId}`;

/** The case a reference names, for the audit filter. */
export async function caseIdFor(supabase: Awaited<ReturnType<typeof createRequestClient>>, reference: string | undefined): Promise<string | null | undefined> {
  const ref = reference?.trim().toUpperCase();
  if (!ref) return undefined;
  const { data } = await supabase.from("cases").select("id").eq("reference", ref).maybeSingle();
  return data?.id ?? null;
}

export async function listAudit(filters: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  const supabase = await createRequestClient();
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  let query = supabase.from("audit_log").select("*", { count: "exact" }).order("at", { ascending: false }).order("id", { ascending: false });
  if (filters.table && filters.table in AUDITED_TABLES) query = query.eq("table_name", filters.table);
  if (filters.op && ["INSERT", "UPDATE", "DELETE"].includes(filters.op)) query = query.eq("op", filters.op);
  if (filters.actor === "system") query = query.is("actor_id", null);
  else if (filters.actor && /^[0-9a-f-]{36}$/.test(filters.actor)) query = query.eq("actor_id", filters.actor);
  // Dates are Sri Lanka days.
  if (filters.from && DATE.test(filters.from)) query = query.gte("at", `${filters.from}T00:00:00+05:30`);
  if (filters.to && DATE.test(filters.to)) query = query.lte("at", `${filters.to}T23:59:59.999+05:30`);
  const caseId = await caseIdFor(supabase, filters.caseRef);
  if (caseId === null) return { rows: [], total: 0 };
  if (caseId) query = query.or(caseAuditFilter(caseId));
  const { data, count } = await query.range(from, from + AUDIT_PAGE_SIZE - 1);
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    table: r.table_name,
    rowId: r.row_id,
    op: r.op as AuditRow["op"],
    actorId: r.actor_id,
    actorKind: r.actor_kind,
    changedKeys: r.changed_keys ?? [],
    before: (r.before ?? null) as Record<string, unknown> | null,
    after: (r.after ?? null) as Record<string, unknown> | null,
    ip: r.ip,
    at: r.at,
  }));
  return { rows, total: count ?? rows.length };
}
