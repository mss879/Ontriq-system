import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LOGO_COLORS, LOGO_LOCKUP } from "@/domain/brand/logo-paths";
import type { CandidateView } from "@/domain/candidate/view";

/**
 * The consent and authorisation form the candidate downloads, signs on paper
 * and photographs (A4, English, Ontriq brand). Built with pdf-lib's standard
 * fonts, so text outside Windows-1252 (Sinhala or Tamil names) becomes a
 * blank line for the candidate to write by hand. The final report and other
 * documents use the Phase 3 document system; this form only needs to print well.
 */

const NAVY = rgb(10 / 255, 26 / 255, 47 / 255);
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ORANGE = hex(LOGO_COLORS.orange);
const BLUE_ON_DARK = hex("#3D8FDB");

function hex(value: string) {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const SMART: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " };

/** Text the standard fonts can draw; null when too much would be lost (non-Latin names). */
export function pdfSafe(value: string | null | undefined): string | null {
  if (!value) return null;
  const mapped = [...value.normalize("NFC")].map((ch) => SMART[ch] ?? ch).join("");
  const kept = [...mapped].filter((ch) => {
    const code = ch.codePointAt(0)!;
    return code >= 32 && code <= 255;
  });
  return kept.length >= Math.ceil([...mapped].length * 0.8) ? kept.join("").trim() : null;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildConsentPdf(view: CandidateView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Consent and authorisation · ${view.case.reference}`);
  doc.setAuthor(view.org.legal_name || view.org.name);
  doc.setSubject("Consent and authorisation for background verification");
  doc.setCreator("Ontriq");

  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 54;
  const inner = width - margin * 2;

  // Header band with the reversed lockup.
  page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: NAVY });
  page.drawRectangle({ x: 0, y: height - 95, width, height: 3, color: ORANGE });
  const scale = 46 / 216.5;
  const at = { x: margin, y: height - 23, scale };
  page.drawSvgPath(LOGO_LOCKUP.orange, { ...at, color: ORANGE });
  page.drawSvgPath(LOGO_LOCKUP.markblue, { ...at, color: BLUE_ON_DARK });
  page.drawSvgPath(LOGO_LOCKUP.word, { ...at, color: rgb(1, 1, 1) });
  page.drawSvgPath(LOGO_LOCKUP.qtail, { ...at, color: BLUE_ON_DARK });
  page.drawSvgPath(LOGO_LOCKUP.tag, { ...at, color: rgb(1, 1, 1) });
  const tag = "CONSENT AND AUTHORISATION";
  page.drawText(tag, { x: width - margin - bold.widthOfTextAtSize(tag, 8.5), y: height - 50, size: 8.5, font: bold, color: rgb(1, 1, 1), opacity: 0.75 });
  const ref = view.case.reference;
  page.drawText(ref, { x: width - margin - regular.widthOfTextAtSize(ref, 9), y: height - 64, size: 9, font: regular, color: rgb(1, 1, 1), opacity: 0.6 });

  let y = height - 132;
  const title = "Consent and Authorisation for Background Verification";
  page.drawText(title, { x: margin, y, size: 16, font: bold, color: INK });
  y -= 22;
  y = paragraph(page, regular, 10, MUTED, "Please read this form, complete the details, sign and date it, then upload a clear photo of the signed page on your secure page.", margin, y, inner);
  y -= 14;

  // Details.
  const org = pdfSafe(view.org.legal_name || view.org.name) ?? "Ontriq (Pvt) Ltd";
  const client = pdfSafe(view.case.client_name) ?? "";
  const rows: [string, string | null][] = [
    ["Candidate name", pdfSafe(view.candidate.full_name)],
    ["NIC number", null],
    ["Requested by", client || null],
    ["Position", pdfSafe(view.case.position_title)],
    ["Verification reference", ref],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: margin, y, size: 9, font: bold, color: MUTED });
    if (value) page.drawText(value, { x: margin + 150, y, size: 10.5, font: regular, color: INK });
    page.drawLine({ start: { x: margin + 148, y: y - 4 }, end: { x: width - margin, y: y - 4 }, thickness: 0.6, color: RULE });
    y -= 24;
  }
  y -= 6;

  // Checks.
  page.drawText("Checks to be carried out", { x: margin, y, size: 11, font: bold, color: INK });
  y -= 17;
  const checks = view.checks.map((c) => pdfSafe(c.label)).filter((c): c is string => Boolean(c));
  const colWidth = inner / 2;
  checks.forEach((label, i) => {
    const cx = margin + (i % 2) * colWidth;
    const cy = y - Math.floor(i / 2) * 16;
    page.drawRectangle({ x: cx, y: cy - 1, width: 7, height: 7, borderColor: hex(LOGO_COLORS.blue), borderWidth: 0.8 });
    page.drawText(label, { x: cx + 14, y: cy, size: 10, font: regular, color: INK });
  });
  y -= Math.ceil(checks.length / 2) * 16 + 14;

  // Authorisation.
  page.drawText("Authorisation", { x: margin, y, size: 11, font: bold, color: INK });
  y -= 16;
  const clauses = [
    `I authorise ${org} to verify the information I have provided${client ? ` to ${client}` : ""}, including the checks listed above, and to contact the schools, universities, employers, referees, Grama Niladhari, police and other authorities and people needed to do so.`,
    `I authorise those institutions and people to release the information ${org} asks for, and I release them and ${org} from any liability for providing it in good faith.`,
    `I understand that my personal data will be used only for this verification, kept securely and shared only with ${client || "the company that requested it"}, in line with the Personal Data Protection Act No. 9 of 2022 of Sri Lanka. I may ask ${org} what data it holds about me.`,
    "I confirm that the information I have provided is true and complete, and that this consent remains valid until the verification is complete.",
  ];
  clauses.forEach((text, i) => {
    page.drawText(`${i + 1}.`, { x: margin, y, size: 10, font: bold, color: INK });
    y = paragraph(page, regular, 10, INK, text, margin + 16, y, inner - 16) - 6;
  });
  y -= 18;

  // Signature block.
  const half = (inner - 24) / 2;
  const sign = (label: string, x: number, at: number) => {
    page.drawLine({ start: { x, y: at }, end: { x: x + half, y: at }, thickness: 0.8, color: INK });
    page.drawText(label, { x, y: at - 13, size: 8.5, font: regular, color: MUTED });
  };
  sign("Signature", margin, y);
  sign("Date", margin + half + 24, y);
  y -= 46;
  sign("Full name", margin, y);
  sign("NIC number", margin + half + 24, y);

  // Footer.
  const contact = [view.org.address, view.org.phone, view.org.email, view.org.website].map(pdfSafe).filter(Boolean).join("  ·  ");
  page.drawLine({ start: { x: margin, y: 64 }, end: { x: width - margin, y: 64 }, thickness: 0.6, color: RULE });
  page.drawText(org, { x: margin, y: 48, size: 8.5, font: bold, color: MUTED });
  if (contact) paragraph(page, regular, 8, MUTED, contact, margin, 36, inner);
  const form = `Form v1 · ${ref}`;
  page.drawText(form, { x: width - margin - regular.widthOfTextAtSize(form, 8), y: 48, size: 8, font: regular, color: MUTED });

  return doc.save();
}

function paragraph(page: PDFPage, font: PDFFont, size: number, color: ReturnType<typeof rgb>, text: string, x: number, y: number, width: number): number {
  for (const line of wrap(text, font, size, width)) {
    page.drawText(line, { x, y, size, font, color });
    y -= size * 1.45;
  }
  return y;
}
