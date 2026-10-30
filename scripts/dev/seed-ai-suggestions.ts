/**
 * Development helper: put realistic AI suggestions on one local case so the
 * review screens can be checked without an API key, and take them away again.
 *
 *   npx tsx --env-file=.env.local scripts/dev/seed-ai-suggestions.ts [ONT-2026-000001]
 *   npx tsx --env-file=.env.local scripts/dev/seed-ai-suggestions.ts --clean
 *
 * Without a reference it picks the newest open case with checks and files.
 * Seeded rows carry the marker "dev-seed" (source_refs, or the classification
 * model) so --clean removes exactly them and the decisions made on them.
 * Local stack only; service role.
 */
import { createServiceClient } from "../../src/jobs/admin-client";
import { checkTypeSchema, type FieldDef } from "../../src/domain/check-types/schema";
import type { Json } from "../../src/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local stack only");
const admin = createServiceClient();
const MARK = "dev-seed";
const args = process.argv.slice(2);

async function clean() {
  const { data: rows } = await admin.from("ai_suggestions").select("id").contains("source_refs", JSON.stringify([MARK]));
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length) {
    for (const id of ids) await admin.from("case_events").delete().eq("kind", "ai_decision").contains("data", { suggestion_id: id });
    await admin.from("ai_suggestions").delete().in("id", ids);
  }
  const { data: docs } = await admin.from("document_ai").select("document_id").contains("classification", { model: MARK });
  if (docs?.length) await admin.from("document_ai").delete().in("document_id", docs.map((d) => d.document_id));
  console.log(`removed ${ids.length} suggestions and ${docs?.length ?? 0} file readings`);
}

function sample(f: FieldDef, i: number): unknown {
  const k = f.key.toLowerCase();
  switch (f.type) {
    case "date":
      return k.includes("birth") ? "1994-03-12" : "2016-12-31";
    case "date_range":
      return { from: "2018-02-01", to: "2021-06-30" };
    case "select":
      return f.options?.[0]?.value ?? null;
    case "multi_select":
      return f.options?.length ? [f.options[0].value] : null;
    case "boolean":
      return true;
    case "number":
      return k.includes("year") ? 2015 : 3;
    case "nic":
      return "199407201234";
    case "email":
      return "hr@abc.lk";
    case "phone":
      return "+94112345678";
    case "text":
    case "textarea":
      if (k.includes("name") && k.includes("candidate")) return "Kasun Anuradha Perera";
      if (k.includes("institution") || k.includes("school") || k.includes("university")) return "University of Colombo";
      if (k.includes("company") || k.includes("employer")) return "ABC Holdings (Pvt) Ltd";
      if (k.includes("designation") || k.includes("title") || k.includes("position")) return "Senior Accountant";
      if (k.includes("index") || k.includes("roll") || k.includes("number") || k.includes("code")) return `IDX${4400 + i}`;
      if (k.includes("qualification") || k.includes("degree")) return "BSc (Hons) in Accounting";
      return `${f.label} as printed`;
    default:
      return null;
  }
}

async function seed(reference?: string) {
  let q = admin.from("cases").select("id, org_id, reference, stage").not("stage", "in", "(released,cancelled)").order("received_at", { ascending: false });
  if (reference) q = q.eq("reference", reference);
  const { data: cases } = await q.limit(30);
  let picked: { id: string; org_id: string; reference: string; stage: string } | null = null;
  for (const c of cases ?? []) {
    const { count } = await admin.from("documents").select("id", { count: "exact", head: true }).eq("case_id", c.id).neq("status", "pending_upload");
    if (reference || (count ?? 0) > 0) {
      picked = c;
      break;
    }
  }
  picked ??= cases?.[0] ?? null;
  if (!picked) throw new Error(reference ? `no open case ${reference}` : "no open case");
  const c = picked;
  const { data: checks } = await admin.from("case_checks").select("id, label, values, version:check_type_versions(schema)").eq("case_id", c.id).order("sort");
  const { data: docs } = await admin.from("documents").select("id, filename, category").eq("case_id", c.id).neq("status", "pending_upload").order("created_at");
  const { data: reqs } = await admin.from("case_check_requirements").select("category, label").eq("case_id", c.id).limit(3);
  const rows: Record<string, unknown>[] = [];
  const add = (r: { capability: string; entity_type: string; entity_id: string; field_key?: string | null; value: unknown; confidence?: number | null; rationale?: string | null }) =>
    rows.push({ org_id: c.org_id, run_id: null, field_key: null, confidence: null, rationale: null, ...r, source_refs: [MARK] });

  const firstDoc = docs?.[0]?.filename ?? "nic-front.jpg";
  add({
    capability: "case.consistency",
    entity_type: "case",
    entity_id: c.id,
    value: {
      issues: [
        { severity: "medium", topic: "name", description: "The degree certificate reads \"K. A. Perera\" while the NIC reads \"Kasun Anuradha Perera\". Initials are common; confirm with the university.", documents: [firstDoc] },
        { severity: "low", topic: "dates", description: "The service letter's end date (30 June 2021) is a month after the resignation letter (31 May 2021).", documents: [] },
      ],
      summary: "Two small differences to check; nothing contradicts the declared details.",
    },
    rationale: "Two small differences to check.",
  });
  add({
    capability: "case.preqc",
    entity_type: "case",
    entity_id: c.id,
    value: {
      checklist: [
        { item: "Every required document is in", ok: false, note: reqs?.[0] ? `${reqs[0].label} is still missing` : "One document is still missing" },
        { item: "Files are readable", ok: true, note: null },
        { item: "Names and NIC agree across documents", ok: true, note: "Initials differ on the degree certificate" },
      ],
      requests: [
        { to: "candidate", kind: "document", title: reqs?.[0]?.label ?? "O/L certificate", message: "Please upload a clear photo of the full page, with all four corners visible.", category: reqs?.[0]?.category ?? null },
        { to: "client", kind: "question", title: "Employment dates", message: "Could you confirm the candidate's start date at ABC Holdings? The CV and the service letter differ.", category: null },
      ],
      summary: "Nearly complete: one document to collect and one date to confirm.",
    },
    rationale: "Nearly complete.",
  });
  add({
    capability: "case.postqc",
    entity_type: "case",
    entity_id: c.id,
    value: {
      checks: (checks ?? []).slice(0, 3).map((k, i) => ({ check: k.label, ok: i !== 1, concerns: i === 1 ? ["Marked complete, but the confirmation email isn't on file"] : [] })),
      missing: ["Referee 2 feedback"],
      proposed_result: "amber",
      reasoning: "Most checks are clear; one result isn't backed by evidence yet and a referee hasn't answered.",
    },
    rationale: "One result needs evidence.",
  });
  add({ capability: "report.narrative", entity_type: "case", entity_id: c.id, field_key: "executive_summary", value: { text: "Ontriq verified the candidate's identity, education and employment with the issuing sources. All details matched except the employment end date, which the employer confirmed as 31 May 2021." } });

  for (const [i, k] of (checks ?? []).slice(0, 2).entries()) {
    const schema = checkTypeSchema.parse((k.version as unknown as { schema: unknown }).schema);
    const values = (k.values ?? {}) as Record<string, unknown>;
    const fields = schema.fields.filter((f) => f.type !== "repeatable_group");
    const pick = fields.filter((f) => f.ai?.extract).length ? fields.filter((f) => f.ai?.extract) : fields;
    for (const [j, f] of pick.slice(0, 5).entries()) {
      const value = sample(f, j);
      if (value === null || JSON.stringify(values[f.key]) === JSON.stringify(value)) continue;
      add({ capability: "document.extract", entity_type: "case_check", entity_id: k.id, field_key: f.key, value, confidence: [0.94, 0.9, 0.72, 0.55, 0.88][j], rationale: `From ${docs?.[j % Math.max(1, docs.length)]?.filename ?? firstDoc}` });
    }
    add({ capability: "report.narrative", entity_type: "case_check", entity_id: k.id, field_key: "remarks", value: { text: `Ontriq confirmed the ${k.label.toLowerCase()} details with the issuing source. The details matched the candidate's declaration.` } });
    if (i === 0) {
      const green = schema.result.options.find((o) => o.tone === "green")?.key ?? "clear";
      add({ capability: "check.outreach", entity_type: "case_check", entity_id: k.id, field_key: "outreach", value: { subject: `Verification request: ${k.label}`, body: "Dear Sir or Madam,\n\nOntriq (Pvt) Ltd is verifying the details below with the candidate's consent. Could you confirm whether they are correct?\n\nThank you,\nOntriq Verification Team", call_script: "Introduce Ontriq, mention the candidate's consent, read out each detail and note what they confirm.", follow_up_days: 3 } });
      add({
        capability: "check.response",
        entity_type: "case_check",
        entity_id: k.id,
        field_key: "result",
        value: {
          comparisons: pick.slice(0, 3).map((f, j) => ({ field: f.label, claimed: String(sample(f, j) ?? "—"), confirmed: String(sample(f, j) ?? "—"), matches: true })),
          proposed_result: green,
          confidence: 0.9,
          reasoning: "The source confirmed every detail asked about.",
          client_note: "The issuing source confirmed the details provided.",
        },
        confidence: 0.9,
        rationale: "The source confirmed every detail asked about.",
      });
    }
  }

  if (docs?.[0]) {
    add({ capability: "document.classify", entity_type: "document", entity_id: docs[0].id, field_key: "quality", value: { readable: true, matches_expected: true, issues: ["blurred", "glare"], detected: docs[0].category, message: "Your photo is a little blurred. Please retake it in good light, without flash." }, confidence: 0.6, rationale: "Quality problems" });
    const { data: existing } = await admin.from("document_ai").select("document_id").eq("document_id", docs[0].id).maybeSingle();
    if (!existing) {
      await admin.from("document_ai").insert({ document_id: docs[0].id, org_id: c.org_id, classification: { document_type: docs[0].category, readable: true, matches_expected: true, quality_issues: ["blurred", "glare"], language: "en", possible_tampering: false, model: MARK } as NonNullable<Json>, quality: { readable: true, issues: ["blurred", "glare"] } as NonNullable<Json> });
    }
  }
  if (docs?.[1]) {
    add({ capability: "document.tamper", entity_type: "document", entity_id: docs[1].id, field_key: "tamper", value: { notes: "The date's font differs from the rest of the letter." }, confidence: 0.5, rationale: "The date's font differs from the rest of the letter." });
  }

  const { error } = await admin.from("ai_suggestions").insert(rows as never);
  if (error) throw new Error(error.message);
  console.log(`seeded ${rows.length} suggestions on ${c.reference} (${c.stage}) · /app/cases/${c.id}`);
  if (checks?.[0]) console.log(`check page: /app/cases/${c.id}/checks/${checks[0].id}`);
}

(args.includes("--clean") ? clean() : seed(args.find((a) => !a.startsWith("--")))).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
