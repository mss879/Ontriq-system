/**
 * The final report's content, compiled from a case (requirements §1.7): cover
 * details, a summary of every check (incomplete checks are never shown as
 * verified), one section per check with the fields marked for the report,
 * the result and remarks, the evidence list, annexures (the Global Sanction
 * report attached untouched), QC and approval details and the result legend.
 *
 * The snapshot is stored with each report version. Its canonical JSON hash
 * lets approval refuse a draft when the case changed after it was made
 * (public.approve_report, with the database's own stamp in 0049). Keep it free
 * of timestamps of the moment it is compiled. Pure module (tests/unit/report.test.ts).
 */
import { recordLabel } from "../check-types/records";
import { GENERAL_CATEGORIES, pagesLabel } from "../documents/combined";
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
  /** What a combined file holds, for its cover sheet. */
  contents?: string[];
  /** What Pre-QC saw, when someone marked it (the flowchart's copy or original step). */
  original?: "original" | "certified_copy" | "copy";
};

export type ReportSnapshot = {
  v: 1;
  org: { name: string; legal_name: string; address: string; phone: string; email: string; website: string };
  case: {
    reference: string;
    client: string;
    client_address?: string | null;
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
    client_address?: string | null;
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
  documents: {
    id: string;
    case_check_id: string | null;
    category: string;
    category_name: string;
    filename: string;
    mime: string;
    sha256: string | null;
    created_at: string;
    record_key?: string | null;
    holds?: { check_id: string | null; label: string; pages: string | null }[];
    /** A file on the case as a whole that counts for this check, as the only slot of its kind. */
    for_check?: string | null;
    original_kind?: string | null;
    /** Sensitive evidence someone decided to keep out of the report. The check says it exists, the file stays with Ontriq. */
    withheld?: boolean;
  }[];
  qc: { kind: "pre" | "post"; reviewer: string; created_at: string }[];
};

/** Document categories annexed automatically on this case (the Global Sanction report). A waived check needs none. */
export function fixedAnnexureCategories(checks: { state: string; schema: { fixed_annexure?: { category: string } } }[]): string[] {
  return [...new Set(checks.flatMap((k) => (k.state !== "waived" && k.schema.fixed_annexure ? [k.schema.fixed_annexure.category] : [])))];
}

const DATE_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" };

/** Spec 4.2: dates in the check's details read DD/MM/YY. */
export function fieldDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}

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
      return fieldDate(String(raw)) ?? "—";
    case "date_range": {
      const r = raw as { from?: string; to?: string; present?: boolean };
      if (!r.from && !r.to) return "—";
      if (r.to) return `${fieldDate(r.from) ?? "?"} to ${fieldDate(r.to)}`;
      return r.present ? `${fieldDate(r.from) ?? "?"} to present` : `From ${fieldDate(r.from)}`;
    }
    case "boolean":
      return raw === true ? "Yes" : raw === false ? "No" : String(raw);
    case "select":
      return optionLabel(raw);
    case "multi_select":
      return (Array.isArray(raw) ? raw : [raw]).map(optionLabel).join(", ") || "—";
    default:
      // Numbers too: a year of completion reads 2015, not 2,015.
      return String(raw);
  }
}

const STATUS: Record<ReportCheck["status"], string> = {
  verified: "Verified",
  discrepancy: "Discrepancy found",
  unable_to_verify: "Unable to verify",
  not_required: "Not required",
  incomplete: "Pending",
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
    input.documents.filter((d) => d.case_check_id === checkId || d.for_check === checkId || d.holds?.some((h) => h.check_id === checkId)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const atPages = (filename: string, pages: string | null) => [filename, pagesLabel(pages)].filter(Boolean).join(", ");
  const firstPage = (h: { pages: string | null }) => Number.parseInt(h.pages ?? "") || Infinity;

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
      // A finished check with an amber result isn't simply "verified".
      status_label: status === "verified" && (k.result_tone ?? option?.tone) === "amber" ? "Completed, see remarks" : STATUS[status],
      // Results appear only for checks that reached a result; incomplete checks are never shown as verified.
      result_label: done ? (option?.label ?? null) : null,
      result_tone: done ? (k.result_tone ?? option?.tone ?? null) : null,
      fields: done || status === "not_required" ? fields : [],
      groups: done ? groups : [],
      // A reopened check keeps its old note until someone rewrites it, and that isn't a finding.
      remarks: done || status === "not_required" ? k.client_note?.trim() || null : null,
      completed_on: done ? reportDate(k.completed_at) : null,
      evidence: evidenceFor(k.id).map((d) => {
        if (d.withheld) return `${d.category_name}: held on file by ${input.org.name}, not attached`;
        const held = d.case_check_id === k.id ? undefined : d.holds?.find((h) => h.check_id === k.id);
        if (held) return `${held.label}: ${atPages(d.filename, held.pages)}`;
        const record = recordLabel(k.schema.fields, k.values, d.record_key);
        return `${d.category_name}${record ? ` (${record})` : ""}: ${d.filename}`;
      }),
    };
  });

  const fixedCategories = new Set(checks.map((k) => k.schema.fixed_annexure?.category).filter(Boolean) as string[]);
  const checkLabel = new Map(checks.map((k) => [k.id, k.label]));
  const recordOf = (d: ReportInputs["documents"][number]) => {
    const k = checks.find((x) => x.id === d.case_check_id);
    return k ? recordLabel(k.schema.fields, k.values, d.record_key) : null;
  };
  const home = (d: ReportInputs["documents"][number]) => d.case_check_id ?? d.for_check ?? null;
  // Annexures follow the report: by check, then by employer or referee, then as they arrived.
  const place = (d: ReportInputs["documents"][number]) => {
    const at = checks.findIndex((k) => k.id === home(d));
    return at < 0 ? checks.length : at;
  };
  const docs = input.documents
    .filter((d) => !d.withheld)
    .sort((a, b) => place(a) - place(b) || (a.record_key ?? "").localeCompare(b.record_key ?? "") || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const annexures: ReportAnnexure[] = [
    ...docs.filter((d) => !fixedCategories.has(d.category)).map((d) => ({ d, kind: "evidence" as const })),
    ...docs.filter((d) => fixedCategories.has(d.category)).map((d) => ({ d, kind: "fixed" as const })),
  ].map(({ d, kind }) => ({
    document_id: d.id,
    title: d.holds?.length ? "Combined file" : kind === "fixed" ? d.category_name : `${home(d) ? `${checkLabel.get(home(d) as string) ?? "Case"} · ` : ""}${d.category_name}${recordOf(d) ? ` · ${recordOf(d)}` : ""}`,
    filename: d.filename,
    mime: d.mime,
    kind,
    check_label: home(d) ? (checkLabel.get(home(d) as string) ?? null) : null,
    sha256: d.sha256,
    ...(d.original_kind === "original" || d.original_kind === "certified_copy" || d.original_kind === "copy" ? { original: d.original_kind } : {}),
    ...(d.holds?.length
      ? { contents: [...(GENERAL_CATEGORIES.has(d.category) ? [] : [d.category_name]), ...[...d.holds].sort((a, b) => firstPage(a) - firstPage(b)).map((h) => atPages(h.label, h.pages))] }
      : {}),
  }));

  const latestQc = (kind: "pre" | "post") =>
    input.qc.filter((q) => q.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return {
    v: 1,
    org: input.org,
    case: {
      reference: input.case.reference,
      client: input.case.client_name,
      ...(input.case.client_address ? { client_address: input.case.client_address } : {}),
      client_reference: input.case.client_reference,
      position: input.case.position_title,
      department: input.case.department,
      package: input.case.package_name,
      process: input.case.process_type === "candidate_collected" ? "Documents collected from the candidate by Ontriq" : "Documents supplied by the client",
      received_on: reportDate(input.case.received_at) ?? "",
      // A report that went out with pending checks hasn't finished verification.
      completed_on: reportChecks.some((k) => k.status === "incomplete") ? null : reportDate(input.case.completed_at),
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
  green: { label: "Clear", meaning: "Checks have been completed without significant discrepancies." },
  amber: { label: "Pending / Review", meaning: "One or more checks remain pending, or additional evidence or review is required." },
  red: { label: "Discrepancy Identified", meaning: "A discrepancy has been identified and requires review or appropriate follow-up." },
};
