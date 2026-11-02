import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NonRetryableError, type JobHandler } from "../types";
import { renderBusinessReportPdf } from "../documents/business-report";
import type { BusinessReport } from "../../domain/business-report/build";

/**
 * assistant.report: draw a report from the assistant as a PDF in the private
 * documents bucket. The figures were read as the person who asked and wait in
 * assistant_report_figures; they're removed once the PDF is drawn or has finally failed.
 */
export const businessReportRender: JobHandler = async (job, { admin }) => {
  const id = (job.payload as { document_id?: string } | null)?.document_id;
  if (!id) throw new NonRetryableError("assistant.report job without document_id");
  const { data: doc } = await admin.from("generated_documents").select("id, org_id, created_by, status").eq("id", id).eq("kind", "assistant_report").maybeSingle();
  if (!doc) throw new NonRetryableError(`assistant report ${id} not found`);
  if (doc.status === "ready") return { skipped: doc.status };
  const forget = () => admin.from("assistant_report_figures").delete().eq("document_id", doc.id);

  try {
    const { data: figures } = await admin.from("assistant_report_figures").select("report").eq("document_id", doc.id).maybeSingle();
    if (!figures) throw new NonRetryableError(`assistant report ${id} has no figures`);
    const report = figures.report as unknown as BusinessReport;
    const { data: person } = doc.created_by ? await admin.from("profiles").select("full_name, email").eq("id", doc.created_by).maybeSingle() : { data: null };
    const preparedOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" });
    const pdf = new Uint8Array(await renderBusinessReportPdf(report, person?.full_name || person?.email || "Ontriq", preparedOn));
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const path = `org/${doc.org_id}/assistant_report/${doc.id}.pdf`;
    const up = await admin.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    await admin.from("generated_documents").update({ status: "ready", storage_path: path, sha256, page_count: pages, size_bytes: pdf.byteLength }).eq("id", doc.id);
    await forget();
    return { path, pages };
  } catch (error) {
    if (error instanceof NonRetryableError || job.attempts >= job.max_attempts) {
      await admin.from("generated_documents").update({ status: "failed" }).eq("id", doc.id);
      await forget();
    }
    throw error;
  }
};
