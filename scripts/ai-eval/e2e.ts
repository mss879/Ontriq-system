/**
 * The AI automations on the real pipeline, local stack only: real case, real
 * uploads to storage, real database triggers, the real job worker and handlers,
 * real suggestions and ledger. Run with the local env file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { drainJobs } from "../../src/jobs/run-job";
import { parseNic } from "../../src/domain/nic-core";
import { hashLinkSecret, newLinkSecret, sealLinkSecret } from "../../src/lib/crypto/candidate-token";
import { ORG, signedInClient } from "../dev/dev-session";
import { DOC_DIR, OUT_DIR } from "./paths";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local stack only");
const service = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false } });
const { db } = await signedInClient("admin");

const pkg = (await service.from("packages").select("id").eq("code", "COMPREHENSIVE").single()).data?.id;
const client = (await service.from("clients").select("id, name").eq("name", "John Keells Holdings").single()).data;
if (!pkg || !client) throw new Error("local seed missing");
const started = new Date().toISOString();

async function newCase(name: string, nicRaw: string, process = "client_supplied") {
  const nic = parseNic(nicRaw);
  if (!nic.valid) throw new Error("nic");
  const { data, error } = await db.rpc("create_case", { p: { client_id: client!.id, package_id: pkg, process_type: process, position_title: "Finance Executive", candidate: { full_name: name, nic: nic.display, nic_canonical: nic.canonical, date_of_birth: nic.birthDate, gender: nic.gender, district: "Kalutara" } } });
  if (error) throw new Error(`create_case: ${error.message}`);
  return data as { case_id: string; reference: string };
}

async function upload(caseId: string, doc: string, file: string, category: string, checkKey: string | null) {
  const ext = path.extname(doc);
  const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
  const bytes = readFileSync(path.join(DOC_DIR, doc));
  const id = randomUUID();
  const storagePath = `org/${ORG}/case/${caseId}/${id}${ext}`;
  const up = await service.storage.from("documents").upload(storagePath, bytes, { contentType: mime });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  let check: string | null = null;
  if (checkKey) {
    const { data } = await service.from("case_checks").select("id, check_type:check_types!inner(key)").eq("case_id", caseId).eq("check_types.key", checkKey).single();
    check = data?.id ?? null;
  }
  const ins = await service.from("documents").insert({ id, org_id: ORG, case_id: caseId, case_check_id: check, client_id: client!.id, category, filename: file, mime, size_bytes: bytes.byteLength, storage_bucket: "documents", storage_path: storagePath, status: "pending_upload", uploaded_by_kind: "client" } as never);
  if (ins.error) throw new Error(`document: ${ins.error.message}`);
  const done = await service.from("documents").update({ status: "uploaded" } as never).eq("id", id);
  if (done.error) throw new Error(`finalise: ${done.error.message}`);
  return id;
}

async function drain(label: string) {
  const t0 = Date.now();
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const r = await drainJobs({ budgetMs: 280_000, reserveMs: 0, maxJobs: 40, workerId: `ai-e2e-${randomUUID().slice(0, 8)}`, admin: service as never });
    total += r.processed;
    if (r.stoppedBy === "empty") break;
  }
  console.log(`  ${label}: ${total} jobs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function setStage(caseId: string, stage: string) {
  const r = await service.from("cases").update({ stage } as never).eq("id", caseId);
  if (r.error) throw new Error(`stage ${stage}: ${r.error.message}`);
}

const report: Record<string, unknown> = {};

// `npm run ai:e2e -- --candidate` plays a candidate up to their last step, through the same functions
// as their page, and prints their link. Confirming is left for a browser.
if (process.argv.includes("--candidate")) {
  console.log("A candidate with everything uploaded");
  const c = await newCase("Nimali Sanduni Perera", "199057501234", "candidate_collected");
  const secret = newLinkSecret();
  const { data: link, error } = await db.rpc("issue_candidate_link", { p_case: c.case_id, p_token_hash: hashLinkSecret(secret), p_token_enc: sealLinkSecret(secret), p_language: "en", p_days: 14 });
  if (error) throw new Error(`link: ${error.message}`);
  const send = async (requirement: string | null, file: string, name: string) => {
    const bytes = readFileSync(path.join(DOC_DIR, file));
    const ext = path.extname(file);
    const mime = ext === ".pdf" ? "application/pdf" : "image/jpeg";
    const begun = await service.rpc("candidate_begin_upload", { p_link: link, p_requirement: requirement, p_category: null as never, p_filename: name, p_mime: mime, p_size: bytes.byteLength });
    if (begun.error) throw new Error(`begin: ${begun.error.message}`);
    const d = begun.data as { id: string; bucket: string; path: string };
    const up = await service.storage.from(d.bucket).upload(d.path, bytes, { contentType: mime });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const done = await service.rpc("candidate_finalize_upload", { p_link: link, p_document: d.id });
    if (done.error) throw new Error(`finalize: ${done.error.message}`);
  };
  const FILES: Record<string, [string, string]> = { nic_copy: ["nic_smart.jpg", "IMG_2041.jpg"], education_certificate: ["ol_si.pdf", "OL results.pdf"], service_letter: ["svc_si.jpg", "seva sahathikaya.jpg"], gn_certificate: ["gn_si.jpg", "GN cert.jpg"], police_report: ["police_si.pdf", "police report.pdf"] };
  const slots = (await service.from("case_check_requirements").select("id, category, status").eq("case_id", c.case_id)).data ?? [];
  for (const r of slots) if (r.status === "pending" && FILES[r.category]) await send(r.id, ...FILES[r.category]);
  const signed = await service.rpc("candidate_submit_consent", { p_link: link, p_method: "esign", p_signed_name: "Nimali Sanduni Perera", p_document: null as never });
  if (signed.error) throw new Error(`consent: ${signed.error.message}`);
  await drain("read and extract");
  console.log(JSON.stringify({ case: c, url: `/c/${secret}`, owed: (await service.from("case_check_requirements").select("label, status").eq("case_id", c.case_id).eq("status", "pending")).data }, null, 1));
  process.exit(0);
}

// ---- B: one PDF holding everything, which is what the client asked for
console.log("Case B: one combined PDF");
const b = await newCase("Nimali Sanduni Perera", "199057501234");
await upload(b.case_id, "pack_mixed.pdf", "candidate documents.pdf", "other", null);
await drain("read and extract");

// `npm run ai:e2e -- --pack` stops here, with the combined file waiting for a person.
if (process.argv.includes("--pack")) {
  const slots = (await service.from("case_check_requirements").select("label, status").eq("case_id", b.case_id)).data;
  const held = (await service.from("ai_suggestions").select("value").eq("field_key", "contains").gte("created_at", started)).data;
  console.log(JSON.stringify({ case: b, slots, held }, null, 1));
  process.exit(0);
}

// ---- A: separate files, the way most cases arrive
console.log("Case A: separate documents");
const a = await newCase("Nimali Sanduni Perera", "199057501234");
const files: [string, string, string, string | null][] = [
  ["nic_smart.jpg", "IMG_2041.jpg", "nic_copy", "nic"],
  ["ol_si.pdf", "OL results.pdf", "education_certificate", "education"],
  ["svc_si.jpg", "seva sahathikaya.jpg", "service_letter", "employment"],
  ["gn_si.jpg", "GN cert.jpg", "gn_certificate", "address"],
  ["police_si.pdf", "police report.pdf", "police_report", "police"],
  ["q_blur.jpg", "blurred letter.jpg", "service_letter", "employment"],
];
const ids: Record<string, string> = {};
for (const [doc, file, category, check] of files) ids[doc] = await upload(a.case_id, doc, file, category, check);
await drain("read and extract");

// ---- the reviews on case A, driven by real stage changes
const suggested = async (caseId: string) => {
  const { data: checks } = await service.from("case_checks").select("id, label").eq("case_id", caseId);
  const rows = (await service.from("ai_suggestions").select("capability, entity_id, field_key, value, confidence, rationale, decision").in("entity_id", (checks ?? []).map((c) => c.id)).eq("decision", "pending")).data ?? [];
  return (checks ?? []).map((c) => ({ check: c.label, fields: rows.filter((r) => r.entity_id === c.id).map((r) => ({ key: r.field_key, value: r.value, confidence: r.confidence, why: r.rationale })) }));
};
report.caseA = await suggested(a.case_id);
report.caseB = await suggested(b.case_id);
const events = async (caseId: string) => (await service.from("case_events").select("kind, title, body").eq("case_id", caseId).eq("kind", "ai_read").order("at")).data ?? [];
report.timelineA = await events(a.case_id);
report.timelineB = await events(b.case_id);
report.documentsA = (await service.from("documents").select("filename, ai:document_ai(classification, quality), text:document_texts(text)").eq("case_id", a.case_id)).data?.map((d) => {
  const ai = (Array.isArray(d.ai) ? d.ai[0] : d.ai) as { classification?: Record<string, unknown> } | null;
  const text = (Array.isArray(d.text) ? d.text[0] : d.text) as { text?: string } | null;
  return { file: d.filename, type: ai?.classification?.document_type, readable: ai?.classification?.readable, issues: ai?.classification?.quality_issues, textStored: text?.text?.length ?? 0 };
});

// Accept the confident values into the checks, as an officer would.
console.log("Case A: stages");
const { data: checks } = await service.from("case_checks").select("id, label, values").eq("case_id", a.case_id);
for (const k of checks ?? []) {
  const rows = (await service.from("ai_suggestions").select("field_key, value").eq("entity_id", k.id).eq("capability", "document.extract").eq("decision", "pending")).data ?? [];
  const values = { ...(k.values as object), ...Object.fromEntries(rows.map((r) => [r.field_key, r.value])) };
  await service.from("case_checks").update({ values } as never).eq("id", k.id);
}
await setStage(a.case_id, "pre_qc");
await drain("consistency and Pre-QC");
await setStage(a.case_id, "verification");

const employment = (await service.from("case_checks").select("id, check_type:check_types!inner(key)").eq("case_id", a.case_id).eq("check_types.key", "employment").single()).data;
await service.rpc("enqueue_job", { p_kind: "ai.outreach_draft", p_payload: { check_id: employment?.id, target: "HR Manager, Saman Engineering (Pvt) Ltd" }, p_idempotency_key: `e2e-outreach-${randomUUID()}`, p_entity_type: "case_check", p_entity_id: employment?.id, p_org: ORG });
await service.rpc("enqueue_job", { p_kind: "ai.response_capture", p_payload: { check_id: employment?.id, reply: "We confirm that Mrs. Nimali Sanduni Perera worked here as an Accounts Assistant from 2 March 2015 to 30 September 2020. R. Gunawardena, HR Manager" }, p_idempotency_key: `e2e-reply-${randomUUID()}`, p_entity_type: "case_check", p_entity_id: employment?.id, p_org: ORG });
await drain("outreach and reply");

await service.from("case_checks").update({ state: "completed", result: "clear", result_tone: "green", completed_at: new Date().toISOString(), client_note: "Confirmed with the issuing source." } as never).eq("case_id", a.case_id);
await setStage(a.case_id, "post_qc");
await drain("Post-QC");
await setStage(a.case_id, "report");
await drain("report remarks");

await service.rpc("enqueue_job", { p_kind: "briefing.daily", p_payload: {}, p_idempotency_key: `e2e-briefing-${randomUUID()}` });
await drain("daily briefing");

const caseRows = (await service.from("ai_suggestions").select("capability, field_key, value, rationale").eq("entity_id", a.case_id).neq("decision", "superseded")).data ?? [];
report.reviews = caseRows;
report.onEmployment = (await service.from("ai_suggestions").select("capability, field_key, value").eq("entity_id", employment?.id ?? "").in("capability", ["check.outreach", "check.response", "report.narrative"])).data;
report.briefing = (await service.from("ai_suggestions").select("value").eq("capability", "briefing.daily").gte("created_at", started).limit(1).maybeSingle()).data;

// ---- what the ledger says it cost
const runs = (await service.from("ai_runs").select("capability, model, case_id, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, error").gte("created_at", started)).data ?? [];
const by = new Map<string, { n: number; cost: number; bad: number; ms: number; model: string }>();
for (const r of runs) {
  const k = `${r.capability}`;
  const e = by.get(k) ?? { n: 0, cost: 0, bad: 0, ms: 0, model: r.model };
  by.set(k, { n: e.n + 1, cost: e.cost + Number(r.cost_usd), bad: e.bad + (r.status === "ok" ? 0 : 1), ms: e.ms + (r.duration_ms ?? 0), model: r.model });
}
console.log("\ncapability | model | calls | failed | total $ | avg sec");
for (const [k, v] of by) console.log(`${k} | ${v.model} | ${v.n} | ${v.bad} | $${v.cost.toFixed(4)} | ${(v.ms / v.n / 1000).toFixed(1)}`);
const onCase = (id: string) => runs.filter((r) => r.case_id === id).reduce((s, r) => s + Number(r.cost_usd), 0);
console.log(`\nCase A ${a.reference}: $${onCase(a.case_id).toFixed(4)}   Case B ${b.reference}: $${onCase(b.case_id).toFixed(4)}   All: $${runs.reduce((s, r) => s + Number(r.cost_usd), 0).toFixed(4)}`);
const jobs = (await service.from("jobs").select("kind, status, last_error").gte("created_at", started).neq("status", "succeeded")).data ?? [];
console.log("Unfinished or failed jobs:", JSON.stringify(jobs).slice(0, 600));
for (const r of runs.filter((x) => x.status !== "ok")) console.log("Failed run:", r.capability, r.status, r.error?.slice(0, 200));
report.ids = { a, b };
writeFileSync(path.join(OUT_DIR, "e2e.json"), JSON.stringify(report, null, 2));
console.log("\nCase A id", a.case_id, "Case B id", b.case_id);
