import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { ACTIVE_STAGES, type FinalResult, type Stage } from "@/domain/workflow/stages";

/** Read models for the client directory. Row level security decides what each person sees. */

export const CLIENT_STATUSES = ["prospect", "active", "suspended", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export type ClientListItem = {
  id: string;
  name: string;
  code: string;
  industry: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  activeCases: number;
  totalCases: number;
};

export function addressText(address: unknown): string {
  if (!address || typeof address !== "object") return typeof address === "string" ? address : "";
  const a = address as Record<string, unknown>;
  if (typeof a.text === "string") return a.text;
  return ["line1", "line2", "city", "district", "postcode"]
    .map((k) => a[k])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(", ");
}

export async function listClients(filters: { q?: string; status?: string }): Promise<ClientListItem[]> {
  const supabase = await createRequestClient();
  let query = supabase
    .from("clients")
    .select("id, name, code, industry, email, phone, status, total:cases(count), active:cases(count)")
    .in("active.stage", ACTIVE_STAGES)
    .order("name");
  if (filters.status && (CLIENT_STATUSES as readonly string[]).includes(filters.status)) query = query.eq("status", filters.status);
  else if (filters.status !== "all") query = query.neq("status", "archived");
  if (filters.q) {
    const term = filters.q.replace(/[%_,()]/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,legal_name.ilike.%${term}%,industry.ilike.%${term}%`);
  }
  const { data } = await query.limit(500);
  const count = (v: unknown) => (Array.isArray(v) ? Number((v[0] as { count?: number } | undefined)?.count ?? 0) : 0);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    industry: c.industry,
    email: c.email,
    phone: c.phone,
    status: c.status as ClientStatus,
    totalCases: count(c.total),
    activeCases: count(c.active),
  }));
}

export type ClientProfile = {
  id: string;
  name: string;
  code: string;
  legalName: string | null;
  registrationNo: string | null;
  vatNo: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string;
  slaDays: number;
  paymentTermsDays: number;
  retentionMonths: number;
  status: ClientStatus;
  notes: string | null;
  createdAt: string;
};

export const getClientProfile = cache(async (id: string): Promise<ClientProfile | null> => {
  const supabase = await createRequestClient();
  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    legalName: c.legal_name,
    registrationNo: c.registration_no,
    vatNo: c.vat_no,
    industry: c.industry,
    website: c.website,
    email: c.email,
    phone: c.phone,
    address: addressText(c.address),
    slaDays: c.sla_days,
    paymentTermsDays: c.payment_terms_days,
    retentionMonths: c.retention_months,
    status: c.status as ClientStatus,
    notes: c.notes,
    createdAt: c.created_at,
  };
});

export type ClientContact = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  receivesReports: boolean;
  receivesInvoices: boolean;
};

export async function getClientContacts(clientId: string): Promise<ClientContact[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("client_contacts").select("*").eq("client_id", clientId).order("is_primary", { ascending: false }).order("name");
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    email: c.email,
    phone: c.phone,
    isPrimary: c.is_primary,
    receivesReports: c.receives_reports,
    receivesInvoices: c.receives_invoices,
  }));
}

/** Check types this client may order: no row means allowed. */
export async function getClientCheckAccess(clientId: string): Promise<Map<string, boolean>> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("client_check_type_access").select("check_type_id, enabled").eq("client_id", clientId);
  return new Map((data ?? []).map((r) => [r.check_type_id, r.enabled]));
}

export type ClientCaseRow = {
  id: string;
  reference: string;
  candidateName: string;
  stage: Stage;
  onHold: boolean;
  proposedResult: FinalResult | null;
  checksDone: number;
  checksTotal: number;
  receivedAt: string;
  dueAt: string | null;
  packageName: string;
};

export async function getClientCases(clientId: string, limit = 10): Promise<ClientCaseRow[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("cases")
    .select("id, reference, candidate_name, stage, on_hold, proposed_result, checks_done, checks_total, received_at, due_at, package_snapshot")
    .eq("client_id", clientId)
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((c) => ({
    id: c.id,
    reference: c.reference,
    candidateName: c.candidate_name,
    stage: c.stage,
    onHold: c.on_hold,
    proposedResult: c.proposed_result as FinalResult | null,
    checksDone: c.checks_done,
    checksTotal: c.checks_total,
    receivedAt: c.received_at,
    dueAt: c.due_at,
    packageName: ((c.package_snapshot as { name?: string } | null)?.name ?? "") || "Custom",
  }));
}

export async function getClientCaseCounts(clientId: string): Promise<{ active: number; released: number; total: number }> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("cases").select("stage").eq("client_id", clientId);
  const rows = data ?? [];
  return {
    total: rows.length,
    active: rows.filter((r) => (ACTIVE_STAGES as Stage[]).includes(r.stage)).length,
    released: rows.filter((r) => r.stage === "released").length,
  };
}
