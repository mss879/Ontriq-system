import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { MAX_SCAN_PAGES, pageImage, scanPages } from "@/jobs/ai/pages";

const photo = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#d9cfa8" } }).jpeg().toBuffer();

/** A phone scanner's PDF: each page one JPEG, plus the app's small logo. */
async function scannedPdf(pages: Buffer[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const logo = await pdf.embedJpg(await photo(240, 90));
  for (const bytes of pages) {
    const page = pdf.addPage([595, 842]);
    page.drawImage(await pdf.embedJpg(bytes), { x: 0, y: 0, width: 595, height: 842 });
    page.drawImage(logo, { x: 10, y: 10, width: 60, height: 22 });
  }
  return pdf.save();
}

describe("scanPages", () => {
  it("gives back the scan behind each page, not the scanner's logo", async () => {
    const first = await photo(1800, 3000);
    const second = await photo(1700, 2500);
    const pages = await scanPages(await scannedPdf([first, second]));
    expect(pages?.length).toBe(2);
    expect(Buffer.from(pages![0]).equals(first)).toBe(true);
    expect(Buffer.from(pages![1]).equals(second)).toBe(true);
  });

  it("keeps a PDF with real text as a PDF", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText("Service letter", { x: 50, y: 780, font: await pdf.embedFont(StandardFonts.Helvetica) });
    page.drawImage(await pdf.embedJpg(await photo(1800, 3000)), { x: 0, y: 0, width: 595, height: 700 });
    expect(await scanPages(await pdf.save())).toBeNull();
  });

  it("keeps small images, long files and broken files as they are", async () => {
    expect(await scanPages(await scannedPdf([await photo(400, 600)]))).toBeNull();
    const many = await photo(1000, 1400);
    expect(await scanPages(await scannedPdf(Array.from({ length: MAX_SCAN_PAGES + 1 }, () => many)))).toBeNull();
    expect(await scanPages(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("pageImage", () => {
  it("turns the page clockwise and caps the long side at 2576 px", async () => {
    const out = await pageImage(await photo(3000, 2000), 90);
    const meta = await sharp(Buffer.from(out!)).metadata();
    expect([meta.width, meta.height]).toEqual([1717, 2576]);
    expect(meta.format).toBe("jpeg");
  });

  it("returns null for bytes that aren't an image", async () => {
    expect(await pageImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
