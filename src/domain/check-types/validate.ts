/**
 * Validates check values against a check type's fields. Two modes:
 *   draft  — save partial work: formats are checked, required fields are not.
 *   submit — everything the type requires must be present and valid.
 * Returns normalised values (trimmed strings, numbers as numbers, empty
 * values dropped) and errors keyed by path ("employers.0.company").
 * Pure module: used by the form in the browser and by the server action.
 */
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod";
import { parseNic } from "../nic-core";
import { DISTRICTS } from "../districts";
import type { FieldDef } from "./schema";

export type CheckValues = Record<string, unknown>;
export type ValidationResult = { ok: boolean; values: CheckValues; errors: Record<string, string> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && v !== null && Object.values(v).every((x) => x === undefined || x === null || x === ""));

function validDate(s: string) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type FieldOutcome = { value?: unknown; error?: string };

function checkScalar(f: FieldDef, raw: unknown): FieldOutcome {
  const label = f.label;
  switch (f.type) {
    case "text":
    case "textarea":
    case "address": {
      const s = String(raw).trim();
      const max = f.validation?.maxLength ?? (f.type === "text" ? 200 : 4000);
      return s.length > max ? { error: `${label} must be ${max} characters or fewer.` } : { value: s };
    }
    case "email": {
      const s = String(raw).trim().toLowerCase();
      return z.email().safeParse(s).success ? { value: s } : { error: `${label} must be a valid email address.` };
    }
    case "phone": {
      const s = String(raw).trim();
      return isValidPhoneNumber(s, "LK") ? { value: s } : { error: `${label} must be a valid phone number.` };
    }
    case "nic": {
      const parsed = parseNic(String(raw));
      return parsed.valid ? { value: parsed.display } : { error: `${label}: ${parsed.error}` };
    }
    case "district": {
      const s = String(raw).trim();
      return (DISTRICTS as readonly string[]).includes(s) ? { value: s } : { error: `${label} must be a Sri Lankan district.` };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
      if (f.validation?.min !== undefined && n < f.validation.min) return { error: `${label} must be at least ${f.validation.min}.` };
      if (f.validation?.max !== undefined && n > f.validation.max) return { error: `${label} must be at most ${f.validation.max}.` };
      return { value: n };
    }
    case "date": {
      const s = String(raw).trim();
      return validDate(s) ? { value: s } : { error: `${label} must be a valid date.` };
    }
    case "date_range": {
      const r = (raw ?? {}) as { from?: string; to?: string };
      const from = r.from?.trim() || undefined;
      const to = r.to?.trim() || undefined;
      if (from && !validDate(from)) return { error: `${label}: the start date is not valid.` };
      if (to && !validDate(to)) return { error: `${label}: the end date is not valid.` };
      if (from && to && from > to) return { error: `${label}: the start date is after the end date.` };
      return { value: { ...(from ? { from } : {}), ...(to ? { to } : {}) } };
    }
    case "select": {
      const s = String(raw);
      return f.options?.some((o) => o.value === s) ? { value: s } : { error: `Choose a valid option for ${label}.` };
    }
    case "multi_select": {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const bad = arr.find((v) => !f.options?.some((o) => o.value === v));
      return bad ? { error: `Choose valid options for ${label}.` } : { value: [...new Set(arr)] };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true" || raw === "yes") return { value: true };
      if (raw === "false" || raw === "no") return { value: false };
      return { error: `${label} must be yes or no.` };
    }
    case "repeatable_group":
      return { error: `${label} is a group.` };
  }
}

function missingRequired(f: FieldDef, value: unknown): boolean {
  if (f.type === "date_range") {
    const r = (value ?? {}) as { from?: string; to?: string };
    return !r.from || !r.to;
  }
  return isEmpty(value);
}

function validateFields(fields: FieldDef[], input: CheckValues, mode: "draft" | "submit", prefix: string, errors: Record<string, string>): CheckValues {
  const out: CheckValues = {};
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.key}` : f.key;
    const raw = input?.[f.key];

    if (f.type === "repeatable_group") {
      const items = Array.isArray(raw) ? (raw as CheckValues[]) : [];
      const kept = items.map((item, i) => validateFields(f.fields ?? [], item ?? {}, mode, `${path}.${i}`, errors)).filter((v) => !isEmpty(v) || mode === "submit");
      if (mode === "submit") {
        const min = f.group?.min ?? (f.required ? 1 : 0);
        if (kept.length < min) errors[path] = `${f.label} needs at least ${min} ${min === 1 ? (f.group?.item_label ?? "item").toLowerCase() : `${(f.group?.item_label ?? "item").toLowerCase()}s`}.`;
      }
      if (f.group?.max && kept.length > f.group.max) errors[path] = `${f.label} allows at most ${f.group.max}.`;
      if (kept.length) out[f.key] = kept;
      continue;
    }

    if (isEmpty(raw)) {
      if (mode === "submit" && f.required) errors[path] = `${f.label} is required.`;
      continue;
    }
    const result = checkScalar(f, raw);
    if (result.error) {
      errors[path] = result.error;
      continue;
    }
    if (mode === "submit" && f.required && missingRequired(f, result.value)) {
      errors[path] = `${f.label} needs both dates.`;
      continue;
    }
    if (!isEmpty(result.value)) out[f.key] = result.value;
  }
  return out;
}

export function validateCheckValues(fields: FieldDef[], input: CheckValues | null | undefined, mode: "draft" | "submit"): ValidationResult {
  const errors: Record<string, string> = {};
  const values = validateFields(fields, input ?? {}, mode, "", errors);
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** The same rules as a zod schema, for callers that compose with zod. */
export function buildZod(fields: FieldDef[], mode: "draft" | "submit") {
  return z.custom<CheckValues>().transform((input, ctx) => {
    const result = validateCheckValues(fields, input, mode);
    for (const [path, message] of Object.entries(result.errors)) ctx.addIssue({ code: "custom", message, path: path.split(".") });
    return result.values;
  });
}

/** How many required top-level fields are filled, for progress meters. */
export function completion(fields: FieldDef[], values: CheckValues | null | undefined): { filled: number; required: number } {
  const required = fields.filter((f) => f.required);
  const filled = required.filter((f) => !missingRequired(f, values?.[f.key])).length;
  return { filled, required: required.length };
}
