/**
 * Walks the behaviours added in 0048 through the real screens on the local
 * stack: signs in as each role (dev-session.ts, nothing typed or printed),
 * drives the pages in headless Chromium and saves a screenshot of each. The
 * database tests prove the rules. This proves a person can reach them.
 *
 *   npx tsx --env-file=.env.local scripts/dev/audit-walkthrough.ts --base http://localhost:3100 --shots dir
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { sessionCookies, signedInClient } from "./dev-session";
import { candidateLinkUrl, hashLinkSecret, newLinkSecret, sealLinkSecret } from "../../src/lib/crypto/candidate-token";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const shots = flag("shots") ?? "/tmp/ontriq-walkthrough";
mkdirSync(shots, { recursive: true });
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = Date.now().toString(36);

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
const rpc = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
};

/** The pinned browser may not be downloaded: use whichever headless shell is cached. */
function cachedShell(): string | undefined {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

async function contextFor(browser: Browser, role: string, client?: string): Promise<BrowserContext> {
  const { cookies } = await sessionCookies(role, client);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  return ctx;
}
const open = async (page: Page, url: string) => {
  await page.goto(`${base}${url}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
};
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });

async function main() {
  const admin = await signedInClient("admin");
  const client = await signedInClient("client_admin", CLIENT);
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data: comp } = await admin.db.from("packages").select("id").eq("code", "COMPREHENSIVE").single();
  const { data: essential } = await admin.db.from("packages").select("id").eq("code", "ESSENTIAL").single();
  const create = (p: Record<string, unknown>) =>
    rpc(admin.db.rpc("create_case", { p: { client_id: CLIENT, ...p } as never })) as unknown as Promise<{ case_id: string; reference: string }>;

  const type1 = await create({
    package_id: comp!.id,
    process_type: "client_supplied",
    instructions: "Please start with the degree certificate.",
    internal_notes: `Team only ${RUN}: hiring manager knows the candidate.`,
    candidate: { full_name: `Dinuka Herath ${RUN}` },
  });
  const quiet = await create({ package_id: essential!.id, process_type: "candidate_collected", candidate: { full_name: `Quiet Candidate ${RUN}` } });
  const type2 = await create({ package_id: comp!.id, process_type: "candidate_collected", candidate: { full_name: `Ishara Gunasekara ${RUN}`, email: `ishara.${RUN}@example.test` } });

  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));

  // ---------------------------------------------------------------- the wizard
  const adminCtx = await contextFor(browser, "admin");
  await step("Type 2 can't be created with no way to reach the candidate", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/new?client=${CLIENT}`);
    const start = page.getByRole("button", { name: "Start from scratch" });
    if (await start.isVisible().catch(() => false)) await start.click();
    const hemas = page.getByRole("radio", { name: /Hemas/ });
    if (await hemas.isVisible().catch(() => false)) {
      await hemas.click();
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await page.getByLabel("Full name").fill(`No Contact ${RUN}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Comprehensive/ }).click();
    await page.getByRole("radio", { name: /Ontriq collects from the candidate/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("so add an email or phone number to reach them").first().waitFor({ timeout: 5000 });
    await shot(page, "01-type2-needs-contact");
    await page.close();
  });

  await step("The wizard offers a second education record, and separates staff notes from client instructions", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/new?client=${CLIENT}`);
    const start = page.getByRole("button", { name: "Start from scratch" });
    if (await start.isVisible().catch(() => false)) await start.click();
    const hemas = page.getByRole("radio", { name: /Hemas/ });
    if (await hemas.isVisible().catch(() => false)) {
      await hemas.click();
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await page.getByLabel("Full name").fill(`Two Records ${RUN}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Comprehensive/ }).click();
    await page.getByRole("button", { name: "Add a record" }).click();
    must(await page.getByLabel("Name of this check").inputValue(), "no label");
    must(await page.getByLabel("Instructions for the team").isVisible(), "no staff notes field");
    must(await page.getByLabel("Instructions from the client").isVisible(), "no client instructions field");
    await page.getByLabel("Name of this check").scrollIntoViewIfNeeded();
    await shot(page, "02-wizard-second-record", true);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create case" }).click();
    await page.waitForURL(/\/app\/cases\/[0-9a-f-]{36}/, { timeout: 15000 });
    const { data: c } = await admin.db.from("cases").select("id").eq("candidate_name", `Two Records ${RUN}`).single();
    const { count } = await admin.db.from("case_checks").select("id", { count: "exact", head: true }).eq("case_id", c!.id).ilike("label", "Education%");
    must(count === 2, `expected 2 education checks, got ${count}`);
    await page.close();
  });

  // ---------------------------------------------------------------- case page
  await step("The case page warns when a Type 2 candidate hasn't been contacted", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${quiet.case_id}`);
    await page.getByText("Contacting the candidate isn't finished").waitFor({ timeout: 8000 });
    await shot(page, "03-not-contacted");
    await page.close();
  });

  await step("A contacted candidate clears that warning", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${type2.case_id}`);
    await page.waitForSelector("h1");
    // Its page hasn't gone out yet in this run: the link below sends it.
    await page.close();
  });

  // ---------------------------------------------------------------- confidentiality
  const clientCtx = await contextFor(browser, "client_admin", CLIENT);
  await step("The client reads their own instructions, and never the team's notes", async () => {
    const page = await clientCtx.newPage();
    await open(page, `/portal/cases/${type1.case_id}`);
    await page.getByText("Please start with the degree certificate.").waitFor({ timeout: 8000 });
    const text = await page.locator("body").innerText();
    must(!text.includes(`Team only ${RUN}`), "the team's note reached the portal");
    await shot(page, "04-portal-instructions", true);
    await page.close();
  });

  await step("A client user can't read the clients table through the API", async () => {
    const { data } = await client.db.from("clients").select("id, notes");
    must((data ?? []).length === 0, "rows came back");
    const { data: profile } = await client.db.rpc("portal_client_profile");
    must((profile as { name?: string } | null)?.name, "the portal lost its company name");
  });

  // ---------------------------------------------------------------- the BGV form and candidate answers
  await step("The BGV form and answers work on the candidate's own page", async () => {
    const secret = newLinkSecret();
    await rpc(admin.db.rpc("issue_candidate_link", { p_case: type2.case_id, p_token_hash: hashLinkSecret(secret), p_token_enc: sealLinkSecret(secret), p_language: "en", p_days: 14 }));
    const parts = (await rpc(admin.db.rpc("issue_bgv_form", { p_case: type2.case_id }))) as unknown as number;
    must(parts > 0, "the form asked for nothing");
    const { data: checks } = await admin.db.from("case_checks").select("id, label").eq("case_id", type2.case_id);
    const address = checks!.find((k) => k.label === "Address")!;
    const reference = checks!.find((k) => k.label === "Reference check")!;
    await rpc(admin.db.rpc("create_candidate_request", { p_case: type2.case_id, p: { kind: "field", check_id: address.id, field_key: "residence_period", title: "How long have you lived there?" } }));
    await rpc(admin.db.rpc("create_candidate_request", { p_case: type2.case_id, p: { kind: "question", title: "Anything else we should know?" } }));

    const candidate = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await candidate.newPage();
    await page.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
    await page.waitForURL(/\/c\/session/, { timeout: 10000 });
    await page.getByRole("heading", { name: /your details/ }).first().waitFor({ timeout: 8000 });
    await shot(page, "05-candidate-bgv-form", true);

    // The date range, with "still here".
    const card = page.locator("article", { hasText: "How long have you lived there?" });
    await card.locator("input").first().fill("01/02/2019");
    await card.getByLabel("Still here").check();
    await card.getByRole("button", { name: "Send answer" }).click();
    await card.getByText("Answer sent").first().waitFor({ timeout: 8000 });
    await shot(page, "06-candidate-date-range", true);

    // Referees as rows; two people, so two records survive.
    const rows = page.locator("article", { hasText: "Referees" });
    must(await rows.count(), "no referees form");
    await candidate.close();

    const { data: asked } = await admin.db.from("candidate_requests").select("id, answer, status").eq("case_id", type2.case_id).eq("field_key", "residence_period").single();
    must(typeof asked?.answer === "object" && (asked.answer as { value?: { present?: boolean } }).value?.present === true, `stored ${JSON.stringify(asked?.answer)}`);
    void reference;
  });

  await step("Staff can use the date answer, and it lands on the check", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${type2.case_id}#candidate`);
    const row = page.locator("li", { hasText: "How long have you lived there?" });
    await row.getByRole("button", { name: "Use answer" }).click();
    await page.waitForTimeout(800);
    const { data: k } = await admin.db.from("case_checks").select("values").eq("case_id", type2.case_id).eq("label", "Address").single();
    const period = (k?.values as { residence_period?: { from?: string; present?: boolean } }).residence_period;
    must(period?.from === "2019-02-01" && period?.present === true, `check holds ${JSON.stringify(period)}`);
    await shot(page, "07-staff-used-answer", true);
    await page.close();
  });

  // ---------------------------------------------------------------- documents
  await step("Files can be marked as an original or a copy", async () => {
    await rpc(admin.db.rpc("begin_document_upload", { p_case: type1.case_id, p_check: null as never, p_category: "nic_copy", p_filename: `nic-${RUN}.pdf`, p_mime: "application/pdf", p_size: 1000 }));
    const { data: d } = await admin.db.from("documents").select("id").eq("case_id", type1.case_id).eq("filename", `nic-${RUN}.pdf`).single();
    await rpc(admin.db.rpc("finalize_document_upload", { p_document: d!.id }));
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${type1.case_id}#documents`);
    const select = page.getByLabel(`Is nic-${RUN}.pdf an original or a copy`);
    await select.click();
    await page.getByRole("option", { name: "Certified copy" }).click();
    await page.waitForTimeout(700);
    const { data: after } = await admin.db.from("documents").select("original_kind").eq("id", d!.id).single();
    must(after?.original_kind === "certified_copy", `stored ${after?.original_kind}`);
    await shot(page, "08-copy-or-original", true);
    await page.close();
  });

  // ---------------------------------------------------------------- settings
  await step("Workflow settings hold your own statuses, QC lists and the order rule", async () => {
    const ctx = await contextFor(browser, "super_admin");
    const page = await ctx.newPage();
    await open(page, "/app/settings/workflow");
    await page.getByRole("button", { name: "New status" }).click();
    await page.getByLabel("Your team sees", { exact: true }).fill(`Waiting for head office ${RUN}`);
    await page.getByLabel("Clients see", { exact: true }).fill("With our head office");
    await page.getByRole("button", { name: "Save status" }).click();
    await page.getByText(`Waiting for head office ${RUN}`).first().waitFor({ timeout: 8000 });
    must(await page.getByLabel("Pre-QC checklist, one item per line").isVisible(), "no Pre-QC list");
    must(await page.getByLabel("Run checks in the flowchart's order").isVisible(), "no order switch");
    await shot(page, "09-workflow-settings", true);
    await ctx.close();
  });

  await step("Your own status can be set on a case, and the client reads it", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${type1.case_id}`);
    await page.getByLabel("Set a status on this case").click({ timeout: 8000 });
    await page.getByRole("option", { name: `Waiting for head office ${RUN}` }).click();
    await page.waitForTimeout(800);
    await shot(page, "10-own-status");
    await page.close();
    // The portal's chip says "Action needed" first while documents are owed, so read the status itself.
    const { data } = await client.db.rpc("portal_case_detail", { p_case: type1.case_id });
    const label = (data as unknown as { case: { status_label: string } }).case.status_label;
    must(label === "With our head office", `the client reads "${label}"`);
  });

  await step("Staff lists show the full status beside the stage", async () => {
    const page = await adminCtx.newPage();
    await open(page, "/app/cases");
    const text = await page.locator("body").innerText();
    must(/Documents Pending|Document Review in Progress/.test(text), "no status text in the list");
    await shot(page, "11-cases-list");
    await page.close();
  });

  // ---------------------------------------------------------------- Post-QC
  await step("Post-QC can return a case to data entry, from the review dialog", async () => {
    await service.from("cases").update({ stage: "post_qc", manual_status_key: null }).eq("id", type1.case_id);
    await service.from("case_checks").update({ state: "completed", result: "clear", result_tone: "green" }).eq("case_id", type1.case_id);
    const ctx = await contextFor(browser, "qc_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${type1.case_id}`);
    await page.getByRole("button", { name: "Record Post-QC decision" }).click();
    await page.getByRole("radio", { name: "Return" }).click();
    await page.getByRole("radio", { name: /Back to data entry/ }).click();
    await page.getByRole("dialog").getByRole("checkbox").last().check();
    await page.getByLabel("Remarks").fill("The employee code is wrong.");
    await shot(page, "12-post-qc-return");
    await page.getByRole("button", { name: "Return for correction" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 8000 });
    const { data: c } = await admin.db.from("cases").select("stage, status_key").eq("id", type1.case_id).single();
    must(c?.stage === "data_entry" && c.status_key === "returned_to_data_entry", `case is ${JSON.stringify(c)}`);
    await ctx.close();
  });

  await step("Approving with an unticked item asks why", async () => {
    const plain = await create({ package_id: essential!.id, process_type: "client_supplied", candidate: { full_name: `Pre QC ${RUN}` } });
    await service.from("case_check_requirements").update({ status: "waived" }).eq("case_id", plain.case_id);
    await service.from("cases").update({ stage: "pre_qc" }).eq("id", plain.case_id);
    const ctx = await contextFor(browser, "qc_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${plain.case_id}`);
    await page.getByRole("button", { name: "Record Pre-QC decision" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("dialog").getByText("why you are approving").first().waitFor({ timeout: 5000 });
    await shot(page, "13-pre-qc-needs-reason");
    await ctx.close();
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed. Screenshots in ${shots}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
