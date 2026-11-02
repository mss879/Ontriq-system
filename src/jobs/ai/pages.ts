/**
 * Scanned files as the model reads them best: one upright photo per page.
 * A phone scanner's PDF holds a JPEG per page. Sent as a PDF, its handwriting
 * reaches the model small, and a card scanned sideways stays sideways; sent
 * as the page photos, turned upright, the same Sinhala form read correctly
 * (scripts/ai-eval/real-scans.ts). A PDF with real text stays a PDF: its text
 * layer reads better than any photo of it.
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFPage } from "pdf-lib";

/** Longer scans go as the PDF: every page as a photo would cost more than it adds. */
export const MAX_SCAN_PAGES = 10;
/** The longest side the model reads at full detail. */
const LONG_EDGE = 2576;
/** Claude takes images up to 5 MB once encoded, which is about this much file. */
const MAX_IMAGE_BYTES = 3.7 * 1024 * 1024;
/** Smaller images on a scanned page are logos and stamps added by the scanner app. */
const MIN_SCAN_EDGE = 800;
const TEXT_OPERATORS = /\b(Tj|TJ)\b|'|"/;

function pageText(page: PDFPage): string {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((s) => page.doc.context.lookup(s)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) return "";
      try {
        return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** The page's largest image, when it is a JPEG big enough to be the scan itself. */
function pageScan(page: PDFPage): Uint8Array | null {
  const objects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  let best: { bytes: Uint8Array; area: number } | null = null;
  for (const [, ref] of objects?.entries() ?? []) {
    const o = page.doc.context.lookup(ref);
    if (!(o instanceof PDFRawStream) || o.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = o.dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber() ?? 0;
    const height = o.dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber() ?? 0;
    const filter = o.dict.get(PDFName.of("Filter"));
    const jpeg = filter === PDFName.of("DCTDecode") || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of("DCTDecode"));
    if (!best || width * height > best.area) best = jpeg ? { bytes: o.contents, area: width * height } : { bytes: new Uint8Array(), area: width * height };
  }
  if (!best?.bytes.length) return null;
  const edge = Math.sqrt(best.area);
  return edge >= MIN_SCAN_EDGE ? best.bytes : null;
}

/** The JPEG behind each page of a scanned PDF, or null when any page has text or isn't a scan. */
export async function scanPages(bytes: Uint8Array): Promise<Uint8Array[] | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdf.getPages();
    if (!pages.length || pages.length > MAX_SCAN_PAGES) return null;
    const scans: Uint8Array[] = [];
    for (const page of pages) {
      if (TEXT_OPERATORS.test(pageText(page))) return null;
      const scan = pageScan(page);
      if (!scan) return null;
      scans.push(scan);
    }
    return scans;
  } catch {
    return null;
  }
}

/**
 * A page as the model takes it: turned the way its camera said, then `turn`
 * degrees clockwise, at most 2576 px on the long side, as a JPEG. Only the
 * copy changes: the file in Storage stays as uploaded, because it is the
 * evidence. Null when the image library can't read it.
 */
export async function pageImage(bytes: Uint8Array, turn = 0): Promise<Uint8Array | null> {
  try {
    const { default: sharp } = await import("sharp");
    const upright = await sharp(bytes).rotate().toBuffer();
    const sized = sharp(upright).rotate(turn).resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true });
    for (const quality of [90, 75]) {
      const out = await sized.clone().jpeg({ quality }).toBuffer();
      if (out.byteLength <= MAX_IMAGE_BYTES) return new Uint8Array(out);
    }
    return null;
  } catch {
    return null;
  }
}
