import { createHash } from "node:crypto";
import { NonRetryableError, type JobHandler } from "../types";
import { currentSnapshot } from "../report/load";
import { renderReportBody } from "../report/build-body";
import { assembleReport } from "../report/assemble";
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

    // Annexure files, in the snapshot's order.
    const ids = snapshot.annexures.map((a) => a.document_id);
    const { data: docs } = ids.length ? await admin.from("documents").select("id, storage_bucket, storage_path").in("id", ids) : { data: [] };
    const where = new Map((docs ?? []).map((d) => [d.id, d]));
    const annexures = [];
    for (const a of snapshot.annexures) {
      const d = where.get(a.document_id);
      let bytes: Uint8Array | null = null;
      if (d) {
        const file = await admin.storage.from(d.storage_bucket).download(d.storage_path);
        bytes = file.data ? new Uint8Array(await file.data.arrayBuffer()) : null;
      }
      annexures.push({ ...a, bytes });
    }

    const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");
    const approver = v.approved_by ? (await admin.from("profiles").select("full_name").eq("id", v.approved_by).maybeSingle()).data?.full_name : null;
    const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" }) : null);
    const body = await renderReportBody(snapshot, {
      kind: v.kind,
      version: v.version,
      finalResult: (v.final_result as ResultTone | null) ?? null,
      approvedBy: approver ?? null,
      approvedOn: fmt(v.approved_at),
      verifyUrl: v.kind === "final" ? `${origin}/verify/${v.id}` : null,
      generatedOn: fmt(new Date().toISOString()) ?? "",
      revisionReason: v.revision_reason,
    });
    await heartbeat({ step: "body" });
    const assembled = await assembleReport(new Uint8Array(body), annexures, { reference: snapshot.case.reference, draft: v.kind === "draft" });
    // A report without its fixed annexure is not a report: stop here and say why.
    const lost = snapshot.annexures.find((a) => a.kind === "fixed" && assembled.skipped.includes(a.filename));
    if (lost) {
      throw new NonRetryableError(`${lost.title} (${lost.filename}) couldn't be attached. It must be a PDF or photo that opens normally. Upload a new version, then generate the draft again.`);
    }

    const path = `org/${v.org_id}/case/${v.case_id}/report/v${v.version}-${v.kind}.pdf`;
    const up = await admin.storage.from("reports").upload(path, assembled.bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const sha256 = createHash("sha256").update(assembled.bytes).digest("hex");
    const done = await admin.rpc("report_render_done", {
      p_version: v.id,
      p_ok: true,
      p_snapshot: v.kind === "draft" ? (snapshot as never) : undefined,
      p_snapshot_hash: hash,
      p_storage_path: path,
      p_sha256: sha256,
      p_pages: assembled.pages,
      p_size: assembled.bytes.byteLength,
      p_annexures: snapshot.annexures.map((a) => ({ title: a.title, filename: a.filename, kind: a.kind, embedded: !assembled.skipped.includes(a.filename), partial: assembled.partial.includes(a.filename) })) as never,
    });
    if (done.error) throw new Error(`report_render_done: ${done.error.message}`);
    return { path, pages: assembled.pages, sha256, skipped: assembled.skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.rpc("report_render_done", { p_version: v.id, p_ok: false, p_error: message });
    throw error;
  }
};
