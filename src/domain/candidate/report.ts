/**
 * The candidate report: what a candidate provided, written up by the AI once
 * they confirm, with their files as an appendix. Pure: the job, the staff
 * screen and the tests share it.
 */
import { fieldDate } from "../reports/compile-core";
import { answerText as valueText, isBlank } from "./answers";
import { UPLOAD_STAGES } from "./steps";
import type { CandidateRow, CandidateRowForm } from "./view";

/** Files are cited as A1, A2… in the report and on each file's cover sheet. */
export const appendixRef = (index: number) => `A${index + 1}`;

type Cited = { appendix: string[] };
type Fact = Cited & { label: string; value: string };
export type CandidateReportBody = {
  summary: string;
  sections: { title: string; facts: Fact[]; note: string | null }[];
  points_to_check: (Cited & { note: string })[];
};

/** The AI's report with what can't be trusted taken out: references to files that don't exist, and empty facts. */
export function cleanCandidateReport(report: CandidateReportBody, refs: string[]): CandidateReportBody {
  const known = (list: string[]) => [...new Set(list.map((r) => r.trim().toUpperCase()))].filter((r) => refs.includes(r));
  return {
    summary: report.summary.trim(),
    sections: report.sections
      .map((s) => ({ title: s.title.trim(), note: s.note?.trim() || null, facts: s.facts.filter((f) => f.value.trim()).map((f) => ({ ...f, appendix: known(f.appendix) })) }))
      .filter((s) => s.facts.length),
    points_to_check: report.points_to_check.filter((p) => p.note.trim()).map((p) => ({ ...p, appendix: known(p.appendix) })),
  };
}

const cell = (field: CandidateRowForm["fields"][number] | undefined, value: CandidateRow[string]) => {
  const named = (v: string) => field?.options?.find((o) => o.value === v)?.label ?? fieldDate(v) ?? v;
  if (typeof value === "string") return named(value);
  if (Array.isArray(value)) return value.map(named).join(", ");
  const { from, to, present } = value;
  return [fieldDate(from), present ? "present" : fieldDate(to)].filter(Boolean).join(" to ");
};

/** A candidate's answer as text. Rows of employers or referees carry their labels. A value can be a list or a date range. */
export function answerText(answer: { value?: unknown; rows?: CandidateRow[] } | null, form?: CandidateRowForm | null, options: { value: string; label: string }[] = []): string {
  if (!isBlank(answer?.value)) return valueText(typeof answer?.value === "string" ? answer.value.trim() : answer?.value, options);
  const fieldOf = (key: string) => form?.fields.find((f) => f.key === key);
  const label = (key: string) => fieldOf(key)?.label ?? key.replace(/_/g, " ");
  return (answer?.rows ?? [])
    .map((row) =>
      Object.entries(row)
        .map(([key, value]) => [label(key), cell(fieldOf(key), value)] as const)
        .filter(([, text]) => text)
        .map(([name, text]) => `${name}: ${text}`)
        .join("; "),
    )
    .filter(Boolean)
    .join(" | ");
}

/** A candidate should confirm once nothing is owed, and again after giving anything new. */
export function shouldConfirm(nothingOwed: boolean, submission: { confirmed_at: string | null; changed_since: boolean }, stage: string): boolean {
  // Past verification the candidate has nothing left to send, and the page no longer says what is outstanding.
  if (!nothingOwed || !UPLOAD_STAGES.includes(stage)) return false;
  return !submission.confirmed_at || submission.changed_since;
}
