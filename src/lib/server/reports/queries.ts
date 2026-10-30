import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { peopleById, type Person } from "@/lib/server/cases/queries";
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
  basedOn: string | null;
  createdAt: string;
  requestedBy: Person | null;
  approvedBy: Person | null;
  approvedAt: string | null;
  releasedBy: Person | null;
  releasedAt: string | null;
  annexures: { title: string; filename: string; kind: string; embedded: boolean }[];
};

/** What the approver sees from a draft: the proposed result and each check's line. */
export type DraftSummary = {
  proposedResult: FinalResult | null;
  checks: { label: string; status: string; statusLabel: string; resultLabel: string | null; resultTone: FinalResult | null }[];
};

const person = (people: Map<string, Person>, id: string | null) => (id ? (people.get(id) ?? { id, name: "Team member", email: "" }) : null);

export const getReportVersions = cache(async (caseId: string): Promise<{ versions: ReportVersion[]; draftSummary: DraftSummary | null }> => {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("report_versions")
    .select("id, version, kind, status, final_result, page_count, size_bytes, sha256, error, revision_reason, based_on, created_at, requested_by, approved_by, approved_at, released_by, released_at, annexures, snapshot")
    .eq("case_id", caseId)
    .order("version", { ascending: false });
  if (!data?.length) return { versions: [], draftSummary: null };
  const people = await peopleById();
  const versions: ReportVersion[] = data.map((v) => ({
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
    basedOn: v.based_on,
    createdAt: v.created_at,
    requestedBy: person(people, v.requested_by),
    approvedBy: person(people, v.approved_by),
    approvedAt: v.approved_at,
    releasedBy: person(people, v.released_by),
    releasedAt: v.released_at,
    annexures: (v.annexures ?? []) as ReportVersion["annexures"],
  }));
  const latestDraft = data.find((v) => v.kind === "draft" && v.status === "ready");
  const snap = latestDraft?.snapshot as ReportSnapshot | null | undefined;
  const draftSummary: DraftSummary | null = snap?.summary
    ? {
        proposedResult: snap.proposed_result ?? null,
        checks: snap.summary.map((s) => ({ label: s.label, status: s.status, statusLabel: s.status_label, resultLabel: s.result_label, resultTone: s.result_tone })),
      }
    : null;
  return { versions, draftSummary };
});

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
    .select("id, version, status, final_result, released_at, page_count, sha256, revision_reason, case:cases!inner(id, reference, candidate_name, client:clients(name))")
    .eq("kind", "final")
    .in("status", f.status === "all" ? ["released", "superseded"] : [f.status ?? "released"])
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(SCAN_LIMIT);
  if (f.from) q = q.gte("released_at", `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lte("released_at", `${f.to}T23:59:59+05:30`);
  const { data } = await q;
  const all: ArchivedReport[] = (data ?? []).map((v) => {
    const c = v.case as unknown as { id: string; reference: string; candidate_name: string; client: { name: string } | null };
    return {
      versionId: v.id,
      version: v.version,
      status: v.status as ArchivedReport["status"],
      caseId: c.id,
      reference: c.reference,
      candidateName: c.candidate_name,
      clientName: c.client?.name ?? "",
      finalResult: v.final_result as FinalResult | null,
      releasedAt: v.released_at,
      pageCount: v.page_count,
      sha256: v.sha256,
      revisionReason: v.revision_reason,
    };
  });
  const term = f.q?.toLowerCase();
  const matched = term ? all.filter((r) => [r.reference, r.candidateName, r.clientName].some((x) => x.toLowerCase().includes(term))) : all;
  return { rows: matched.slice(0, ARCHIVE_LIMIT), total: matched.length, capped: (data ?? []).length >= SCAN_LIMIT };
}

export type PortalReport = { versionId: string; version: number; releasedAt: string | null; sha256: string | null; pageCount: number | null; finalResult: FinalResult | null };

/** The client's latest released report for a case (portal_report, 0012), or null. */
export const getPortalReport = cache(async (caseId: string): Promise<PortalReport | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_report", { p_case: caseId });
  if (error || !data) return null;
  const r = data as { version_id: string; version: number; released_at: string | null; sha256: string | null; page_count: number | null; final_result: FinalResult | null };
  return { versionId: r.version_id, version: r.version, releasedAt: r.released_at, sha256: r.sha256, pageCount: r.page_count, finalResult: r.final_result };
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
    };

/** Public authenticity check (/verify/<id>). Service role; returns only what proves a report genuine. */
export async function verifyReport(id: string): Promise<VerifyResult> {
  const { data, error } = await createAdminClient().rpc("verify_report", { p_version: id });
  if (error || !data) return { found: false };
  const v = data as { status: "valid" | "superseded" | "not_released" | "erased"; reference: string; version: number; released_at: string | null; sha256: string | null; page_count: number | null; client: string; candidate: string | null; issuer: string };
  return { found: true, status: v.status, reference: v.reference, version: v.version, releasedAt: v.released_at, sha256: v.sha256, pageCount: v.page_count, client: v.client, candidate: v.candidate, issuer: v.issuer };
}
