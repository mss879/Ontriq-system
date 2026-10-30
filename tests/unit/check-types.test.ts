import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_CHECK_TYPES, BUILTIN_PACKAGES, DOCUMENT_CATEGORIES } from "@/domain/check-types/builtin";
import { checkTypeSchema, parseCheckTypeSchema, type CheckTypeSchema, type FieldDef } from "@/domain/check-types/schema";
import { recordLabel, recordOptions } from "@/domain/check-types/records";
import { completion, modeAt, validateCheckValues } from "@/domain/check-types/validate";
import type { Stage } from "@/domain/workflow/stages";

const byKey = (key: string) => parseCheckTypeSchema(BUILTIN_CHECK_TYPES.find((t) => t.key === key)!.schema);

describe("built-in check types", () => {
  it("are all valid check type schemas", () => {
    for (const t of BUILTIN_CHECK_TYPES) {
      const r = checkTypeSchema.safeParse(t.schema);
      expect(r.success, `${t.key}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("only use known document categories", () => {
    const known = new Set(DOCUMENT_CATEGORIES.map((c) => c.key));
    for (const t of BUILTIN_CHECK_TYPES) for (const d of t.schema.documents ?? []) expect(known.has(d.category), `${t.key} → ${d.category}`).toBe(true);
  });

  it("packages only reference built-in checks", () => {
    const keys = new Set(BUILTIN_CHECK_TYPES.map((t) => t.key));
    for (const p of BUILTIN_PACKAGES) for (const c of p.checks) expect(keys.has(c)).toBe(true);
  });

  it("cover every field the requirements list", () => {
    const keys = (k: string) => byKey(k).fields.flatMap((f) => [f.key, ...(f.fields ?? []).map((s) => s.key)]);
    expect(keys("education")).toEqual(expect.arrayContaining(["candidate_name", "student_number", "institution", "year_of_completion", "qualification"]));
    expect(keys("employment")).toEqual(expect.arrayContaining(["company", "designation", "period", "employee_code", "employment_type"]));
    expect(keys("address")).toEqual(expect.arrayContaining(["address", "residence_period", "verified_by", "gn_name"]));
    expect(keys("police")).toEqual(expect.arrayContaining(["nic", "permanent_address", "residence_period", "police_station_area", "verified_by", "oic_name", "station_contact"]));
    expect(keys("nic")).toContain("nic_number");
    expect(keys("reference")).toEqual(expect.arrayContaining(["full_name", "current_employer", "current_job_title", "worked_together_at", "relationship", "acquaintance_duration", "contact_number", "email"]));
    expect(keys("sanction")).toEqual(expect.arrayContaining(["sanctions_found", "details"]));
    expect(byKey("sanction").fixed_annexure).toEqual({ category: "sanction_report", untouched: true });
    expect(byKey("reference").fields[0].group).toMatchObject({ min: 2, max: 2 });
  });

  it("are what 0024 seeds plus the changes in 0040 and 0041", () => {
    const between = (file: string, tag: string) => {
      const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
      const start = sql.indexOf(tag) + tag.length;
      return JSON.parse(sql.slice(start, sql.indexOf(tag, start)));
    };
    const seeded = between("0024_seed_catalog.sql", "$builtin$") as { key: string; schema: CheckTypeSchema }[];
    const stages = between("0040_evidence_and_entry_rules.sql", "$stages$") as Record<string, string[]>;
    const delta = between("0041_client_requirements.sql", "$json$") as Record<"documents_client_visible" | "report_fields" | "candidate_fields", Record<string, string[]>>;
    expect(seeded.map((s) => s.key)).toEqual(BUILTIN_CHECK_TYPES.map((t) => t.key));
    const applied = (key: string, f: FieldDef): FieldDef => ({
      ...f,
      ...(stages[key]?.includes(f.key) ? { stage: "verification" as const } : {}),
      ...(delta.report_fields[key]?.includes(f.key) ? { visibility: { ...f.visibility, report: true } } : {}),
      ...(delta.candidate_fields[key]?.includes(f.key) ? { fill_by: [...f.fill_by, "candidate" as const] } : {}),
      ...(f.fields ? { fields: (f.fields as FieldDef[]).map((s) => applied(key, s)) } : {}),
    });
    for (const t of BUILTIN_CHECK_TYPES) {
      const base = parseCheckTypeSchema(seeded.find((s) => s.key === t.key)!.schema);
      const expected = {
        ...base,
        fields: base.fields.map((f) => applied(t.key, f)),
        documents: base.documents.map((d) => (delta.documents_client_visible[t.key]?.includes(d.category) ? { ...d, client_visible: true } : d)),
      };
      expect(parseCheckTypeSchema(t.schema), t.key).toEqual(expected);
    }
  });

  it("are marked for verification exactly as 0040 marks stored versions", () => {
    const sql = readFileSync("supabase/migrations/0040_evidence_and_entry_rules.sql", "utf8");
    const start = sql.indexOf("$stages$") + "$stages$".length;
    const marked = JSON.parse(sql.slice(start, sql.indexOf("$stages$", start))) as Record<string, string[]>;
    const later = (fields: FieldDef[]): string[] => fields.flatMap((f) => [...(f.stage === "verification" ? [f.key] : []), ...later((f.fields ?? []) as FieldDef[])]);
    for (const t of BUILTIN_CHECK_TYPES) expect(marked[t.key]).toEqual(later(parseCheckTypeSchema(t.schema).fields));
  });

  it("never ask Data Entry for a result", () => {
    const later = (k: string) => byKey(k).fields.filter((f) => f.stage === "verification").map((f) => f.key);
    expect(later("sanction")).toEqual(expect.arrayContaining(["sanctions_found", "details"]));
    expect(later("nic")).toContain("validation_source");
    expect(later("address")).toContain("verified_by");
    expect(later("police")).toContain("verified_by");
  });

  it("rejects duplicate keys and empty choices", () => {
    const bad = checkTypeSchema.safeParse({
      fields: [
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "Again", type: "select" },
      ],
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toMatch(/used twice/);
    expect(JSON.stringify(bad.error?.issues)).toMatch(/at least one choice/);
  });
});

describe("check values", () => {
  const employment = byKey("employment").fields;
  const reference = byKey("reference").fields;

  it("asks Data Entry only for its own fields, and verification for the rest", () => {
    const sanction = byKey("sanction").fields;
    expect(validateCheckValues(sanction, {}, "entry").ok).toBe(true);
    expect(validateCheckValues(sanction, {}, "submit").errors).toHaveProperty("sanctions_found");

    const nic = byKey("nic").fields;
    const typed = { nic_number: "853400937V", name_on_nic: "Nimal Perera" };
    expect(Object.keys(validateCheckValues(nic, {}, "entry").errors).sort()).toEqual(["name_on_nic", "nic_number"]);
    expect(validateCheckValues(nic, typed, "entry").ok).toBe(true);
    expect(validateCheckValues(nic, typed, "submit").errors).toHaveProperty("validation_source");
    expect(validateCheckValues(nic, { ...typed, validation_source: "drp" }, "submit").ok).toBe(true);
  });

  it("still checks formats on fields that aren't due yet", () => {
    expect(validateCheckValues(byKey("sanction").fields, { screened_on: "not a date" }, "entry").errors).toHaveProperty("screened_on");
  });

  it("counts only what is due at this stage", () => {
    const nic = byKey("nic").fields;
    expect(completion(nic, {}, "entry").required).toBe(2);
    expect(completion(nic, {}).required).toBe(3);
    expect(completion(byKey("sanction").fields, {}, "entry").required).toBe(0);
  });

  it("switches from Data Entry's fields to all of them when verification starts", () => {
    expect(["intake", "documents", "pre_qc", "data_entry"].map((s) => modeAt(s as Stage))).toEqual(["entry", "entry", "entry", "entry"]);
    expect(["verification", "post_qc", "report"].map((s) => modeAt(s as Stage))).toEqual(["submit", "submit", "submit"]);
  });

  it("accepts a current job or address with no end date", () => {
    const row = { company: "Dialog", designation: "Engineer", employee_code: "D1", employment_type: "permanent" };
    const check = (period: unknown) => validateCheckValues(employment, { candidate_name: "N", employers: [{ ...row, period }] }, "entry");
    expect(check({ from: "2020-01-01", present: true }).ok).toBe(true);
    expect(check({ from: "2020-01-01", to: "2021-01-01" }).ok).toBe(true);
    expect(check({ from: "2020-01-01" }).errors).toHaveProperty(["employers.0.period"]);
    expect(check({ from: "2020-01-01", to: "2021-01-01", present: true }).values.employers).toEqual([{ ...row, period: { from: "2020-01-01", present: true } }]);
  });

  it("names a check's rows so files and contacts can belong to one", () => {
    const values = { employers: [{ company: "Dialog Axiata" }, {}] };
    expect(recordOptions(employment, values)).toEqual([{ key: "employers.0", label: "Employer 1 · Dialog Axiata" }, { key: "employers.1", label: "Employer 2" }]);
    expect(recordLabel(employment, values, "employers.0")).toBe("Employer 1 · Dialog Axiata");
    expect(recordLabel(employment, values, "employers.9")).toBeNull();
    expect(recordLabel(employment, values, null)).toBeNull();
  });

  it("lets a draft be saved with required fields missing", () => {
    const r = validateCheckValues(employment, { candidate_name: "  Nimal Perera " }, "draft");
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ candidate_name: "Nimal Perera" });
  });

  it("requires every required field to submit", () => {
    const r = validateCheckValues(employment, { candidate_name: "Nimal" }, "submit");
    expect(r.ok).toBe(false);
    expect(r.errors.employers).toMatch(/at least 1 employer/);
  });

  it("validates repeating groups item by item", () => {
    const r = validateCheckValues(
      employment,
      {
        candidate_name: "Nimal",
        employers: [
          { company: "Dialog", designation: "Engineer", period: { from: "2020-01-01", to: "2022-06-30" }, employee_code: "D123", employment_type: "permanent", hr_email: "hr@dialog.lk", hr_phone: "077 123 4567" },
          { company: "Hemas", designation: "Lead", period: { from: "2023-01-01" }, employee_code: "H9", employment_type: "permanent" },
        ],
      },
      "submit",
    );
    expect(r.errors).toEqual({ "employers.1.period": 'Period of employment needs a start and an end date, or "Still here".' });
  });

  it("checks formats even in drafts", () => {
    const r = validateCheckValues(
      employment,
      { employers: [{ hr_email: "nope", hr_phone: "123", period: { from: "2022-01-01", to: "2021-01-01" }, employment_type: "freelance" }] },
      "draft",
    );
    expect(Object.keys(r.errors).sort()).toEqual(["employers.0.employment_type", "employers.0.hr_email", "employers.0.hr_phone", "employers.0.period"]);
  });

  it("needs exactly two referees", () => {
    const referee = { full_name: "A", current_employer: "B", current_job_title: "C", worked_together_at: "D", relationship: "colleague", acquaintance_duration: "3 years", contact_number: "+94 77 123 4567", email: "a@b.lk" };
    expect(validateCheckValues(reference, { referees: [referee] }, "submit").errors.referees).toMatch(/at least 2/);
    expect(validateCheckValues(reference, { referees: [referee, referee] }, "submit").ok).toBe(true);
    expect(validateCheckValues(reference, { referees: [referee, referee, referee] }, "submit").errors.referees).toMatch(/at most 2/);
  });

  it("coerces numbers and validates NICs and bounds", () => {
    const fields: FieldDef[] = byKey("education").fields;
    const r = validateCheckValues(fields, { year_of_completion: "2015" }, "draft");
    expect(r.values.year_of_completion).toBe(2015);
    expect(validateCheckValues(fields, { year_of_completion: "1800" }, "draft").errors.year_of_completion).toMatch(/at least 1950/);
    expect(validateCheckValues(byKey("nic").fields, { nic_number: "12345" }, "draft").errors.nic_number).toMatch(/NIC number/);
  });

  it("measures completion of required fields", () => {
    expect(completion(byKey("nic").fields, { nic_number: "853400937V" })).toEqual({ filled: 1, required: 3 });
  });
});
