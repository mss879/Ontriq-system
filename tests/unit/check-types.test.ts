import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_CHECK_TYPES, BUILTIN_PACKAGES, DOCUMENT_CATEGORIES } from "@/domain/check-types/builtin";
import { checkTypeSchema, parseCheckTypeSchema, type FieldDef } from "@/domain/check-types/schema";
import { completion, validateCheckValues } from "@/domain/check-types/validate";

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

  it("are seeded exactly by 0024_seed_catalog.sql", () => {
    const sql = readFileSync("supabase/migrations/0024_seed_catalog.sql", "utf8");
    const start = sql.indexOf("$builtin$") + "$builtin$".length;
    const end = sql.indexOf("$builtin$", start);
    const seeded = JSON.parse(sql.slice(start, end)) as { key: string; schema: unknown }[];
    expect(seeded.map((s) => s.key)).toEqual(BUILTIN_CHECK_TYPES.map((t) => t.key));
    for (const t of BUILTIN_CHECK_TYPES) expect(seeded.find((s) => s.key === t.key)!.schema).toEqual(parseCheckTypeSchema(t.schema));
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
    expect(r.errors).toEqual({ "employers.1.period": "Period of employment needs both dates." });
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
