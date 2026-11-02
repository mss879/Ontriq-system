/**
 * Takes a real case from draft to release through the screens, each step signed
 * in as the role that does it, then reads the result as the client. It also
 * opens the screens the final rules changed. Needs the demo data on the local
 * stack (scripts/seed-demo.ts). Saves a screenshot of every step.
 *
 *   npx tsx --env-file=.env.local scripts/dev/final-walkthrough.ts --base http://localhost:3100 --shots dir
 * Add --only "pattern" to run the steps whose names match.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { sessionCookies, signedInClient } from "./dev-session";
import { reportRefused, watchServerActions } from "./firewall-guard";
import { candidateLinkUrl, hashLinkSecret, newLinkSecret, sealLinkSecret } from "../../src/lib/crypto/candidate-token";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? "http://localhost:3100").replace(/\/+$/, "");
const shots = flag("shots") ?? "/tmp/ontriq-final-walkthrough";
mkdirSync(shots, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const only = flag("only");
async function step(name: string, run: () => Promise<string | void>) {
  if (only && !new RegExp(only).test(name)) return;
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
const RUN = Date.now().toString(36);

function cachedShell(): string | undefined {
  const dir = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const bin = path.join(dir, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

async function contextFor(browser: Browser, role: string, client?: string, width = 1440): Promise<BrowserContext> {
  const { cookies } = await sessionCookies(role, client);
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: base })));
  watchServerActions(ctx);
  return ctx;
}
const open = async (page: Page, url: string) => {
  await page.goto(`${base}${url}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
};
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });
/** The local stack has no Realtime, so a person's page reloads here when the worker finishes. */
async function untilVisible(page: Page, name: string | RegExp, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const button = page.getByRole("button", { name });
    if (await button.isVisible().catch(() => false)) return button;
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }
  throw new Error(`no ${name} button after ${tries} tries`);
}

async function main() {
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data: demo } = await service.from("clients").select("id, code").like("notes", "[demo-seed]%");
  must(demo?.length, "no demo data: run scripts/seed-demo.ts first");
  const inClient = async (stage: string, extra: (q: ReturnType<typeof caseQuery>) => ReturnType<typeof caseQuery> = (q) => q) =>
    (await extra(caseQuery(stage).in("client_id", demo!.map((c) => c.id))).limit(1).maybeSingle()).data;
  const caseQuery = (stage: string) => service.from("cases").select("id, reference, client_id, candidate_name, on_hold").eq("stage", stage).eq("on_hold", false);

  const reportCase = await inClient("report");
  must(reportCase, "no demo case at the report stage");
  // Sinhala and Tamil in the report, the way a staff note would carry them.
  const { data: firstCheck } = await service.from("case_checks").select("id").eq("case_id", reportCase!.id).order("sort").limit(1).single();
  await service.from("case_checks").update({ client_note: "අධ්‍යාපන සහතිකය තහවුරු කරන ලදී. கல்விச் சான்றிதழ் உறுதிப்படுத்தப்பட்டது." }).eq("id", firstCheck!.id);
  const client = reportCase!.client_id;

  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: cachedShell() }));
  const opsCtx = await contextFor(browser, "operations_manager");
  const adminCtx = await contextFor(browser, "admin");
  const clientCtx = await contextFor(browser, "client_admin", client);

  let finalId = "";

  await step("Operations makes the draft and sends it for approval", async () => {
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${reportCase!.id}#report`);
    const generate = page.getByRole("button", { name: "Generate draft" });
    if (await generate.isVisible().catch(() => false)) await generate.click();
    const send = await untilVisible(page, "Send for approval");
    await shot(page, "01-draft-ready", true);
    await send.click();
    await page.getByText("is waiting for approval").first().waitFor({ timeout: 15_000 });
    await page.close();
  });

  await step("The approver sees the checks, the result and the sensitive-evidence question", async () => {
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${reportCase!.id}#report`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Final result").waitFor({ timeout: 8000 });
    await shot(page, "02-approve-dialog");
    const sensitive = dialog.getByText("This report holds sensitive evidence");
    if (await sensitive.isVisible()) {
      const approve = dialog.getByRole("button", { name: /Approve as/ });
      must(await approve.isDisabled(), "approve worked without answering the sensitive question");
      await dialog.locator("label", { hasText: "This report holds sensitive evidence" }).getByRole("checkbox").check();
      await shot(page, "03-approve-sensitive-ticked");
    }
    await dialog.getByRole("button", { name: /Approve as/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15_000 });
    const release = await untilVisible(page, /Release to client/);
    await shot(page, "04-approved-own-release-blocked", true);
    must(await release.isDisabled(), "the approver could release their own report");
    await page.close();
  });

  await step("A second person releases it to the client", async () => {
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${reportCase!.id}#report`);
    await page.getByRole("button", { name: /Release to client/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Release report" }).waitFor({ timeout: 8000 });
    await shot(page, "05-release-dialog");
    await dialog.getByRole("button", { name: "Release report" }).click();
    await page.getByText(/^Released to /).first().waitFor({ timeout: 15_000 });
    await shot(page, "06-released", true);
    const { data: v } = await service.from("report_versions").select("id, status, page_count, sha256, storage_path").eq("case_id", reportCase!.id).eq("kind", "final").order("version", { ascending: false }).limit(1).single();
    must(v?.status === "released", `final is ${v?.status}`);
    finalId = v!.id;
    const file = await service.storage.from("reports").download(v!.storage_path!);
    writeFileSync(path.join(shots, "released-report.pdf"), Buffer.from(await file.data!.arrayBuffer()));
    await page.close();
    return `${v!.page_count} pages`;
  });

  await step("The client finds it in their list, on the case and under Reports", async () => {
    const page = await clientCtx.newPage();
    await open(page, "/portal/cases");
    await page.getByText(reportCase!.reference).first().waitFor({ timeout: 8000 });
    await shot(page, "07-portal-case-list");
    await open(page, `/portal/cases/${reportCase!.id}`);
    await shot(page, "08-portal-released-case", true);
    await open(page, "/portal/reports");
    await page.getByText(reportCase!.reference).first().waitFor({ timeout: 8000 });
    await shot(page, "09-portal-reports");
    const res = await page.context().request.get(`${base}/api/reports/${finalId}?download=1`, { maxRedirects: 0 });
    must(res.status() === 200 || res.status() === 302, `download gave ${res.status()}`);
    await page.close();
  });

  await step("The portal list reads well on a phone", async () => {
    const ctx = await contextFor(browser, "client_admin", client, 390);
    const page = await ctx.newPage();
    await open(page, "/portal/cases");
    await shot(page, "10-portal-list-phone");
    must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the list scrolls sideways");
    await ctx.close();
  });

  await step("The public verify page confirms it", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await open(page, `/verify/${finalId}`);
    await page.getByText("Genuine report").first().waitFor({ timeout: 8000 });
    await shot(page, "11-verify-page", true);
    const text = await page.locator("body").innerText();
    must(!text.includes(reportCase!.candidate_name), "the public page shows the candidate's name");
    await ctx.close();
  });

  await step("A draft that went stale is refused, and the approver can send it back", async () => {
    const other = await inClient("report");
    must(other, "no second demo case at the report stage");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${other!.id}#report`);
    await page.getByRole("button", { name: "Generate draft" }).click();
    const send = await untilVisible(page, "Send for approval");
    await send.click();
    await page.getByText("is waiting for approval").first().waitFor({ timeout: 15_000 });
    await page.close();
    await service.from("case_checks").update({ client_note: "Corrected after the draft was made." }).eq("case_id", other!.id);
    const approver = await adminCtx.newPage();
    await open(approver, `/app/cases/${other!.id}#report`);
    await approver.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = approver.getByRole("dialog");
    await dialog.getByText("Final result").waitFor({ timeout: 8000 });
    const sensitive = dialog.locator("label", { hasText: "This report holds sensitive evidence" });
    if (await sensitive.isVisible()) await sensitive.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: /Approve as/ }).click();
    await dialog.getByRole("alert").waitFor({ timeout: 8000 });
    await shot(approver, "12-stale-draft-refused");
    await dialog.getByRole("button", { name: "Send back for a new draft" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    const { data: c } = await service.from("cases").select("stage").eq("id", other!.id).single();
    must(c?.stage === "report", `the case is at ${c?.stage}`);
    await approver.close();
  });

  await step("Staff who review a case see a locked file list after approval", async () => {
    const stuck = await inClient("approval");
    must(stuck, "no demo case at approval");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${stuck!.id}#documents`);
    await shot(page, "12b-documents-at-approval", true);
    await page.close();
  });

  await step("The documents panel offers its tools while files are being collected", async () => {
    const collecting = await inClient("documents");
    must(collecting, "no demo case collecting documents");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${collecting!.id}#documents`);
    await shot(page, "13-documents-collecting", true);
    await page.close();
  });

  await step("A case in verification shows its checks to the officer", async () => {
    const verifying = await inClient("verification");
    must(verifying, "no demo case in verification");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${verifying!.id}`);
    await shot(page, "14-verification-case", true);
    const { data: k } = await service.from("case_checks").select("id").eq("case_id", verifying!.id).order("sort").limit(1).single();
    await open(page, `/app/cases/${verifying!.id}/checks/${k!.id}`);
    await shot(page, "15-check-page", true);
    await page.close();
  });

  await step("The client sees an open case's checks and what they owe", async () => {
    const collecting = (await service.from("cases").select("id").eq("stage", "documents").eq("client_id", client).limit(1).maybeSingle()).data;
    const verifying = (await service.from("cases").select("id").eq("stage", "verification").eq("client_id", client).limit(1).maybeSingle()).data;
    const page = await clientCtx.newPage();
    if (collecting) {
      await open(page, `/portal/cases/${collecting.id}`);
      await shot(page, "16-portal-documents-case", true);
    }
    if (verifying) {
      await open(page, `/portal/cases/${verifying.id}`);
      await shot(page, "17-portal-verification-case", true);
    }
    await open(page, "/portal");
    await shot(page, "18-portal-home", true);
    await page.close();
    return `${collecting ? "collecting" : "no collecting case"}, ${verifying ? "verifying" : "no verifying case"}`;
  });

  await step("The stage boards and lists show the demo work", async () => {
    const page = await opsCtx.newPage();
    await open(page, "/app/cases");
    await shot(page, "19-cases-list");
    await open(page, "/app");
    await shot(page, "20-dashboard");
    await page.close();
  });

  await step("A QC officer sees the Pre-QC checklist from Settings", async () => {
    const preqc = await inClient("pre_qc");
    must(preqc, "no demo case at Pre-QC");
    const ctx = await contextFor(browser, "qc_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${preqc!.id}`);
    await page.getByRole("button", { name: "Record Pre-QC decision" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 8000 });
    await shot(page, "21-pre-qc-dialog");
    await ctx.close();
  });

  await step("The candidate's page reads in Sinhala and Tamil, with the form's own fields translated", async () => {
    const admin = await signedInClient("admin");
    const { data: pkg } = await admin.db.from("packages").select("id").eq("code", "COMPREHENSIVE").single();
    for (const [language, word, field] of [["si", "ඔබේ විස්තර", "ආයතනය"], ["ta", "உங்கள் விவரங்கள்", "நிறுவனம்"]] as const) {
      const made = (await rpc(admin.db.rpc("create_case", { p: { client_id: client, package_id: pkg!.id, process_type: "candidate_collected", candidate: { full_name: `Walkthrough ${language} ${RUN}`, email: `walk.${language}.${RUN}@example.test`, preferred_language: language } } as never }))) as unknown as { case_id: string };
      const secret = newLinkSecret();
      await rpc(admin.db.rpc("issue_candidate_link", { p_case: made.case_id, p_token_hash: hashLinkSecret(secret), p_token_enc: sealLinkSecret(secret), p_language: language, p_days: 14 }));
      await rpc(admin.db.rpc("issue_bgv_form", { p_case: made.case_id }));
      const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
      watchServerActions(ctx);
      const page = await ctx.newPage();
      await page.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
      await page.waitForURL(/\/c\/session/, { timeout: 10000 });
      await page.getByText(word).first().waitFor({ timeout: 8000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await shot(page, `22-candidate-${language}`, true);
      const text = await page.locator("body").innerText();
      must(text.includes(field), `no translated field label in ${language}`);
      await ctx.close();
    }
  });

  await step("A file can be moved, and withholding sensitive evidence asks why", async () => {
    const { data: rows } = await service.from("documents").select("case_id, filename, case:cases!inner(stage, on_hold, client_id)").eq("sensitive", true).eq("case.stage", "verification").eq("case.on_hold", false).in("case.client_id", demo!.map((c) => c.id)).limit(1);
    must(rows?.length, "no sensitive file on a demo case in verification");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${rows![0].case_id}#documents`);
    const name = rows![0].filename;
    await page.getByRole("button", { name: `More for ${name}` }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: `More for ${name}` }).click();
    await shot(page, "23-file-menu");
    await page.getByRole("menuitem", { name: /Move/ }).click();
    await page.getByRole("dialog").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await shot(page, "24-move-file");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 5000 });
    await page.getByLabel(`Who can see ${name}`).click();
    await page.getByRole("option", { name: /Internal/ }).click();
    await page.getByRole("dialog").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await shot(page, "25-withhold-reason");
    await page.close();
  });

  await step("A NIC on file under another name waits for a person to decide", async () => {
    const clientUser = await signedInClient("client_admin", client);
    const { data: known } = await service.from("candidates").select("nic, nic_canonical, full_name").not("nic_canonical", "is", null).eq("id", (await service.from("cases").select("candidate_id").eq("id", reportCase!.id).single()).data!.candidate_id).single();
    const { data: pkg } = await clientUser.db.from("packages").select("id").eq("code", "ESSENTIAL").single();
    const typed = `Typed Differently ${RUN}`;
    const made = (await rpc(clientUser.db.rpc("create_case", { p: { client_id: client, package_id: pkg!.id, process_type: "client_supplied", candidate: { full_name: typed, nic: known!.nic, nic_canonical: known!.nic_canonical } } as never }))) as unknown as { case_id: string };
    const { data: before } = await service.from("cases").select("candidate_match_open, candidate_id").eq("id", made.case_id).single();
    must(before?.candidate_match_open, "the case isn't waiting for a decision");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${made.case_id}`);
    await page.getByText("This NIC is already on file under another name").waitFor({ timeout: 8000 });
    await shot(page, "26-candidate-match");
    await page.getByRole("button", { name: "Different person" }).click();
    await page.getByText("Kept as a separate candidate").first().waitFor({ timeout: 8000 });
    const { data: after } = await service.from("cases").select("candidate_match_open, candidate_id, candidate_name").eq("id", made.case_id).single();
    must(!after?.candidate_match_open && after?.candidate_id !== before?.candidate_id && after?.candidate_name === typed, `case is ${JSON.stringify(after)}`);
    await page.close();
  });

  const portalReader = async (clientId: string) => contextFor(browser, "client_admin", clientId);

  await step("Needs info sends a real question, and the client reads what is needed", async () => {
    const { data: rows } = await service.from("cases").select("id, client_id, checks:case_checks(id, state)").eq("stage", "verification").eq("on_hold", false).eq("process_type", "client_supplied").in("client_id", demo!.map((c) => c.id));
    const row = (rows ?? []).map((r) => ({ ...r, open: (r.checks as { id: string; state: string }[]).find((k) => k.state === "in_progress") })).find((r) => r.open);
    must(row, "no demo case with an open check");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${row!.id}/checks/${row!.open!.id}`);
    await page.getByRole("button", { name: "Needs info" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What do you need?").fill(`Which branch did they work at? ${RUN}`);
    await page.waitForTimeout(300);
    await shot(page, "27-needs-info");
    await dialog.getByRole("button", { name: "Send the question" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    const { data: k } = await service.from("case_checks").select("state").eq("id", row!.open!.id).single();
    must(k?.state === "pending_info", `check is ${k?.state}`);
    await page.close();
    const ctx = await portalReader(row!.client_id);
    const portal = await ctx.newPage();
    await open(portal, `/portal/cases/${row!.id}`);
    await portal.getByText(`Which branch did they work at? ${RUN}`).first().waitFor({ timeout: 8000 });
    await shot(portal, "28-portal-question", true);
    await ctx.close();
  });

  await step("Post-QC can reword a finding without the AI", async () => {
    const { data: rows } = await service.from("cases").select("id, checks:case_checks(id, state)").eq("stage", "post_qc").eq("on_hold", false).in("client_id", demo!.map((c) => c.id)).limit(1);
    const row = rows?.[0];
    must(row, "no demo case at Post-QC");
    const checkId = (row!.checks as { id: string; state: string }[]).find((k) => k.state === "completed")?.id;
    must(checkId, "no finished check");
    const ctx = await contextFor(browser, "qc_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${row!.id}/checks/${checkId}`);
    await page.getByRole("button", { name: /remarks/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Remarks").fill(`Confirmed with the source, reworded by QC ${RUN}.`);
    await page.waitForTimeout(300);
    await shot(page, "29-edit-remarks");
    await dialog.getByRole("button", { name: "Save remarks" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    const { data: k } = await service.from("case_checks").select("client_note").eq("id", checkId!).single();
    must(k?.client_note?.includes(RUN), `note is ${k?.client_note}`);
    await ctx.close();
  });

  await step("Back to documents tells the client what is needed", async () => {
    const { data: found } = await service.from("cases").select("id, client_id").eq("stage", "data_entry").eq("on_hold", false).eq("process_type", "client_supplied").in("client_id", demo!.map((c) => c.id)).limit(1).maybeSingle();
    must(found, "no demo case in data entry");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${found!.id}`);
    await page.getByRole("button", { name: "Back to documents" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What is missing or wrong").fill(`The service letter is for another employer ${RUN}.`);
    await page.waitForTimeout(300);
    await shot(page, "30-back-to-documents");
    await dialog.getByRole("button", { name: "Send back" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    await page.close();
    const ctx = await portalReader(found!.client_id);
    const portal = await ctx.newPage();
    await open(portal, `/portal/cases/${found!.id}`);
    await portal.getByText(`The service letter is for another employer ${RUN}.`).first().waitFor({ timeout: 8000 });
    await ctx.close();
  });

  await step("A data entry officer who starts verification lands on their work, not a missing page", async () => {
    const { data: next } = await service.from("cases").select("id, assigned_to").eq("stage", "data_entry").eq("on_hold", false).in("client_id", demo!.map((c) => c.id)).limit(1).maybeSingle();
    must(next, "no demo case left in data entry");
    await service.from("case_checks").update({ values_valid: true }).eq("case_id", next!.id);
    const ctx = await contextFor(browser, "data_entry_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${next!.id}`);
    await page.getByRole("button", { name: "Start verification" }).click();
    await page.waitForURL(/\/app\/queues/, { timeout: 15_000 });
    await shot(page, "31-after-start-verification");
    await ctx.close();
  });

  /** A new case for one scenario, so it leans on nothing an earlier step changed. */
  const newCase = async (kind: "client_supplied" | "candidate_collected", label: string, stage?: string) => {
    const admin = await signedInClient("admin");
    const { data: pkg } = await admin.db.from("packages").select("id").eq("code", "COMPREHENSIVE").single();
    const made = (await rpc(admin.db.rpc("create_case", { p: { client_id: client, package_id: pkg!.id, process_type: kind, candidate: { full_name: `Walkthrough ${label} ${RUN}`, email: `${label.toLowerCase().replace(/\W+/g, ".")}.${RUN}@example.test` } } as never }))) as unknown as { case_id: string };
    const { data: row } = await service.from("cases").select("org_id, client_id").eq("id", made.case_id).single();
    if (stage) await service.from("cases").update({ stage: stage as never, assigned_to: null }).eq("id", made.case_id);
    return { id: made.case_id, orgId: row!.org_id, clientId: row!.client_id, admin };
  };
  const candidateSession = async (admin: Awaited<ReturnType<typeof signedInClient>>, caseId: string) => {
    const secret = newLinkSecret();
    await rpc(admin.db.rpc("issue_candidate_link", { p_case: caseId, p_token_hash: hashLinkSecret(secret), p_token_enc: sealLinkSecret(secret), p_language: "en", p_days: 14 }));
    return secret;
  };

  await step("A paper consent form can be recorded for a candidate who can't sign online", async () => {
    const c = await newCase("candidate_collected", "Paper");
    await service.from("documents").insert({ org_id: c.orgId, case_id: c.id, client_id: c.clientId, category: "consent_form", filename: `signed-form-${RUN}.pdf`, mime: "application/pdf", storage_path: `walk/${RUN}.pdf`, status: "uploaded", uploaded_by_kind: "staff" });
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}#candidate`);
    await page.getByRole("button", { name: "Record a paper form" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Note (optional)").fill("Signed in person at our office.");
    await page.waitForTimeout(300);
    await shot(page, "38-paper-consent");
    await dialog.getByRole("button", { name: "Record consent" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    const { data: form } = await service.from("consent_forms").select("status, method").eq("case_id", c.id).single();
    must(form?.status === "accepted" && form.method === "staff", `consent is ${JSON.stringify(form)}`);
    await page.reload({ waitUntil: "load" });
    await page.getByRole("button", { name: "Send back" }).waitFor({ timeout: 8000 });
    await page.close();
  });

  await step("A data entry officer sends a case back: the message goes with it, and they land on their work", async () => {
    const one = await newCase("client_supplied", "Back One", "data_entry");
    const two = await newCase("candidate_collected", "Back Two", "data_entry");
    const secret = await candidateSession(two.admin, two.id);
    const ctx = await contextFor(browser, "data_entry_officer");
    for (const [c, text, name] of [[one, `Please send a clearer NIC photo ${RUN}.`, "39-entry-back-client"], [two, `Your service letter names another employer ${RUN}.`, "40-entry-back-candidate"]] as const) {
      const page = await ctx.newPage();
      await open(page, `/app/cases/${c.id}`);
      await page.getByRole("button", { name: "Back to documents" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("What is missing or wrong").fill(text);
      await dialog.getByRole("button", { name: "Send back" }).click();
      await page.waitForURL(/\/app\/queues/, { timeout: 15_000 });
      await shot(page, name);
      await page.close();
    }
    await ctx.close();
    const reader = await portalReader(one.clientId);
    const portal = await reader.newPage();
    await open(portal, `/portal/cases/${one.id}`);
    await portal.getByText(`Please send a clearer NIC photo ${RUN}.`).first().waitFor({ timeout: 8000 });
    await reader.close();
    const candidate = await browser.newContext({ viewport: { width: 420, height: 900 } });
    watchServerActions(candidate);
    const page = await candidate.newPage();
    await page.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
    await page.waitForURL(/\/c\/session/, { timeout: 10000 });
    await page.getByText(`Your service letter names another employer ${RUN}.`).first().waitFor({ timeout: 8000 });
    await shot(page, "41-candidate-reads-why", true);
    await candidate.close();
  });

  await step("Needs info on a Type 2 case asks the candidate, and the client reads who is being waited for", async () => {
    const c = await newCase("candidate_collected", "Waiting", "verification");
    const secret = await candidateSession(c.admin, c.id);
    const { data: k } = await service.from("case_checks").select("id").eq("case_id", c.id).order("sort").limit(1).single();
    await service.from("case_checks").update({ state: "in_progress" }).eq("id", k!.id);
    const question = `Which branch did you work at ${RUN}?`;
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}/checks/${k!.id}`);
    await page.getByRole("button", { name: "Needs info" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What do you need?").fill(question);
    await dialog.getByRole("button", { name: "Send the question" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    await page.close();
    const reader = await portalReader(c.clientId);
    const portal = await reader.newPage();
    await open(portal, `/portal/cases/${c.id}`);
    await portal.getByText("Waiting for the candidate").first().waitFor({ timeout: 8000 });
    must(!(await portal.locator("body").innerText()).includes("Information needed"), "the client was told information is needed from them");
    await shot(portal, "48-portal-waiting-for-candidate", true);
    await reader.close();
    const candidate = await browser.newContext({ viewport: { width: 420, height: 900 } });
    watchServerActions(candidate);
    const mine = await candidate.newPage();
    await mine.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
    await mine.waitForURL(/\/c\/session/, { timeout: 10000 });
    await mine.getByText(question).first().waitFor({ timeout: 8000 });
    await candidate.close();
  });

  await step("A reopened discrepancy can be corrected, not waived, and its note stays out of a clear result", async () => {
    const c = await newCase("client_supplied", "Reopened", "verification");
    const { data: k } = await service.from("case_checks").select("id").eq("case_id", c.id).order("sort").limit(1).single();
    await service.from("case_checks").update({ state: "in_progress", values_valid: true, client_note: `The name differs from the register ${RUN}`, discrepancy_at: new Date().toISOString() }).eq("id", k!.id);
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}/checks/${k!.id}`);
    must(!(await page.getByRole("button", { name: "Waive" }).isVisible().catch(() => false)), "Waive offered on a recorded discrepancy");
    await page.getByRole("button", { name: "Record outcome" }).click();
    const dialog = page.getByRole("dialog");
    const note = dialog.getByLabel(/Note for the client/);
    must((await note.inputValue()) === "", "the old finding was carried into a clear result");
    await dialog.getByRole("button", { name: "Use it again" }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await shot(page, "42-outcome-after-reopen");
    await dialog.getByRole("radio", { name: /Discrepancy/ }).click();
    must((await dialog.getByLabel("Finding for the report").inputValue()).includes(RUN), "a discrepancy should start from the old finding");
    await page.close();
  });

  await step("After verification nobody is asked for a file: the candidate's page and staff say the same", async () => {
    const c = await newCase("candidate_collected", "Closed Uploads");
    await rpc(c.admin.db.rpc("create_candidate_request", { p_case: c.id, p: { kind: "document", category: "other", title: `Extra file ${RUN}` } as never }));
    const secret = await candidateSession(c.admin, c.id);
    await service.from("consent_forms").update({ status: "submitted", method: "esign", signed_name: "Walkthrough", signed_at: new Date().toISOString() }).eq("case_id", c.id);
    await service.from("cases").update({ stage: "post_qc" }).eq("id", c.id);
    const candidate = await browser.newContext({ viewport: { width: 420, height: 900 } });
    watchServerActions(candidate);
    const mine = await candidate.newPage();
    await mine.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
    await mine.waitForURL(/\/c\/session/, { timeout: 10000 });
    await mine.waitForLoadState("networkidle").catch(() => undefined);
    await shot(mine, "43-candidate-after-verification", true);
    const text = await mine.locator("body").innerText();
    must(!/One last step/.test(text), "the candidate was told to confirm, then would be refused");
    must(!/All received/.test(text), "the page said all received beside files that never came");
    must(!text.includes("Go to the document"), "a request for a file that can't come in is still showing");
    await candidate.close();
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}#candidate`);
    await page.getByRole("button", { name: "Accept", exact: true }).first().waitFor({ timeout: 8000 });
    must(!(await page.getByRole("button", { name: "Send back" }).isVisible().catch(() => false)), "consent can't go back once uploads closed");
    await shot(page, "44-consent-after-verification");
    await page.close();
  });

  await step("Sending consent back reaches the candidate, and a request to the client doesn't", async () => {
    const c = await newCase("candidate_collected", "Consent Back");
    const secret = await candidateSession(c.admin, c.id);
    await service.from("consent_forms").update({ status: "submitted", method: "esign", signed_name: "Walkthrough", signed_at: new Date().toISOString() }).eq("case_id", c.id);
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}#candidate`);
    await page.getByRole("button", { name: "Send back" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What is wrong?").fill(`The signature is missing ${RUN}.`);
    await dialog.getByRole("button", { name: "Send back" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    await page.close();
    const told = await service.from("email_outbox").select("id", { count: "exact", head: true }).eq("entity_id", c.id).eq("template_key", "candidate.update");
    must(told.count, "the candidate wasn't told their consent came back");
    const candidate = await browser.newContext({ viewport: { width: 420, height: 900 } });
    watchServerActions(candidate);
    const mine = await candidate.newPage();
    await mine.goto(candidateLinkUrl(base, secret), { waitUntil: "load" });
    await mine.waitForURL(/\/c\/session/, { timeout: 10000 });
    await mine.getByText(`The signature is missing ${RUN}.`).first().waitFor({ timeout: 8000 });
    await candidate.close();
    const one = await newCase("client_supplied", "Asked Client");
    await candidateSession(one.admin, one.id);
    const again = await opsCtx.newPage();
    await open(again, `/app/cases/${one.id}#documents`);
    await again.getByRole("button", { name: "Request", exact: true }).click();
    const ask = again.getByRole("dialog");
    await ask.getByRole("combobox", { name: "Document" }).click();
    await again.getByRole("option", { name: "Other document" }).click();
    await ask.getByRole("button", { name: /Request|Send/ }).click();
    await ask.waitFor({ state: "hidden", timeout: 8000 });
    await again.close();
    const quiet = await service.from("email_outbox").select("id", { count: "exact", head: true }).eq("entity_id", one.id).eq("template_key", "candidate.update");
    must(!quiet.count, "the candidate was emailed about a request made of the client");
  });

  await step("Saving an open draft invoice keeps a case added meanwhile", async () => {
    const { data: draft } = await service.from("invoices").select("id, org_id").eq("status", "draft").in("client_id", demo!.map((c) => c.id)).order("created_at", { ascending: false }).limit(1).single();
    const page = await adminCtx.newPage();
    await open(page, `/app/invoices/${draft!.id}`);
    await page.getByLabel("Message on the invoice").fill(`Edited in the walkthrough ${RUN}.`);
    const description = `Added by the month's job ${RUN}`;
    await service.from("invoice_items").insert({ org_id: draft!.org_id, invoice_id: draft!.id, description, unit_price: 1000, sort: 900 });
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Saved" }).waitFor({ timeout: 8000 });
    const { data: lines } = await service.from("invoice_items").select("description").eq("invoice_id", draft!.id);
    must(lines?.some((l) => l.description === description), "saving removed a line the form never had");
    await page.getByLabel(/Line \d+ description/).last().waitFor({ timeout: 8000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const shown = await page.getByLabel(/Line \d+ description/).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    must(shown.includes(description), `the form didn't pick the new line up: ${shown.join(", ")}`);
    await shot(page, "49-draft-keeps-new-line");
    await page.close();
    await service.from("invoice_items").delete().eq("invoice_id", draft!.id).eq("description", description);
  });

  await step("An erased case lists no files it can't open", async () => {
    const c = await newCase("client_supplied", "Erased");
    await service.from("documents").insert({ org_id: c.orgId, case_id: c.id, client_id: c.clientId, category: "other", filename: `their-file-${RUN}.pdf`, mime: "application/pdf", storage_path: `walk/e${RUN}.pdf`, status: "uploaded", visibility: "client", uploaded_by_kind: "client" });
    await service.from("cases").update({ stage: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", c.id);
    await rpc(service.rpc("erase_case", { p_case: c.id, p_reason: "Walkthrough of erasure" }));
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${c.id}#documents`);
    await page.getByText("File erased").first().waitFor({ timeout: 8000 });
    must(!(await page.getByRole("link", { name: "Open" }).isVisible().catch(() => false)), "a file link survived erasure");
    await shot(page, "45-erased-case");
    await page.close();
    const reader = await portalReader(c.clientId);
    const portal = await reader.newPage();
    await open(portal, `/portal/cases/${c.id}`);
    const text = await portal.locator("body").innerText();
    must(!text.includes("their-file") && !/\berased\.pdf\b/.test(text), "the portal lists a file that is gone");
    await reader.close();
  });

  await step("A report on a hidden case says who can't see it", async () => {
    const { data: rel } = await service.from("cases").select("id").eq("stage", "released").in("client_id", demo!.map((c) => c.id)).limit(1).single();
    await service.from("cases").update({ client_visible: false }).eq("id", rel!.id);
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${rel!.id}#report`);
    await page.getByText("hidden from the client's portal").first().waitFor({ timeout: 8000 });
    await shot(page, "46-hidden-case-report");
    await page.close();
    await service.from("cases").update({ client_visible: true }).eq("id", rel!.id);
  });

  await step("Officers see client names in their lists, and search offers no client page QC can't open", async () => {
    const c = await newCase("client_supplied", "Names", "data_entry");
    const { data: cl } = await service.from("clients").select("name").eq("id", c.clientId).single();
    const ctx = await contextFor(browser, "data_entry_officer");
    const page = await ctx.newPage();
    await open(page, "/app/queues?tab=data_entry");
    await page.getByText(`Walkthrough Names ${RUN}`).first().waitFor({ timeout: 8000 });
    const row = await page.locator("li, tr", { hasText: `Walkthrough Names ${RUN}` }).first().innerText();
    must(row.includes(cl!.name), `the row reads: ${row}`);
    await shot(page, "47-officer-list");
    await ctx.close();
    const qc = await contextFor(browser, "qc_officer");
    const res = await qc.request.get(`${base}/api/search?q=${encodeURIComponent(cl!.name.slice(0, 6))}`);
    const { hits } = (await res.json()) as { hits: { kind: string }[] };
    must(!hits.some((h) => h.kind === "client"), "QC was offered a client page it can't open");
    await qc.close();
  });

  await step("A held case offers nothing that would be refused", async () => {
    const held = (await service.from("cases").select("id").eq("on_hold", true).in("client_id", demo!.map((c) => c.id)).limit(1).maybeSingle()).data;
    must(held, "no held demo case");
    const page = await opsCtx.newPage();
    await open(page, `/app/cases/${held!.id}`);
    for (const name of ["Ask candidate", "Ask the client", "Send BGV form"]) must(!(await page.getByRole("button", { name }).isVisible().catch(() => false)), `${name} offered on hold`);
    await shot(page, "32-held-case", true);
    await page.close();
  });

  await step("An officer sees the client's name on their case, and no link they can't follow", async () => {
    const { userId } = await sessionCookies("verification_officer");
    const { data: k } = await service.from("case_checks").select("id, case_id, case:cases!inner(stage, on_hold, client_id)").eq("case.stage", "verification").eq("case.on_hold", false).in("case.client_id", demo!.map((c) => c.id)).limit(1).single();
    await service.from("case_checks").update({ assigned_to: userId }).eq("id", k!.id);
    const name = demo!.find((c) => c.id === (k!.case as unknown as { client_id: string }).client_id)!;
    const { data: client } = await service.from("clients").select("name").eq("id", name.id).single();
    const ctx = await contextFor(browser, "verification_officer");
    const page = await ctx.newPage();
    await open(page, `/app/cases/${k!.case_id}`);
    await page.getByText(client!.name).first().waitFor({ timeout: 8000 });
    await shot(page, "33-officer-case");
    await ctx.close();
  });

  await step("A revision that reopened work can't be stopped, and the client keeps their report", async () => {
    const { data: rel } = await service.from("cases").select("id, client_id").eq("stage", "released").in("client_id", demo!.map((c) => c.id)).order("released_at", { ascending: false }).limit(1).single();
    const page = await adminCtx.newPage();
    await open(page, `/app/cases/${rel!.id}#report`);
    await page.getByRole("button", { name: "Revise" }).click();
    await page.getByRole("dialog").getByLabel("Why it's being revised").fill("A date was typed wrongly.");
    await page.getByRole("dialog").getByRole("button", { name: "Start revision" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 8000 });
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByRole("button", { name: "Back to verification" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").first().check();
    await dialog.getByRole("textbox").fill("The date needs correcting with the source.");
    await page.waitForTimeout(300);
    await shot(page, "34-revision-back-to-verification");
    await dialog.getByRole("button", { name: /Back to verification|Send back/ }).click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const text = await page.locator("body").innerText();
    must(!/Stop the revision/.test(text), "a revision that reopened a check offers to stop");
    await shot(page, "35-revision-in-verification");
    await page.close();
    const ctx = await portalReader(rel!.client_id);
    const portal = await ctx.newPage();
    await open(portal, "/portal/cases");
    await shot(portal, "36-portal-revising");
    await open(portal, `/portal/cases/${rel!.id}`);
    await portal.getByText("Ontriq is revising this report").first().waitFor({ timeout: 8000 });
    await portal.getByRole("link", { name: /Download PDF/ }).waitFor({ timeout: 8000 });
    await shot(portal, "37-portal-revising-case", true);
    await ctx.close();
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed. Screenshots in ${shots}`);
  if (failed.length) process.exitCode = 1;
  reportRefused();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
