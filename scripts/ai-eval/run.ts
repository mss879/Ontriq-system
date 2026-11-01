/**
 * Score the AI against the labelled set and print what it cost.
 *   npx tsx --env-file=.env.local scripts/ai-eval/run.ts [--suites a,b] [--arms h-low,s-medium] [--run name]
 * With no --arms each suite runs on the model and effort it uses in production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { arm, type Arm } from "./lib";
import { CURRENT, SUITES, spend, type Row } from "./suites";
import { OUT_DIR } from "./paths";

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const run = flag("run") ?? "baseline";
const names = (flag("suites")?.split(",") ?? Object.keys(SUITES)) as (keyof typeof SUITES)[];

function parseArm(s: string): Arm {
  const [tier, effort, opt] = s.split("-") as ["h" | "s" | "o", Arm["effort"], string | undefined];
  return arm(tier, effort, opt === "nothink" ? { thinking: "off" } : {});
}

const rows: Row[] = [];
for (const name of names) {
  const base = flag("arms")?.split(",").map(parseArm) ?? [CURRENT[name]];
  // Answers vary between runs: --repeat scores each arm several times.
  const arms = base.flatMap((a) => Array.from({ length: Number(flag("repeat") ?? 1) }, (_, attempt) => ({ ...a, attempt })));
  const started = Date.now();
  const only = flag("only")?.split(",");
  const suite = SUITES[name] as (run: string, arms: Arm[], only?: (d: { id: string }) => boolean) => Promise<Row[]>;
  const out = await suite(run, arms, only ? (d) => only.includes(d.id) : undefined);
  rows.push(...out);
  console.log(`${name}: ${out.length} calls in ${((Date.now() - started) / 1000).toFixed(0)}s, spent so far $${spend.live.toFixed(3)}`);
}

const lines: string[] = [];
const by = new Map<string, Row[]>();
for (const r of rows) by.set(`${r.suite} ${r.arm}`, [...(by.get(`${r.suite} ${r.arm}`) ?? []), r]);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
lines.push("suite arm | checks passed | clean items | $/call | sec/call | in | out | thinking | cache r/w | stops");
for (const [k, list] of by) {
  const passed = list.reduce((a, r) => a + r.passed, 0);
  const total = list.reduce((a, r) => a + r.total, 0);
  const clean = list.filter((r) => r.passed === r.total).length;
  const stops = [...new Set(list.map((r) => r.stop))].join(",");
  lines.push(`${k} | ${passed}/${total} (${((100 * passed) / (total || 1)).toFixed(0)}%) | ${clean}/${list.length} | $${avg(list.map((r) => r.cost)).toFixed(4)} | ${(avg(list.map((r) => r.ms)) / 1000).toFixed(1)} | ${avg(list.map((r) => r.input)).toFixed(0)} | ${avg(list.map((r) => r.output)).toFixed(0)} | ${avg(list.map((r) => r.thinking)).toFixed(0)} | ${avg(list.map((r) => r.cacheRead)).toFixed(0)}/${avg(list.map((r) => r.cacheWrite)).toFixed(0)} | ${stops}`);
}
lines.push("", "Failures:");
for (const r of rows) if (r.fails.length) lines.push(`- ${r.suite} ${r.arm} ${r.id}: ${r.fails.join("; ")}`);
const report = lines.join("\n");
console.log(`\n${report}\n\nLive spend this run: $${spend.live.toFixed(3)} on ${spend.calls} calls.`);
const dir = path.join(OUT_DIR, "results", run);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `summary-${names.join("+").slice(0, 40)}.txt`), report);
writeFileSync(path.join(dir, `rows-${names.join("+").slice(0, 40)}.json`), JSON.stringify(rows, null, 2));
