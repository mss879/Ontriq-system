import { describe, expect, it } from "vitest";
import { autofillSuggestions, checksToFill, docsForCheck, extractionFields, fieldPathLabel, groupRows, missingDetails } from "@/domain/ai/extraction";
import { checkTypeSchema, type FieldDef } from "@/domain/check-types/schema";
import { extractPrompt, ExtractSchema, ClassifySchema, classifyPrompt } from "@/lib/ai/prompts";
import { BUILTIN_CHECK_TYPES } from "@/domain/check-types/builtin";

const schemaOf = (key: string) => checkTypeSchema.parse(BUILTIN_CHECK_TYPES.find((t) => t.key === key)!.schema);

describe("which fields the AI fills", () => {
  it("reads the police report's own details but not what a person attests to", () => {
    const keys = extractionFields(schemaOf("police").fields).flat.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["nic", "permanent_address", "police_station_area", "oic_name"]));
    expect(keys).not.toContain("verified_by");
  });

  it("includes repeating groups such as employers, without the confirmation columns", () => {
    const { flat, groups } = extractionFields(schemaOf("employment").fields);
    expect(flat.map((f) => f.key)).not.toContain("employers");
    const employers = groups.find((g) => g.key === "employers")!;
    const columns = employers.fields.map((f) => f.key);
    expect(columns).toEqual(expect.arrayContaining(["company", "designation", "period"]));
    expect(columns).not.toContain("confirmed_by");
  });

  it("respects a field switched off in the check type builder", () => {
    const fields = [{ key: "note", label: "Note", type: "text", ai: { extract: false } }] as unknown as FieldDef[];
    expect(extractionFields(fields).flat).toEqual([]);
  });
});

describe("which check a file feeds", () => {
  const reqs = [
    { case_check_id: "police", category: "police_report" },
    { case_check_id: "edu", category: "education_certificate" },
  ];
  const all = ["police", "edu", "nic"];

  it("uses the check the file was uploaded to", () => {
    expect(checksToFill({ case_check_id: "edu", category: "other" }, ["police_report"], reqs, all)).toEqual(["edu"]);
  });

  it("matches the slot's category", () => {
    expect(checksToFill({ case_check_id: null, category: "police_report" }, [], reqs, all)).toEqual(["police"]);
  });

  it("follows what the AI says a general upload really is", () => {
    expect(checksToFill({ case_check_id: null, category: "other" }, ["police_report"], reqs, all)).toEqual(["police"]);
  });

  it("offers one PDF of everything to every check", () => {
    expect(checksToFill({ case_check_id: null, category: "other" }, ["other"], reqs, all)).toEqual(all);
    expect(checksToFill({ case_check_id: null, category: "cv" }, [], reqs, all)).toEqual(all);
  });

  it("leaves other files alone when nothing asks for them", () => {
    expect(checksToFill({ case_check_id: null, category: "gn_certificate" }, [], reqs, all)).toEqual([]);
  });
});

describe("which files a check reads", () => {
  const reqs = [{ case_check_id: "police", category: "police_report" }];
  const doc = (id: string, case_check_id: string | null, category: string) => ({ id, case_check_id, category });

  it("puts the check's own files first and skips other checks' files", () => {
    const docs = [doc("cv", null, "cv"), doc("other-check", "edu", "education_certificate"), doc("slot", null, "police_report"), doc("mine", "police", "police_report")];
    expect(docsForCheck(docs, "police", reqs).map((d) => d.id)).toEqual(["mine", "slot", "cv"]);
  });

  it("caps how many it reads without losing its own", () => {
    const docs = [...Array.from({ length: 8 }, (_, i) => doc(`cv${i}`, null, "other")), doc("mine", "police", "police_report")];
    const read = docsForCheck(docs, "police", reqs);
    expect(read).toHaveLength(6);
    expect(read[0].id).toBe("mine");
  });
});

describe("rows for a repeating group", () => {
  it("keeps known columns and drops blanks and empty rows", () => {
    const group = { fields: [{ key: "company" }, { key: "designation" }] };
    expect(
      groupRows(group, [
        { cells: [{ key: "company", value: "Dialog" }, { key: "designation", value: "" }, { key: "hacked", value: "x" }] },
        { cells: [{ key: "company", value: null }] },
      ]),
    ).toEqual([{ company: "Dialog" }]);
  });
});

describe("what is still missing", () => {
  it("names what's left once the found values are counted", () => {
    const { fields } = schemaOf("nic");
    expect(missingDetails(fields, {})).toEqual(expect.arrayContaining(["NIC number", "Name on NIC", "Validated through"]));
    const after = missingDetails(fields, { nic_number: "853400937V", name_on_nic: "Sajith Ranasinghe" });
    expect(after).toEqual(["Validated through"]);
  });

  it("labels a column inside a group", () => {
    const { fields } = schemaOf("employment");
    expect(fieldPathLabel(fields, "employers.1.company")).toContain("Company");
    expect(fieldPathLabel(fields, "employers.1.company")).toContain("2");
  });
});

describe("autofill", () => {
  const s = (fieldKey: string, confidence: number | null) => ({ id: fieldKey, fieldKey, value: "x", confidence });

  it("fills empty fields it is reasonably sure of", () => {
    expect(autofillSuggestions([s("a", 0.9), s("b", 0.6)], {}).map((x) => x.fieldKey)).toEqual(["a", "b"]);
  });

  it("leaves low confidence for a person to accept", () => {
    expect(autofillSuggestions([s("a", 0.4), s("b", null)], {})).toEqual([]);
  });

  it("never overwrites what someone entered", () => {
    expect(autofillSuggestions([s("a", 0.99), s("b", 0.99)], { a: "typed", b: "" }).map((x) => x.fieldKey)).toEqual(["b"]);
  });
});

describe("the instructions to the model", () => {
  it("asks for English values from Sinhala documents, with repeating groups", () => {
    const { flat, groups } = extractionFields(schemaOf("employment").fields);
    const p = extractPrompt({
      checkLabel: "Employment",
      fields: flat.map((f) => ({ key: f.key, label: f.label, type: f.type })),
      groups: groups.map((g) => ({ key: g.key, label: g.label, fields: g.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })) })),
    });
    expect(p.system).toMatch(/Sinhala/);
    expect(p.system).toMatch(/in English/);
    expect(p.text).toContain("employers");
    expect(p.text).toContain("company");
  });

  it("accepts a translated value with its original, and rows for a group", () => {
    const parsed = ExtractSchema.parse({
      fields: [{ key: "oic_name", value: "K. Perera", confidence: 0.9, source: "police.pdf", written_as: "කේ. පෙරේරා" }],
      groups: [{ key: "employers", rows: [{ cells: [{ key: "company", value: "Dialog" }] }], confidence: 0.8, source: "letter.pdf" }],
      overall: "The report shows no adverse record.",
      notes: null,
    });
    expect(parsed.fields[0].written_as).toBe("කේ. පෙරේරා");
  });

  it("asks the first read to translate", () => {
    expect(classifyPrompt({ expectedCategory: "police_report", expectedLabel: "Police report", categories: [] }).text).toMatch(/translate/i);
    expect(Object.keys(ClassifySchema.shape)).toContain("translation_en");
  });
});
