import { NonRetryableError, type JobHandler } from "../types";
import type { ServiceClient } from "../admin-client";
import { isAiConfigured, runStructured, type AiContext } from "../../lib/ai/claude";
import * as P from "../../lib/ai/prompts";
import { caseSummary, documentBlock, loadAiCase, suggest } from "../ai/context";
import { checksToFill, docsForCheck, extractionFields, groupRows, missingDetails } from "../../domain/ai/extraction";
import { currentSnapshot } from "../report/load";
import { removeObjects } from "../storage";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The AI capabilities as jobs (plan §8, migration 0029 queues them). Each
 * reads with the service role, asks Claude for structured output, and leaves
 * suggestions for people to accept, edit or reject. When AI is not set up or
 * a capability is switched off, they finish quietly.
 */

const notReady = () => (!isAiConfigured() ? { skipped: "AI is not set up" } : null);
const ctx = (job: { id: string }, c: { org_id: string; client_id?: string; id?: string }, version: string, source: string, extra: Partial<AiContext> = {}): AiContext => ({
  orgId: c.org_id,
  clientId: c.client_id ?? null,
  caseId: c.id ?? null,
  jobId: job.id,
  source,
  promptVersion: version,
  ...extra,
});
const payload = <T>(job: { payload: unknown }) => (job.payload ?? {}) as T;

/** ai.classify_document: type, quality, text; feedback for candidates; tamper signals; then extraction. */
export const aiClassify: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { document_id } = payload<{ document_id?: string }>(job);
  if (!document_id) throw new NonRetryableError("ai.classify_document without document_id");
  const { data: d } = await admin
    .from("documents")
    .select("id, org_id, case_id, case_check_id, client_id, category, label, filename, mime, size_bytes, storage_bucket, storage_path, uploaded_by_kind, status")
    .eq("id", document_id)
    .maybeSingle();
  if (!d || !["uploaded", "accepted"].includes(d.status)) return { skipped: "document not available" };
  if (d.category === "consent_form" && d.mime === "image/png" && d.filename === "signature.png") return { skipped: "drawn signature" };
  const block = await documentBlock(admin, d);
  if (!block) {
    // Say so on the file, so nobody waits for details that won't arrive.
    await admin.from("document_ai").upsert({ document_id: d.id, org_id: d.org_id, classification: { not_read: d.mime === "image/heic" ? "It's an iPhone HEIC photo. Upload a JPEG or PDF instead." : "The file is too large. Upload a smaller copy." }, quality: {} });
    return { skipped: "file type or size not readable" };
  }
  const { data: cats } = await admin.from("document_categories").select("key, name").eq("org_id", d.org_id).eq("is_active", true);
  const prompt = P.classifyPrompt({ expectedCategory: d.category, expectedLabel: d.label ?? d.category, categories: cats ?? [] });
  const r = await runStructured(admin, "document.classify", ctx(job, { org_id: d.org_id, client_id: d.client_id ?? undefined, id: d.case_id }, P.CLASSIFY_VERSION, "jobs/ai-classify", { documentId: d.id }), {
    system: prompt.system,
    content: [block, P.text(prompt.text)],
    schema: P.ClassifySchema,
    minTokens: P.CLASSIFY_MIN_TOKENS,
  });
  if (!r.ok) {
    // The first look failed, but the file can still fill its check: extraction reads the file itself.
    const queued = await queueExtraction(admin, d, null);
    return { skipped: r.reason, extract: queued };
  }
  const out = r.data;
  await admin.from("document_ai").upsert({ document_id: d.id, org_id: d.org_id, classification: { ...out, text: undefined, model: r.model }, quality: { readable: out.readable, issues: out.quality_issues } });
  // Later steps compare documents by this text, so they get the English alongside the original.
  const stored = out.translation_en ? `${out.text}\n\n[English translation]\n${out.translation_en}` : out.text;
  if (stored) await admin.from("document_texts").upsert({ document_id: d.id, org_id: d.org_id, text: stored.slice(0, 20000), language: out.language });

  const problem = !out.readable || !out.matches_expected || out.quality_issues.length > 0;
  if (problem) {
    await suggest(admin, {
      org_id: d.org_id, run_id: r.runId, capability: "document.classify", entity_type: "document", entity_id: d.id, field_key: "quality",
      value: { readable: out.readable, matches_expected: out.matches_expected, issues: out.quality_issues, detected: out.document_type, message: out.candidate_message },
      confidence: out.readable ? 0.6 : 0.85,
      rationale: out.matches_expected ? "Quality problems" : `Looks like ${out.document_type}, not what this slot asks for`,
    });
    // Instant feedback on the candidate's page (plan §8, capability 12). Fixed wording chosen from
    // what the AI found, never the model's own text, so nothing it writes reaches the candidate unread.
    const feedback = candidateFeedback(out);
    if (d.uploaded_by_kind === "candidate" && feedback) {
      await admin.rpc("log_case_event", {
        p_case: d.case_id, p_check: d.case_check_id as string, p_kind: "document_feedback", p_title: "About your upload", p_body: feedback,
        p_data: { document_id: d.id }, p_client: false, p_candidate: true,
      });
    }
  }
  if (out.possible_tampering) {
    await suggest(admin, {
      org_id: d.org_id, run_id: r.runId, capability: "document.tamper", entity_type: "document", entity_id: d.id, field_key: "tamper",
      value: { notes: out.tampering_notes }, confidence: 0.5, rationale: out.tampering_notes ?? "Possible signs of editing",
    });
  }
  const queued = await queueExtraction(admin, d, out.document_type);
  return { type: out.document_type, readable: out.readable, extract: queued };
};

/** Pre-fill every check this document can help with. */
async function queueExtraction(admin: ServiceClient, d: { id: string; org_id: string; case_id: string; case_check_id: string | null; category: string }, detected: string | null): Promise<number> {
  const [{ data: requirements }, { data: all }] = await Promise.all([
    admin.from("case_check_requirements").select("case_check_id, category").eq("case_id", d.case_id),
    admin.from("case_checks").select("id").eq("case_id", d.case_id),
  ]);
  const checks = checksToFill(d, detected, requirements ?? [], (all ?? []).map((k) => k.id));
  for (const check of checks) {
    await admin.rpc("enqueue_job", { p_kind: "ai.extract_fields", p_payload: { check_id: check }, p_idempotency_key: `ai.extract_fields:${check}:${d.id}`, p_entity_type: "case_check", p_entity_id: check, p_org: d.org_id });
  }
  return checks.length;
}

/** ai.extract_fields: pre-fill one check's fields from its documents, for side-by-side confirmation. */
export const aiExtract: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { check_id } = payload<{ check_id?: string }>(job);
  if (!check_id) throw new NonRetryableError("ai.extract_fields without check_id");
  const { data: k } = await admin.from("case_checks").select("case_id").eq("id", check_id).single();
  if (!k) return { skipped: "check gone" };
  const c = await loadAiCase(admin, k.case_id);
  const check = c.checks.find((x) => x.id === check_id);
  if (!check || ["completed", "discrepancy", "unable_to_verify", "waived"].includes(check.state)) return { skipped: "check closed" };
  const { flat: fields, groups } = extractionFields(check.fields);
  if (!fields.length && !groups.length) return { skipped: "nothing to extract" };
  const docs = docsForCheck(c.documents, check_id, c.requirements);
  if (!docs.length) return { skipped: "no documents" };
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const d of docs) {
    blocks.push(P.text(`Document: ${d.filename} (${d.category_name})`));
    const b = await documentBlock(admin, d);
    if (b) blocks.push(b);
    else if (d.text) blocks.push(P.text(d.text.slice(0, 6000)));
  }
  const describe = (f: (typeof fields)[number]) => ({ key: f.key, label: f.label, type: f.type, hint: f.ai?.hint, options: f.options });
  const prompt = P.extractPrompt({ checkLabel: check.label, fields: fields.map(describe), groups: groups.map((g) => ({ key: g.key, label: g.label, fields: g.fields.map(describe) })) });
  const r = await runStructured(admin, "document.extract", ctx(job, c, P.EXTRACT_VERSION, "jobs/ai-extract"), {
    system: prompt.system,
    content: [P.text(prompt.text), ...blocks],
    schema: P.ExtractSchema,
    minTokens: P.EXTRACT_MIN_TOKENS,
  });
  if (!r.ok) return { skipped: r.reason };
  const found: Record<string, unknown> = {};
  let n = 0;
  const leave = async (key: string, value: unknown, confidence: number, source: string | null, writtenAs?: string | null) => {
    found[key] = value;
    if (JSON.stringify(check.values[key]) === JSON.stringify(value)) return;
    const rationale = [source ? `From ${source}` : null, writtenAs ? `written as “${writtenAs}”` : null].filter(Boolean).join(", ");
    await suggest(admin, {
      org_id: c.org_id, run_id: r.runId, capability: "document.extract", entity_type: "case_check", entity_id: check_id, field_key: key,
      value, confidence, rationale: rationale || null, source_refs: source ? [source] : [],
    });
    n++;
  };
  for (const f of r.data.fields) {
    if (!fields.some((x) => x.key === f.key) || f.value === null || f.value === "") continue;
    await leave(f.key, f.value, f.confidence, f.source, f.written_as);
  }
  for (const g of r.data.groups) {
    const group = groups.find((x) => x.key === g.key);
    const rows = group ? groupRows(group, g.rows) : [];
    if (rows.length) await leave(g.key, rows, g.confidence, g.source);
  }
  // Tell the team what came of it, on the timeline: what was found and what nobody has yet.
  const missing = missingDetails(check.fields, { ...check.values, ...found }, "entry");
  await admin.rpc("log_case_event", {
    p_case: c.id, p_check: check_id, p_kind: "ai_read", p_title: `AI read the documents for ${check.label}`,
    p_body: [r.data.overall, n ? `Found ${n} ${n === 1 ? "detail" : "details"} to confirm.` : "Nothing new to fill in.", missing.length ? `Still missing: ${missing.join(", ")}.` : "Nothing is missing."].filter(Boolean).join(" "),
    p_data: { found: n, missing }, p_client: false, p_candidate: false,
  });
  return { suggested: n, missing: missing.length };
};

/** ai.consistency (case enters Pre-QC), then the Pre-QC copilot. */
export const aiConsistency: JobHandler = async (job, { admin }) => {
  const p = payload<{ case_id?: string; then?: string }>(job);
  if (!p.case_id) throw new NonRetryableError("ai.consistency without case_id");
  const skip = notReady();
  if (!skip) {
    const c = await loadAiCase(admin, p.case_id);
    const docs = c.documents.map((d) => `--- ${d.filename} (${d.category_name})\n${(d.text ?? "(no text read yet)").slice(0, 2500)}`).join("\n");
    const r = await runStructured(admin, "case.consistency", ctx(job, c, P.CONSISTENCY_VERSION, "jobs/ai-consistency"), {
      system: P.CONSISTENCY_SYSTEM,
      content: [P.text(`${caseSummary(c, { values: true })}\n\nDocuments:\n${docs}`)],
      schema: P.ConsistencySchema,
    });
    if (r.ok) {
      await suggest(admin, { org_id: c.org_id, run_id: r.runId, capability: "case.consistency", entity_type: "case", entity_id: c.id, value: r.data, confidence: null, rationale: r.data.summary });
    }
  }
  if (p.then === "ai.preqc_copilot") {
    await admin.rpc("enqueue_job", { p_kind: "ai.preqc_copilot", p_payload: { case_id: p.case_id }, p_idempotency_key: `ai.preqc_copilot:${p.case_id}:${job.id}`, p_entity_type: "case", p_entity_id: p.case_id });
  }
  return skip ?? { done: true };
};

/** ai.preqc_copilot: checklist and drafted requests for the Pre-QC officer. */
export const aiPreqc: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { case_id } = payload<{ case_id?: string }>(job);
  if (!case_id) throw new NonRetryableError("ai.preqc_copilot without case_id");
  const c = await loadAiCase(admin, case_id);
  const { data: cons } = await admin.from("ai_suggestions").select("value").eq("entity_type", "case").eq("entity_id", c.id).eq("capability", "case.consistency").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const reqs = c.requirements.map((r) => `- ${r.label} (${r.category}): ${r.status}, ${r.received_count}/${r.min_count}${r.client_visible ? ", client-supplied" : ""}`).join("\n");
  const quality = c.documents
    .filter((d) => d.classification)
    .map((d) => `- ${d.filename}: ${JSON.stringify({ readable: d.classification?.readable, matches: d.classification?.matches_expected, issues: d.classification?.quality_issues })}`)
    .join("\n");
  const r = await runStructured(admin, "case.preqc", ctx(job, c, P.PREQC_VERSION, "jobs/ai-preqc"), {
    system: P.PREQC_SYSTEM,
    content: [P.text(`${caseSummary(c, { values: true })}\n\nRequired documents:\n${reqs}\n\nDocument checks:\n${quality || "(none yet)"}\n\nConsistency findings:\n${JSON.stringify(cons?.value ?? "not run")}`)],
    schema: P.PreQcSchema,
  });
  if (!r.ok) return { skipped: r.reason };
  await suggest(admin, { org_id: c.org_id, run_id: r.runId, capability: "case.preqc", entity_type: "case", entity_id: c.id, value: r.data, rationale: r.data.summary });
  return { checklist: r.data.checklist.length, requests: r.data.requests.length };
};

/** ai.postqc: second pair of eyes before the report, with a proposed result. */
export const aiPostqc: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { case_id } = payload<{ case_id?: string }>(job);
  if (!case_id) throw new NonRetryableError("ai.postqc without case_id");
  const c = await loadAiCase(admin, case_id);
  const { data: cons } = await admin.from("ai_suggestions").select("value").eq("entity_type", "case").eq("entity_id", c.id).eq("capability", "case.consistency").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const evidence = c.documents.map((d) => `- ${d.filename} (${d.category_name})${d.case_check_id ? ` for ${c.checks.find((k) => k.id === d.case_check_id)?.label}` : ""}`).join("\n");
  const r = await runStructured(admin, "case.postqc", ctx(job, c, P.POSTQC_VERSION, "jobs/ai-postqc"), {
    system: P.POSTQC_SYSTEM,
    content: [P.text(`${caseSummary(c, { values: true })}\n\nEvidence on file:\n${evidence || "(none)"}\n\nConsistency findings:\n${JSON.stringify(cons?.value ?? "not run")}`)],
    schema: P.PostQcSchema,
  });
  if (!r.ok) return { skipped: r.reason };
  await suggest(admin, { org_id: c.org_id, run_id: r.runId, capability: "case.postqc", entity_type: "case", entity_id: c.id, value: r.data, rationale: r.data.reasoning });
  return { proposed: r.data.proposed_result };
};

/** ai.narrative: remarks per check and an executive summary for the report. */
export const aiNarrative: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { case_id } = payload<{ case_id?: string }>(job);
  if (!case_id) throw new NonRetryableError("ai.narrative without case_id");
  const { snapshot, orgId } = await currentSnapshot(admin, case_id);
  const { data: c } = await admin.from("cases").select("id, client_id").eq("id", case_id).single();
  const r = await runStructured(admin, "report.narrative", ctx(job, { org_id: orgId, client_id: c?.client_id, id: case_id }, P.NARRATIVE_VERSION, "jobs/ai-narrative"), {
    system: P.NARRATIVE_SYSTEM,
    content: [P.text(`Write remarks for each check and an executive summary.\n${JSON.stringify({ case: snapshot.case, candidate: { name: snapshot.candidate.full_name }, checks: snapshot.checks.map((k) => ({ key: k.key, label: k.label, status: k.status_label, result: k.result_label, fields: k.fields, groups: k.groups, current_remarks: k.remarks })) })}`)],
    schema: P.NarrativeSchema,
  });
  if (!r.ok) return { skipped: r.reason };
  const { data: checks } = await admin.from("case_checks").select("id, check_type:check_types(key)").eq("case_id", case_id);
  const idOf = new Map((checks ?? []).map((k) => [(k.check_type as unknown as { key: string }).key, k.id]));
  for (const k of r.data.checks) {
    const id = idOf.get(k.key);
    if (id && k.remarks.trim()) await suggest(admin, { org_id: orgId, run_id: r.runId, capability: "report.narrative", entity_type: "case_check", entity_id: id, field_key: "remarks", value: { text: k.remarks.trim() } });
  }
  await suggest(admin, { org_id: orgId, run_id: r.runId, capability: "report.narrative", entity_type: "case", entity_id: case_id, field_key: "executive_summary", value: { text: r.data.executive_summary } });
  return { remarks: r.data.checks.length };
};

/** ai.outreach_draft (on request): an email and call script to confirm a check with its source. */
export const aiOutreach: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { check_id, target } = payload<{ check_id?: string; target?: string }>(job);
  if (!check_id) throw new NonRetryableError("ai.outreach_draft without check_id");
  const { data: k } = await admin.from("case_checks").select("case_id").eq("id", check_id).single();
  if (!k) return { skipped: "check gone" };
  const c = await loadAiCase(admin, k.case_id);
  const check = c.checks.find((x) => x.id === check_id)!;
  const details = check.fields.map((f) => (check.values[f.key] !== undefined ? `${f.label}: ${JSON.stringify(check.values[f.key])}` : null)).filter(Boolean).join("\n");
  const r = await runStructured(admin, "check.outreach", ctx(job, c, P.OUTREACH_VERSION, "jobs/ai-outreach"), {
    system: P.OUTREACH_SYSTEM,
    content: [P.text(`Check: ${check.label}\nCandidate: ${c.candidate.full_name}\nWho to contact: ${target || "the issuing institution or employer"}\nDetails to confirm:\n${details}`)],
    schema: P.OutreachSchema,
  });
  if (!r.ok) return { skipped: r.reason };
  await suggest(admin, { org_id: c.org_id, run_id: r.runId, capability: "check.outreach", entity_type: "case_check", entity_id: check_id, field_key: "outreach", value: { ...r.data, follow_up_days: Math.min(14, Math.max(1, Math.round(r.data.follow_up_days))) } });
  return { drafted: true };
};

/** ai.response_capture (on request): compare a verifier's reply with the declared details and propose a result. */
export const aiResponse: JobHandler = async (job, { admin }) => {
  const skip = notReady();
  if (skip) return skip;
  const { check_id, reply } = payload<{ check_id?: string; reply?: string }>(job);
  if (!check_id || !reply) throw new NonRetryableError("ai.response_capture needs check_id and reply");
  const { data: k } = await admin.from("case_checks").select("case_id").eq("id", check_id).single();
  if (!k) return { skipped: "check gone" };
  const c = await loadAiCase(admin, k.case_id);
  const check = c.checks.find((x) => x.id === check_id)!;
  const declared = check.fields.map((f) => (check.values[f.key] !== undefined ? `${f.key} (${f.label}): ${JSON.stringify(check.values[f.key])}` : null)).filter(Boolean).join("\n");
  const r = await runStructured(admin, "check.response", ctx(job, c, P.RESPONSE_VERSION, "jobs/ai-response"), {
    system: P.RESPONSE_SYSTEM,
    content: [P.text(`Check: ${check.label}\nResult options: ${check.resultOptions.map((o) => `${o.key} (${o.label}, ${o.tone})`).join(", ")}\nDeclared:\n${declared}\n\nReply received:\n${reply.slice(0, 8000)}`)],
    schema: P.ResponseSchema,
  });
  if (!r.ok) return { skipped: r.reason };
  const valid = check.resultOptions.some((o) => o.key === r.data.proposed_result);
  await suggest(admin, {
    org_id: c.org_id, run_id: r.runId, capability: "check.response", entity_type: "case_check", entity_id: check_id, field_key: "result",
    value: { ...r.data, proposed_result: valid ? r.data.proposed_result : null }, confidence: r.data.confidence, rationale: r.data.reasoning,
  });
  return { proposed: r.data.proposed_result };
};

async function managers(admin: ServiceClient, orgId: string, permission: string) {
  const { data } = await admin.from("memberships").select("user_id, role:roles(role_permissions(permission))").eq("org_id", orgId).eq("kind", "staff").eq("status", "active");
  return (data ?? [])
    .filter((m) => ((m.role as unknown as { role_permissions: { permission: string }[] })?.role_permissions ?? []).some((p) => p.permission === permission || p.permission === "*"))
    .map((m) => m.user_id);
}

/** sla.scan (every 15 minutes): tell owners about checks and cases due within a day or overdue, once a day each. */
export const slaScan: JobHandler = async (_job, { admin }) => {
  const soon = new Date(Date.now() + 24 * 3600_000).toISOString();
  const { data: checks } = await admin
    .from("case_checks")
    .select("id, label, due_at, assigned_to, org_id, case:cases!inner(id, reference, stage, on_hold)")
    .not("assigned_to", "is", null)
    .lt("due_at", soon)
    .not("state", "in", "(completed,discrepancy,unable_to_verify,waived)");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  let sent = 0;
  for (const k of checks ?? []) {
    const c = k.case as unknown as { id: string; reference: string; stage: string; on_hold: boolean };
    if (["released", "cancelled"].includes(c.stage) || c.on_hold) continue;
    const overdue = new Date(k.due_at!).getTime() < Date.now();
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", k.assigned_to!).eq("entity_id", k.id).gte("created_at", `${today}T00:00:00+05:30`);
    if (count) continue;
    await admin.rpc("notify_users", {
      p_user_ids: [k.assigned_to!], p_type: overdue ? "sla.overdue" : "sla.at_risk",
      p_title: `${c.reference}: ${k.label} ${overdue ? "is overdue" : "is due within a day"}`, p_body: "", p_link: `/app/cases/${c.id}`,
      p_urgent: overdue, p_entity_type: "case_check", p_entity_id: k.id, p_org: k.org_id,
    });
    sent++;
  }
  return { notified: sent };
};

/** briefing.daily (07:30 Colombo): the managers' morning summary. Uses AI when set up, plain figures otherwise. */
export const dailyBriefing: JobHandler = async (job, { admin }) => {
  const { data: orgs } = await admin.from("orgs").select("id");
  for (const o of orgs ?? []) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const facts = {
      new_cases: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).gte("created_at", since)),
      released: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).gte("released_at", since)),
      open_cases: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).not("stage", "in", "(released,cancelled)")),
      overdue_checks: await count(admin.from("case_checks").select("id", { count: "exact", head: true }).eq("org_id", o.id).lt("due_at", new Date().toISOString()).not("state", "in", "(completed,discrepancy,unable_to_verify,waived)")),
      waiting_pre_qc: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).eq("stage", "pre_qc")),
      waiting_post_qc: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).eq("stage", "post_qc")),
      waiting_approval: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).eq("stage", "approval")),
      unassigned: await count(admin.from("cases").select("id", { count: "exact", head: true }).eq("org_id", o.id).is("assigned_to", null).not("stage", "in", "(released,cancelled)")),
    };
    let briefing: P.BriefingResult = {
      headline: `${facts.open_cases} open cases, ${facts.overdue_checks} overdue checks`,
      bullets: [`${facts.new_cases} new and ${facts.released} released in the last day.`, `Waiting: ${facts.waiting_pre_qc} Pre-QC, ${facts.waiting_post_qc} Post-QC, ${facts.waiting_approval} approval.`, ...(facts.unassigned ? [`${facts.unassigned} cases have no owner.`] : [])],
      risks: facts.overdue_checks ? [`${facts.overdue_checks} checks are past their due date.`] : [],
    };
    let runId: string | null = null;
    if (isAiConfigured()) {
      const r = await runStructured(admin, "briefing.daily", { orgId: o.id, jobId: job.id, source: "jobs/briefing", promptVersion: P.BRIEFING_VERSION }, {
        system: P.BRIEFING_SYSTEM,
        content: [P.text(`Figures for the last 24 hours and now:\n${JSON.stringify(facts)}`)],
        schema: P.BriefingSchema,
      });
      if (r.ok) {
        briefing = { ...r.data, bullets: r.data.bullets.slice(0, 8), risks: r.data.risks.slice(0, 5) };
        runId = r.runId;
      }
    }
    await suggest(admin, { org_id: o.id, run_id: runId, capability: "briefing.daily", entity_type: "org", entity_id: o.id, value: { ...briefing, facts, day: new Date().toISOString().slice(0, 10) } });
    const to = await managers(admin, o.id, "analytics.read");
    if (to.length) await admin.rpc("notify_users", { p_user_ids: to, p_type: "briefing.daily", p_title: `Morning briefing: ${briefing.headline}`, p_body: briefing.bullets.join(" "), p_link: "/app", p_org: o.id });
  }
  return { orgs: orgs?.length ?? 0 };
};

/** performance.rollup (00:30 Colombo): yesterday's figures per person. */
export const performanceRollup: JobHandler = async (job, { admin }) => {
  const p = payload<{ day?: string }>(job);
  const day = p.day ?? new Date(Date.now() + 5.5 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
  const { data, error } = await admin.rpc("performance_rollup", { p_day: day });
  if (error) throw new Error(`performance_rollup: ${error.message}`);
  return { day, rows: data };
};

const ISSUE_WORDS: Record<string, string> = {
  blurred: "it looks blurred",
  cropped: "part of it is cut off",
  too_dark: "it is too dark",
  glare: "there is glare on it",
  rotated: "it is turned sideways",
  low_resolution: "the picture is too small to read",
  missing_pages: "some pages seem to be missing",
};

/** What the candidate is told about an upload with a problem (fixed sentences). */
export function candidateFeedback(out: { readable: boolean; matches_expected: boolean; quality_issues: string[] }): string | null {
  if (!out.matches_expected) return "This file doesn't look like the document this slot asks for. Please check it and upload the right one.";
  const issues = out.quality_issues.map((i) => ISSUE_WORDS[i]).filter(Boolean);
  if (!out.readable || issues.length) return `We couldn't read this file clearly${issues.length ? ` (${issues.join(", ")})` : ""}. Please upload a sharper photo or scan.`;
  return null;
}

/** nudge.auto: push people over the overdue threshold; a second push in a week escalates. */
export const nudgeAuto: JobHandler = async (job, { admin }) => {
  const { data } = await admin.rpc("auto_nudge_candidates");
  let sent = 0;
  for (const c of (data ?? []) as { org_id: string; user_id: string; name: string; overdue: number; escalate: boolean }[]) {
    let message = `Hi ${c.name.split(" ")[0]}, you have ${c.overdue} overdue item${c.overdue === 1 ? "" : "s"}. Could you take a look today, or tell your manager what's holding them up so we can help?`;
    if (isAiConfigured()) {
      // Case references and due dates only: no candidate names (which clients type) reach the prompt.
      const raw = ((await admin.rpc("staff_open_items" as never, { p_user: c.user_id } as never)).data ?? []) as { kind: string; reference: string; due_at: string | null; overdue: boolean }[];
      const items = raw.filter((x) => x.overdue).slice(0, 20).map((x) => `- ${x.reference} (${x.kind === "case" ? "case" : "check"}, due ${x.due_at?.slice(0, 10) ?? "unknown"})`);
      const r = await runStructured(admin, "team.nudge", { orgId: c.org_id, jobId: job.id, source: "jobs/nudge-auto", promptVersion: P.NUDGE_VERSION }, {
        system: P.NUDGE_SYSTEM,
        content: [P.text(`Team member: ${c.name.split(" ")[0]}\nOverdue items:\n${items.join("\n") || "- none listed"}`)],
        schema: P.NudgeSchema,
      });
      if (r.ok && r.data.message.trim()) message = r.data.message.trim();
    }
    await admin.rpc("send_nudge", { p_to: c.user_id, p_message: message, p_channels: ["in_app", "email"] });
    if (c.escalate) await admin.rpc("escalate_nudge", { p_user: c.user_id, p_overdue: c.overdue });
    sent++;
  }
  return { sent };
};

/**
 * retention.purge (nightly): voice notes lose their audio after 30 days
 * (transcripts stay), and closed cases past their client's retention period
 * have the candidate's personal data erased (0035), files included.
 */
export const retentionPurge: JobHandler = async (_job, { admin }) => {
  const { data } = await admin.rpc("voice_notes_to_purge");
  const rows = (data ?? []) as { id: string; storage_path: string }[];
  if (rows.length) {
    await admin.storage.from("documents").remove(rows.map((r) => r.storage_path));
    await admin.from("assistant_voice_notes").update({ storage_path: null, status: "purged", purged_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  }

  const { data: due, error } = await admin.rpc("retention_due_cases", { p_limit: 50 });
  if (error) throw new Error(`retention_due_cases: ${error.message}`);
  let erased = 0;
  let files = 0;
  const failed: string[] = [];
  for (const c of (due ?? []) as { case_id: string; reference: string; retention_months: number }[]) {
    const r = await admin.rpc("erase_case", { p_case: c.case_id, p_reason: `Retention period of ${c.retention_months} months passed` });
    if (r.error) {
      failed.push(`${c.reference}: ${r.error.message}`);
      continue;
    }
    files += await removeObjects(admin, ((r.data as { objects?: { bucket: string; path: string }[] }).objects ?? []));
    erased++;
  }
  if (failed.length) {
    // Personal data past its retention period must not linger quietly: record it and fail the job.
    await admin.from("system_events").insert({ kind: "retention.failed", severity: "error", message: `Retention erasure failed for ${failed.length} case(s)`, context: { failed: failed.slice(0, 50) } });
    throw new Error(`retention erasure failed for ${failed.length} case(s): ${failed.slice(0, 3).join("; ")}`);
  }
  return { purged: rows.length, erased, files };
};
