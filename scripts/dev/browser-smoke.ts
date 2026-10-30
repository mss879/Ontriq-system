/**
 * Browser smoke test on the local stack: signs in as each role (throwaway
 * users from dev-session.ts; cookies go straight into the browser, nothing is
 * typed or printed), opens the role's pages in headless Chromium at desktop
 * and phone sizes and in dark mode, and records console errors, failed
 * requests, error pages and sideways scrolling. Then it tries the keyboard
 * shortcuts, the search palette and the assistant panel.
 *
 *   npx tsx --env-file=.env.local scripts/dev/browser-smoke.ts [--base http://localhost:3100] [--shots dir] [--only role,role]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { sessionCookies } from "./dev-session";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3000").replace(/\/+$/, "");
const shots = flag("shots");
const only = flag("only")?.split(",");
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Visit = { role: string; client?: string; paths: string[]; dark?: string[] };
const PLAN: Visit[] = [
  {
    role: "super_admin",
    paths: ["/app", "/app/command", "/app/queues", "/app/cases", "/app/clients", "/app/candidates", "/app/reports", "/app/quotes", "/app/invoices", "/app/payments", "/app/team", "/app/team/performance", "/app/analytics", "/app/audit", "/app/settings", "/app/settings/ai", "/app/settings/branding", "/app/settings/billing", "/app/settings/assignment", "/app/settings/check-types", "/app/settings/packages"],
    dark: ["/app", "/app/cases", "/app/invoices", "/app/team/performance", "/app/analytics"],
  },
  { role: "admin", paths: ["/app", "/app/cases", "/app/cases/new", "/app/cases/import", "/app/clients", "/app/team", "/app/team/performance", "/app/analytics"] },
  { role: "operations_manager", paths: ["/app", "/app/queues", "/app/reports", "/app/team/performance", "/app/analytics"] },
  { role: "verification_officer", paths: ["/app", "/app/queues", "/app/cases", "/app/team/performance"] },
  { role: "qc_officer", paths: ["/app", "/app/queues"] },
  { role: "data_entry_officer", paths: ["/app", "/app/queues"] },
  { role: "client_relations", paths: ["/app", "/app/clients", "/app/quotes", "/app/invoices", "/app/payments"] },
  { role: "viewer", paths: ["/app", "/app/cases"] },
  { role: "client_admin", client: CLIENT, paths: ["/portal", "/portal/cases", "/portal/cases/new", "/portal/reports", "/portal/quotes", "/portal/invoices", "/portal/packages", "/portal/templates", "/portal/team", "/portal/settings"], dark: ["/portal", "/portal/invoices"] },
  { role: "client_user", client: CLIENT, paths: ["/portal", "/portal/cases", "/portal/invoices"] },
  { role: "client_viewer", client: CLIENT, paths: ["/portal", "/portal/cases"] },
];

type Finding = { role: string; path: string; view: string; status: number | null; finalPath: string; problems: string[] };
const findings: Finding[] = [];
const interactions: { name: string; ok: boolean; detail: string }[] = [];

async function contextFor(browser: Browser, v: Visit, opts: { mobile?: boolean; dark?: boolean }) {
  const { cookies } = await sessionCookies(v.role, v.client);
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: opts.mobile,
    hasTouch: opts.mobile,
    colorScheme: opts.dark ? "dark" : "light",
  });
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  return ctx;
}

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|Download the React DevTools|\[Fast Refresh\]|webpack-hmr|_next\/webpack|WebSocket connection to .*(realtime|_next)/i.test(t)) return;
    problems.push(`console: ${t.slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 500 && !r.url().includes("/realtime/")) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  return problems;
}

async function visit(page: Page, v: Visit, p: string, view: string) {
  const problems = watch(page);
  let status: number | null = null;
  try {
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 45_000 });
    status = res?.status() ?? null;
  } catch (e) {
    problems.push(`navigation: ${(e as Error).message.split("\n")[0]}`);
  }
  await page.waitForTimeout(400);
  const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (/Application error|Unhandled Runtime Error|This page couldn.t load|Something went wrong/i.test(body)) problems.push("error page shown");
  if (/\b(undefined|NaN|\[object Object\])\b/.test(body)) problems.push(`odd text: ${/\b(undefined|NaN|\[object Object\])\b/.exec(body)?.[0]}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
  if (overflow > 1) problems.push(`scrolls sideways by ${overflow}px`);
  const finalPath = new URL(page.url()).pathname;
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `${v.role}${p.replace(/[^a-z0-9]+/gi, "_")}_${view}.png`), fullPage: view !== "mobile" }).catch(() => undefined);
  }
  findings.push({ role: v.role, path: p, view, status, finalPath, problems });
  console.log(`${problems.length ? "BAD" : "ok "} ${v.role.padEnd(20)} ${view.padEnd(7)} ${p}${finalPath !== p ? ` → ${finalPath}` : ""}${problems.length ? `\n      ${problems.join("\n      ")}` : ""}`);
}

async function tryInteractions(browser: Browser) {
  const ctx = await contextFor(browser, PLAN[0], {});
  const page = await ctx.newPage();
  const problems = watch(page);
  const record = (name: string, ok: boolean, detail = "") => {
    interactions.push({ name, ok, detail });
    console.log(`${ok ? "ok " : "BAD"} interaction: ${name}${detail ? ` · ${detail}` : ""}`);
  };
  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => undefined);

  await page.keyboard.press("Shift+Slash");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  record("? opens the shortcuts list", await help.isVisible({ timeout: 3000 }).catch(() => false));
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);

  await page.keyboard.press("Control+k");
  const palette = page.getByPlaceholder(/search|type a command/i).first();
  record("Ctrl+K opens search", await palette.isVisible({ timeout: 3000 }).catch(() => false));
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(300);

  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await page.waitForURL(/\/app\/cases$/, { timeout: 8000 }).catch(() => undefined);
  record("g then c opens Cases", new URL(page.url()).pathname === "/app/cases", new URL(page.url()).pathname);

  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.keyboard.press("Control+j");
  const composer = page.getByRole("textbox").last();
  const opened = await composer.isVisible({ timeout: 4000 }).catch(() => false);
  record("Ctrl+J opens Ask Ontriq", opened);
  if (opened) {
    await composer.fill("Which cases are overdue?");
    await page.keyboard.press("Enter");
    const answer = page.getByText(/isn.t set up|AI isn.t|not set up/i).first();
    const got = await answer.waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);
    record("The assistant answers (AI not set up locally)", got, got ? (await answer.innerText()).slice(0, 80) : "no answer shown");
  }
  if (shots) await page.screenshot({ path: path.join(shots, "interaction_assistant.png") }).catch(() => undefined);
  record("No errors during the interactions", problems.length === 0, problems.join(" | ").slice(0, 300));
  await ctx.close();
}

/** Playwright's own browser when installed, else the newest headless shell already in the cache (no download). */
function cachedShell(): string | undefined {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(dir)) return undefined;
  const shells = readdirSync(dir).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of shells) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

async function main() {
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
  try {
    for (const v of PLAN) {
      if (only && !only.includes(v.role)) continue;
      const desktop = await contextFor(browser, v, {});
      for (const p of v.paths) await visit(await desktop.newPage(), v, p, "desktop");
      await desktop.close();
      const mobile = await contextFor(browser, v, { mobile: true });
      for (const p of v.paths) await visit(await mobile.newPage(), v, p, "mobile");
      await mobile.close();
      if (v.dark?.length) {
        const dark = await contextFor(browser, v, { dark: true });
        for (const p of v.dark) await visit(await dark.newPage(), v, p, "dark");
        await dark.close();
      }
    }
    if (!only || only.includes("super_admin")) await tryInteractions(browser);
  } finally {
    await browser.close();
  }
  const bad = findings.filter((f) => f.problems.length);
  const badInteractions = interactions.filter((i) => !i.ok);
  const out = { base, at: new Date().toISOString(), pages: findings.length, bad: bad.length, findings, interactions };
  if (shots) writeFileSync(path.join(shots, "report.json"), JSON.stringify(out, null, 2));
  console.log(`\n${findings.length - bad.length} of ${findings.length} page views clean; ${interactions.length - badInteractions.length} of ${interactions.length} interactions passed`);
  process.exit(bad.length || badInteractions.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
