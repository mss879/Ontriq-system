import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_CHECK_TYPES, BUILTIN_PACKAGES, DOCUMENT_CATEGORIES } from "@/domain/check-types/builtin";
import { checkTypeSchema, parseCheckTypeSchema, publishIssues, type CheckTypeSchema, type FieldDef } from "@/domain/check-types/schema";
import { recordLabel, recordMoves, recordOptions } from "@/domain/check-types/records";
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

  it("are what 0024 seeds plus the changes in 0040, 0041, 0048 and 0049", () => {
    const between = (file: string, tag: string) => {
      const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
      const start = sql.indexOf(tag) + tag.length;
      return JSON.parse(sql.slice(start, sql.indexOf(tag, start)));
    };
    const seeded = between("0024_seed_catalog.sql", "$builtin$") as { key: string; schema: CheckTypeSchema }[];
    const stages = between("0040_evidence_and_entry_rules.sql", "$stages$") as Record<string, string[]>;
    const delta = between("0041_client_requirements.sql", "$json$") as Record<"documents_client_visible" | "report_fields" | "candidate_fields", Record<string, string[]>>;
    const audit = between("0048_audit_fixes.sql", "$json$") as {
      education_levels: { value: string; label: string }[];
      per_record: Record<string, Record<string, string>>;
      documents: Record<string, unknown[]>;
      group_fields: Record<string, Record<string, unknown[]>>;
      fields: Record<string, unknown[]>;
    };
    const final = between("0049_final_audit_fixes.sql", "$json$") as {
      require: Record<string, string[]>;
      require_group: Record<string, Record<string, string[]>>;
      fields: Record<string, unknown[]>;
      group_fields: Record<string, Record<string, unknown[]>>;
      integer: Record<string, string[]>;
      documents_client_visible: Record<string, string[]>;
      documents_stage: Record<string, Record<string, "documents" | "verification">>;
    };
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
      const expected = parseCheckTypeSchema({
        ...base,
        fields: [
          ...(audit.fields[t.key] ?? []),
          ...base.fields
            .map((f) => applied(t.key, f))
            .map((f) => (f.key === "qualification_level" ? { ...f, options: [...audit.education_levels, ...(f.options ?? [])] } : f))
            .map((f) => (audit.group_fields[t.key]?.[f.key] ? { ...f, fields: [...(f.fields ?? []), ...audit.group_fields[t.key][f.key]] } : f))
            .map((f) => (final.require[t.key]?.includes(f.key) ? { ...f, required: true } : f))
            .map((f) => (final.integer[t.key]?.includes(f.key) ? { ...f, validation: { ...f.validation, integer: true } } : f))
            .map((f) => (final.require_group[t.key]?.[f.key] ? { ...f, fields: (f.fields as FieldDef[]).map((s) => (final.require_group[t.key][f.key].includes(s.key) ? { ...s, required: true } : s)) } : f))
            .map((f) => (final.group_fields[t.key]?.[f.key] ? { ...f, fields: [...(f.fields ?? []), ...final.group_fields[t.key][f.key]] } : f)),
          ...(final.fields[t.key] ?? []),
        ],
        documents: [
          ...base.documents
            .map((d) => (delta.documents_client_visible[t.key]?.includes(d.category) ? { ...d, client_visible: true } : d))
            .map((d) => (audit.per_record[t.key]?.[d.category] ? { ...d, per_record: audit.per_record[t.key][d.category] } : d))
            .map((d) => (final.documents_client_visible[t.key]?.includes(d.category) ? { ...d, client_visible: true } : d))
            .map((d) => (final.documents_stage[t.key]?.[d.category] ? { ...d, stage: final.documents_stage[t.key][d.category] } : d)),
          ...(audit.documents[t.key] ?? []),
        ],
      });
      expect(parseCheckTypeSchema(t.schema), t.key).toEqual(expected);
    }
  });

  it("are marked for verification exactly as 0040 marks stored versions", () => {
    const sql = readFileSync("supabase/migrations/0040_evidence_and_entry_rules.sql", "utf8");
    const start = sql.indexOf("$stages$") + "$stages$".length;
    const marked = JSON.parse(sql.slice(start, sql.indexOf("$stages$", start))) as Record<string, string[]>;
    const later = (fields: FieldDef[]): string[] => fields.flatMap((f) => [...(f.stage === "verification" ? [f.key] : []), ...later((f.fields ?? []) as FieldDef[])]);
    // 0048 and 0049 added what was confirmed with each source, recorded during verification.
    const added: Record<string, string[]> = { reference: ["details_confirmed", "confirmed_on"], employment: ["confirmed_on", "employer_response"], address: ["confirmed_on"], police: ["confirmed_on"] };
    for (const t of BUILTIN_CHECK_TYPES) expect([...marked[t.key], ...(added[t.key] ?? [])]).toEqual(later(parseCheckTypeSchema(t.schema).fields));
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
      "entry",
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
    const referee = { full_name: "A", current_employer: "B", current_job_title: "C", worked_together_at: "D", relationship: "colleague", acquaintance_duration: "3 years", contact_number: "+94 77 123 4567", email: "a@b.lk", feedback: "Reliable", details_confirmed: "yes", confirmed_on: "2026-10-01" };
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

  it("takes a whole year, and an address abroad", () => {
    expect(validateCheckValues(byKey("education").fields, { year_of_completion: 2015.5 }, "draft").errors.year_of_completion).toMatch(/whole number/);
    expect(validateCheckValues(byKey("address").fields, { district: "Outside Sri Lanka" }, "draft").ok).toBe(true);
  });

  it("won't let a check be verified without what the source said", () => {
    const edu = byKey("education");
    const entry = { candidate_name: "A", qualification_level: "degree", qualification: "BSc", institution: "Colombo", student_number: "1", year_of_completion: 2015 };
    expect(validateCheckValues(edu.fields, entry, "entry").ok).toBe(true);
    expect(Object.keys(validateCheckValues(edu.fields, entry, "submit").errors).sort()).toEqual(["confirmation_channel", "confirmed_by", "confirmed_on"]);
  });
});

describe("records", () => {
  const employment = byKey("employment").fields;
  const row = (company: string) => ({ company });

  it("follow their row when one above is removed", () => {
    expect(recordMoves(employment, { employers: [row("Dialog"), row("SLT"), row("MAS")] }, { employers: [row("Dialog"), row("MAS")] })).toEqual({ "employers.1": null, "employers.2": "employers.1" });
  });

  it("keep two rows with one name apart", () => {
    const v = { employers: [row("Dialog"), row("Dialog")] };
    expect(recordMoves(employment, v, v)).toEqual({});
  });

  it("stay on a row whose name was corrected", () => {
    expect(recordMoves(employment, { employers: [row("Dialog"), row("SLT")] }, { employers: [row("Dialog Axiata"), row("SLT")] })).toEqual({});
  });

  it("follow a row that moved, even past a shared name", () => {
    expect(recordMoves(employment, { employers: [row("MAS"), row("Dialog"), row("Dialog")] }, { employers: [row("Dialog"), row("Dialog")] })).toEqual({ "employers.0": null, "employers.1": "employers.0", "employers.2": "employers.1" });
  });

  it("stay put when nothing moved", () => {
    const v = { employers: [row("Dialog"), row("SLT")] };
    expect(recordMoves(employment, v, v)).toEqual({});
    expect(recordMoves(employment, v, { employers: [row("Dialog"), row("SLT"), row("MAS")] })).toEqual({});
  });
});

describe("publishing a check type", () => {
  const education = () => structuredClone(byKey("education"));
  const employment = () => structuredClone(byKey("employment"));

  it("accepts every built-in form", () => {
    for (const t of BUILTIN_CHECK_TYPES) expect(publishIssues(parseCheckTypeSchema(t.schema)), t.key).toEqual([]);
  });

  it("needs a way for a check to come out clear, and a way to record a discrepancy", () => {
    const noGreen = education();
    noGreen.result.options = noGreen.result.options.filter((o) => o.tone !== "green");
    expect(publishIssues(noGreen).join(" ")).toMatch(/green result/);
    const noRed = education();
    noRed.result.options = noRed.result.options.filter((o) => o.tone !== "red");
    expect(publishIssues(noRed).join(" ")).toMatch(/red result/);
  });

  it("refuses two results with one key", () => {
    const s = education();
    s.result.options = [...s.result.options, { ...s.result.options[0] }];
    expect(publishIssues(s)).toContain("Two results share a key.");
  });

  it("refuses a group that asks for more rows than it allows", () => {
    const s = employment();
    const group = s.fields.find((f) => f.type === "repeatable_group")!;
    group.group = { ...group.group!, min: 5, max: 2 };
    expect(publishIssues(s).join(" ")).toMatch(/at least 5 but allows only 2/);
  });

  it("refuses a number whose lowest value is above its highest", () => {
    const s = education();
    const year = s.fields.find((f) => f.type === "number")!;
    year.validation = { ...year.validation, min: 2030, max: 2000 };
    expect(publishIssues(s).join(" ")).toMatch(/lowest value above its highest/);
  });

  it("refuses a per-record document with no such group on the check", () => {
    const s = employment();
    s.documents = [...s.documents, { ...s.documents[0], per_record: "nowhere" }];
    expect(publishIssues(s).join(" ")).toMatch(/set per record/);
  });

  it("refuses a mistyped year rather than printing it as a believable date", () => {
    const fields = [{ key: "on", label: "Confirmed on", type: "date", required: true, stage: "entry", visibility: [], fill_by: ["staff"] }] as never;
    expect(validateCheckValues(fields, { on: "0201-03-15" }, "submit").ok).toBe(false);
    expect(validateCheckValues(fields, { on: "2024-03-15" }, "submit").ok).toBe(true);
  });
});
