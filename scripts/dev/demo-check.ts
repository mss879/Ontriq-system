/**
 * Walks the demo in a real browser as each hand-over sign-in: signs in with
 * the email and password from the logins file (session cookies go straight
 * into the browser; nothing is printed), opens the pages that sign-in should
 * use and records errors, error pages, sideways scrolling and whether the
 * seeded data shows.
 *
 *   npx tsx scripts/dev/demo-check.ts --env .env.hosted --logins demo-logins.local.md --base http://localhost:3200 --shots dir
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { chromium, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
loadEnvFile(arg("env") ?? ".env.hosted");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const base = (arg("base") ?? "http://localhost:3200").replace(/\/+$/, "");
const shots = arg("shots");

const rows = [...readFileSync(arg("logins") ?? "demo-logins.local.md", "utf8").matchAll(/\| (.+?) \| `(.+?)` \| `(.+?)` \|/g)].map((m) => ({ who: m[1], email: m[2], password: m[3] }));
const PLAN: { match: RegExp; name: string; pages: [string, string][] }[] = [
  {
    match: /^Admin/,
    name: "admin",
    pages: [
      ["/app", "Active cases by stage"], ["/app/queues", "Pre-QC"], ["/app/cases", "ONT-2026"], ["/app/clients", "Lanka Horizon"], ["/app/candidates", "NIC"], ["/app/reports", "ONT-2026"],
      ["/app/quotes", "QT-2026"], ["/app/invoices", "INV-2026"], ["/app/payments", "Payments"], ["/app/team/performance", "Nimal Fernando"], ["/app/analytics", "Cases per week"], ["/app/analytics?tab=revenue", "Outstanding"], ["/app/analytics?tab=ai", "AI"], ["/app/audit", "Audit"],
    ],
  },
  { match: /^(Staff|Verification Officer)/, name: "staff", pages: [["/app", "Good"], ["/app/queues", "ONT-2026"], ["/app/cases", "ONT-2026"], ["/app/team/performance", "scorecard"]] },
  { match: /^Client (portal|Admin: Lanka)/, name: "client", pages: [["/portal", "Lanka Horizon"], ["/portal/cases", "ONT-2026"], ["/portal/cases/new", "New request"], ["/portal/reports", "ONT-2026"], ["/portal/quotes", "QT-2026"], ["/portal/invoices", "INV-2026"], ["/portal/packages", "Packages"], ["/portal/team", "Dilani"]] },
];

function shell() {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
}

async function cookiesFor(email: string, password: string) {
  const db = createClient(url, publishable, { auth: { persistSession: false } });
  const s = await db.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`sign-in failed for ${email}: ${s.error?.message}`);
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, publishable, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  await ssr.auth.setSession({ access_token: s.data.session.access_token, refresh_token: s.data.session.refresh_token });
  return [...jar].map(([name, value]) => ({ name, value }));
}

async function walk(browser: Browser, name: string, email: string, password: string, pages: [string, string][]) {
  const cookies = await cookiesFor(email, password);
  console.log(`ok  ${name}: signed in with the password`);
  let bad = 0;
  for (const [view, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies(cookies.map((c) => ({ ...c, url: base })));
    for (const [p, expect] of pages) {
      const page = await ctx.newPage();
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 160)}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !/favicon|realtime|WebSocket/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`);
      });
      page.on("response", (r) => {
        if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
      });
      await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 60_000 }).catch((e) => problems.push(`navigation: ${String(e).split("\n")[0]}`));
      await page.waitForTimeout(300);
      const body = await page.locator("body").innerText().catch(() => "");
      if (/Application error|This page couldn.t load|Something went wrong/i.test(body)) problems.push("error page");
      if (/\b(undefined|NaN|\[object Object\])\b/.test(body)) problems.push("odd text on the page");
      if (!body.toLowerCase().includes(expect.toLowerCase())) problems.push(`missing "${expect}"`);
      const final = new URL(page.url()).pathname;
      if (final !== p.split("?")[0]) problems.push(`sent to ${final}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
      if (overflow > 1) problems.push(`scrolls sideways by ${overflow}px`);
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `${name}${p.replace(/[^a-z0-9]+/gi, "_")}_${view}.png`), fullPage: view === "desktop" }).catch(() => undefined);
      }
      if (problems.length) bad++;
      console.log(`${problems.length ? "BAD" : "ok "} ${name} ${view} ${p}${problems.length ? `\n      ${problems.join("\n      ")}` : ""}`);
      await page.close();
    }
    await ctx.close();
  }
  return bad;
}

async function main() {
  // --extra /app/cases/<id>,/app/cases/<id>: more pages for the admin.
  for (const p of arg("extra")?.split(",") ?? []) PLAN[0].pages.push([p, "ONT-2026"]);
  const browser = await chromium.launch({ executablePath: shell() });
  let bad = 0;
  for (const plan of PLAN) {
    const row = rows.find((r) => plan.match.test(r.who));
    if (!row) throw new Error(`no sign-in for ${plan.name} in the logins file`);
    bad += await walk(browser, plan.name, row.email, row.password, plan.pages);
  }
  await browser.close();
  console.log(bad ? `\n${bad} page view(s) with problems` : "\nAll page views clean");
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
