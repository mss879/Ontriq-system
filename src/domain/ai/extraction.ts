/**
 * Reading documents into a check: which file feeds which check, which fields
 * the AI may fill, what lands in the form, and what is still missing after.
 * Pure: the background jobs, the check form and the tests all share it.
 */
import { validateCheckValues, type ValidationMode } from "../check-types/validate";
import type { FieldDef } from "../check-types/schema";

/** Details a person attests to after verifying. They are never read off a document. */
const ATTESTED = new Set(["verified_by", "confirmed_by", "confirmed_on", "confirmation_channel", "validation_source", "sanctions_found", "feedback", "visit_date", "visit_notes"]);

/** Categories that aren't about one check: a CV, or one PDF holding a candidate's details. */
const GENERAL_CATEGORIES = new Set(["cv", "other"]);

/** At or above this, a value found for an empty field is placed in the form for the person to check and save. */
export const AUTOFILL_CONFIDENCE = 0.6;

const canRead = (f: FieldDef) => (f.ai ? f.ai.extract : !ATTESTED.has(f.key));

/** The fields worth asking about: plain ones, and repeating groups (employers, referees) with their columns. */
export function extractionFields(fields: FieldDef[]): { flat: FieldDef[]; groups: (FieldDef & { fields: FieldDef[] })[] } {
  return {
    flat: fields.filter((f) => f.type !== "repeatable_group" && canRead(f)),
    groups: fields.flatMap((f) => {
      if (f.type !== "repeatable_group") return [];
      const columns = (f.fields ?? []).filter(canRead);
      return columns.length ? [{ ...f, fields: columns }] : [];
    }),
  };
}

type DocRef = { case_check_id: string | null; category: string };
type RequirementRef = { case_check_id: string | null; category: string };

/**
 * The checks a newly read file can fill. Its own check when it has one, then any
 * check asking for that category or for what the AI says it really is. A CV or a
 * general PDF that matches nothing is offered to every check.
 */
export function checksToFill(doc: DocRef, detectedType: string | null, requirements: RequirementRef[], allChecks: string[]): string[] {
  if (doc.case_check_id) return [doc.case_check_id];
  const wanted = new Set([doc.category, ...(detectedType ? [detectedType] : [])]);
  const matched = requirements.filter((r) => r.case_check_id && wanted.has(r.category)).map((r) => r.case_check_id as string);
  if (matched.length) return [...new Set(matched)];
  return GENERAL_CATEGORIES.has(doc.category) ? allChecks : [];
}

/** The files to read for one check, most relevant first, so a long case doesn't crowd out its own documents. */
export function docsForCheck<T extends DocRef>(docs: T[], checkId: string, requirements: RequirementRef[], limit = 6): T[] {
  const asked = new Set(requirements.filter((r) => r.case_check_id === checkId || r.case_check_id === null).map((r) => r.category));
  const rank = (d: T) => (d.case_check_id === checkId ? 0 : d.case_check_id ? 9 : asked.has(d.category) ? 1 : GENERAL_CATEGORIES.has(d.category) ? 2 : 9);
  return docs
    .filter((d) => rank(d) < 9)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit);
}

/** Model output for a repeating group, as the rows the form stores. Unknown columns and blanks are dropped. */
export function groupRows(group: { fields: { key: string }[] }, rows: { cells: { key: string; value: unknown }[] }[]): Record<string, unknown>[] {
  const known = new Set(group.fields.map((f) => f.key));
  return rows
    .map((row) => Object.fromEntries(row.cells.filter((c) => known.has(c.key) && c.value !== null && c.value !== "").map((c) => [c.key, c.value])))
    .filter((row) => Object.keys(row).length > 0);
}

/** "employers.1.company" → "Company (Employer 2)". */
export function fieldPathLabel(fields: FieldDef[], path: string): string {
  const [key, index, sub] = path.split(".");
  const f = fields.find((x) => x.key === key);
  if (!f) return path;
  if (index === undefined) return f.label;
  const child = f.fields?.find((x) => x.key === sub);
  return `${child?.label ?? sub} (${f.group?.item_label ?? "Item"} ${Number(index) + 1})`;
}

/** Required details that are empty or invalid in these values, by label. */
export function missingDetails(fields: FieldDef[], values: Record<string, unknown> | null | undefined, mode: ValidationMode = "submit"): string[] {
  return Object.keys(validateCheckValues(fields, values, mode).errors).map((path) => fieldPathLabel(fields, path));
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Suggestions to place straight in the form: confident enough, and never over something already there. */
export function autofillSuggestions<T extends { fieldKey: string; confidence: number | null }>(suggestions: T[], values: Record<string, unknown>): T[] {
  return suggestions.filter((s) => (s.confidence ?? 0) >= AUTOFILL_CONFIDENCE && isBlank(values[s.fieldKey]));
}
