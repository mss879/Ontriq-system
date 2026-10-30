/**
 * The final report's content, compiled from a case (requirements §1.7): cover
 * details, a summary of every check (incomplete checks are never shown as
 * verified), one section per check with the fields marked for the report,
 * the result and remarks, the evidence list, annexures (the Global Sanction
 * report attached untouched), QC and approval details and the result legend.
 *
 * The snapshot is stored with each report version. Its canonical JSON hash
 * lets approval refuse a draft when the case changed after it was made
 * (public.approve_report in 0012). Keep it free of timestamps of the moment
 * it is compiled. Pure module (tests/unit/report.test.ts).
 */
import type { FieldDef } from "../check-types/schema";
import type { ResultTone } from "../check-types/schema";

export type ReportFieldRow = { label: string; value: string };
export type ReportGroup = { label: string; columns: string[]; rows: string[][] };

export type ReportCheck = {
  key: string;
  label: string;
  status: "verified" | "discrepancy" | "unable_to_verify" | "not_required" | "incomplete";
  status_label: string;
  result_label: string | null;
  result_tone: ResultTone | null;
  fields: ReportFieldRow[];
  groups: ReportGroup[];
  remarks: string | null;
  completed_on: string | null;
  evidence: string[];
};

export type ReportAnnexure = {
  document_id: string;
  title: string;
  filename: string;
  mime: string;
  kind: "evidence" | "fixed";
  check_label: string | null;
  sha256: string | null;
};

export type ReportSnapshot = {
  v: 1;
  org: { name: string; legal_name: string; address: string; phone: string; email: string; website: string };
  case: {
    reference: string;
    client: string;
    client_reference: string | null;
    position: string | null;
    department: string | null;
    package: string | null;
    process: string;
    received_on: string;
    completed_on: string | null;
  };
  candidate: { full_name: string; nic: string | null; date_of_birth: string | null };
  summary: { label: string; status: ReportCheck["status"]; status_label: string; result_label: string | null; result_tone: ResultTone | null }[];
  checks: ReportCheck[];
  annexures: ReportAnnexure[];
  qc: { kind: "pre" | "post"; reviewer: string; on: string }[];
  proposed_result: ResultTone | null;
};

export type ReportInputs = {
  org: ReportSnapshot["org"];
  case: {
    reference: string;
    client_name: string;
    client_reference: string | null;
    position_title: string | null;
    department: string | null;
    package_name: string | null;
    process_type: string;
    received_at: string;
    completed_at: string | null;
    proposed_result: ResultTone | null;
  };
  candidate: { full_name: string; nic: string | null; date_of_birth: string | null };
  checks: {
    id: string;
    key: string;
    label: string;
    sort: number;
    state: string;
    result: string | null;
    result_tone: ResultTone | null;
    client_note: string | null;
    values: Record<string, unknown>;
    completed_at: string | null;
    schema: { fields: FieldDef[]; result: { options: { key: string; label: string; tone: ResultTone }[] }; fixed_annexure?: { category: string } };
  }[];
  documents: { id: string; case_check_id: string | null; category: string; category_name: string; filename: string; mime: string; sha256: string | null; created_at: string }[];
  qc: { kind: "pre" | "post"; reviewer: string; created_at: string }[];
};

const DATE_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" };

/** "12 Mar 2024" from an ISO date or timestamp. */
export function reportDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+05:30`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", DATE_FMT);
}

export function formatFieldValue(f: FieldDef, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const optionLabel = (v: unknown) => f.options?.find((o) => o.value === v)?.label ?? String(v);
  switch (f.type) {
    case "date":
      return reportDate(String(raw)) ?? "—";
    case "date_range": {
      const r = raw as { from?: string; to?: string };
      if (!r.from && !r.to) return "—";
      return `${reportDate(r.from) ?? "?"} to ${r.to ? reportDate(r.to) : "present"}`;
    }
    case "boolean":
      return raw === true ? "Yes" : raw === false ? "No" : String(raw);
    case "select":
      return optionLabel(raw);
    case "multi_select":
      return (Array.isArray(raw) ? raw : [raw]).map(optionLabel).join(", ") || "—";
    case "number":
      return typeof raw === "number" ? raw.toLocaleString("en-GB") : String(raw);
    default:
      return String(raw);
  }
}

const STATUS: Record<ReportCheck["status"], string> = {
  verified: "Verified",
  discrepancy: "Discrepancy found",
  unable_to_verify: "Unable to verify",
  not_required: "Not required",
  incomplete: "Not completed",
};

function checkStatus(state: string): ReportCheck["status"] {
  if (state === "completed") return "verified";
  if (state === "discrepancy") return "discrepancy";
  if (state === "unable_to_verify") return "unable_to_verify";
  if (state === "waived") return "not_required";
  return "incomplete";
}

export function compileReport(input: ReportInputs): ReportSnapshot {
  const checks = [...input.checks].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  const evidenceFor = (checkId: string) =>
    input.documents.filter((d) => d.case_check_id === checkId).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const reportChecks: ReportCheck[] = checks.map((k) => {
    const status = checkStatus(k.state);
    const done = status === "verified" || status === "discrepancy" || status === "unable_to_verify";
    const option = k.schema.result.options.find((o) => o.key === k.result);
    const reportFields = k.schema.fields.filter((f) => f.visibility?.report !== false);
    const fields: ReportFieldRow[] = reportFields
      .filter((f) => f.type !== "repeatable_group")
      .map((f) => ({ label: f.label, value: formatFieldValue(f, k.values[f.key]) }))
      .filter((r) => r.value !== "—");
    const groups: ReportGroup[] = reportFields
      .filter((f) => f.type === "repeatable_group" && Array.isArray(k.values[f.key]) && (k.values[f.key] as unknown[]).length)
      .map((f) => {
        const sub = (f.fields ?? []).filter((s) => s.visibility?.report !== false);
        const items = k.values[f.key] as Record<string, unknown>[];
        return { label: f.label, columns: sub.map((s) => s.label), rows: items.map((item) => sub.map((s) => formatFieldValue(s, item?.[s.key]))) };
      });
    return {
      key: k.key,
      label: k.label,
      status,
      status_label: STATUS[status],
      // Results appear only for checks that reached a result; incomplete checks are never shown as verified.
      result_label: done ? (option?.label ?? null) : null,
      result_tone: done ? (k.result_tone ?? option?.tone ?? null) : null,
      fields: done || status === "not_required" ? fields : [],
      groups: done ? groups : [],
      remarks: k.client_note?.trim() || null,
      completed_on: done ? reportDate(k.completed_at) : null,
      evidence: evidenceFor(k.id).map((d) => `${d.category_name}: ${d.filename}`),
    };
  });

  const fixedCategories = new Set(checks.map((k) => k.schema.fixed_annexure?.category).filter(Boolean) as string[]);
  const checkLabel = new Map(checks.map((k) => [k.id, k.label]));
  const docs = [...input.documents].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const annexures: ReportAnnexure[] = [
    ...docs.filter((d) => !fixedCategories.has(d.category)).map((d) => ({ d, kind: "evidence" as const })),
    ...docs.filter((d) => fixedCategories.has(d.category)).map((d) => ({ d, kind: "fixed" as const })),
  ].map(({ d, kind }) => ({
    document_id: d.id,
    title: kind === "fixed" ? d.category_name : `${d.case_check_id ? `${checkLabel.get(d.case_check_id) ?? "Case"} · ` : ""}${d.category_name}`,
    filename: d.filename,
    mime: d.mime,
    kind,
    check_label: d.case_check_id ? (checkLabel.get(d.case_check_id) ?? null) : null,
    sha256: d.sha256,
  }));

  const latestQc = (kind: "pre" | "post") =>
    input.qc.filter((q) => q.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return {
    v: 1,
    org: input.org,
    case: {
      reference: input.case.reference,
      client: input.case.client_name,
      client_reference: input.case.client_reference,
      position: input.case.position_title,
      department: input.case.department,
      package: input.case.package_name,
      process: input.case.process_type === "candidate_collected" ? "Documents collected from the candidate by Ontriq" : "Documents supplied by the client",
      received_on: reportDate(input.case.received_at) ?? "",
      completed_on: reportDate(input.case.completed_at),
    },
    candidate: { full_name: input.candidate.full_name, nic: input.candidate.nic, date_of_birth: reportDate(input.candidate.date_of_birth) },
    summary: reportChecks.map((c) => ({ label: c.label, status: c.status, status_label: c.status_label, result_label: c.result_label, result_tone: c.result_tone })),
    checks: reportChecks,
    annexures,
    qc: (["pre", "post"] as const).flatMap((kind) => {
      const q = latestQc(kind);
      return q ? [{ kind, reviewer: q.reviewer, on: reportDate(q.created_at) ?? "" }] : [];
    }),
    proposed_result: input.case.proposed_result,
  };
}

/** JSON with object keys sorted, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export const RESULT_WORDS: Record<ResultTone, { label: string; meaning: string }> = {
  green: { label: "Clear", meaning: "All checks completed and verified without discrepancies." },
  amber: { label: "Review", meaning: "Some information could not be verified or is pending; read the findings." },
  red: { label: "Discrepancy", meaning: "At least one check found information that does not match what was declared." },
};
