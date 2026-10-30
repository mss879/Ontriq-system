/**
 * Append the annexures to the report body with pdf-lib: each evidence file
 * behind a small cover sheet (images scaled onto A4 pages, PDFs copied page
 * by page), and the fixed annexure (Global Sanction report) attached
 * untouched. Caps keep the worker within memory. Plain Node.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReportAnnexure } from "../../domain/reports/compile-core";
import { toJpeg } from "./convert-image";

const A4 = { w: 595.28, h: 841.89 };
export const MAX_ANNEXURE_PAGES = 300;
export const MAX_ANNEXURE_BYTES = 150 * 1024 * 1024;

/** Text the standard fonts can encode (Latin-1); other scripts fall back to "?". */
const ascii = (t: string) => t.normalize("NFC").replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");

export async function assembleReport(
  body: Uint8Array,
  annexures: (ReportAnnexure & { bytes: Uint8Array | null })[],
  opts: { reference: string; draft: boolean },
): Promise<{ bytes: Uint8Array; pages: number; skipped: string[]; partial: string[] }> {
  const doc = await PDFDocument.load(body);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const skipped: string[] = [];
  const partial: string[] = [];
  let added = 0;
  let bytesSeen = 0;

  const cover = (n: number, a: ReportAnnexure, note?: string) => {
    const page = doc.addPage([A4.w, A4.h]);
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: rgb(0.969, 0.345, 0.204) });
    page.drawText(ascii(`${opts.reference} · Annexure ${n}`), { x: 48, y: A4.h - 60, size: 9, font, color: rgb(0.42, 0.45, 0.5) });
    page.drawText(ascii(a.title), { x: 48, y: A4.h - 90, size: 18, font: bold, color: rgb(0.04, 0.1, 0.18) });
    page.drawText(ascii(a.filename), { x: 48, y: A4.h - 112, size: 10, font, color: rgb(0.22, 0.25, 0.32) });
    if (a.kind === "fixed") page.drawText("Attached unchanged, as issued by the screening platform.", { x: 48, y: A4.h - 132, size: 10, font, color: rgb(0.22, 0.25, 0.32) });
    if (a.sha256) page.drawText(ascii(`File fingerprint (SHA-256): ${a.sha256}`), { x: 48, y: A4.h - 152, size: 7.5, font, color: rgb(0.42, 0.45, 0.5) });
    if (note) page.drawText(ascii(note), { x: 48, y: A4.h - 176, size: 10, font: bold, color: rgb(0.76, 0.25, 0.23) });
    if (opts.draft) page.drawText("DRAFT", { x: 170, y: 330, size: 110, font: bold, color: rgb(0.76, 0.25, 0.23), opacity: 0.08 });
  };

  let n = 0;
  for (const a of annexures) {
    n += 1;
    if (!a.bytes) {
      cover(n, a, "The file could not be read when this report was made.");
      skipped.push(a.filename);
      continue;
    }
    // The caps protect the worker from evidence piling up. The fixed annexure is always embedded.
    if (a.kind === "evidence") {
      bytesSeen += a.bytes.byteLength;
      if (bytesSeen > MAX_ANNEXURE_BYTES || added >= MAX_ANNEXURE_PAGES) {
        cover(n, a, "Not embedded: the report reached its size limit. Ontriq can share this file separately.");
        skipped.push(a.filename);
        continue;
      }
    }
    try {
      if (a.mime === "application/pdf") {
        const src = await PDFDocument.load(a.bytes, { ignoreEncryption: false });
        const all = src.getPageIndices();
        const indices = all.slice(0, a.kind === "fixed" ? undefined : Math.max(0, MAX_ANNEXURE_PAGES - added));
        if (indices.length < all.length) partial.push(a.filename);
        cover(n, a, indices.length < all.length ? `Only the first ${indices.length} of ${all.length} pages are included. Ontriq can share the full file.` : undefined);
        const pages = await doc.copyPages(src, indices);
        for (const p of pages) doc.addPage(p);
        added += pages.length;
      } else if (a.mime.startsWith("image/")) {
        const photo = a.mime === "image/jpeg" || a.mime === "image/png" ? a.bytes : await toJpeg(a.bytes, a.mime);
        if (!photo) throw new Error("unreadable image");
        cover(n, a);
        const img = a.mime === "image/png" ? await doc.embedPng(photo) : await doc.embedJpg(photo);
        const page = doc.addPage([A4.w, A4.h]);
        const scale = Math.min((A4.w - 72) / img.width, (A4.h - 96) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
        added += 1;
      } else {
        cover(n, a, "This file type can't be embedded in a PDF. Ontriq can share it separately.");
        skipped.push(a.filename);
      }
    } catch {
      cover(n, a, "The file could not be embedded (it may be protected or damaged).");
      skipped.push(a.filename);
    }
  }
  doc.setTitle(`${opts.reference} verification report`);
  doc.setProducer("Ontriq CRM");
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount(), skipped, partial };
}
