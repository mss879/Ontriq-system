/**
 * Every check type through the screens that send "_response" (local stack):
 * the AI's values for every field, accepted and saved; "Awaiting reply" and
 * back. Fails when a save doesn't land or when an action request would be
 * refused on the live site (firewall-guard.ts). With --bodies dir it keeps
 * each action body, so they can be replayed against the live edge.
 *
 *   npx tsx --env-file=.env.local scripts/dev/firewall-paths.ts --base http://localhost:3100 [--bodies dir]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createServiceClient } from "../../src/jobs/admin-client";
import { checkTypeSchema, type FieldDef } from "../../src/domain/check-types/schema";
import { extractionFields } from "../../src/domain/ai/extraction";
import type { Stage } from "../../src/domain/workflow/stages";
import { sessionCookies } from "./dev-session";
import { refusedOnLive, reportRefused, watchServerActions } from "./firewall-guard";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const bodies = flag("bodies");
if (bodies) mkdirSync(bodies, { recursive: true });
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("local stack only");
const admin = createServiceClient();
const MARK = "firewall-paths";

function cachedShell(): string | undefined {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
}

/** A value the form accepts for this field, with "_response" wherever free text allows. */
function sample(f: FieldDef): unknown {
  const k = f.key;
  switch (f.type) {
    case "date":
      return k.includes("birth") ? "1994-03-12" : "2024-05-20";
    case "date_range":
      return { from: "2018-02-01", to: "2021-06-30" };
    case "select":
      return f.options?.[0]?.value;
    case "multi_select":
      return f.options?.length ? [f.options[0].value] : undefined;
    case "boolean":
      return true;
    case "number":
      return k.includes("year") ? 2015 : 3;
    case "nic":
      return "199407201234";
    case "email":
      return "hr@abc.lk";
    case "phone":
      return "+94112345678";
    case "district":
      return "Colombo";
    case "text":
    case "address":
    case "textarea":
      return `${f.label} as printed (ref employer_response ${k})`.slice(0, f.validation?.maxLength ?? 200);
    default:
      return undefined;
  }
}

const results: { name: string; ok: boolean; detail: string }[] = [];
async function step(name: string, run: () => Promise<string | void>) {
  try {
    const detail = (await run()) ?? "";
    results.push({ name, ok: true, detail });
    console.log(`ok    ${name}${detail ? ` · ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name} · ${detail}`);
  }
}
const must = (cond: unknown, message: string) => {
  if (!cond) throw new Error(message);
};

type Picked = { caseId: string; checkId: string; orgId: string; key: string; stage: string; values: Record<string, unknown>; fields: FieldDef[] };

async function pick(key: string, stages: Stage[]): Promise<Picked | null> {
  const { data } = await admin
    .from("case_checks")
    .select("id, org_id, case_id, values, state, check_types!inner(key), version:check_type_versions(schema), cases!inner(stage, on_hold)")
    .eq("check_types.key", key)
    .in("cases.stage", stages)
    .eq("cases.on_hold", false)
    .not("state", "in", "(completed,waived,discrepancy,unable_to_verify)")
    .limit(1);
  const k = data?.[0] as unknown as { id: string; org_id: string; case_id: string; values: Record<string, unknown>; version: { schema: unknown }; cases: { stage: string } } | undefined;
  if (!k) return null;
  return { caseId: k.case_id, checkId: k.id, orgId: k.org_id, key, stage: k.cases.stage, values: k.values ?? {}, fields: checkTypeSchema.parse(k.version.schema).fields };
}

/** What the AI job would leave: one suggestion per readable field, and the groups' rows. */
async function suggest(p: Picked) {
  // Empty, as a check is before the AI reads its files, so every value lands and the run can repeat.
  await admin.from("case_checks").update({ values: {} }).eq("id", p.checkId);
  await admin.from("ai_suggestions").delete().eq("entity_id", p.checkId).eq("capability", "document.extract").eq("decision", "pending");
  const { flat, groups } = extractionFields(p.fields);
  const rows: Record<string, unknown>[] = [];
  for (const f of flat) {
    const value = sample(f);
    if (value !== undefined) rows.push({ field_key: f.key, value });
  }
  for (const g of groups) rows.push({ field_key: g.key, value: [Object.fromEntries(g.fields.flatMap((c) => (sample(c) === undefined ? [] : [[c.key, sample(c)]])))] });
  const { error } = await admin.from("ai_suggestions").insert(
    rows.map((r) => ({ ...r, org_id: p.orgId, capability: "document.extract", entity_type: "case_check", entity_id: p.checkId, confidence: 0.92, rationale: "From test.pdf", source_refs: [MARK] })) as never,
  );
  if (error) throw new Error(error.message);
  return rows.map((r) => r.field_key as string);
}

async function open(page: Page, p: Picked) {
  await page.goto(`${base}/app/cases/${p.caseId}/checks/${p.checkId}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  must(!(await page.getByText("This page didn't load").count()), "error page on load");
}

async function acceptAndSave(page: Page, p: Picked, keys: string[]) {
  await open(page, p);
  const all = page.getByRole("button", { name: /Accept \d+ high-confidence/ });
  if (await all.count()) await all.click();
  for (const b of await page.getByRole("button", { name: /^Accept / }).all()) if (await b.isVisible()) await b.click();
  await page.locator("form button[type=submit]:visible", { hasText: "Save" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("All changes saved") || document.body.innerText.includes("didn't load"), undefined, { timeout: 20_000 });
  must(!(await page.getByText("This page didn't load").count()), "error page after saving");
  const { data } = await admin.from("case_checks").select("values").eq("id", p.checkId).single();
  const saved = (data?.values ?? {}) as Record<string, unknown>;
  const missing = keys.filter((k) => saved[k] === undefined);
  must(!missing.length, `not saved: ${missing.join(", ")}`);
  await page.waitForTimeout(800);
  const { count } = await admin.from("ai_suggestions").select("id", { count: "exact", head: true }).eq("entity_id", p.checkId).contains("source_refs", JSON.stringify([MARK])).eq("decision", "pending");
  must(count === 0, `${count} suggestions still pending`);
  const group = keys.find((k) => Array.isArray(saved[k]));
  return `${keys.length} fields saved${group ? `, ${group}: ${Object.keys((saved[group] as Record<string, unknown>[])[0] ?? {}).length} columns` : ""}`;
}

async function stateOf(checkId: string) {
  const { data } = await admin.from("case_checks").select("state").eq("id", checkId).single();
  return data?.state;
}

async function main() {
  const { cookies } = await sessionCookies("super_admin");
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  watchServerActions(ctx);
  let n = 0;
  if (bodies) ctx.on("request", (r) => r.headers()["next-action"] && r.method() === "POST" && writeFileSync(path.join(bodies, `${String(++n).padStart(3, "0")}.body`), r.postDataBuffer() ?? ""));
  const page = await ctx.newPage();

  for (const key of ["education", "employment", "nic", "address", "police", "reference", "sanction"]) {
    const entry = await pick(key, ["documents", "pre_qc", "data_entry"]);
    await step(`${key}: AI values accepted and saved (data entry)`, async () => {
      must(entry, "no open check");
      return acceptAndSave(page, entry!, await suggest(entry!));
    });
    const verifying = await pick(key, ["verification"]);
    await step(`${key}: AI values accepted and saved (verification)`, async () => {
      must(verifying, "no check in verification");
      return acceptAndSave(page, verifying!, await suggest(verifying!));
    });
    await step(`${key}: Awaiting reply, then back in progress`, async () => {
      must(verifying, "no check in verification");
      const id = verifying!.checkId;
      const reach = async (button: string, want: string) => {
        await page.getByRole("button", { name: button }).click();
        for (let i = 0; i < 40 && (await stateOf(id)) !== want; i++) await page.waitForTimeout(500);
        must((await stateOf(id)) === want, `${want} not saved`);
        must(!(await page.getByText("This page didn't load").count()), "error page");
        await page.waitForLoadState("networkidle").catch(() => undefined);
      };
      await open(page, verifying!);
      if ((await stateOf(id)) !== "in_progress") await reach("In progress", "in_progress");
      await reach("Awaiting reply", "awaiting_response");
      await reach("In progress", "in_progress");
    });
  }
  await browser.close();
  await admin.from("ai_suggestions").delete().contains("source_refs", JSON.stringify([MARK]));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed. ${refusedOnLive.length} request(s) the live site would refuse.`);
  if (failed.length) process.exitCode = 1;
  reportRefused();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
