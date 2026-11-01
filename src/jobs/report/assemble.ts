/**
 * Append the annexures to the report body with pdf-lib. Planning comes first:
 * each file is read once to learn what can be done with it and which part of the
 * report it goes in, so the report can say what it really holds. Assembly then
 * reads each file again, one at a time, which keeps the worker within memory.
 * Each evidence file goes behind a cover sheet (images scaled onto A4 pages, PDFs
 * copied page by page), and the fixed annexure (Global Sanction report) is
 * attached untouched. Spec 7 wants all evidence in the report package, so what
 * doesn't fit goes in a further part. A protected PDF can't be copied page by
 * page: the original file travels inside the PDF instead. Plain Node.
 */
import { createHash } from "node:crypto";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ReportAnnexure } from "../../domain/reports/compile-core";
import { renderAnnexureCover, renderPartTitle } from "./annexure-cover";
import { jpegOrientation, toJpeg } from "./convert-image";

const A4 = { w: 595.28, h: 841.89 };
export const MAX_ANNEXURE_PAGES = 300;
/**
 * What one file of the report may hold in evidence. The reports bucket takes
 * 100 MB, but a hosted project's global limit can be 50 MB, and files grow a
 * little when copied. Past this, evidence moves to the next part.
 */
export const MAX_ANNEXURE_BYTES = 45 * 1024 * 1024;

export type AnnexureStatus =
  | "embedded"
  /** Protected: held inside the PDF as the file itself. */
  | "attached"
  /** Storage didn't give it back. */
  | "unreadable"
  /** It isn't a PDF or photo that opens. */
  | "damaged"
  /** A file type a PDF can't hold. */
  | "unsupported"
  /** Past the caps, on a report with no further parts. */
  | "left_out";

export type AnnexureFile = ReportAnnexure & { read: () => Promise<Uint8Array | null> };

export type PlannedAnnexure = AnnexureFile & {
  number: number;
  status: AnnexureStatus;
  part: number;
  /** Worked out here, on what is really in storage. The browser's figure is only a claim. */
  fingerprint: string | null;
  altered: boolean;
};

/** What the report's own annexure list needs to know. */
export type AnnexureOutcome = Pick<PlannedAnnexure, "document_id" | "status" | "part" | "altered">;

export type AssembleOptions = {
  reference: string;
  draft: boolean;
  label?: string;
  /** Which part of the report this file is. */
  part?: number;
  verifyUrl?: string | null;
};
export type Assembled = { bytes: Uint8Array; pages: number };

const isPhoto = (mime: string) => mime.startsWith("image/");
const isProtected = (error: unknown) => error instanceof Error && /encrypted/i.test(error.message); // pdf-lib's error class doesn't survive its build, so instanceof can't see it

async function photoBytes(bytes: Uint8Array, mime: string) {
  return mime === "image/jpeg" || mime === "image/png" ? bytes : toJpeg(bytes, mime);
}

async function embedPhoto(doc: PDFDocument, photo: Uint8Array, mime: string) {
  return mime === "image/png" ? doc.embedPng(photo) : doc.embedJpg(photo);
}

/** What can be done with a file, without keeping it. */
async function inspect(a: AnnexureFile) {
  const bytes = await a.read();
  if (!bytes) return { status: "unreadable" as const, pages: 0, size: 0, fingerprint: a.sha256, altered: false };
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  const altered = Boolean(a.sha256) && a.sha256 !== fingerprint;
  const seen = { fingerprint, altered };
  if (a.mime === "application/pdf") {
    try {
      const pages = (await PDFDocument.load(bytes, { ignoreEncryption: false })).getPageCount();
      // A PDF with no pages has nothing to show, so it isn't really in the report.
      return { ...seen, status: pages ? ("embedded" as const) : ("damaged" as const), pages, size: bytes.byteLength };
    } catch (error) {
      return { ...seen, status: isProtected(error) ? ("attached" as const) : ("damaged" as const), pages: 0, size: bytes.byteLength };
    }
  }
  if (isPhoto(a.mime)) {
    try {
      const photo = await photoBytes(bytes, a.mime);
      if (!photo) throw new Error("unreadable image");
      await embedPhoto(await PDFDocument.create(), photo, a.mime);
      return { ...seen, status: "embedded" as const, pages: 1, size: photo.byteLength };
    } catch {
      return { ...seen, status: "damaged" as const, pages: 0, size: 0 };
    }
  }
  return { ...seen, status: "unsupported" as const, pages: 0, size: 0 };
}

/**
 * Number the files and share them out. The fixed annexure stays in the report
 * itself, so its room is set aside first. Evidence moves to the next part when the
 * current one is full, or is left out when the report has no further parts.
 */
export async function planAnnexures(files: AnnexureFile[], opts: { parts: boolean }): Promise<PlannedAnnexure[]> {
  const seen = [];
  for (const a of files) seen.push({ a, ...(await inspect(a)) });
  let part = 1;
  let bytes = seen.filter((s) => s.a.kind === "fixed").reduce((n, s) => n + s.size, 0);
  let pages = 0;
  let held = 0;
  return seen.map((s, i) => {
    let status: AnnexureStatus = s.status;
    if (s.a.kind === "evidence" && (status === "embedded" || status === "attached")) {
      // A file bigger than the limit still goes, whole, on a part of its own.
      if (held > 0 && (bytes + s.size > MAX_ANNEXURE_BYTES || pages + s.pages > MAX_ANNEXURE_PAGES)) {
        if (opts.parts) {
          part += 1;
          bytes = 0;
          pages = 0;
          held = 0;
        } else status = "left_out";
      }
      if (status !== "left_out") {
        bytes += s.size;
        pages += s.pages;
        held += 1;
      }
    }
    return { ...s.a, number: i + 1, status, part: s.a.kind === "fixed" ? 1 : part, fingerprint: s.fingerprint, altered: s.altered };
  });
}

/** Why a file isn't simply here, in words for the reader of the report. */
function warnings(a: PlannedAnnexure): string[] {
  return [
    ...(a.altered ? ["This file has changed since it was uploaded."] : []),
    ...(a.status === "attached" ? ["This file is protected, so its pages can't be shown here. Open it from your PDF reader's attachments."] : []),
    ...(a.status === "unreadable" ? ["The file could not be read when this report was made."] : []),
    ...(a.status === "damaged" ? ["The file could not be embedded: it may be damaged."] : []),
    ...(a.status === "unsupported" ? ["This file type can't be embedded in a PDF. Ontriq can share it separately."] : []),
    ...(a.status === "left_out" ? ["Not embedded: the report reached its size limit. Ontriq can share this file separately."] : []),
  ];
}

/** "Rotate me" as phones write it: 3 is upside down, 6 and 8 are portraits lying on their side. */
function drawPhoto(page: PDFPage, img: PDFImage, orientation: number) {
  const sideways = orientation >= 5;
  const across = sideways ? img.height : img.width;
  const up = sideways ? img.width : img.height;
  const scale = Math.min((A4.w - 72) / across, (A4.h - 96) / up, 1);
  const width = img.width * scale;
  const height = img.height * scale;
  const left = (A4.w - across * scale) / 2;
  const bottom = (A4.h - up * scale) / 2;
  if (orientation === 5 || orientation === 6) page.drawImage(img, { x: left, y: bottom + width, width, height, rotate: degrees(-90) });
  else if (orientation === 7 || orientation === 8) page.drawImage(img, { x: left + height, y: bottom, width, height, rotate: degrees(90) });
  else if (orientation === 3 || orientation === 4) page.drawImage(img, { x: left + width, y: bottom + height, width, height, rotate: degrees(180) });
  else page.drawImage(img, { x: left, y: bottom, width, height });
}

export async function assembleReport(body: Uint8Array, plan: PlannedAnnexure[], opts: AssembleOptions): Promise<Assembled> {
  const doc = await PDFDocument.load(body);
  const part = opts.part ?? 1;
  const stamp: PDFFont | null = opts.draft ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  // Drafts say so on every page, copied ones included. A final is left exactly as it came.
  const marked = (page: PDFPage) => {
    if (stamp) page.drawText("DRAFT", { x: page.getWidth() / 2 - 150, y: page.getHeight() / 2 - 60, size: 90, font: stamp, color: rgb(0.76, 0.25, 0.23), opacity: 0.1, rotate: degrees(30) });
  };

  for (const a of plan.filter((p) => p.part === part)) {
    const intact = a.status === "embedded" && !a.altered;
    const cover = await renderAnnexureCover({
      reference: opts.reference,
      heading: `${opts.label ?? "Annexure"} ${a.number}`,
      title: a.title,
      filename: a.filename,
      lines: a.kind === "fixed" && intact ? ["Attached unchanged, as issued by the screening platform. The original file is inside this PDF."] : [],
      warnings: warnings(a),
      sha256: a.fingerprint,
      contents: a.contents,
      draft: opts.draft,
    });
    const coverDoc = await PDFDocument.load(cover);
    for (const page of await doc.copyPages(coverDoc, coverDoc.getPageIndices())) doc.addPage(page);
    if (a.status !== "embedded" && a.status !== "attached") continue;

    const bytes = await a.read();
    if (!bytes) throw new Error(`${a.filename} could be read a moment ago and now can't`);
    if (a.mime === "application/pdf" && a.status === "embedded") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
      for (const page of await doc.copyPages(src, src.getPageIndices())) marked(doc.addPage(page));
    } else if (a.status === "embedded") {
      const photo = await photoBytes(bytes, a.mime);
      if (!photo) throw new Error(`${a.filename} could be read a moment ago and now can't`);
      const page = doc.addPage([A4.w, A4.h]);
      // Converted photos are already upright. A JPEG from a phone says how to turn it.
      drawPhoto(page, await embedPhoto(doc, photo, a.mime), a.mime === "image/jpeg" ? jpegOrientation(photo) : 1);
      marked(page);
    }
    // The pages show the report; the attachment is the file as issued, form fields and all.
    if (a.status === "attached" || a.kind === "fixed") await doc.attach(bytes, a.filename, { mimeType: a.mime, description: a.title });
  }
  doc.setTitle(`${opts.reference} verification report${part > 1 ? `, part ${part}` : ""}`);
  doc.setProducer("Ontriq CRM");
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}

/** A further file of the same report: a title page, then the annexures that follow on. */
export async function assembleReportPart(plan: PlannedAnnexure[], opts: AssembleOptions & { part: number }): Promise<Assembled> {
  return assembleReport(await renderPartTitle({ reference: opts.reference, part: opts.part, draft: opts.draft, verifyUrl: opts.verifyUrl }), plan, opts);
}
