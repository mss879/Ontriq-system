/**
 * Append the annexures to the report body with pdf-lib. Planning comes first:
 * each file is read once to learn what can be done with it and which part of the
 * report it goes in, so the report can say what it really holds. Assembly then
 * reads each file again, one at a time, which keeps the worker within memory.
 * Each evidence file starts on the page of its own heading (a photo fitted below
 * it, a PDF's first page scaled to fit, the rest copied page by page), so no sheet
 * stands nearly empty. A file with something to explain keeps a cover sheet of its
 * own, and the fixed annexure (Global Sanction report) is attached untouched. Spec 7 wants all evidence in the report package, so what
 * doesn't fit goes in a further part. A protected PDF can't be copied page by
 * page: the original file travels inside the PDF instead. Plain Node.
 */
import { createHash } from "node:crypto";
import { decodePDFRawStream, degrees, PDFDict, PDFDocument, PDFName, PDFRawStream, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ReportAnnexure } from "../../domain/reports/compile-core";
import { renderAnnexureCover, renderAnnexureHeading, renderPartTitle } from "./annexure-cover";
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

export type AnnexureFile = ReportAnnexure & {
  /** The document's kind, such as nic_copy, when the caller knows it. */
  category?: string;
  read: () => Promise<Uint8Array | null>;
};

export type PlannedAnnexure = AnnexureFile & {
  number: number;
  status: AnnexureStatus;
  part: number;
  /** Worked out here, on what is really in storage. The browser's figure is only a claim. */
  fingerprint: string | null;
  altered: boolean;
  /** Pages it fills: a photo is one. */
  pages: number;
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
    return { ...s.a, number: i + 1, status, part: s.a.kind === "fixed" ? 1 : part, fingerprint: s.fingerprint, altered: s.altered, pages: s.pages };
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

type Box = { x: number; y: number; w: number; h: number };
const MARGIN = 36;
/** A page of its own: the room below the top and bottom margins. */
const FULL_PAGE: Box = { x: MARGIN, y: 48, w: A4.w - MARGIN * 2, h: A4.h - 96 };

/**
 * Where to draw something so it fills the box across, from the top down, turned
 * clockwise by quarter turns. Photos never grow past their own size; pages do.
 */
function fit(width: number, height: number, turns: number, box: Box, grow: boolean) {
  const sideways = turns % 2 === 1;
  const across = sideways ? height : width;
  const up = sideways ? width : height;
  const scale = Math.min(box.w / across, box.h / up, grow ? Infinity : 1);
  const w = width * scale;
  const h = height * scale;
  const left = box.x + (box.w - across * scale) / 2;
  const bottom = box.y + box.h - up * scale;
  if (turns === 1) return { x: left, y: bottom + w, width: w, height: h, rotate: degrees(-90) };
  if (turns === 2) return { x: left + w, y: bottom + h, width: w, height: h, rotate: degrees(180) };
  if (turns === 3) return { x: left + h, y: bottom, width: w, height: h, rotate: degrees(90) };
  return { x: left, y: bottom, width: w, height: h };
}

/** "Rotate me" as phones write it: 3 is upside down, 6 and 8 are portraits lying on their side. */
const PHOTO_TURNS: Record<number, number> = { 3: 2, 4: 2, 5: 1, 6: 1, 7: 3, 8: 3 };

function drawPhoto(page: PDFPage, img: PDFImage, orientation: number, box: Box) {
  page.drawImage(img, fit(img.width, img.height, PHOTO_TURNS[orientation] ?? 0, box, false));
}

/** Nothing to explain about the file, so its heading can share the page it starts on. */
const sharesHeading = (a: PlannedAnnexure) => a.kind === "evidence" && a.status === "embedded" && !a.altered && !a.contents?.length;

/**
 * The client wants both sides of an NIC on one page: a file's first two pages, or
 * front and back sent as two files of one page each.
 */
const isNic = (a: PlannedAnnexure) => a.category === "nic_copy";
const sidesOfOneNic = (a: PlannedAnnexure, b: PlannedAnnexure | undefined): b is PlannedAnnexure =>
  Boolean(b) && isNic(a) && isNic(b!) && sharesHeading(a) && sharesHeading(b!) && a.part === b!.part && a.check_label === b!.check_label && a.pages === 1 && b!.pages === 1;

/**
 * A scanning app often turns a card's photo on its side to fill a portrait page. A
 * card is wider than it is tall, so when an NIC page draws nothing but one landscape
 * photo turned a quarter, the quarter turns that undo it show the card upright.
 */
function cardTurns(page: PDFPage): number | null {
  const objects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  const refs = objects?.values() ?? [];
  if (refs.length !== 1) return null;
  const image = page.doc.context.lookup(refs[0]);
  if (!(image instanceof PDFRawStream)) return null;
  const size = (key: string) => Number(image.dict.get(PDFName.of(key))?.toString());
  if (image.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image" || !(size("Width") > size("Height"))) return null;
  const drawn = page.node.Contents();
  if (!(drawn instanceof PDFRawStream) || drawn.contents.byteLength > 400) return null;
  // Only "place the photo, draw it": a text layer or notes on the page would be lost.
  const ops = new TextDecoder().decode(decodePDFRawStream(drawn).decode()).trim();
  const m = /^q\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s+\S+\s+cm\s+\/\S+\s+Do\s+Q$/.exec(ops);
  if (!m) return null;
  const quarter = Math.round(Math.atan2(Number(m[2]), Number(m[1])) / (Math.PI / 2));
  // Placed the way it was taken (or upside down), the page is already as good as it gets.
  return quarter % 2 === 0 ? null : (((quarter + Math.round(page.getRotation().angle / 90)) % 4) + 4) % 4;
}

/** Something to draw on a heading's page: a photo, or a page of a PDF. */
type Piece = { width: number; height: number; turns: number; grow: boolean; draw: (page: PDFPage, at: ReturnType<typeof fit>) => void };

const GAP = 12;
const scaleOf = (p: Piece, box: Box) => {
  const sideways = p.turns % 2 === 1;
  return Math.min(box.w / (sideways ? p.height : p.width), box.h / (sideways ? p.width : p.height), p.grow ? Infinity : 1);
};
const tall = (p: Piece, box: Box) => scaleOf(p, box) * (p.turns % 2 === 1 ? p.width : p.height);
const area = (p: Piece, box: Box) => scaleOf(p, box) ** 2 * p.width * p.height;

/** One piece fills the room. Two go side by side or one above the other, whichever shows them bigger. */
function layOut(page: PDFPage, pieces: Piece[], box: Box) {
  if (pieces.length < 2) {
    for (const p of pieces) p.draw(page, fit(p.width, p.height, p.turns, box, p.grow));
    return;
  }
  const [a, b] = pieces;
  const half = (box.w - GAP) / 2;
  const left: Box = { ...box, w: half };
  const right: Box = { ...box, x: box.x + half + GAP, w: half };
  const top: Box = { ...box, y: box.y + (box.h + GAP) / 2, h: (box.h - GAP) / 2 };
  const across = area(a, left) + area(b, right);
  const down = area(a, top) + area(b, top);
  if (across >= down) {
    a.draw(page, fit(a.width, a.height, a.turns, left, a.grow));
    b.draw(page, fit(b.width, b.height, b.turns, right, b.grow));
  } else {
    // The second starts right under the first, so no gap opens between them.
    const used = tall(a, top);
    a.draw(page, fit(a.width, a.height, a.turns, { ...box, y: box.y + box.h - used, h: used }, a.grow));
    b.draw(page, fit(b.width, b.height, b.turns, { ...box, h: box.h - used - GAP }, b.grow));
  }
}

export async function assembleReport(body: Uint8Array, plan: PlannedAnnexure[], opts: AssembleOptions): Promise<Assembled> {
  const doc = await PDFDocument.load(body);
  const part = opts.part ?? 1;
  const stamp: PDFFont | null = opts.draft ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  // Drafts say so on every page, copied ones included. A final is left exactly as it came.
  const marked = (page: PDFPage) => {
    if (stamp) page.drawText("DRAFT", { x: page.getWidth() / 2 - 150, y: page.getHeight() / 2 - 60, size: 90, font: stamp, color: rgb(0.76, 0.25, 0.23), opacity: 0.1, rotate: degrees(30) });
  };

  const mine = plan.filter((p) => p.part === part);
  for (let i = 0; i < mine.length; i += 1) {
    const a = mine[i];
    const heading = `${opts.label ?? "Annexure"} ${a.number}`;
    if (sharesHeading(a)) {
      const group = sidesOfOneNic(a, mine[i + 1]) ? [a, mine[(i += 1)]] : [a];
      const pieces: Piece[] = [];
      const after: { src: PDFDocument; pages: number[] }[] = [];
      for (const g of group) {
        const bytes = await g.read();
        if (!bytes) throw new Error(`${g.filename} could be read a moment ago and now can't`);
        if (g.mime === "application/pdf") {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
          // An NIC's back follows its front on the same page; anything else starts with one page.
          const want = isNic(g) && group.length === 1 ? 2 : 1;
          let used = 0;
          for (; used < Math.min(want, src.getPageCount()); used += 1) {
            const source = src.getPage(used);
            // An empty page has nothing to draw onto another, so it goes in whole after the heading.
            if (!source.node.Contents()) break;
            const embedded = await doc.embedPage(source);
            const turns = (isNic(g) ? cardTurns(source) : null) ?? ((Math.round(source.getRotation().angle / 90) % 4) + 4) % 4;
            pieces.push({ width: embedded.width, height: embedded.height, turns, grow: true, draw: (page, at) => page.drawPage(embedded, at) });
          }
          const rest = src.getPageIndices().slice(used);
          if (rest.length) after.push({ src, pages: rest });
        } else {
          const photo = await photoBytes(bytes, g.mime);
          if (!photo) throw new Error(`${g.filename} could be read a moment ago and now can't`);
          const img = await embedPhoto(doc, photo, g.mime);
          // Converted photos are already upright. A JPEG from a phone says how to turn it.
          const turns = PHOTO_TURNS[g.mime === "image/jpeg" ? jpegOrientation(photo) : 1] ?? 0;
          pieces.push({ width: img.width, height: img.height, turns, grow: false, draw: (page, at) => page.drawImage(img, at) });
        }
      }
      const head = await renderAnnexureHeading({
        reference: opts.reference,
        heading: group.length > 1 ? `${opts.label ?? "Annexures"} ${group.map((g) => g.number).join(" and ")}` : heading,
        title: a.title,
        filename: group.map((g) => g.filename).join(" · "),
        fingerprints: group.flatMap((g) => (g.fingerprint ? [group.length > 1 ? `${g.filename}: ${g.fingerprint}` : g.fingerprint] : [])),
      });
      const [page] = await doc.copyPages(await PDFDocument.load(head.bytes), [0]);
      doc.addPage(page);
      layOut(page, pieces, { x: MARGIN, y: MARGIN, w: A4.w - MARGIN * 2, h: A4.h - head.top - 12 - MARGIN });
      marked(page);
      for (const { src, pages } of after) for (const copy of await doc.copyPages(src, pages)) marked(doc.addPage(copy));
      continue;
    }

    const intact = a.status === "embedded" && !a.altered;
    const cover = await renderAnnexureCover({
      reference: opts.reference,
      heading,
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
      drawPhoto(page, await embedPhoto(doc, photo, a.mime), a.mime === "image/jpeg" ? jpegOrientation(photo) : 1, FULL_PAGE);
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
