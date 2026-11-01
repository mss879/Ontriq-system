/**
 * Turning what a candidate sent into what a check stores (spec 2.2). Answers
 * arrive as values since 0048, but older ones hold what the candidate read:
 * an option's label, or "2020-01-01 – 2021-06-30". Pure module
 * (tests/unit/candidate-answers.test.ts).
 */
import type { FieldDef } from "../check-types/schema";

export type DateRangeAnswer = { from?: string; to?: string; present?: boolean };
export type AnswerValue = string | string[] | DateRangeAnswer;
export type GivenAnswer = { value?: unknown; rows?: Record<string, unknown>[] } | null | undefined;

type Option = { value: string; label: string };

export const isBlank = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => x === undefined || x === null || x === ""));

const optionValue = (options: Option[] | undefined, raw: unknown) => {
  const text = String(raw).trim();
  const hit = options?.find((o) => o.value === text || o.label.toLowerCase() === text.toLowerCase());
  return hit ? hit.value : text;
};

function asRange(raw: unknown): DateRangeAnswer | null {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as DateRangeAnswer;
  if (typeof raw !== "string") return null;
  const [from, to] = raw.split(/\s+[–-]\s+/).map((s) => s.trim());
  return from ? { from, ...(to ? { to } : {}) } : null;
}

/** The value a field stores for this answer, or undefined if there is nothing to use. */
export function answerToFieldValue(field: Pick<FieldDef, "type" | "options">, raw: unknown): unknown {
  if (isBlank(raw)) return undefined;
  switch (field.type) {
    case "date_range": {
      const r = asRange(raw);
      return r && !isBlank(r) ? r : undefined;
    }
    case "select":
      return optionValue(field.options, raw);
    case "multi_select": {
      const list = Array.isArray(raw) ? raw : String(raw).split(/,\s*/);
      return list.map((v) => optionValue(field.options, v)).filter((v) => v !== "");
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? n : raw;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const text = String(raw).trim().toLowerCase();
      return text === "yes" || text === "true" ? true : text === "no" || text === "false" ? false : text;
    }
    default:
      return raw;
  }
}

/** A row's name: the group's first text field in the check type's order. Postgres doesn't keep key order. */
function rowName(group: Pick<FieldDef, "fields"> | undefined, row: Record<string, unknown>): string {
  const first = group?.fields?.find((f) => f.type === "text" && !isBlank(row[f.key]));
  return first ? String(row[first.key]).trim().toLowerCase() : "";
}

/**
 * Rows join what staff already entered. A row with the same name updates it,
 * once: two jobs at one company are two rows, in an answer as on a check.
 * Others are added.
 */
export function mergeRows(group: Pick<FieldDef, "fields"> | undefined, existing: unknown, incoming: Record<string, unknown>[]): Record<string, unknown>[] {
  const rows = Array.isArray(existing) ? (existing as Record<string, unknown>[]).filter((r) => Object.keys(r ?? {}).length) : [];
  const open = rows.map((_, i) => i);
  for (const row of incoming) {
    const name = rowName(group, row);
    const at = name ? open.findIndex((i) => rowName(group, rows[i]) === name) : -1;
    if (at >= 0) {
      const [i] = open.splice(at, 1);
      rows[i] = { ...rows[i], ...row };
    } else rows.push(row);
  }
  return rows;
}

/** field_key of the form covering a check's single details (public.issue_bgv_form, 0048). */
export const DETAILS_FORM_KEY = "__details";

/** Only what the check type lets a candidate fill, whatever a tampered form sent. Findings aren't theirs to write. */
const candidateFills = (f: FieldDef) => f.fill_by?.includes("candidate") === true && f.stage !== "verification";

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) || String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Where an answer differs from what is already on the check. */
export type AnswerConflict = { key: string; label: string; current: unknown; answer: unknown };
export type AppliedAnswer = { ok: true; values: Record<string, unknown>; conflicts: AnswerConflict[] } | { ok: false; error: string };

/**
 * The check's values once this answer is used, or why it can't be. A whole
 * form fills gaps. Where it differs from what is there it says so, and replaces
 * it only when a person chose that: a correction shouldn't vanish, and neither
 * should what staff entered. A single detail was asked for on purpose, so it
 * replaces what is there.
 */
export function applyAnswer(fields: FieldDef[], current: Record<string, unknown>, fieldKey: string, given: GivenAnswer, opts: { replace?: boolean } = {}): AppliedAnswer {
  const none = { ok: false as const, error: "There is no answer to use yet." };
  if (fieldKey === DETAILS_FORM_KEY) {
    const row = given?.rows?.[0];
    if (!row) return none;
    const values = { ...current };
    const conflicts: AnswerConflict[] = [];
    let seen = 0;
    for (const f of fields) {
      if (f.type === "repeatable_group" || !candidateFills(f)) continue;
      const v = answerToFieldValue(f, row[f.key]);
      if (isBlank(v)) continue;
      seen += 1;
      if (isBlank(values[f.key])) values[f.key] = v;
      else if (!sameValue(values[f.key], v)) {
        conflicts.push({ key: f.key, label: f.label, current: values[f.key], answer: v });
        if (opts.replace) values[f.key] = v;
      }
    }
    return seen ? { ok: true, values, conflicts } : none;
  }
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) return { ok: false, error: "That detail is no longer part of the check." };
  if (field.type === "repeatable_group") {
    if (!given?.rows?.length) return none;
    const rows = given.rows.map((row) =>
      Object.fromEntries(
        (field.fields ?? []).filter(candidateFills).flatMap((f) => {
          const v = answerToFieldValue(f, row[f.key]);
          return isBlank(v) ? [] : [[f.key, v]];
        }),
      ),
    );
    const used = rows.filter((r) => Object.keys(r).length);
    if (!used.length) return none;
    return { ok: true, values: { ...current, [fieldKey]: mergeRows(field, current[fieldKey], used) }, conflicts: [] };
  }
  const v = answerToFieldValue(field, given?.value);
  return isBlank(v) ? none : { ok: true, values: { ...current, [fieldKey]: v }, conflicts: [] };
}

type TextOptions = { to?: string; present?: string; date?: (iso: string) => string };

/** An answer as a person reads it. Pass `date` to show dates as the audience expects. */
export function answerText(value: unknown, options: Option[] = [], text: TextOptions = {}): string {
  if (isBlank(value)) return "";
  const { to = "to", present = "present", date = (iso: string) => iso } = text;
  const label = (v: unknown) => {
    const shown = options.find((o) => o.value === String(v))?.label ?? String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(shown) ? date(shown) : shown;
  };
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (typeof value === "object") {
    const r = value as DateRangeAnswer;
    return `${r.from ? date(r.from) : "?"} ${to} ${r.present ? present : r.to ? date(r.to) : "?"}`;
  }
  return label(value);
}
