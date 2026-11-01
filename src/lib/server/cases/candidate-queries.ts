import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { peopleById, type Person } from "./queries";
import { getCaseSuggestions } from "@/lib/server/ai/queries";
import { newest } from "@/domain/ai/suggestions";
import type { AnswerValue } from "@/domain/candidate/answers";
import type { CandidateReportBody } from "@/domain/candidate/report";

/**
 * Staff reads for the candidate side of a case (0008): the link, requests,
 * messages and consent. Row level security limits them to cases the viewer
 * can see. candidate_links has column-level grants: the secret's hash and
 * sealed copy are never selected here.
 */

const LINK_COLUMNS =
  "id, case_id, language, expires_at, revoked_at, revoked_reason, revoked_by, sent_at, sent_via, sent_count, first_opened_at, last_opened_at, open_count, reminders_sent, last_reminded_at, escalated_at, created_by, created_at";

export type CandidateLinkInfo = {
  id: string;
  language: "en" | "si" | "ta";
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  sentAt: string | null;
  sentVia: string[];
  sentCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  remindersSent: number;
  lastRemindedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  createdBy: Person | null;
  state: "active" | "expired" | "revoked";
};

export type CandidateRequestItem = {
  id: string;
  kind: "document" | "field" | "question";
  title: string;
  help: string | null;
  /** Part of the candidate's BGV form. */
  form: boolean;
  fieldKey: string | null;
  fieldType: string | null;
  caseCheckId: string | null;
  requirementId: string | null;
  dueAt: string | null;
  status: "open" | "answered" | "accepted" | "cancelled";
  answer: { value?: AnswerValue; document_id?: string; rows?: Record<string, unknown>[] } | null;
  /** Choices for a single detail, to show an answer in the words the candidate read. */
  options: { value: string; label: string }[];
  /** The columns, when the candidate filled in rows. */
  rowFields: { key: string; label: string; options?: { value: string; label: string }[] }[];
  answeredAt: string | null;
  reviewNote: string | null;
  reviewedBy: Person | null;
  reviewedAt: string | null;
  createdBy: Person | null;
  createdAt: string;
};

export type CandidateMessageItem = { id: string; fromKind: "staff" | "candidate"; author: Person | null; body: string; readAt: string | null; createdAt: string };

export type ConsentInfo = {
  id: string;
  status: "pending" | "submitted" | "accepted" | "rejected";
  method: "esign" | "upload" | "staff" | null;
  signedName: string | null;
  signedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  documentId: string | null;
  reviewNote: string | null;
  reviewedBy: Person | null;
  reviewedAt: string | null;
};

/** The latest candidate report, for staff. Its AI text is left out for anyone who can't open the file. */
export type CandidateReportInfo = {
  id: string;
  version: number;
  status: "queued" | "ready" | "failed";
  pageCount: number | null;
  createdAt: string;
  confirmedAt: string | null;
  ai: Pick<CandidateReportBody, "summary" | "points_to_check"> | null;
  /** Waiting for someone to read it. */
  suggestionId: string | null;
  /** It holds sensitive evidence this person can't open. */
  locked: boolean;
};

export type CandidatePanelData = {
  report: CandidateReportInfo | null;
  /** The candidate has files on the case, so staff can have a report made. */
  hasFiles: boolean;
  link: CandidateLinkInfo | null;
  /** Any link was ever issued: from then on consent is needed before Pre-QC (0008 guard). */
  everIssued: boolean;
  /** Any link reached them by email: the flowchart's formal request. */
  linkEmailed: boolean;
  requests: CandidateRequestItem[];
  messages: CandidateMessageItem[];
  consent: ConsentInfo | null;
};

const person = (people: Map<string, Person>, id: string | null) => (id ? (people.get(id) ?? { id, name: "Team member", email: "" }) : null);

export const getCandidatePanel = cache(async (caseId: string): Promise<CandidatePanelData> => {
  const supabase = await createRequestClient();
  const [links, requests, messages, consent, people, report, files, confirmed, suggestions] = await Promise.all([
    supabase.from("candidate_links").select(LINK_COLUMNS).eq("case_id", caseId).order("created_at", { ascending: false }).limit(5),
    supabase.from("candidate_requests").select("*").eq("case_id", caseId).neq("status", "cancelled").order("created_at"),
    supabase.from("candidate_messages").select("*").eq("case_id", caseId).order("created_at").limit(200),
    supabase.from("consent_forms").select("*").eq("case_id", caseId).maybeSingle(),
    peopleById(),
    supabase.from("generated_documents").select("id, version, status, page_count, created_at").eq("entity_type", "case").eq("entity_id", caseId).eq("kind", "candidate_report").in("status", ["queued", "ready", "failed"]).order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("documents").select("id, sensitive").eq("case_id", caseId).eq("uploaded_by_kind", "candidate").in("status", ["uploaded", "accepted"]),
    supabase.from("cases").select("candidate_confirmed_at").eq("id", caseId).maybeSingle(),
    getCaseSuggestions(caseId),
  ]);
  const written = newest(suggestions, (s) => s.capability === "candidate.report");
  const body = written?.value as CandidateReportBody | undefined;
  const r = report.data;
  const confirmedAt = confirmed.data?.candidate_confirmed_at ?? null;
  const now = Date.now();
  const l = links.data?.[0];
  const link: CandidateLinkInfo | null = l
    ? {
        id: l.id,
        language: (l.language as CandidateLinkInfo["language"]) ?? "en",
        expiresAt: l.expires_at,
        revokedAt: l.revoked_at,
        revokedReason: l.revoked_reason,
        sentAt: l.sent_at,
        sentVia: l.sent_via ?? [],
        sentCount: l.sent_count,
        firstOpenedAt: l.first_opened_at,
        lastOpenedAt: l.last_opened_at,
        openCount: l.open_count,
        remindersSent: l.reminders_sent,
        lastRemindedAt: l.last_reminded_at,
        escalatedAt: l.escalated_at,
        createdAt: l.created_at,
        createdBy: person(people, l.created_by),
        state: l.revoked_at ? "revoked" : new Date(l.expires_at).getTime() <= now ? "expired" : "active",
      }
    : null;
  const c = consent.data;
  return {
    report: r
      ? {
          id: r.id,
          version: r.version,
          status: r.status as CandidateReportInfo["status"],
          pageCount: r.page_count,
          createdAt: r.created_at,
          confirmedAt,
          ai: body ? { summary: body.summary, points_to_check: body.points_to_check } : null,
          suggestionId: written?.decision === "pending" ? written.id : null,
          locked: false,
        }
      : // Row level security hides a report from anyone who can't open its files (0047).
        confirmedAt
        ? { id: "", version: 0, status: "ready", pageCount: null, createdAt: "", confirmedAt, ai: null, suggestionId: null, locked: true }
        : null,
    hasFiles: Boolean(files.data?.length),
    link,
    everIssued: Boolean(links.data?.length),
    linkEmailed: Boolean(links.data?.some((l) => l.sent_at && l.sent_via?.includes("email"))),
    requests: (requests.data ?? []).map((q) => ({
      id: q.id,
      kind: q.kind as CandidateRequestItem["kind"],
      title: q.title,
      form: q.form === true,
      help: q.help,
      fieldKey: q.field_key,
      fieldType: q.field_type,
      caseCheckId: q.case_check_id,
      requirementId: q.requirement_id,
      dueAt: q.due_at,
      status: q.status as CandidateRequestItem["status"],
      answer: (q.answer ?? null) as CandidateRequestItem["answer"],
      options: Array.isArray(q.options) ? (q.options as { value: string; label: string }[]).filter((o) => typeof o === "object") : [],
      rowFields: Array.isArray(q.options) ? [] : (((q.options as { fields?: unknown } | null)?.fields ?? []) as CandidateRequestItem["rowFields"]),
      answeredAt: q.answered_at,
      reviewNote: q.review_note,
      reviewedBy: person(people, q.reviewed_by),
      reviewedAt: q.reviewed_at,
      createdBy: person(people, q.created_by),
      createdAt: q.created_at,
    })),
    messages: (messages.data ?? []).map((m) => ({
      id: m.id,
      fromKind: m.from_kind as CandidateMessageItem["fromKind"],
      author: person(people, m.author_id),
      body: m.body,
      readAt: m.read_at,
      createdAt: m.created_at,
    })),
    consent: c
      ? {
          id: c.id,
          status: c.status as ConsentInfo["status"],
          method: (c.method ?? null) as ConsentInfo["method"],
          signedName: c.signed_name,
          signedAt: c.signed_at,
          ip: c.ip,
          userAgent: c.user_agent,
          documentId: c.document_id,
          reviewNote: c.review_note,
          reviewedBy: person(people, c.reviewed_by),
          reviewedAt: c.reviewed_at,
        }
      : null,
  };
});

/** The guard in 0008 (cases_consent_guard): a link was issued and consent is not in yet. */
export function consentMissing(panel: Pick<CandidatePanelData, "everIssued" | "consent">, processType: string): boolean {
  return (panel.everIssued || processType === "candidate_collected") && !(panel.consent && (panel.consent.status === "submitted" || panel.consent.status === "accepted"));
}

/** public.case_consent_missing (0049): past Pre-QC, a client-supplied case carries its consent among the documents, unless a form was rejected. */
export function consentRefused(panel: Pick<CandidatePanelData, "consent">, processType: string): boolean {
  const given = panel.consent?.status === "submitted" || panel.consent?.status === "accepted";
  return !given && (processType === "candidate_collected" || panel.consent?.status === "rejected");
}

export type CandidateReply = {
  id: string;
  kind: "answer" | "consent";
  caseId: string;
  reference: string;
  candidateName: string;
  title: string;
  at: string;
};

/** Answers and consents waiting for staff review, on cases the viewer can see (My work). */
export async function getCandidateReplies(limit = 30): Promise<CandidateReply[]> {
  const supabase = await createRequestClient();
  const [answers, consents] = await Promise.all([
    supabase
      .from("candidate_requests")
      .select("id, case_id, title, kind, answered_at, case:cases(reference, candidate_name, stage)")
      .eq("status", "answered")
      .order("answered_at", { ascending: true })
      .limit(limit),
    supabase
      .from("consent_forms")
      .select("id, case_id, signed_at, method, case:cases(reference, candidate_name, stage)")
      .eq("status", "submitted")
      .order("signed_at", { ascending: true })
      .limit(limit),
  ]);
  type CaseRef = { reference: string; candidate_name: string; stage: string } | null;
  const open = (c: CaseRef) => c && c.stage !== "released" && c.stage !== "cancelled";
  const rows: CandidateReply[] = [
    ...(answers.data ?? [])
      .filter((a) => open(a.case as CaseRef))
      .map((a) => {
        const c = a.case as CaseRef;
        return {
          id: a.id,
          kind: "answer" as const,
          caseId: a.case_id,
          reference: c?.reference ?? "",
          candidateName: c?.candidate_name ?? "",
          title: a.kind === "document" ? `Uploaded: ${a.title}` : `Answered: ${a.title}`,
          at: a.answered_at ?? "",
        };
      }),
    ...(consents.data ?? [])
      .filter((f) => open(f.case as CaseRef))
      .map((f) => {
        const c = f.case as CaseRef;
        return {
          id: f.id,
          kind: "consent" as const,
          caseId: f.case_id,
          reference: c?.reference ?? "",
          candidateName: c?.candidate_name ?? "",
          title: f.method === "upload" ? "Uploaded a signed consent form" : "Signed the consent form online",
          at: f.signed_at ?? "",
        };
      }),
  ];
  return rows.sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
}
