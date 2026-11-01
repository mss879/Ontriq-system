/** Draw the test documents to files outside the repo, and age some into phone photos. */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { DOCS, SLIPS, type Photo } from "./docs";
import { parseNic } from "../../src/domain/nic-core";
import { DOC_DIR } from "./paths";


/** The pinned browser may not be downloaded; use the cached headless shell the smoke test uses. */
function cachedShell(): string | undefined {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

async function age(png: Buffer, p: Photo, mime: string): Promise<Buffer> {
  let img = sharp(png).flatten({ background: "#ffffff" });
  if (p.crop) img = sharp(await img.extract(p.crop).toBuffer());
  if (p.turn) img = sharp(await img.rotate(p.turn).toBuffer());
  if (p.tilt) img = sharp(await img.rotate(p.tilt, { background: "#3a3530" }).toBuffer());
  if (p.dark) img = sharp(await img.modulate({ brightness: p.dark }).toBuffer());
  if (p.blur) img = sharp(await img.blur(p.blur).toBuffer());
  return mime === "image/png" ? img.png().toBuffer() : img.jpeg({ quality: p.quality ?? 78 }).toBuffer();
}

for (const nic of ["199057501234", "905751234V", "883071234V", "921234567V", "951721234V"]) {
  const r = parseNic(nic);
  if (!r.valid) throw new Error(`fixture NIC ${nic} is not valid`);
  console.log(nic, r.birthDate, r.gender);
}

mkdirSync(DOC_DIR, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
const context = await browser.newContext({ deviceScaleFactor: 1.5, viewport: { width: 1000, height: 1400 } });
const tab = await context.newPage();

const shot = async (html: string) => {
  await tab.setContent(html, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  return tab.locator("#p").screenshot({ type: "png" });
};

for (const d of [...DOCS, ...SLIPS]) {
  const file = path.join(DOC_DIR, `${d.id}${d.mime === "application/pdf" ? ".pdf" : d.mime === "image/png" ? ".png" : ".jpg"}`);
  const shots: Buffer[] = [];
  let text = "";
  for (const html of d.pages) {
    shots.push(await shot(html));
    text += `${await tab.locator("#p").innerText()}\n`;
  }
  writeFileSync(path.join(DOC_DIR, `${d.id}.truth.txt`), text);
  if (d.mime === "application/pdf") {
    const pdf = await PDFDocument.create();
    for (const html of d.pages) {
      await tab.setContent(html, { waitUntil: "load" });
      await tab.evaluate(() => document.fonts.ready);
      const one = await PDFDocument.load(await tab.pdf({ format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
      const copied = await pdf.copyPages(one, [0]);
      pdf.addPage(copied[0]);
    }
    writeFileSync(file, await pdf.save());
  } else {
    const photo = (d as { photo?: Photo }).photo ?? {};
    writeFileSync(file, await age(shots[0], photo, d.mime));
  }
}
await browser.close();
console.log("wrote", readdirSync(DOC_DIR).length, "files to", DOC_DIR, existsSync(DOC_DIR));
