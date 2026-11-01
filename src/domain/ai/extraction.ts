/**
 * Reading documents into a check: which file feeds which check, which fields
 * the AI may fill, what lands in the form, and what is still missing after.
 * Pure: the background jobs, the check form and the tests all share it.
 */
import { validateCheckValues, type ValidationMode } from "../check-types/validate";
import type { FieldDef } from "../check-types/schema";
import { GENERAL_CATEGORIES } from "../documents/combined";

/** Details a person attests to after verifying. They are never read off a document. */
const ATTESTED = new Set(["verified_by", "confirmed_by", "confirmed_on", "confirmation_channel", "validation_source", "sanctions_found", "feedback", "visit_date", "visit_notes"]);

const ADDRESSED_TO_AI = /(ignore|disregard|forget)\b.{0,40}\b(instructions?|prompts?|rules)\b|(note|message|instruction)s? (to|for) (the )?(ai|assistant|system|reviewer|model)\b|\bai system\b|system override/i;

/** Text written to steer an AI reader. Staff always hear about it, whatever the model makes of it. */
export const addressedToAi = (text: string | null | undefined) => ADDRESSED_TO_AI.test(text ?? "");

/** At or above this, a value found for an empty field is placed in the form for the person to check and save. */
export const AUTOFILL_CONFIDENCE = 0.6;

/** Whether the AI reads this field: what the check type says, else everything a person doesn't attest to. */
export const canRead = (f: Pick<FieldDef, "key" | "ai">) => (f.ai ? f.ai.extract : !ATTESTED.has(f.key));

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
 * check asking for that category or for what the AI says it holds. A file holding
 * several documents reaches every check that wants one of them. A CV or a general
 * PDF is offered to every check unless it clearly feeds just one.
 */
export function checksToFill(doc: DocRef, detected: string[], requirements: RequirementRef[], allChecks: string[]): string[] {
  const types = new Set(detected.filter((t) => !GENERAL_CATEGORIES.has(t)));
  const wanted = new Set([doc.category, ...types]);
  const matched = [...new Set(requirements.filter((r) => r.case_check_id && wanted.has(r.category)).map((r) => r.case_check_id as string))];
  if (doc.case_check_id) return types.size > 1 ? [...new Set([doc.case_check_id, ...matched])] : [doc.case_check_id];
  if (GENERAL_CATEGORIES.has(doc.category) && (types.size > 1 || !matched.length)) return allChecks;
  return matched;
}

/** The files to read for one check, most relevant first, so a long case doesn't crowd out its own documents. The file that prompted the read always goes in. */
export function docsForCheck<T extends DocRef & { id?: string }>(docs: T[], checkId: string, requirements: RequirementRef[], limit = 6, prompted?: string): T[] {
  const asked = new Set(requirements.filter((r) => r.case_check_id === checkId || r.case_check_id === null).map((r) => r.category));
  const rank = (d: T) => (d.case_check_id === checkId || (prompted && d.id === prompted) ? 0 : d.case_check_id ? 9 : asked.has(d.category) ? 1 : GENERAL_CATEGORIES.has(d.category) ? 2 : 9);
  return docs
    .filter((d) => rank(d) < 9)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit);
}

/** A value as the form stores it: a period keeps only what it says, and an empty one counts as nothing. */
export function formValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value === "" ? null : value;
  const { from, to, present } = value as { from?: string | null; to?: string | null; present?: boolean };
  const day = (d: string) => (/^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d);
  const period = { ...(from ? { from: day(from) } : {}), ...(present ? { present: true } : to ? { to: day(to) } : {}) };
  return Object.keys(period).length ? period : null;
}

/** Model output for a repeating group, as the rows the form stores. Unknown columns and blanks are dropped. */
export function groupRows(group: { fields: { key: string }[] }, rows: { cells: { key: string; value: unknown }[] }[]): Record<string, unknown>[] {
  const known = new Set(group.fields.map((f) => f.key));
  return rows
    .map((row) => Object.fromEntries(row.cells.filter((c) => known.has(c.key)).map((c) => [c.key, formValue(c.value)]).filter(([, value]) => value !== null)))
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
