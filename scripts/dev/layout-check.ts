/**
 * Catches tables that don't fit: signs in with the demo logins and opens the
 * list pages at common screen widths, flagging any table wider than its card
 * and any page that scrolls sideways. A wide table can't scroll inside its card
 * and keep a sticky header, so this is the check that keeps both true.
 *
 *   npx tsx scripts/dev/layout-check.ts --env .env.hosted --logins demo-logins.local.md --base http://localhost:3200
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { chromium } from "@playwright/test";
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
const WIDTHS = [768, 1024, 1280, 1366, 1440, 1536, 1728, 1920];
const PAGES = ["/app/cases", "/app/clients", "/app/candidates", "/app/reports", "/app/quotes", "/app/invoices", "/app/payments", "/app/team", "/app/team/performance", "/app/audit"];

const rows = [...readFileSync(arg("logins") ?? "demo-logins.local.md", "utf8").matchAll(/\| (.+?) \| `(.+?)` \| `(.+?)` \|/g)].map((m) => ({ who: m[1], email: m[2], password: m[3] }));

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
  if (s.error || !s.data.session) throw new Error(`sign-in failed: ${s.error?.message}`);
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, publishable, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  await ssr.auth.setSession({ access_token: s.data.session.access_token, refresh_token: s.data.session.refresh_token });
  return [...jar].map(([name, value]) => ({ name, value }));
}

async function main() {
  const admin = rows.find((r) => /^Admin/.test(r.who));
  if (!admin) throw new Error("no admin sign-in in the logins file");
  const cookies = await cookiesFor(admin.email, admin.password);
  const browser = await chromium.launch({ executablePath: shell() });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies.map((c) => ({ ...c, url: base })));
  const page = await ctx.newPage();
  let bad = 0;
  for (const p of PAGES) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 60_000 });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const table of document.querySelectorAll("table")) {
          if (!table.checkVisibility()) continue;
          const card = table.closest("section");
          if (!card) continue;
          const over = Math.round(table.getBoundingClientRect().width - card.getBoundingClientRect().width);
          if (over > 1) out.push(`table is ${over}px wider than its card`);
        }
        const root = document.documentElement;
        if (root.scrollWidth - root.clientWidth > 1) out.push(`page scrolls sideways by ${root.scrollWidth - root.clientWidth}px`);
        const inset = document.querySelector("[data-slot=sidebar-inset]");
        if (inset && inset.scrollWidth - inset.clientWidth > 1) out.push(`content scrolls sideways by ${inset.scrollWidth - inset.clientWidth}px`);
        return out;
      });
      if (problems.length) {
        bad++;
        console.log(`BAD ${p} at ${width}px: ${problems.join("; ")}`);
      }
    }
  }
  await browser.close();
  console.log(bad ? `\n${bad} problem(s)` : `\nAll ${PAGES.length} pages fit at ${WIDTHS.length} widths`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
