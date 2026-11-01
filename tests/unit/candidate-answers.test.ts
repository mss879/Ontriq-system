import { describe, expect, it } from "vitest";
import { BUILTIN_CHECK_TYPES } from "@/domain/check-types/builtin";
import { parseCheckTypeSchema, type FieldDef } from "@/domain/check-types/schema";
import { validateCheckValues } from "@/domain/check-types/validate";
import { answerText, answerToFieldValue, applyAnswer, DETAILS_FORM_KEY, mergeRows } from "@/domain/candidate/answers";

const fields = (key: string) => parseCheckTypeSchema(BUILTIN_CHECK_TYPES.find((t) => t.key === key)!.schema).fields;
const field = (type: FieldDef["type"], options?: FieldDef["options"]) => ({ type, options });
const LEVELS = [
  { value: "ol", label: "G.C.E. O/L" },
  { value: "degree", label: "Degree" },
];

describe("candidate answers", () => {
  it("stores an option's value, whether the answer holds the value or the label", () => {
    expect(answerToFieldValue(field("select", LEVELS), "degree")).toBe("degree");
    expect(answerToFieldValue(field("select", LEVELS), "Degree")).toBe("degree");
    expect(answerToFieldValue(field("multi_select", LEVELS), "G.C.E. O/L, Degree")).toEqual(["ol", "degree"]);
    expect(answerToFieldValue(field("multi_select", LEVELS), ["ol"])).toEqual(["ol"]);
  });

  it("stores yes and no as booleans", () => {
    expect(answerToFieldValue(field("boolean"), "Yes")).toBe(true);
    expect(answerToFieldValue(field("boolean"), "no")).toBe(false);
  });

  it("reads a date range sent as an object, or as the old joined text", () => {
    expect(answerToFieldValue(field("date_range"), { from: "2020-01-01", present: true })).toEqual({ from: "2020-01-01", present: true });
    expect(answerToFieldValue(field("date_range"), "2020-01-01 – 2021-06-30")).toEqual({ from: "2020-01-01", to: "2021-06-30" });
    expect(answerToFieldValue(field("date_range"), "")).toBeUndefined();
  });

  it("never overwrites a check with nothing", () => {
    const address = fields("address");
    const current = { residence_period: { from: "2019-01-01", to: "2020-01-01" } };
    expect(applyAnswer(address, current, "residence_period", { value: "" })).toEqual({ ok: false, error: "There is no answer to use yet." });
    expect(applyAnswer(address, current, "residence_period", null).ok).toBe(false);
  });

  it("uses a date range answer so that validation keeps it", () => {
    const address = fields("address");
    const applied = applyAnswer(address, {}, "residence_period", { value: "2020-01-01 – 2021-06-30" });
    if (!applied.ok) throw new Error(applied.error);
    expect(validateCheckValues(address, applied.values, "draft").values.residence_period).toEqual({ from: "2020-01-01", to: "2021-06-30" });
  });

  it("uses a select answer so that validation accepts it", () => {
    const education = fields("education");
    const applied = applyAnswer(education, {}, "qualification_level", { value: "Degree" });
    if (!applied.ok) throw new Error(applied.error);
    expect(validateCheckValues(education, applied.values, "draft").ok).toBe(true);
  });

  it("refuses a date range that isn't one, instead of dropping it", () => {
    expect(validateCheckValues(fields("address"), { residence_period: "last year" }, "draft").errors).toHaveProperty("residence_period");
  });

  it("fills only the gaps from a whole form", () => {
    const applied = applyAnswer(fields("education"), { candidate_name: "As entered by staff" }, DETAILS_FORM_KEY, { rows: [{ candidate_name: "From the form", institution: "University of Colombo" }] });
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.values).toEqual({ candidate_name: "As entered by staff", institution: "University of Colombo" });
  });

  it("says so when a form holds no answer at all", () => {
    expect(applyAnswer(fields("education"), { institution: "Kept" }, DETAILS_FORM_KEY, { rows: [{ institution: " " }] }).ok).toBe(false);
  });

  it("shows an answer in the words the candidate read", () => {
    expect(answerText("degree", LEVELS)).toBe("Degree");
    expect(answerText(["ol", "degree"], LEVELS)).toBe("G.C.E. O/L, Degree");
    expect(answerText({ from: "2020-01-01", present: true })).toBe("2020-01-01 to present");
    expect(answerText(null)).toBe("");
  });
});

describe("candidate rows", () => {
  const group = fields("employment").find((f) => f.key === "employers")!;

  it("keeps two employers apart, in the key order Postgres returns", () => {
    // jsonb sorts keys by length, so the period comes first on every row.
    const rows = [
      { period: { to: "2020-01-01", from: "2018-01-01" }, company: "Dialog", designation: "Engineer" },
      { period: { to: "2022-01-01", from: "2020-02-01" }, company: "Hemas", designation: "Lead" },
    ];
    expect(mergeRows(group, [], rows)).toHaveLength(2);
  });

  it("updates a row with the same name, and adds the rest", () => {
    const existing = [{ company: "Dialog", designation: "Engineer", employee_code: "E1" }];
    const merged = mergeRows(group, existing, [
      { company: "dialog ", designation: "Senior engineer" },
      { company: "Hemas", designation: "Lead" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ designation: "Senior engineer", employee_code: "E1" });
  });

  it("keeps two jobs at one company as two rows", () => {
    const rows = [
      { company: "Dialog Axiata", designation: "Contract analyst" },
      { company: "Dialog Axiata", designation: "Analyst" },
    ];
    const merged = mergeRows(group, [], rows);
    expect(merged.map((r) => r.designation)).toEqual(["Contract analyst", "Analyst"]);
  });

  it("matches each row on file once", () => {
    const existing = [{ company: "Dialog", designation: "A", employee_code: "1" }, { company: "Dialog", designation: "B", employee_code: "2" }];
    const merged = mergeRows(group, existing, [{ company: "Dialog", designation: "A2" }, { company: "Dialog", designation: "B2" }]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ designation: "B2", employee_code: "2" });
  });

  it("adds a row with no name rather than guessing", () => {
    expect(mergeRows(group, [{ company: "Dialog" }], [{ designation: "Lead" }])).toHaveLength(2);
  });

  it("merges through applyAnswer", () => {
    const employment = fields("employment");
    const applied = applyAnswer(employment, {}, "employers", {
      rows: [
        { period: { from: "2018-01-01", to: "2020-01-01" }, company: "Dialog", designation: "Engineer", employee_code: "E1", employment_type: "Permanent" },
        { period: { from: "2020-02-01", present: true }, company: "Hemas", designation: "Lead", employee_code: "E2", employment_type: "contract" },
      ],
    });
    if (!applied.ok) throw new Error(applied.error);
    const rows = applied.values.employers as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0].employment_type).toBe("permanent");
  });
});

describe("what a candidate can write", () => {
  it("drops findings slipped into a form", () => {
    const sanction = fields("sanction");
    const applied = applyAnswer(sanction, {}, "__details", { rows: [{ screened_name: "Nimal", sanctions_found: "no", screening_platform: "Cfirst" }] });
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.values).toEqual({ screened_name: "Nimal" });
  });

  it("drops findings slipped into a row", () => {
    const reference = fields("reference");
    const applied = applyAnswer(reference, {}, "referees", { rows: [{ full_name: "Ruwan", feedback: "Excellent", details_confirmed: "yes" }] });
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.values.referees).toEqual([{ full_name: "Ruwan" }]);
  });

  it("says where a form differs, and replaces only when told", () => {
    const education = fields("education");
    const current = { institution: "Colombo" };
    const given = { rows: [{ institution: "Kelaniya", qualification: "BSc" }] };
    const kept = applyAnswer(education, current, "__details", given);
    if (!kept.ok) throw new Error(kept.error);
    expect(kept.conflicts.map((c) => c.key)).toEqual(["institution"]);
    expect(kept.values).toMatchObject({ institution: "Colombo", qualification: "BSc" });
    const replaced = applyAnswer(education, current, "__details", given, { replace: true });
    if (!replaced.ok) throw new Error(replaced.error);
    expect(replaced.values.institution).toBe("Kelaniya");
  });

  it("isn't stuck when a form holds nothing new", () => {
    const education = fields("education");
    const applied = applyAnswer(education, { institution: "Colombo" }, "__details", { rows: [{ institution: "colombo" }] });
    expect(applied.ok).toBe(true);
  });

  it("turns numbers into numbers", () => {
    const education = fields("education");
    const applied = applyAnswer(education, {}, "__details", { rows: [{ year_of_completion: "2015" }] });
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.values.year_of_completion).toBe(2015);
  });

  it("shows dates the way the audience reads them", () => {
    expect(answerText({ from: "2020-01-01", present: true }, [], { date: (iso) => iso.slice(0, 4) })).toBe("2020 to present");
    expect(answerText("2020-03-04", [], { date: () => "04/03/20" })).toBe("04/03/20");
  });
});
