/**
 * The check type definition language. A check type version stores one of
 * these as JSON (check_type_versions.schema); forms, validation, document
 * requirements and the report are all driven by it, so Ontriq can add a new
 * kind of check without code. Pure module.
 */
import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "date_range",
  "select",
  "multi_select",
  "boolean",
  "phone",
  "email",
  "nic",
  "address",
  "district",
  "repeatable_group",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  date_range: "Date range",
  select: "Choice",
  multi_select: "Multiple choice",
  boolean: "Yes / no",
  phone: "Phone number",
  email: "Email address",
  nic: "NIC number",
  address: "Address",
  district: "District",
  repeatable_group: "Repeating group",
};

/**
 * When a field is filled in. Data entry works from the documents; verification
 * records what the source confirmed. A required field only holds up its own
 * stage, so nobody has to invent a result to get past Data Entry.
 */
export const FIELD_STAGES = ["data_entry", "verification"] as const;
export type FieldStage = (typeof FIELD_STAGES)[number];

const keySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "Use lowercase letters, digits and underscores, starting with a letter.");

const optionSchema = z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(120) });

const visibilitySchema = z.object({
  /** Shown to the client company in the portal. */
  client: z.boolean().default(false),
  /** Printed in the final report. */
  report: z.boolean().default(true),
  /** Kept for stored versions. What a candidate sees is set by fill_by. */
  candidate: z.boolean().default(false),
});

const baseField = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  stage: z.enum(FIELD_STAGES).default("data_entry"),
  help: z.string().max(300).optional(),
  placeholder: z.string().max(120).optional(),
  options: z.array(optionSchema).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      maxLength: z.number().int().positive().optional(),
      /** Numbers only: a year or a count, with no decimals. */
      integer: z.boolean().optional(),
    })
    .optional(),
  visibility: visibilitySchema.default({ client: false, report: true, candidate: false }),
  /** Who else may fill the field: "candidate" puts it on the BGV form. Staff can always fill it. */
  fill_by: z.array(z.enum(["staff", "candidate", "client"])).default(["staff"]),
  /** Whether AI extraction pre-fills it, and a hint for the model. On unless set to false. */
  ai: z.object({ extract: z.boolean().default(false), hint: z.string().max(300).optional() }).optional(),
  width: z.enum(["full", "half"]).default("half"),
});

export const fieldSchema = baseField.extend({
  /** Only for repeatable_group: the fields of each item (one level deep). */
  fields: z.array(baseField).optional(),
  group: z
    .object({ min: z.number().int().min(0).default(0), max: z.number().int().min(1).default(10), item_label: z.string().max(60).default("Item") })
    .optional(),
});

export const documentRequirementSchema = z.object({
  category: keySchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().max(400).optional(),
  /** How many files are needed. 0 makes the document optional. */
  min: z.number().int().min(0).max(20).default(1),
  max: z.number().int().min(1).max(50).optional(),
  /** Documents must be in before the case leaves this stage. */
  stage: z.enum(["documents", "verification"]).default("documents"),
  client_visible: z.boolean().default(false),
  /** Spec 4.2: one file for each row of this repeating group, before the check can be verified. */
  per_record: keySchema.optional(),
});

export const RESULT_TONES = ["green", "amber", "red"] as const;
export type ResultTone = (typeof RESULT_TONES)[number];

export const resultOptionSchema = z.object({ key: keySchema, label: z.string().min(1).max(60), tone: z.enum(RESULT_TONES) });

export const DEFAULT_RESULT_OPTIONS = [
  { key: "clear", label: "Clear", tone: "green" as const },
  { key: "discrepancy", label: "Discrepancy", tone: "red" as const },
  { key: "pending", label: "Pending review", tone: "amber" as const },
  { key: "unable_to_verify", label: "Unable to verify", tone: "amber" as const },
];

export const checkTypeSchema = z
  .object({
    version: z.literal(1).default(1),
    fields: z.array(fieldSchema).min(1, "Add at least one field."),
    documents: z.array(documentRequirementSchema).default([]),
    result: z.object({ options: z.array(resultOptionSchema).min(2) }).default({ options: DEFAULT_RESULT_OPTIONS }),
    /** Kept for stored versions: the report is laid out from the fields themselves. */
    report: z.object({ blocks: z.array(z.record(z.string(), z.unknown())).default([]) }).default({ blocks: [] }),
    sla_days: z.number().int().min(1).max(90).default(5),
    /** Address and police checks happen on the ground; assignment considers regions. */
    location_bound: z.boolean().default(false),
    /** A document attached to the report untouched as its own annexure (Global Sanction). */
    fixed_annexure: z.object({ category: keySchema, untouched: z.literal(true) }).optional(),
  })
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    schema.fields.forEach((f, i) => {
      if (seen.has(f.key)) ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: `The key "${f.key}" is used twice.` });
      seen.add(f.key);
      if ((f.type === "select" || f.type === "multi_select") && !f.options?.length)
        ctx.addIssue({ code: "custom", path: ["fields", i, "options"], message: `"${f.label}" needs at least one choice.` });
      if (f.type === "repeatable_group") {
        if (!f.fields?.length) ctx.addIssue({ code: "custom", path: ["fields", i, "fields"], message: `"${f.label}" needs fields for each item.` });
        const inner = new Set<string>();
        f.fields?.forEach((sub, j) => {
          if (sub.type === "repeatable_group") ctx.addIssue({ code: "custom", path: ["fields", i, "fields", j, "type"], message: "Groups cannot be nested." });
          if (inner.has(sub.key)) ctx.addIssue({ code: "custom", path: ["fields", i, "fields", j, "key"], message: `The key "${sub.key}" is used twice.` });
          inner.add(sub.key);
        });
      }
    });
    const cats = new Set<string>();
    schema.documents.forEach((d, i) => {
      if (cats.has(d.category)) ctx.addIssue({ code: "custom", path: ["documents", i, "category"], message: `"${d.label}" is listed twice.` });
      cats.add(d.category);
    });
  });

export type FieldDef = z.infer<typeof fieldSchema>;
export type DocumentRequirement = z.infer<typeof documentRequirementSchema>;
export type ResultOption = z.infer<typeof resultOptionSchema>;
export type CheckTypeSchema = z.infer<typeof checkTypeSchema>;
/** What authors write before defaults apply. */
export type CheckTypeSchemaInput = z.input<typeof checkTypeSchema>;

/**
 * What has to be right before a version goes live. Checked at publish, not on
 * read: a stored version stays readable whatever it holds, and cases keep theirs.
 */
export function publishIssues(schema: CheckTypeSchema): string[] {
  const issues: string[] = [];
  const tones = new Set(schema.result.options.map((o) => o.tone));
  if (!tones.has("green")) issues.push("Add a green result, so a check can come out clear.");
  if (!tones.has("red")) issues.push("Add a red result, so a check can record a discrepancy.");
  const keys = schema.result.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) issues.push("Two results share a key.");
  for (const f of schema.fields) {
    if (f.type === "repeatable_group" && f.group && f.group.min > f.group.max) issues.push(`"${f.label}" asks for at least ${f.group.min} but allows only ${f.group.max}.`);
    if (f.type === "number" && f.validation?.min !== undefined && f.validation.max !== undefined && f.validation.min > f.validation.max) issues.push(`"${f.label}" has a lowest value above its highest.`);
  }
  for (const d of schema.documents) {
    if (d.per_record && !schema.fields.some((f) => f.key === d.per_record && f.type === "repeatable_group")) issues.push(`"${d.label}" is set per record, but that repeating group isn't on this check.`);
  }
  return issues;
}

/** Parse a stored schema, filling defaults. Throws on invalid input. */
export function parseCheckTypeSchema(raw: unknown): CheckTypeSchema {
  return checkTypeSchema.parse(raw);
}

export function resultOption(schema: Pick<CheckTypeSchema, "result">, key: string | null | undefined): ResultOption | undefined {
  return key ? schema.result.options.find((o) => o.key === key) : undefined;
}
