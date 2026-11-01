import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientNamesFor, peopleById, type Person } from "@/lib/server/cases/queries";
import type { ReportSnapshot } from "@/domain/reports/compile-core";
import type { FinalResult } from "@/domain/workflow/stages";

/**
 * Report reads (0012). Staff read report_versions under row level security
 * (reports.preview on a case they can see); clients only through
 * portal_report(); the public verify page through verify_report() with the
 * service role. Server Components only.
 */

export type ReportStatus = "queued" | "rendering" | "ready" | "failed" | "superseded" | "released";

export type ReportVersion = {
  id: string;
  version: number;
  kind: "draft" | "final";
  status: ReportStatus;
  finalResult: FinalResult | null;
  pageCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
  revisionReason: string | null;
  /** Why the approver's result differs from what the checks proposed. */
  resultReason: string | null;
  /** Why the report went on with a file that didn't arrive intact. */
  evidenceNote: string | null;
  /** It holds sensitive evidence, so it opens only for those allowed that. */
  sensitive: boolean;
  /** The PDF went under the retention policy, or with an erasure. */
  fileRemoved: boolean;
  basedOn: string | null;
  createdAt: string;
  requestedBy: Person | null;
  approvedBy: Person | null;
  approvedAt: string | null;
  releasedBy: Person | null;
  releasedAt: string | null;
  annexures: { title: string; filename: string; kind: string; embedded: boolean; attached?: boolean; altered?: boolean; part?: number }[];
  /** Further files of this report, when the evidence didn't fit in one. */
  parts: { part: number; pages: number | null; annexures: string[] }[];
};

/** What the approver sees from a draft: the proposed result and each check's line. */
export type DraftSummary = {
  proposedResult: FinalResult | null;
  checks: { label: string; status: string; statusLabel: string; resultLabel: string | null; resultTone: FinalResult | null }[];
  /** Sensitive files in this draft, which approving would send to the client. */
  sensitive: string[];
  /** Files that didn't reach the draft intact. */
  problems: string[];
  evidenceNote: string | null;
};

/** Files that didn't arrive intact (mirrors public.report_evidence_problems). */
const evidenceProblems = (annexures: ReportVersion["annexures"]) => annexures.filter((a) => !a.embedded || a.altered || a.attached).map((a) => a.filename);

const person = (people: Map<string, Person>, id: string | null) => (id ? (people.get(id) ?? { id, name: "Team member", email: "" }) : null);

export const getReportVersions = cache(async (caseId: string): Promise<{ versions: ReportVersion[]; draftSummary: DraftSummary | null }> => {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("report_versions")
    .select("id, version, kind, status, final_result, page_count, size_bytes, sha256, error, revision_reason, result_reason, evidence_note, based_on, created_at, requested_by, approved_by, approved_at, released_by, released_at, annexures, parts, snapshot, storage_path")
    .eq("case_id", caseId)
    .order("version", { ascending: false });
  if (!data?.length) return { versions: [], draftSummary: null };
  const people = await peopleById();
  const sensitive = await Promise.all(data.map(async (v) => (await supabase.rpc("report_sensitive_files", { p_snapshot: v.snapshot })).data ?? []));
  const versions: ReportVersion[] = data.map((v, i) => ({
    id: v.id,
    version: v.version,
    kind: v.kind as ReportVersion["kind"],
    status: v.status as ReportStatus,
    finalResult: v.final_result as FinalResult | null,
    pageCount: v.page_count,
    sizeBytes: v.size_bytes,
    sha256: v.sha256,
    error: v.error,
    revisionReason: v.revision_reason,
    resultReason: v.result_reason,
    evidenceNote: v.evidence_note,
    sensitive: sensitive[i].length > 0,
    fileRemoved: v.storage_path === null,
    basedOn: v.based_on,
    createdAt: v.created_at,
    requestedBy: person(people, v.requested_by),
    approvedBy: person(people, v.approved_by),
    approvedAt: v.approved_at,
    releasedBy: person(people, v.released_by),
    releasedAt: v.released_at,
    annexures: (v.annexures ?? []) as ReportVersion["annexures"],
    parts: (v.parts ?? []) as ReportVersion["parts"],
  }));
  const latestDraft = data.find((v) => v.kind === "draft" && v.status === "ready");
  const snap = latestDraft?.snapshot as ReportSnapshot | null | undefined;
  const draftSummary: DraftSummary | null = snap?.summary
    ? {
        proposedResult: snap.proposed_result ?? null,
        checks: snap.summary.map((s) => ({ label: s.label, status: s.status, statusLabel: s.status_label, resultLabel: s.result_label, resultTone: s.result_tone })),
        sensitive: sensitive[data.indexOf(latestDraft!)],
        problems: evidenceProblems((latestDraft?.annexures ?? []) as ReportVersion["annexures"]),
        evidenceNote: latestDraft?.evidence_note ?? null,
      }
    : null;
  return { versions, draftSummary };
});

/** Checks with a result whose fixed annexure (Global Sanction report) has no file (0040). */
/** A revision can be stopped while the case still says what the released report says (public.revision_can_stop). */
export async function revisionCanStop(caseId: string): Promise<boolean> {
  const supabase = await createRequestClient();
  const { data } = await supabase.rpc("revision_can_stop", { p_case: caseId });
  return data === true;
}

export const getMissingAnnexures = cache(async (caseId: string): Promise<string[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.rpc("case_missing_annexures", { p_case: caseId });
  return data ?? [];
});

/** Finished checks whose required evidence was taken out of the report (0042). */
export const getUnreportedEvidence = cache(async (caseId: string): Promise<string[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.rpc("case_unreported_evidence", { p_case: caseId });
  return data ?? [];
});

/** Who can open the released report: everyone at the client, or the people named at release. */
export async function getReportAudience(caseId: string): Promise<{ named: { id: string; name: string }[] } | null> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("report_versions").select("id, recipients:report_recipients(user_id)").eq("case_id", caseId).eq("status", "released").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const people = await peopleById();
  const ids = ((data.recipients ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((id): id is string => Boolean(id));
  return { named: ids.map((id) => ({ id, name: people.get(id)?.name ?? "Portal user" })) };
}

export type ReleaseRecipient = { id: string; name: string; email: string; roleName: string; readsCases: boolean };

/** The client's active portal users, for the release dialog. */
export async function getReleaseRecipients(clientId: string): Promise<ReleaseRecipient[]> {
  const supabase = await createRequestClient();
  const [{ data: members }, people] = await Promise.all([
    supabase.from("memberships").select("user_id, role:roles(id, name, perms:role_permissions(permission))").eq("client_id", clientId).eq("kind", "client").eq("status", "active"),
    peopleById(),
  ]);
  return (members ?? [])
    .map((m) => {
      const role = m.role as unknown as { name: string; perms: { permission: string }[] } | null;
      const p = people.get(m.user_id);
      return { id: m.user_id, name: p?.name ?? "Portal user", email: p?.email ?? "", roleName: role?.name ?? "", readsCases: (role?.perms ?? []).some((x) => x.permission === "portal.cases.read") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ReportQueueItem = {
  caseId: string;
  reference: string;
  candidateName: string;
  clientName: string;
  versionId: string;
  version: number;
  at: string;
  approvedBy: string | null;
  approvedByMe: boolean;
  finalResult: FinalResult | null;
};

/** Drafts waiting for approval and finals ready to release, on cases the viewer can see. */
export async function getReportQueues(viewerId: string): Promise<{ toApprove: ReportQueueItem[]; toRelease: ReportQueueItem[] }> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("report_versions")
    .select("id, version, kind, status, created_at, approved_by, final_result, case:cases!inner(id, reference, candidate_name, stage, client:clients(name))")
    .eq("case.stage", "approval")
    .in("status", ["ready", "queued", "rendering"])
    .order("created_at", { ascending: true });
  const people = await peopleById();
  const byCase = new Map<string, NonNullable<typeof data>>();
  for (const v of data ?? []) {
    const c = v.case as unknown as { id: string };
    byCase.set(c.id, [...(byCase.get(c.id) ?? []), v]);
  }
  const toApprove: ReportQueueItem[] = [];
  const toRelease: ReportQueueItem[] = [];
  for (const versions of byCase.values()) {
    const latest = [...versions].sort((a, b) => b.version - a.version)[0];
    const c = latest.case as unknown as { id: string; reference: string; candidate_name: string; client: { name: string } | null };
    const item: ReportQueueItem = {
      caseId: c.id,
      reference: c.reference,
      candidateName: c.candidate_name,
      clientName: c.client?.name ?? "",
      versionId: latest.id,
      version: latest.version,
      at: latest.created_at,
      approvedBy: latest.approved_by ? (people.get(latest.approved_by)?.name ?? "Team member") : null,
      approvedByMe: latest.approved_by === viewerId,
      finalResult: latest.final_result as FinalResult | null,
    };
    if (latest.kind === "draft" && latest.status === "ready") toApprove.push(item);
    if (latest.kind === "final" && latest.status === "ready") toRelease.push(item);
  }
  return { toApprove, toRelease };
}

export type ArchivedReport = {
  versionId: string;
  version: number;
  status: "released" | "superseded";
  caseId: string;
  reference: string;
  candidateName: string;
  clientName: string;
  finalResult: FinalResult | null;
  releasedAt: string | null;
  pageCount: number | null;
  sha256: string | null;
  revisionReason: string | null;
  /** The PDF went under the retention policy. */
  fileRemoved: boolean;
  extraParts: number;
  /** It holds sensitive evidence this person's role can't open. */
  closedToViewer?: boolean;
};

export type ArchiveFilters = { q?: string; from?: string; to?: string; status?: "released" | "superseded" | "all" };
export const ARCHIVE_LIMIT = 100;
const SCAN_LIMIT = 1000;

export function parseArchiveFilters(sp: Record<string, string | string[] | undefined>): ArchiveFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? undefined;
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const status = one("status");
  return {
    q: one("q")?.trim().slice(0, 80) || undefined,
    from: date(one("from")),
    to: date(one("to")),
    status: status === "superseded" || status === "all" ? status : "released",
  };
}

/** Final reports that reached clients, newest first. Searches reference, candidate and client. */
export async function getReportArchive(f: ArchiveFilters): Promise<{ rows: ArchivedReport[]; total: number; capped: boolean }> {
  const supabase = await createRequestClient();
  let q = supabase
    .from("report_versions")
    .select("id, version, status, final_result, released_at, page_count, sha256, revision_reason, storage_path, parts, case:cases!inner(id, reference, candidate_name, client:clients(name))")
    .eq("kind", "final")
    .in("status", f.status === "all" ? ["released", "superseded"] : [f.status ?? "released"])
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(SCAN_LIMIT);
  if (f.from) q = q.gte("released_at", `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lte("released_at", `${f.to}T23:59:59+05:30`);
  const { data } = await q;
  const named = await clientNamesFor((data ?? []).map((v) => v.case as unknown as { id: string; client: { name: string } | null }).filter((c) => !c.client).map((c) => c.id));
  const all: ArchivedReport[] = (data ?? []).map((v) => {
    const c = v.case as unknown as { id: string; reference: string; candidate_name: string; client: { name: string } | null };
    return {
      versionId: v.id,
      version: v.version,
      status: v.status as ArchivedReport["status"],
      caseId: c.id,
      reference: c.reference,
      candidateName: c.candidate_name,
      clientName: c.client?.name ?? named.get(c.id) ?? "",
      finalResult: v.final_result as FinalResult | null,
      releasedAt: v.released_at,
      pageCount: v.page_count,
      sha256: v.sha256,
      revisionReason: v.revision_reason,
      fileRemoved: v.storage_path === null,
      extraParts: Array.isArray(v.parts) ? v.parts.length : 0,
    };
  });
  const term = f.q?.toLowerCase();
  const matched = term ? all.filter((r) => [r.reference, r.candidateName, r.clientName].some((x) => x.toLowerCase().includes(term))) : all;
  const rows = matched.slice(0, ARCHIVE_LIMIT);
  const { data: closed } = await supabase.rpc("reports_closed_to_caller", { p_versions: rows.map((r) => r.versionId) });
  return { rows: rows.map((r) => ({ ...r, closedToViewer: (closed ?? []).includes(r.versionId) })), total: matched.length, capped: (data ?? []).length >= SCAN_LIMIT };
}

export type PortalReport = {
  versionId: string;
  version: number;
  releasedAt: string | null;
  sha256: string | null;
  pageCount: number | null;
  finalResult: FinalResult | null;
  /** The PDF went under the retention policy. The case record stays. */
  fileRemoved: boolean;
  /** Further files of the report, when the evidence didn't fit in one. */
  extraParts: number;
  revised: boolean;
};

/** The client's latest released report for a case (portal_report, 0012), or null. */
export const getPortalReport = cache(async (caseId: string): Promise<PortalReport | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_report", { p_case: caseId });
  if (error || !data) return null;
  const r = data as { version_id: string; version: number; released_at: string | null; sha256: string | null; page_count: number | null; final_result: FinalResult | null; file_removed?: boolean; extra_parts?: number; revised?: boolean };
  return { versionId: r.version_id, version: r.version, releasedAt: r.released_at, sha256: r.sha256, pageCount: r.page_count, finalResult: r.final_result, fileRemoved: r.file_removed === true, extraParts: r.extra_parts ?? 0, revised: r.revised === true };
});

export type VerifyResult =
  | { found: false }
  | {
      found: true;
      status: "valid" | "superseded" | "not_released" | "erased";
      reference: string;
      version: number;
      releasedAt: string | null;
      sha256: string | null;
      pageCount: number | null;
      client: string;
      candidate: string | null;
      issuer: string;
      /** Further files of the same report, each with its own fingerprint. */
      parts: { part: number; sha256: string; pageCount: number | null }[];
    };

/** Public authenticity check (/verify/<id>). Service role; returns only what proves a report genuine. */
export async function verifyReport(id: string): Promise<VerifyResult> {
  const { data, error } = await createAdminClient().rpc("verify_report", { p_version: id });
  if (error || !data) return { found: false };
  const v = data as { status: "valid" | "superseded" | "not_released" | "erased"; reference: string; version: number; released_at: string | null; sha256: string | null; page_count: number | null; client: string; candidate: string | null; issuer: string; parts?: { part: number; sha256: string; page_count: number | null }[] };
  return {
    found: true,
    status: v.status,
    reference: v.reference,
    version: v.version,
    releasedAt: v.released_at,
    sha256: v.sha256,
    pageCount: v.page_count,
    client: v.client,
    candidate: v.candidate,
    issuer: v.issuer,
    parts: (v.parts ?? []).map((p) => ({ part: p.part, sha256: p.sha256, pageCount: p.page_count })),
  };
}
