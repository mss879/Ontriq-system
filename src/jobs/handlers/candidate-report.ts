import { createHash } from "node:crypto";
import { NonRetryableError, type JobHandler } from "../types";
import type { ServiceClient } from "../admin-client";
import { isAiConfigured, runStructured } from "../../lib/ai/claude";
import * as P from "../../lib/ai/prompts";
import { suggest } from "../ai/context";
import { candidateReportContent, type CandidateReportInput } from "../ai/content";
import { assembleReport, planAnnexures, type AnnexureFile } from "../report/assemble";
import { renderCandidateReportBody } from "../report/candidate-body";
import { answerText, appendixRef, cleanCandidateReport, type CandidateReportBody } from "../../domain/candidate/report";
import type { CandidateRowForm } from "../../domain/candidate/view";

/** How often the report waits for uploads still being read, 20 seconds at a time. */
const MAX_WAITS = 15;

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" }) : null);

async function candidateFiles(admin: ServiceClient, caseId: string) {
  const { data } = await admin
    .from("documents")
    .select("id, category, label, filename, mime, sha256, storage_bucket, storage_path, created_at, check:case_checks(sort), text:document_texts(text)")
    .eq("case_id", caseId)
    .eq("uploaded_by_kind", "candidate")
    .in("status", ["uploaded", "accepted"])
    .order("created_at");
  const signatureFile = (d: { category: string; mime: string; filename: string }) => d.category === "consent_form" && d.mime === "image/png" && d.filename === "signature.png";
  const sort = (d: { check: unknown }) => (d.check as { sort: number } | null)?.sort ?? 9999;
  return (data ?? []).filter((d) => !signatureFile(d)).sort((a, b) => sort(a) - sort(b));
}

const consentLine = (f: { status: string; method: string | null; signed_name: string | null; signed_at: string | null } | null) => {
  if (!f || f.status === "pending") return "Not signed";
  const how = f.method === "esign" ? `Signed online by ${f.signed_name}` : f.method === "upload" ? "Signed form uploaded" : "Signed form received by staff";
  return [how, day(f.signed_at)].filter(Boolean).join(", ");
};

/**
 * ai.candidate_report: the candidate confirmed (0047). Write up what they
 * provided, append their files and store the PDF for staff. The AI reads the
 * text already taken from each file, so nothing is read twice. If it can't
 * answer, the report still goes out with the facts and the files.
 */
export const aiCandidateReport: JobHandler = async (job, { admin, heartbeat }) => {
  const { document_id, waited = 0 } = (job.payload ?? {}) as { document_id?: string; waited?: number };
  if (!document_id) throw new NonRetryableError("ai.candidate_report job without document_id");
  const { data: report } = await admin.from("generated_documents").select("id, org_id, entity_id, version, status").eq("id", document_id).maybeSingle();
  if (!report?.entity_id) throw new NonRetryableError(`candidate report ${document_id} not found`);
  if (report.status !== "queued") return { skipped: report.status };
  const caseId = report.entity_id;

  try {
    const files = await candidateFiles(admin, caseId);
    // The report uses what the first read found, so give uploads a moment to finish.
    const { count: reading } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "ai.classify_document")
      .in("status", ["queued", "running"])
      .in("entity_id", files.map((f) => f.id));
    if (reading && waited < MAX_WAITS) {
      await admin.rpc("enqueue_job", {
        p_kind: "ai.candidate_report",
        p_payload: { document_id, waited: waited + 1 },
        p_idempotency_key: `ai.candidate_report:${document_id}:${waited + 1}`,
        p_run_after: new Date(Date.now() + 20_000).toISOString(),
        p_entity_type: "case",
        p_entity_id: caseId,
        p_org: report.org_id,
      });
      return { waiting: reading };
    }

    const { data: c } = await admin
      .from("cases")
      .select("id, org_id, client_id, reference, position_title, candidate_confirmed_at, client:clients(name), org:orgs(name, branding), candidate:candidates(full_name, nic, date_of_birth, email, phone, address)")
      .eq("id", caseId)
      .single();
    if (!c) throw new NonRetryableError(`case ${caseId} not found`);
    const [{ data: checks }, { data: requests }, { data: consent }, { data: cats }] = await Promise.all([
      admin.from("case_checks").select("label").eq("case_id", caseId).neq("state", "waived").order("sort"),
      admin.from("candidate_requests").select("title, field_type, options, answer, status").eq("case_id", caseId).in("status", ["answered", "accepted"]).order("created_at"),
      admin.from("consent_forms").select("status, method, signed_name, signed_at").eq("case_id", caseId).maybeSingle(),
      admin.from("document_categories").select("key, name").eq("org_id", c.org_id),
    ]);

    const catName = new Map((cats ?? []).map((x) => [x.key, x.name]));
    const textOf = (d: (typeof files)[number]) => {
      const t = d.text as unknown as { text: string } | { text: string }[] | null;
      return (Array.isArray(t) ? t[0]?.text : t?.text) ?? null;
    };
    const appendix = files.map((d, i) => ({ ref: appendixRef(i), title: d.label || (catName.get(d.category) ?? d.category), filename: d.filename, text: textOf(d) }));
    const answers = (requests ?? [])
      .map((q) => {
        const rowed = q.field_type === "repeatable_group" || q.field_type === "check_form";
        return { question: q.title, answer: answerText(q.answer as never, rowed ? (q.options as unknown as CandidateRowForm) : null, !rowed && Array.isArray(q.options) ? (q.options as { value: string; label: string }[]) : []) };
      })
      .filter((a) => a.answer);

    const candidate = c.candidate as unknown as CandidateReportInput["candidate"];
    const client = (c.client as unknown as { name: string }).name;
    const input: CandidateReportInput = { reference: c.reference, client, position: c.position_title, candidate, checks: (checks ?? []).map((k) => k.label), answers, documents: appendix };

    let ai: CandidateReportBody | null = null;
    let runId: string | null = null;
    if (isAiConfigured()) {
      const r = await runStructured(
        admin,
        "candidate.report",
        { orgId: c.org_id, clientId: c.client_id, caseId, jobId: job.id, source: "jobs/ai-candidate-report", promptVersion: P.CANDIDATE_REPORT_VERSION },
        { system: P.CANDIDATE_REPORT_SYSTEM, content: [P.text(candidateReportContent(input))], schema: P.CandidateReportSchema },
      );
      if (r.ok) {
        ai = cleanCandidateReport(r.data, appendix.map((a) => a.ref));
        runId = r.runId;
      } else if (r.reason === "unavailable") throw new Error(r.message);
    }
    await heartbeat({ step: "written" });

    const org = c.org as unknown as { name: string; branding: { display_name?: string; legal_name?: string } | null };
    const name = org.branding?.display_name || org.name;
    const body = await renderCandidateReportBody({
      org: { name, legal_name: org.branding?.legal_name || name },
      reference: c.reference,
      client,
      position: c.position_title,
      candidate: { ...candidate, date_of_birth: day(candidate.date_of_birth) },
      version: report.version,
      confirmedOn: day(c.candidate_confirmed_at),
      generatedOn: day(new Date().toISOString()) ?? "",
      consent: consentLine(consent),
      answers,
      appendix,
      ai,
    });

    const annexures: AnnexureFile[] = files.map((d, i) => ({
      document_id: d.id,
      title: appendix[i].title,
      filename: d.filename,
      mime: d.mime,
      kind: "evidence",
      check_label: null,
      sha256: d.sha256,
      read: async () => {
        const file = await admin.storage.from(d.storage_bucket).download(d.storage_path);
        return file.data ? new Uint8Array(await file.data.arrayBuffer()) : null;
      },
    }));
    // The candidate's report is one file for staff. The files themselves stay on the case.
    const plan = await planAnnexures(annexures, { parts: false });
    await heartbeat({ step: "files" });
    const assembled = await assembleReport(new Uint8Array(body), plan, { reference: c.reference, draft: false, label: "Appendix A" });

    const path = `org/${c.org_id}/case/${caseId}/candidate-report/v${report.version}-${report.id}.pdf`;
    const up = await admin.storage.from("documents").upload(path, assembled.bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const sha256 = createHash("sha256").update(assembled.bytes).digest("hex");
    await admin.from("generated_documents").update({ status: "ready", storage_path: path, sha256, page_count: assembled.pages, size_bytes: assembled.bytes.byteLength }).eq("id", report.id).eq("status", "queued");
    if (ai) await suggest(admin, { org_id: c.org_id, run_id: runId, capability: "candidate.report", entity_type: "case", entity_id: caseId, field_key: "candidate_report", value: ai, rationale: ai.summary });
    await admin.rpc("log_case_event", {
      p_case: caseId, p_check: null as never, p_kind: "candidate_report", p_title: "Candidate report is ready",
      p_body: ai ? `${files.length} ${files.length === 1 ? "file" : "files"} in the appendix. ${ai.points_to_check.length ? `${ai.points_to_check.length} to check.` : "Nothing flagged."}` : `${files.length} ${files.length === 1 ? "file" : "files"} in the appendix. Written without the AI.`,
      p_data: { document_id: report.id }, p_client: false, p_candidate: false,
    });
    return { pages: assembled.pages, files: files.length, ai: Boolean(ai), skipped: plan.filter((a) => a.status !== "embedded").map((a) => a.filename) };
  } catch (error) {
    if (job.attempts >= job.max_attempts) await admin.from("generated_documents").update({ status: "failed" }).eq("id", report.id).eq("status", "queued");
    throw error;
  }
};
