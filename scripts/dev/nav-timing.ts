/**
 * Times menu clicks the way a person makes them: hover, click, wait. Signs in as
 * a role on the local stack (cookies from dev-session.ts, nothing typed or
 * printed) and walks the menu twice: first visits, then a quick return to pages
 * already seen. Each click reports when the screen changed, when the real data
 * arrived, and which requests went out.
 *
 * Local requests answer in milliseconds, which hides what people wait for on
 * live, so requests a Netlify function would serve are held back by --function-ms
 * and those a CDN could serve by --cdn-ms. The defaults are medians measured from
 * Colombo. Start the server with the `next-start-timing` launch config and pass
 * its log as --db-log to count database calls per click.
 *
 *   npx tsx --env-file=.env.local scripts/dev/nav-timing.ts --base http://localhost:3100 --role super_admin --db-log <file> --out before.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Page, type Request, type Route } from "@playwright/test";
import { sessionCookies } from "./dev-session";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const role = flag("role") ?? "super_admin";
const client = flag("client");
const out = flag("out");
const dbLog = flag("db-log");
const functionMs = Number(flag("function-ms") ?? 250);
const cdnMs = Number(flag("cdn-ms") ?? 50);
const hoverMs = Number(flag("hover-ms") ?? 150);

const isPortal = role.startsWith("client_") && role !== "client_relations";
const home = isPortal ? "/portal" : "/app";

type Kind = "navigation" | "runtime-prefetch" | "static-prefetch" | "server-other" | "asset";
const FUNCTION_KINDS: Kind[] = ["navigation", "runtime-prefetch", "server-other"];

function classify(req: Request): Kind {
  const url = new URL(req.url());
  const headers = req.headers();
  if (headers.rsc) {
    // 1 is the static shell. 2 and 3 are rendered per session on the server.
    const prefetch = headers["next-router-prefetch"];
    if (prefetch === "1") return "static-prefetch";
    return prefetch ? "runtime-prefetch" : "navigation";
  }
  if (req.isNavigationRequest()) return "navigation";
  if (url.pathname.startsWith("/api/") || req.method() === "POST") return "server-other";
  return "asset";
}

type Seen = { kind: Kind; path: string };
const seen: Seen[] = [];
const seenSince = (mark: number) => {
  const counts: Record<Kind, number> = { navigation: 0, "runtime-prefetch": 0, "static-prefetch": 0, "server-other": 0, asset: 0 };
  for (const s of seen.slice(mark)) counts[s.kind] += 1;
  return counts;
};

async function hold(route: Route) {
  const req = route.request();
  if (!req.url().startsWith(base)) return route.continue();
  const kind = classify(req);
  seen.push({ kind, path: new URL(req.url()).pathname });
  const wait = FUNCTION_KINDS.includes(kind) ? functionMs : kind === "static-prefetch" ? cdnMs : 0;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  return route.continue();
}

let dbCursor = 0;
function dbCallsSinceLast() {
  if (!dbLog || !existsSync(dbLog)) return { total: 0, membership: 0 };
  const lines = readFileSync(dbLog, "utf8").split("\n").filter(Boolean);
  const fresh = lines.slice(dbCursor);
  dbCursor = lines.length;
  return { total: fresh.length, membership: fresh.filter((l) => l.includes("/rpc/my_membership")).length };
}

/** Runs in the page: from each click, watches frames for the URL change and for the last skeleton to go. */
function installProbe() {
  type Probe = { href: string; at: number; screen: number | null; data: number | null; done: boolean };
  const state: { last: Probe | null } = { last: null };
  (window as unknown as { __nav: typeof state }).__nav = state;
  const region = () => document.querySelector('[data-slot="sidebar-inset"]') ?? document.querySelector("main") ?? document.body;
  const loading = () => [...region().querySelectorAll<HTMLElement>('[data-slot="skeleton"], .animate-pulse')].some((el) => el.offsetParent !== null);
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const probe: Probe = { href: new URL(link.href).pathname, at: performance.now(), screen: null, data: null, done: false };
      state.last = probe;
      let clear = 0;
      const tick = () => {
        if (state.last !== probe) return;
        const now = performance.now();
        if (location.pathname === probe.href) {
          probe.screen ??= now - probe.at;
          clear = loading() ? 0 : clear + 1;
          if (clear >= 3) {
            probe.data = now - probe.at;
            probe.done = true;
            return;
          }
        }
        if (now - probe.at > 12_000) {
          probe.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    true,
  );
}

type Row = {
  href: string;
  screenMs: number | null;
  dataMs: number | null;
  hover: Record<Kind, number>;
  click: Record<Kind, number>;
  db: { total: number; membership: number };
};

async function clickThrough(page: Page, hrefs: string[]) {
  const rows: Row[] = [];
  for (const href of hrefs) {
    const link = page.locator(`a[href="${href}"]:visible`).first();
    const beforeHover = seen.length;
    dbCallsSinceLast();
    await link.hover();
    await page.waitForTimeout(hoverMs);
    const hover = seenSince(beforeHover);
    const beforeClick = seen.length;
    await link.click({ noWaitAfter: true });
    await page.waitForFunction(() => (window as unknown as { __nav: { last: { done: boolean } | null } }).__nav.last?.done === true, undefined, { timeout: 14_000 });
    // Let trailing streamed sections and their database calls land.
    await page.waitForTimeout(200);
    const probe = await page.evaluate(() => (window as unknown as { __nav: { last: { screen: number | null; data: number | null } } }).__nav.last);
    rows.push({ href, screenMs: probe.screen === null ? null : Math.round(probe.screen), dataMs: probe.data === null ? null : Math.round(probe.data), hover, click: seenSince(beforeClick), db: dbCallsSinceLast() });
  }
  return rows;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function report(label: string, rows: Row[]) {
  console.info(`\n${label}`);
  console.info(`${"page".padEnd(26)}${"screen".padStart(8)}${"data".padStart(8)}${"hover:fn".padStart(10)}${"hover:cdn".padStart(11)}${"click:fn".padStart(10)}${"db".padStart(5)}${"member".padStart(8)}`);
  for (const r of rows) {
    const fn = (c: Record<Kind, number>) => sum(FUNCTION_KINDS.map((k) => c[k]));
    console.info(`${r.href.padEnd(26)}${String(r.screenMs ?? "-").padStart(8)}${String(r.dataMs ?? "timeout").padStart(8)}${String(fn(r.hover)).padStart(10)}${String(r.hover["static-prefetch"]).padStart(11)}${String(fn(r.click)).padStart(10)}${String(r.db.total).padStart(5)}${String(r.db.membership).padStart(8)}`);
  }
  const done = rows.filter((r) => r.dataMs !== null);
  console.info(
    `median screen ${median(done.map((r) => r.screenMs ?? 0))} ms, median data ${median(done.map((r) => r.dataMs ?? 0))} ms, ` +
      `function calls from hover ${sum(rows.map((r) => r.hover.navigation + r.hover["runtime-prefetch"] + r.hover["server-other"]))}, ` +
      `function calls from clicks ${sum(rows.map((r) => r.click.navigation + r.click["runtime-prefetch"] + r.click["server-other"]))}, ` +
      `database calls ${sum(rows.map((r) => r.db.total))}, membership checks ${sum(rows.map((r) => r.db.membership))}`,
  );
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
  const { cookies } = await sessionCookies(role, client);
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
    // tsx wraps named functions in a __name() helper that doesn't exist in the page.
    await context.addInitScript("globalThis.__name = (fn) => fn");
    await context.addInitScript(installProbe);
    await context.route("**/*", hold);
    const page = await context.newPage();
    await page.goto(`${base}${home}`, { waitUntil: "load" });
    await page.waitForFunction(() => ![...document.querySelectorAll<HTMLElement>('[data-slot="skeleton"], .animate-pulse')].some((el) => el.offsetParent !== null), undefined, { timeout: 15_000 }).catch(() => undefined);
    // Time for whatever the page prefetches on its own.
    await page.waitForTimeout(2500);
    const onLoad = seenSince(0);
    const selector = isPortal ? "header a[href^='/portal']" : "a[data-slot='sidebar-menu-button'][href^='/app']";
    const menu = await page.locator(selector).evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    // The page we start on goes last, since clicking its own link does nothing.
    const hrefs = [...new Set(menu)].filter((h) => h && h !== home).concat(home);
    const first = await clickThrough(page, hrefs);
    const repeat = await clickThrough(page, hrefs);
    console.info(`\n${role} at ${base}: function ${functionMs} ms, CDN ${cdnMs} ms, hover ${hoverMs} ms`);
    console.info(`after load: ${onLoad.navigation} navigation, ${onLoad["runtime-prefetch"]} session prefetch, ${onLoad["static-prefetch"]} static prefetch, ${onLoad["server-other"]} other server`);
    report("first visit", first);
    report("reopening within 30 s", repeat);
    if (out) writeFileSync(out, JSON.stringify({ role, base, functionMs, cdnMs, onLoad, first, repeat }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
