import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { peopleById, type Person } from "@/lib/server/cases/queries";

/** Reads used only by the case and check pages. */

export type DocumentCategoryInfo = { key: string; name: string; guide: string; sensitive: boolean };

export const getDocumentCategories = cache(async (): Promise<DocumentCategoryInfo[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("document_categories").select("key, name, guide, sensitive").eq("is_active", true).order("sort");
  return (data ?? []).map((c) => ({ key: c.key, name: c.name, guide: c.guide, sensitive: c.sensitive }));
});

export type ClientQuestion = {
  id: string;
  question: string;
  status: "open" | "answered" | "closed";
  answer: string | null;
  caseCheckId: string | null;
  askedBy: Person | null;
  answeredBy: Person | null;
  createdAt: string;
  answeredAt: string | null;
};

/** Questions Ontriq put to the client on a case (0041). */
export async function getClientQuestions(caseId: string): Promise<ClientQuestion[]> {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([supabase.from("client_requests").select("*").eq("case_id", caseId).order("created_at", { ascending: false }), peopleById()]);
  const who = (id: string | null) => (id ? (people.get(id) ?? { id, name: "Client", email: "" }) : null);
  return (data ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    status: q.status as ClientQuestion["status"],
    answer: q.answer,
    caseCheckId: q.case_check_id,
    askedBy: who(q.created_by),
    answeredBy: who(q.answered_by),
    createdAt: q.created_at,
    answeredAt: q.answered_at,
  }));
}

export type ContactEntry = {
  id: string;
  caseCheckId: string | null;
  recordKey: string | null;
  channel: string;
  direction: "outbound" | "inbound";
  counterparty: string;
  outcome: string | null;
  body: string;
  by: Person | null;
  at: string;
};

/** Calls, emails and visits staff logged on a case (0041). Automatic emails aren't listed. */
export async function getContactLog(caseId: string): Promise<ContactEntry[]> {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("communications").select("id, case_check_id, record_key, channel, direction, counterparty, outcome, body, created_by, created_at").eq("case_id", caseId).is("template_key", null).order("created_at", { ascending: false }),
    peopleById(),
  ]);
  return (data ?? []).map((c) => ({
    id: c.id,
    caseCheckId: c.case_check_id,
    recordKey: c.record_key,
    channel: c.channel,
    direction: c.direction as ContactEntry["direction"],
    counterparty: c.counterparty ?? "",
    outcome: c.outcome,
    body: c.body,
    by: c.created_by ? (people.get(c.created_by) ?? null) : null,
    at: c.created_at,
  }));
}

/** Check types that can be added to a case. */
export async function getCheckTypeOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("check_types").select("id, name, sort, current_version_id").is("archived_at", null).not("current_version_id", "is", null).order("sort");
  return (data ?? []).map((t) => ({ id: t.id, name: t.name }));
}
