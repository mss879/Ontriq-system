/**
 * Real scans, not rendered test files: how well extraction reads handwritten
 * Sinhala on photographed documents, by how the file is sent and by model.
 * The scans and the answer key hold personal data, so they stay outside the
 * repo, in a folder with a key.json:
 *
 *   { "candidate": "Kasun Perera",
 *     "files": { "nic": { "check": "nic", "category": "nic_copy", "pdf": "nic.pdf",
 *                         "pages": ["nic_p1.png", "nic_p2.png"], "upright": { "2": 90 },
 *                         "truth": { "date_of_birth": { "equals": "1990-01-01" },
 *                                    "name_on_nic": { "all": ["kasun", "perera"] } } } } }
 *
 * "pages" are the scan images inside the PDF; "upright" turns a page clockwise.
 * The "app" way is what the jobs send: the PDF's own scans, turned by the
 * orientation read (src/jobs/handlers/ai-jobs.ts).
 *
 *   npx tsx --env-file=.env.local scripts/ai-eval/real-scans.ts <dir> [--repeat 3] [--arms s-medium,o-medium] [--ways pdf,pages,upright]
 *   npx tsx --env-file=.env.local scripts/ai-eval/real-scans.ts <dir> --turns [--arms h-low]
 *
 * --turns feeds every page at all four rotations and checks the orientation read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { BUILTIN_CHECK_TYPES, DOCUMENT_CATEGORIES } from "../../src/domain/check-types/builtin";
import { checkTypeSchema, type FieldDef } from "../../src/domain/check-types/schema";
import { extractionFields, formValue } from "../../src/domain/ai/extraction";
import { fileBlock } from "../../src/lib/ai/claude";
import { pageBlocks } from "../../src/jobs/ai/context";
import { pageImage, scanPages } from "../../src/jobs/ai/pages";
import * as P from "../../src/lib/ai/prompts";
import { arm, call, pool, save, spend, type Arm } from "./lib";

type Truth = { equals?: string; all?: string[]; present?: boolean };
type FileKey = { check: string; category: string; pdf: string; pages: string[]; upright?: Record<string, number>; truth: Record<string, Truth> };
type Key = { candidate: string; files: Record<string, FileKey> };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args[0];
if (!dir || dir.startsWith("--")) throw new Error("usage: real-scans.ts <dir> [--repeat n] [--arms ...] [--ways ...]");
const key = JSON.parse(readFileSync(path.join(dir, "key.json"), "utf8")) as Key;
// The name staff typed for the candidate, when testing another one: --candidate "Full Name".
if (flag("candidate")) key.candidate = flag("candidate")!;
const repeat = Number(flag("repeat") ?? 3);
const ARMS: Record<string, Arm> = {
  "h-low": arm("h", "low"),
  "h-medium": arm("h", "medium"),
  "s-low": arm("s", "low"),
  "s-medium": arm("s", "medium"),
  "s-high": arm("s", "high"),
  "o-medium": arm("o", "medium"),
  "o-high": arm("o", "high"),
  "f-medium": { name: "f-medium", model: "claude-fable-5-1", effort: "medium" },
};
const arms = (flag("arms") ?? "s-medium").split(",").map((a) => ARMS[a] ?? (() => { throw new Error(`unknown arm ${a}`); })());
const ways = (flag("ways") ?? "pdf,pages,upright").split(",");

/** A page image as the model takes it: JPEG, at most 2576 px on the long edge. */
async function pageBlock(file: string, turn = 0, trim = false): Promise<Anthropic.ContentBlockParam> {
  const { default: sharp } = await import("sharp");
  // Trimming drops the empty page around a card, so the same pixel budget shows its writing larger.
  const upright = await sharp(readFileSync(path.join(dir, file))).rotate(turn).toBuffer();
  const trimmed = trim ? await sharp(upright).trim({ threshold: 40 }).toBuffer().catch(() => upright) : upright;
  const out = await sharp(trimmed).resize({ width: 2576, height: 2576, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: out.toString("base64") } };
}

/** As the jobs do it: the scans inside the PDF, each turned the way the orientation read says. */
async function appBlocks(f: FileKey): Promise<Anthropic.ContentBlockParam[]> {
  const pages = await scanPages(new Uint8Array(readFileSync(path.join(dir, f.pdf))));
  if (!pages) return [fileBlock(new Uint8Array(readFileSync(path.join(dir, f.pdf))), "application/pdf")!];
  const turns = await Promise.all(
    pages.map(async (page) => {
      const image = await pageImage(page);
      const c = await call("document.classify", ARMS["h-low"], { system: P.ORIENT_SYSTEM, content: [fileBlock(image!, "image/jpeg")!, P.text(P.ORIENT_TEXT)], schema: P.OrientSchema });
      return c.data ? P.TURN_FOR[c.data.top] : 0;
    }),
  );
  console.log(`  ${f.pdf}: ${pages.length} scanned pages, turned ${turns.join(", ")}`);
  return (await pageBlocks(pages, turns))!;
}

async function blocksFor(f: FileKey, way: string): Promise<Anthropic.ContentBlockParam[]> {
  if (way === "app") return appBlocks(f);
  if (way === "pdf") return [fileBlock(new Uint8Array(readFileSync(path.join(dir, f.pdf))), "application/pdf")!];
  return Promise.all(f.pages.map((p, i) => pageBlock(p, way.startsWith("upright") ? (f.upright?.[String(i + 1)] ?? 0) : 0, way === "upright-trim")));
}

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[\s.,]/g, "");

function grade(t: Truth, value: unknown): boolean {
  if (t.present !== undefined) return Boolean((value as { present?: boolean } | null)?.present) === t.present;
  if (t.equals !== undefined) return norm(value) === norm(t.equals);
  return (t.all ?? []).every((part) => norm(value).includes(norm(part)));
}

/** Every page, upright and then turned 90, 180 and 270 degrees: does the orientation read put it back? */
async function turns() {
  const jobs = Object.values(key.files).flatMap((f) => f.pages.flatMap((page, i) => [0, 90, 180, 270].flatMap((by) => arms.flatMap((a) => Array.from({ length: repeat }, (_, n) => ({ page, by, a: { ...a, attempt: n }, upright: f.upright?.[String(i + 1)] ?? 0 }))))));
  const rows = await pool(jobs, 4, async ({ page, by, a, upright }) => {
    const content = [await pageBlock(page, (upright + by) % 360), P.text(P.ORIENT_TEXT)];
    const c = await call("document.classify", a, { system: P.ORIENT_SYSTEM, content, schema: P.OrientSchema });
    const want = (360 - by) % 360;
    const got = c.data ? P.TURN_FOR[c.data.top] : null;
    return { page, by, arm: a.name, want, got, ok: got === want, cost: c.cost };
  });
  for (const a of arms) {
    const mine = rows.filter((r) => r.arm === a.name);
    console.log(`${a.name}: ${mine.filter((r) => r.ok).length}/${mine.length} right · $${(mine.reduce((s, r) => s + r.cost, 0) / mine.length).toFixed(4)}/page`);
    for (const r of mine.filter((x) => !x.ok)) console.log(`  wrong: ${r.page} turned ${r.by}, said ${r.got}, should be ${r.want}`);
  }
}

async function main() {
  const jobs = Object.entries(key.files).flatMap(([name, f]) => ways.flatMap((way) => arms.flatMap((a) => Array.from({ length: repeat }, (_, n) => ({ name, f, way, a: { ...a, attempt: n } })))));
  const rows = await pool(jobs, 4, async ({ name, f, way, a }) => {
    const schema = checkTypeSchema.parse(BUILTIN_CHECK_TYPES.find((t) => t.key === f.check)?.schema);
    const { flat, groups } = extractionFields(schema.fields as FieldDef[]);
    const describe = (x: FieldDef) => ({ key: x.key, label: x.label, type: x.type, hint: x.ai?.hint, options: x.options });
    const label = BUILTIN_CHECK_TYPES.find((t) => t.key === f.check)?.name ?? f.check;
    const prompt = P.extractPrompt({ checkLabel: label, fields: flat.map(describe), groups: groups.map((g) => ({ key: g.key, label: g.label, fields: g.fields.map(describe) })), candidate: key.candidate });
    const category = DOCUMENT_CATEGORIES.find((c) => c.key === f.category)?.name ?? f.category;
    const content = [P.text(prompt.text), P.text(`Document: ${f.pdf} (${category})`), ...(await blocksFor(f, way)), P.text(prompt.reminder)];
    const c = await call("document.extract", a, { system: prompt.system, content, schema: P.ExtractSchema, minTokens: P.EXTRACT_MIN_TOKENS });
    save("real-scans", "extract", `${name}__${way}__${a.name}__${a.attempt}`, c);
    const found = Object.fromEntries((c.data?.fields ?? []).map((x) => [x.key, formValue(x.value)]));
    const hits = Object.fromEntries(Object.entries(f.truth).map(([k, t]) => [k, grade(t, found[k])]));
    return { name, way, arm: a.name, ok: c.ok, reason: c.reason, hits, found, cost: c.cost, cached: c.cached };
  });

  console.log(`\n${rows.length} reads · $${spend.live.toFixed(2)} spent now · ${rows.filter((r) => r.cached).length} from cache`);
  for (const [name, f] of Object.entries(key.files)) {
    console.log(`\n${name} (${f.check})`);
    for (const way of ways) {
      for (const a of arms) {
        const mine = rows.filter((r) => r.name === name && r.way === way && r.arm === a.name);
        const fields = Object.keys(f.truth).map((k) => `${k} ${mine.filter((r) => r.hits[k]).length}/${mine.length}`);
        const failed = mine.filter((r) => !r.ok).map((r) => r.reason);
        const cost = mine.reduce((s, r) => s + r.cost, 0) / Math.max(1, mine.length);
        console.log(`  ${way.padEnd(8)} ${a.name.padEnd(9)} ${fields.join(" · ")}${failed.length ? ` · failed: ${failed.join(", ")}` : ""} · $${cost.toFixed(3)}/read`);
      }
    }
  }
  console.log("\nwhat each read found:");
  for (const r of rows) console.log(`  ${r.name} ${r.way} ${r.arm}: ${JSON.stringify(r.found)}`);
}

(args.includes("--turns") ? turns() : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
