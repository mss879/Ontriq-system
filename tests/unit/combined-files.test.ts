import { describe, expect, it } from "vitest";
import { checksToFill, docsForCheck } from "@/domain/ai/extraction";
import { canTakeFile, otherDocuments, pagesLabel, slotOffers } from "@/domain/documents/combined";
import { organizeSuggestions, type Suggestion } from "@/domain/ai/suggestions";
import { compileReport, type ReportInputs } from "@/domain/reports/compile-core";
import { ClassifySchema } from "@/lib/ai/prompts";

const known = ["nic_copy", "service_letter", "police_report", "gn_certificate", "cv", "other"];
const part = (category: string, pages: string | null = null, name: string | null = null) => ({ category, pages, name });

describe("what else a file holds", () => {
  it("leaves out the file's own type, general types and types the org doesn't have", () => {
    const parts = [part("nic_copy", "1"), part("service_letter", "2"), part("other", "3"), part("made_up", "4")];
    expect(otherDocuments(parts, "nic_copy", known)).toEqual([part("service_letter", "2")]);
  });

  it("keeps every page and name when a type appears twice", () => {
    const parts = [part("service_letter", "2", "Nimali Perera"), part("service_letter", "5", "Kasun Silva")];
    expect(otherDocuments(parts, "other", known)).toEqual([part("service_letter", "2, 5", "Nimali Perera, Kasun Silva")]);
  });

  it("offers nothing for a single document uploaded under its own type", () => {
    expect(otherDocuments([part("nic_copy", "1")], "nic_copy", known)).toEqual([]);
  });

  it("says pages the way a person would", () => {
    expect(pagesLabel("3")).toBe("page 3");
    expect(pagesLabel("3-4")).toBe("pages 3-4");
    expect(pagesLabel("2, 5")).toBe("pages 2, 5");
    expect(pagesLabel(" ")).toBeNull();
    expect(pagesLabel(null)).toBeNull();
  });
});

describe("reading a file", () => {
  it("takes a quality word it doesn't know instead of failing the read", () => {
    expect(ClassifySchema.shape.quality_issues.parse(["tilted", "blurred"])).toEqual(["other", "blurred"]);
  });
});

describe("the AI's list on a file", () => {
  const suggestion = (id: string, fieldKey: string): Suggestion => ({ id, capability: "document.classify", entityType: "document", entityId: "doc", fieldKey, value: {}, confidence: null, rationale: null, sourceRefs: [], decision: "pending", createdAt: "2026-10-31T00:00:00Z" });

  it("sits apart from the quality flag on the same file", () => {
    const { documents } = organizeSuggestions([suggestion("q", "quality"), suggestion("c", "contains")], "case");
    expect(documents.doc.quality?.id).toBe("q");
    expect(documents.doc.contains?.id).toBe("c");
  });
});

describe("which slots a file can fill", () => {
  const slot = (id: string, category: string, status: string, receivedCount = 0, files: { documentId: string }[] = []) => ({ id, category, status, receivedCount, files });
  const parts = [part("nic_copy", "1"), part("police_report", "2"), part("gn_certificate", "3"), part("service_letter", "4"), part("sanction_report", "5")];

  it("offers only open slots", () => {
    const reqs = [slot("a", "nic_copy", "pending"), slot("b", "police_report", "received", 1), slot("c", "gn_certificate", "waived"), slot("d", "service_letter", "optional")];
    expect(slotOffers(parts, reqs, "doc", []).map((o) => o.requirement.id)).toEqual(["a", "d"]);
  });

  it("doesn't offer a slot the file already fills", () => {
    expect(slotOffers(parts, [slot("a", "nic_copy", "pending", 0, [{ documentId: "doc" }])], "doc", [])).toEqual([]);
  });

  it("keeps a fixed annexure a file of its own", () => {
    expect(slotOffers(parts, [slot("a", "sanction_report", "pending")], "doc", ["sanction_report"])).toEqual([]);
    expect(canTakeFile({ category: "sanction_report", status: "pending", receivedCount: 0 }, ["sanction_report"])).toBe(false);
  });

  it("offers an optional slot only while it is empty", () => {
    expect(canTakeFile({ category: "transcript", status: "optional", receivedCount: 0 }, [])).toBe(true);
    expect(canTakeFile({ category: "transcript", status: "optional", receivedCount: 1 }, [])).toBe(false);
  });
});

describe("which checks a combined file feeds", () => {
  const reqs = [
    { case_check_id: "police", category: "police_report" },
    { case_check_id: "nic", category: "nic_copy" },
  ];
  const all = ["police", "nic", "address"];

  it("reaches every check from a general upload that holds several documents", () => {
    expect(checksToFill({ case_check_id: null, category: "other" }, ["other", "nic_copy", "police_report"], reqs, all)).toEqual(all);
  });

  it("reaches the other checks from a pack uploaded to one slot", () => {
    expect(checksToFill({ case_check_id: "nic", category: "nic_copy" }, ["nic_copy", "police_report"], reqs, all).sort()).toEqual(["nic", "police"]);
  });

  it("still reads the file that prompted the job, wherever it was uploaded", () => {
    const docs = [{ id: "pack", case_check_id: "nic", category: "nic_copy" }];
    expect(docsForCheck(docs, "police", reqs)).toEqual([]);
    expect(docsForCheck(docs, "police", reqs, 6, "pack")).toEqual(docs);
  });
});

describe("a combined file in the report", () => {
  const base: ReportInputs = {
    org: { name: "Ontriq", legal_name: "Ontriq", address: "", phone: "", email: "", website: "" },
    case: { reference: "ONT-1", client_name: "Client", client_reference: null, position_title: null, department: null, package_name: null, process_type: "client_supplied", received_at: "2026-10-01T00:00:00Z", completed_at: null, proposed_result: null },
    candidate: { full_name: "Nimali Perera", nic: null, date_of_birth: null },
    checks: [
      { id: "nic", key: "nic", label: "NIC verification", sort: 1, state: "completed", result: "clear", result_tone: "green", client_note: null, values: {}, completed_at: "2026-10-02T00:00:00Z", schema: { fields: [], result: { options: [{ key: "clear", label: "Clear", tone: "green" }] } } },
    ],
    documents: [
      { id: "pack", case_check_id: null, category: "other", category_name: "Other", filename: "candidate documents.pdf", mime: "application/pdf", sha256: "abc", created_at: "2026-10-01T00:00:00Z", holds: [{ check_id: "police", label: "Police report", pages: "3-4" }, { check_id: "nic", label: "NIC copy", pages: "1" }] },
      { id: "plain", case_check_id: "nic", category: "nic_copy", category_name: "NIC copy", filename: "nic.jpg", mime: "image/jpeg", sha256: "def", created_at: "2026-10-02T00:00:00Z" },
    ],
    qc: [],
  };

  it("lists the file under the check it serves, with its pages", () => {
    expect(compileReport(base).checks[0].evidence).toEqual(["NIC copy: candidate documents.pdf, page 1", "NIC copy: nic.jpg"]);
  });

  it("says what the file holds on its annexure, in page order", () => {
    const pack = compileReport(base).annexures.find((a) => a.document_id === "pack");
    expect(pack?.title).toBe("Combined file");
    expect(pack?.contents).toEqual(["NIC copy, page 1", "Police report, pages 3-4"]);
  });

  it("lists a whole-case file under the check it counts for, without calling it combined", () => {
    const sole: ReportInputs = { ...base, documents: [{ id: "sole", case_check_id: null, for_check: "nic", category: "nic_copy", category_name: "NIC copy", filename: "nic-both-sides.pdf", mime: "application/pdf", sha256: "abc", created_at: "2026-10-01T00:00:00Z" }] };
    const report = compileReport(sole);
    expect(report.checks[0].evidence).toEqual(["NIC copy: nic-both-sides.pdf"]);
    expect(report.annexures[0].title).toBe("NIC verification · NIC copy");
    expect(report.annexures[0].check_label).toBe("NIC verification");
  });

  it("leaves ordinary annexures as they were, so existing drafts keep their hash", () => {
    const plain = compileReport(base).annexures.find((a) => a.document_id === "plain");
    expect(plain && "contents" in plain).toBe(false);
  });
});
