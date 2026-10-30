import { describe, expect, it } from "vitest";
import { candidatePayload, caseFields, importTemplateCsv, mapImportHeaders, parseImportCsv, validateImport, IMPORT_MAX_ROWS } from "@/domain/cases/import-core";

const today = new Date("2026-10-30T00:00:00Z");

describe("case import", () => {
  it("maps headers by name, label or alias, once each", () => {
    expect(mapImportHeaders(["Candidate Name", "NIC Number", "Mobile", "Language", "Notes", "name"])).toEqual(["full_name", "nic", "phone", "preferred_language", null, null]);
  });

  it("accepts the template as is", () => {
    const r = validateImport(importTemplateCsv(), { processType: "client_supplied", today });
    expect(r.missingColumns).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].errors).toEqual([]);
    expect(candidatePayload(r.rows[0])).toMatchObject({ full_name: "Nimal Perera", nic: "853400937V", nic_canonical: "198534000937", preferred_language: "en", district: "Colombo" });
    expect(caseFields(r.rows[0])).toEqual({ position_title: "Accountant", department: "Finance", client_reference: "EMP-1042" });
  });

  it("reports each problem on its own line and catches duplicates", () => {
    const csv = [
      "Full name,NIC,Email,Phone,District,Language",
      "Kamal Silva,199012345678,kamal@example.com,0771234567,kandy,Sinhala",
      "X,12345,bad-email,123,Atlantis,French",
      "Kamala Silva,199012345678,KAMAL@example.com,,,",
      "Sunil Fernando,,,,,",
    ].join("\n");
    const r = validateImport(csv, { processType: "candidate_collected", today });
    const [ok, bad, dup, noContact] = r.rows;
    expect(ok.errors).toEqual([]);
    expect(ok.values).toMatchObject({ district: "Kandy", preferred_language: "si" });
    expect(ok.nic?.gender).toBe("male");
    expect(bad.errors).toHaveLength(6);
    expect(bad.errors.join(" ")).toMatch(/Full name.*NIC.*Email.*Phone.*District.*Language/);
    expect(dup.errors).toEqual(["Same NIC as line 2."]);
    expect(dup.warnings).toContain("Same email as line 2.");
    expect(noContact.errors).toEqual([]);
    expect(noContact.warnings.join(" ")).toMatch(/No NIC.*candidate link/);
  });

  it("needs a name column and caps the number of rows", () => {
    expect(parseImportCsv("NIC\n853400937V").missingColumns).toEqual(["Full name"]);
    const many = ["Full name", ...Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => `Person ${i}`)].join("\n");
    const r = parseImportCsv(many);
    expect(r.records).toHaveLength(IMPORT_MAX_ROWS);
    expect(r.tooMany).toBe(true);
    expect(r.total).toBe(IMPORT_MAX_ROWS + 5);
    expect(parseImportCsv("Full name,Shoe size\nA B,9").ignoredHeaders).toEqual(["Shoe size"]);
  });
});
