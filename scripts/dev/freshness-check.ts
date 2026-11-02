/**
 * Speed shouldn't cost correctness. On the local stack, in a real browser, this
 * checks that a click shows the page's shell before the server answers, that a
 * quick return makes no server call, that your own changes show at once even on
 * a page kept in the browser, that a quote draft survives a quick return, and
 * that signing out leaves nothing for the next person. Rows it adds are removed.
 *
 *   npx tsx --env-file=.env.local scripts/dev/freshness-check.ts --base http://localhost:3100 [--shots dir]
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, expect, type Browser, type Page, type Request } from "@playwright/test";
import pg from "pg";
import { sessionCookies } from "./dev-session";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const shots = flag("shots");
if (shots) mkdirSync(shots, { recursive: true });
const CLIENT = flag("client") ?? "e013c3bb-1bff-4e5c-b013-3821970e6785";
const db = new pg.Client({ connectionString: "postgresql://postgres@127.0.0.1:55433/ontriq" });

const results: { name: string; ok: boolean; detail: string }[] = [];
async function check(name: string, run: () => Promise<string>) {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error) });
  }
}

/** Requests that would run on a function, for spotting a click that reached the server. */
const isServerCall = (req: Request) => req.url().startsWith(base) && Boolean(req.headers().rsc) && req.headers()["next-router-prefetch"] !== "1";

async function signedIn(browser: Browser, role: string, client?: string, delayMs = 0) {
  const { cookies } = await sessionCookies(role, client);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  if (delayMs) {
    await context.route("**/*", async (route) => {
      if (isServerCall(route.request())) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return route.continue();
    });
  }
  const page = await context.newPage();
  return { context, page };
}

const menuLink = (page: Page, href: string) => page.locator(`a[href="${href}"]:visible`).first();

/** Clicks a menu link and returns how many server calls the click caused. */
async function clickAndCount(page: Page, href: string, waitMs = 500) {
  let calls = 0;
  const onRequest = (req: Request) => {
    if (isServerCall(req)) calls += 1;
  };
  page.on("request", onRequest);
  await menuLink(page, href).click();
  await page.waitForURL((url) => url.pathname === href);
  await page.waitForTimeout(waitMs);
  page.off("request", onRequest);
  return calls;
}

async function shellOnClick(browser: Browser, role: string, home: string, href: string, heading: string, client?: string) {
  const { context, page } = await signedIn(browser, role, client, 2000);
  await page.goto(`${base}${home}`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const started = Date.now();
  await menuLink(page, href).click();
  await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible({ timeout: 900 });
  const shown = Date.now() - started;
  if (shots) await page.screenshot({ path: path.join(shots, `shell-${role}.png`) });
  await context.close();
  return `"${heading}" on screen ${shown} ms after the click, with the server held back 2 s`;
}

async function quickReturn(browser: Browser) {
  const { context, page } = await signedIn(browser, "super_admin");
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const first = await clickAndCount(page, "/app/clients");
  await clickAndCount(page, "/app/team");
  const again = await clickAndCount(page, "/app/clients");
  if (first !== 1) throw new Error(`first visit made ${first} server calls, expected 1`);
  if (again !== 0) throw new Error(`a quick return made ${again} server calls, expected 0`);
  await page.waitForTimeout(31_000);
  await clickAndCount(page, "/app/team");
  await page.waitForTimeout(31_000);
  const later = await clickAndCount(page, "/app/clients");
  if (later !== 1) throw new Error(`a return after 30 s made ${later} server calls, expected 1`);
  await context.close();
  return "first visit 1 server call, quick return 0, return after 30 s 1";
}

async function ownChangeShows(browser: Browser) {
  const name = `Zz Speed Check ${Date.now()}`;
  const { context, page } = await signedIn(browser, "super_admin");
  try {
    await page.goto(`${base}/app/clients`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    // Leave and come back, so the list is a page kept in the browser.
    await clickAndCount(page, "/app/team");
    await clickAndCount(page, "/app/clients");
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Company name").fill(name);
    await page.getByLabel("Client code").fill(`Z${Date.now() % 100000}`);
    await page.getByRole("button", { name: "Add client" }).click();
    await page.waitForURL((url) => /\/app\/clients\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 10_000 });
    await menuLink(page, "/app/clients").click();
    await page.waitForURL((url) => url.pathname === "/app/clients");
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 5000 });
    return "a new client shows in the list straight after adding it";
  } finally {
    await db.query("delete from public.clients where name = $1", [name]);
    await context.close();
  }
}

async function quoteDraftSurvives(browser: Browser) {
  const { rows } = await db.query<{ id: string; title: string }>("select id, title from public.quotes where status = 'draft' limit 1");
  if (!rows[0]) throw new Error("the local data has no draft quote");
  const { id, title } = rows[0];
  const edited = `Speed check ${Date.now()}`;
  const { context, page } = await signedIn(browser, "super_admin");
  try {
    await page.goto(`${base}/app/quotes/${id}`, { waitUntil: "load" });
    // Typing before the page hydrates wouldn't reach the builder.
    await page.waitForTimeout(1000);
    await page.getByLabel("Title", { exact: true }).fill(edited);
    await expect(page.getByText(/Saved \d/).first()).toBeVisible({ timeout: 8000 });
    // Four other pages, so the browser no longer keeps this one mounted.
    for (const href of ["/app/clients", "/app/team", "/app/cases", "/app/reports", "/app/quotes"]) await clickAndCount(page, href, 150);
    await page.locator(`a[href="/app/quotes/${id}"]:visible`).first().click();
    await page.waitForURL((url) => url.pathname === `/app/quotes/${id}`);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(edited, { timeout: 5000 });
    return "an edited draft reopened through four other pages shows the edit";
  } finally {
    await db.query("update public.quotes set title = $1 where id = $2", [title, id]);
    await context.close();
  }
}

async function signOutLeavesNothing(browser: Browser) {
  const { context, page } = await signedIn(browser, "super_admin");
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await expect(menuLink(page, "/app/team")).toBeVisible();
  await clickAndCount(page, "/app/audit");
  const menu = page.locator("[data-slot='sidebar-footer'] button").first();
  await menu.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 10_000 });
  const { cookies } = await sessionCookies("verification_officer");
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await expect(page.locator("a[data-slot='sidebar-menu-button'][href='/app/queues']").first()).toBeVisible();
  const leaked = await page.locator("a[href='/app/team'], a[href='/app/audit']").count();
  await context.close();
  if (leaked) throw new Error("the next person's menu still shows the admin's items");
  return "the next person sees only their own menu";
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
  await db.connect();
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
  const only = flag("only");
  const wanted = (name: string) => !only || name.includes(only);
  try {
    if (wanted("staff click")) await check("staff click shows the page shell at once", () => shellOnClick(browser, "super_admin", "/app", "/app/cases", "Cases"));
    if (wanted("portal click")) await check("portal click shows the page shell at once", () => shellOnClick(browser, "client_admin", "/portal", "/portal/reports", "Reports", CLIENT));
    if (wanted("own change")) await check("your own change shows at once", () => ownChangeShows(browser));
    if (wanted("quote draft")) await check("a quote draft survives a quick return", () => quoteDraftSurvives(browser));
    if (wanted("signing out")) await check("signing out leaves nothing behind", () => signOutLeavesNothing(browser));
    if (wanted("quick return")) await check("quick returns reuse the page, slow ones refetch", () => quickReturn(browser));
  } finally {
    await browser.close();
    await db.end();
  }
  for (const r of results) console.info(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
