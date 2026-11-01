import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { parseNic } from "@/domain/nic-core";
import type { FinalResult, Stage } from "@/domain/workflow/stages";

/** Read models for the candidate directory. Row level security decides what each person sees. */

export const CANDIDATE_PAGE_SIZE = 50;

export type CandidateListItem = {
  id: string;
  fullName: string;
  nic: string | null;
  email: string | null;
  phone: string | null;
  district: string | null;
  caseCount: number;
  addedFor: string | null;
  createdAt: string;
};

export async function listCandidates(filters: { q?: string; page?: number }): Promise<{ items: CandidateListItem[]; total: number }> {
  const supabase = await createRequestClient();
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const from = (page - 1) * CANDIDATE_PAGE_SIZE;
  let query = supabase
    .from("candidates")
    .select("id, full_name, nic, email, phone, district, created_at, cases(count), added_for:clients!candidates_added_for_client_id_fkey(name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (filters.q) {
    const term = filters.q.replace(/[%_,()]/g, " ").trim();
    const nic = parseNic(term);
    if (nic.valid) query = query.eq("nic_canonical", nic.canonical);
    else if (term) query = query.or(`full_name.ilike.%${term}%,nic.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, count } = await query.range(from, from + CANDIDATE_PAGE_SIZE - 1);
  const items = (data ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    nic: c.nic,
    email: c.email,
    phone: c.phone,
    district: c.district,
    caseCount: Array.isArray(c.cases) ? Number((c.cases[0] as { count?: number } | undefined)?.count ?? 0) : 0,
    addedFor: c.added_for?.name ?? null,
    createdAt: c.created_at,
  }));
  return { items, total: count ?? items.length };
}

export type CandidateProfile = {
  id: string;
  fullName: string;
  nic: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  district: string | null;
  preferredLanguage: string;
  addedFor: { id: string; name: string } | null;
  erased: boolean;
  createdAt: string;
};

export const getCandidate = cache(async (id: string): Promise<CandidateProfile | null> => {
  const supabase = await createRequestClient();
  const { data: c } = await supabase.from("candidates").select("*, added_for:clients!candidates_added_for_client_id_fkey(id, name)").eq("id", id).maybeSingle();
  if (!c) return null;
  return {
    id: c.id,
    fullName: c.full_name,
    nic: c.nic,
    dateOfBirth: c.date_of_birth,
    gender: c.gender,
    email: c.email,
    phone: c.phone,
    address: c.address,
    district: c.district,
    preferredLanguage: c.preferred_language,
    addedFor: c.added_for ?? null,
    erased: c.erased_at !== null,
    createdAt: c.created_at,
  };
});

export type CandidateCase = {
  id: string;
  reference: string;
  clientName: string;
  stage: Stage;
  onHold: boolean;
  statusKey: string;
  proposedResult: FinalResult | null;
  finalResult: FinalResult | null;
  checksDone: number;
  checksTotal: number;
  packageName: string;
  positionTitle: string | null;
  receivedAt: string;
  dueAt: string | null;
};

export async function getCandidateCases(candidateId: string): Promise<CandidateCase[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("cases")
    .select("id, reference, stage, on_hold, status_key, proposed_result, final_result, checks_done, checks_total, package_snapshot, position_title, received_at, due_at, client:clients(name)")
    .eq("candidate_id", candidateId)
    .order("received_at", { ascending: false });
  return (data ?? []).map((c) => ({
    id: c.id,
    reference: c.reference,
    clientName: (c.client as { name: string } | null)?.name ?? "",
    stage: c.stage,
    onHold: c.on_hold,
    statusKey: c.status_key,
    proposedResult: c.proposed_result as FinalResult | null,
    finalResult: c.final_result as FinalResult | null,
    checksDone: c.checks_done,
    checksTotal: c.checks_total,
    packageName: ((c.package_snapshot as { name?: string } | null)?.name ?? "") || "Custom",
    positionTitle: c.position_title,
    receivedAt: c.received_at,
    dueAt: c.due_at,
  }));
}
