import { describe, expect, it } from "vitest";
import { canonicalJson, compileReport, formatFieldValue, type ReportInputs } from "@/domain/reports/compile-core";
import { BUILTIN_CHECK_TYPES } from "@/domain/check-types/builtin";
import { parseCheckTypeSchema } from "@/domain/check-types/schema";

const schemaOf = (key: string) => parseCheckTypeSchema(BUILTIN_CHECK_TYPES.find((t) => t.key === key)!.schema);

const inputs = (): ReportInputs => ({
  org: { name: "Ontriq", legal_name: "Ontriq (Pvt) Ltd", address: "Dehiwala", phone: "+94 77", email: "info@ontriq.com", website: "https://www.ontriq.com" },
  case: { reference: "ONT-2026-000001", client_name: "Hemas", client_reference: "EMP-1", position_title: "Accountant", department: null, package_name: "Standard", process_type: "client_supplied", received_at: "2026-11-01T04:00:00Z", completed_at: "2026-11-08T10:00:00Z", proposed_result: "green" },
  candidate: { full_name: "Nimal Perera", nic: "853400937V", date_of_birth: "1985-12-05" },
  checks: [
    { id: "c2", key: "employment", label: "Employment", sort: 20, state: "in_progress", result: null, result_tone: null, client_note: null, values: {}, completed_at: null, schema: schemaOf("employment") },
    { id: "c1", key: "nic", label: "NIC verification", sort: 10, state: "completed", result: "clear", result_tone: "green", client_note: "Matches DRP records.", values: { nic_number: "853400937V", date_of_birth: "1985-12-05" }, completed_at: "2026-11-02T06:00:00Z", schema: schemaOf("nic") },
  ],
  documents: [
    { id: "d2", case_check_id: null, category: "sanction_report", category_name: "Global sanction screening report", filename: "cfirst.pdf", mime: "application/pdf", sha256: "x", created_at: "2026-11-03T00:00:00Z" },
    { id: "d1", case_check_id: "c1", category: "nic_copy", category_name: "NIC copy", filename: "nic.jpg", mime: "image/jpeg", sha256: null, created_at: "2026-11-01T00:00:00Z" },
  ],
  qc: [
    { kind: "pre", reviewer: "Qasim", created_at: "2026-11-02T00:00:00Z" },
    { kind: "pre", reviewer: "Older", created_at: "2026-11-01T00:00:00Z" },
  ],
});

describe("report compile", () => {
  it("orders checks, and never shows an incomplete check as verified", () => {
    const r = compileReport(inputs());
    expect(r.summary.map((s) => s.label)).toEqual(["NIC verification", "Employment"]);
    expect(r.summary[0]).toMatchObject({ status: "verified", result_label: "Clear", result_tone: "green" });
    expect(r.summary[1]).toMatchObject({ status: "incomplete", status_label: "Not completed", result_label: null, result_tone: null });
    expect(r.checks[1].fields).toEqual([]);
    expect(r.checks[0].remarks).toBe("Matches DRP records.");
    expect(r.checks[0].evidence).toEqual(["NIC copy: nic.jpg"]);
    expect(r.qc).toEqual([{ kind: "pre", reviewer: "Qasim", on: "2 Nov 2026" }]);
  });

  it("puts the fixed annexure after the evidence, untouched", () => {
    const r = compileReport(inputs());
    expect(r.annexures.map((a) => [a.kind, a.filename])).toEqual([["evidence", "nic.jpg"], ["evidence", "cfirst.pdf"]]);
    // Sanction screening is a fixed annexure only when the case has that check; here it's ordinary evidence.
    const withSanction = inputs();
    withSanction.checks.push({ id: "c3", key: "sanction", label: "Global sanction screening", sort: 30, state: "completed", result: "clear", result_tone: "green", client_note: null, values: {}, completed_at: null, schema: schemaOf("sanction") });
    const r2 = compileReport(withSanction);
    expect(r2.annexures.map((a) => [a.kind, a.filename])).toEqual([["evidence", "nic.jpg"], ["fixed", "cfirst.pdf"]]);
  });

  it("hashes the same content the same way whatever the input order", () => {
    const a = inputs();
    const b = inputs();
    b.checks.reverse();
    b.documents.reverse();
    expect(canonicalJson(compileReport(a))).toBe(canonicalJson(compileReport(b)));
    b.checks[0].client_note = "changed";
    expect(canonicalJson(compileReport(a))).not.toBe(canonicalJson(compileReport(b)));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("formats field values for print", () => {
    expect(formatFieldValue({ key: "p", label: "Period", type: "date_range" } as never, { from: "2020-01-01", to: "" })).toBe("1 Jan 2020 to present");
    expect(formatFieldValue({ key: "x", label: "X", type: "boolean" } as never, false)).toBe("No");
    expect(formatFieldValue({ key: "s", label: "S", type: "select", options: [{ value: "a", label: "Alpha" }] } as never, "a")).toBe("Alpha");
  });
});
