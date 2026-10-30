import { describe, expect, it } from "vitest";
import { bulkTemplateCsv, mapHeaders, parseCsv, validateBulk } from "@/domain/portal/bulk-core";

describe("CSV parsing", () => {
  it("handles quotes, commas, newlines and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "2"],
    ]);
    expect(parseCsv("﻿name\nAma\n\n")).toEqual([["name"], ["Ama"]]);
  });

  it("maps headers by name or common alias", () => {
    expect(mapHeaders(["Candidate Name", "NIC Number", "Mobile", "Job title", "Whatever"])).toEqual(["full_name", "nic", "phone", "position_title", null]);
  });
});

describe("bulk validation", () => {
  it("accepts the template and flags bad rows with their line numbers", () => {
    expect(validateBulk(bulkTemplateCsv()).rows[0].errors).toEqual([]);
    const { rows, missingColumns } = validateBulk("Full name,NIC,Email\nAma Silva,853400937V,ama@x.lk\nB,12345,nope\nKamal,198534000937,\n");
    expect(missingColumns).toEqual([]);
    expect(rows[0]).toMatchObject({ line: 2, nicCanonical: "198534000937", errors: [] });
    expect(rows[1].errors).toEqual(expect.arrayContaining(["Full name is missing.", 'NIC "12345" is not valid.', 'Email "nope" looks wrong.']));
    // Old and new cards of the same person are the same NIC.
    expect(rows[2].errors).toContain("Same NIC as line 2.");
  });

  it("needs a name column and caps the batch", () => {
    expect(validateBulk("NIC\n853400937V\n").missingColumns).toEqual(["Full name"]);
    const many = "Full name\n" + Array.from({ length: 105 }, (_, i) => `Person ${i}`).join("\n");
    const r = validateBulk(many);
    expect(r.rows).toHaveLength(100);
    expect(r.tooMany).toBe(true);
  });
});
