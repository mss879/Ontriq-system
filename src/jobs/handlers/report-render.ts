import { createHash } from "node:crypto";
import { NonRetryableError, type JobContext, type JobHandler } from "../types";
import { currentSnapshot } from "../report/load";
import { renderReportBody } from "../report/build-body";
import { assembleReport, assembleReportPart, planAnnexures, type AnnexureFile } from "../report/assemble";
import type { ReportSnapshot } from "../../domain/reports/compile-core";
import type { ResultTone } from "../../domain/check-types/schema";

/**
 * report.render: compile (drafts) or reuse the approved draft's snapshot
 * (finals), draw the body, append annexures, store the PDF in the private
 * reports bucket and record its SHA-256 (public.report_render_done, 0012).
 */
export const reportRender: JobHandler = async (job, { admin, heartbeat }) => {
  const versionId = (job.payload as { version_id?: string } | null)?.version_id;
  if (!versionId) throw new NonRetryableError("report.render job without version_id");
  const { data: started } = await admin.rpc("report_render_started", { p_version: versionId });
  const v = started as { id: string | null; case_id: string; org_id: string; version: number; kind: "draft" | "final"; snapshot: ReportSnapshot; snapshot_hash: string | null; final_result: string | null; approved_by: string | null; approved_at: string | null; revision_reason: string | null } | null;
  if (!v?.id) return { skipped: "superseded or already rendered" };

  try {
    let snapshot: ReportSnapshot;
    let hash: string;
    if (v.kind === "draft") {
      const now = await currentSnapshot(admin, v.case_id);
      snapshot = now.snapshot;
      hash = now.hash;
    } else {
      if (!v.snapshot_hash || !v.snapshot?.case) throw new NonRetryableError("final report without the approved draft's snapshot");
      snapshot = v.snapshot;
      hash = v.snapshot_hash;
    }
    await heartbeat({ step: "compiled" });

    const { path, sha256, assembled, plan, parts } = await buildReportFiles(admin, v, snapshot, { run: job.attempts ?? 1, heartbeat });
    const done = await admin.rpc("report_render_done", {
      p_version: v.id,
      p_ok: true,
      p_snapshot: v.kind === "draft" ? (snapshot as never) : undefined,
      p_snapshot_hash: hash,
      p_storage_path: path,
      p_sha256: sha256,
      p_pages: assembled.pages,
      p_size: assembled.bytes.byteLength,
      p_annexures: plan.map((a) => ({
        document_id: a.document_id,
        title: a.title,
        filename: a.filename,
        kind: a.kind,
        part: a.part,
        status: a.status,
        embedded: a.status === "embedded" || a.status === "attached",
        attached: a.status === "attached",
        altered: a.altered,
      })) as never,
      p_parts: parts as never,
    });
    if (done.error) throw new Error(`report_render_done: ${done.error.message}`);
    return { path, pages: assembled.pages, sha256, problems: plan.filter((a) => a.status !== "embedded" || a.altered).map((a) => a.filename), parts: parts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.rpc("report_render_done", { p_version: v.id, p_ok: false, p_error: message });
    throw error;
  }
};

type RenderTarget = { id: string | null; case_id: string; org_id: string; version: number; kind: "draft" | "final"; final_result: string | null; approved_by: string | null; approved_at: string | null; revision_reason: string | null };
type BuildOptions = { run: number; heartbeat: JobContext["heartbeat"]; issue?: number };

/** Draws one version from its snapshot and stores the files. The seed uses it too, to redraw demo reports after moving their dates. */
export async function buildReportFiles(admin: JobContext["admin"], v: RenderTarget, snapshot: ReportSnapshot, { run, heartbeat, issue }: BuildOptions) {
  // Annexure files, in the snapshot's order, read when they're needed.
  const ids = snapshot.annexures.map((a) => a.document_id);
  const { data: docs } = ids.length ? await admin.from("documents").select("id, category, storage_bucket, storage_path").in("id", ids) : { data: [] };
  const where = new Map((docs ?? []).map((d) => [d.id, d]));
  const files: AnnexureFile[] = snapshot.annexures.map((a) => ({
    ...a,
    category: where.get(a.document_id)?.category,
    read: async () => {
      const d = where.get(a.document_id);
      const file = d ? await admin.storage.from(d.storage_bucket).download(d.storage_path) : null;
      return file?.data ? new Uint8Array(await file.data.arrayBuffer()) : null;
    },
  }));
  const plan = await planAnnexures(files, { parts: true });
  await heartbeat({ step: "planned" });
  // A report without its fixed annexure is not a report: stop here and say why.
  const lost = plan.find((a) => a.kind === "fixed" && a.status !== "embedded" && a.status !== "attached");
  if (lost) {
    throw new NonRetryableError(`${lost.title} (${lost.filename}) couldn't be attached. It must be a PDF or photo that opens normally. Upload a new version, then generate the draft again.`);
  }

  const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const verifyUrl = v.kind === "final" ? `${origin}/verify/${v.id}` : null;
  const approver = v.approved_by ? (await admin.from("profiles").select("full_name").eq("id", v.approved_by).maybeSingle()).data?.full_name : null;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" }) : null);
  // A client counts issues of the report, not every draft that came before.
  const { count: released } = await admin.from("report_versions").select("id", { count: "exact", head: true }).eq("case_id", v.case_id).eq("kind", "final").not("released_at", "is", null);
  const body = await renderReportBody(snapshot, {
    kind: v.kind,
    version: v.kind === "final" ? (issue ?? (released ?? 0) + 1) : v.version,
    finalResult: (v.final_result as ResultTone | null) ?? null,
    approvedBy: approver ?? null,
    approvedOn: fmt(v.approved_at),
    verifyUrl,
    // A final is dated by its approval, so drawing it again gives the same report.
    generatedOn: fmt(v.kind === "final" && v.approved_at ? v.approved_at : new Date().toISOString()) ?? "",
    revisionReason: v.revision_reason,
    annexures: plan,
  });
  await heartbeat({ step: "body" });
  const base = { reference: snapshot.case.reference, draft: v.kind === "draft", verifyUrl };
  const assembled = await assembleReport(new Uint8Array(body), plan, { ...base, part: 1 });

  // Each run writes its own file. If a lease ran out and two ran at once, the first one finished stands whole.
  const path = `org/${v.org_id}/case/${v.case_id}/report/v${v.version}-${v.kind}-${run}.pdf`;
  const up = await admin.storage.from("reports").upload(path, assembled.bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const sha256 = createHash("sha256").update(assembled.bytes).digest("hex");

  // Spec 7: what didn't fit goes in further files of the same report.
  const parts: { part: number; path: string; sha256: string; pages: number; size_bytes: number; annexures: string[] }[] = [];
  const lastPart = Math.max(1, ...plan.map((a) => a.part));
  for (let part = 2; part <= lastPart; part += 1) {
    await heartbeat({ step: `part ${part}` });
    const piece = await assembleReportPart(plan, { ...base, part });
    const partPath = `org/${v.org_id}/case/${v.case_id}/report/v${v.version}-${v.kind}-${run}-part-${part}.pdf`;
    const stored = await admin.storage.from("reports").upload(partPath, piece.bytes, { contentType: "application/pdf", upsert: true });
    if (stored.error) throw new Error(`upload: ${stored.error.message}`);
    parts.push({ part, path: partPath, sha256: createHash("sha256").update(piece.bytes).digest("hex"), pages: piece.pages, size_bytes: piece.bytes.byteLength, annexures: plan.filter((a) => a.part === part).map((a) => a.filename) });
  }
  return { path, sha256, assembled, plan, parts };
}
