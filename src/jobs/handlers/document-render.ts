import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NonRetryableError, type JobHandler } from "../types";
import { loadDocumentModel } from "../documents/load";
import { renderDocumentPdf } from "../documents/templates";

/**
 * document.render: draw a quote, invoice, receipt or credit note as a PDF in
 * its template and store it in the private documents bucket
 * (generated_documents row, 0013).
 */
export const documentRender: JobHandler = async (job, { admin }) => {
  const id = (job.payload as { document_id?: string } | null)?.document_id;
  if (!id) throw new NonRetryableError("document.render job without document_id");
  const { data: doc } = await admin.from("generated_documents").select("id, org_id, kind, entity_type, entity_id, version, template_key, status").eq("id", id).maybeSingle();
  if (!doc) throw new NonRetryableError(`generated document ${id} not found`);
  if (doc.status === "superseded" || doc.status === "void") return { skipped: doc.status };

  try {
    const { model, template } = await loadDocumentModel(admin, doc);
    const pdf = new Uint8Array(await renderDocumentPdf(model, template));
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const path = `org/${doc.org_id}/${doc.kind}/${doc.entity_id}/v${doc.version}-${doc.id}.pdf`;
    const up = await admin.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    await admin.from("generated_documents").update({ status: "ready", storage_path: path, sha256, page_count: pages, size_bytes: pdf.byteLength }).eq("id", doc.id);
    return { path, pages };
  } catch (error) {
    if (job.attempts >= job.max_attempts) await admin.from("generated_documents").update({ status: "failed" }).eq("id", doc.id);
    throw error;
  }
};
