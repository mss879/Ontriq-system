import { describe, expect, it } from "vitest";
import { answerText, appendixRef, cleanCandidateReport, shouldConfirm } from "@/domain/candidate/report";
import { candidateDict, timelineTitle } from "@/domain/candidate/i18n";
import { candidateReportContent, type CandidateReportInput } from "@/jobs/ai/content";

describe("the report's appendix", () => {
  it("numbers files from A1", () => {
    expect([0, 1, 11].map(appendixRef)).toEqual(["A1", "A2", "A12"]);
  });

  const report = {
    summary: " Provided five documents. ",
    sections: [
      { title: "Identity", note: " ", facts: [{ label: "NIC", value: "199057501234", appendix: ["a1", "A1", "A9"] }, { label: "Phone", value: " ", appendix: [] }] },
      { title: "Empty", note: null, facts: [{ label: "Blank", value: "", appendix: [] }] },
    ],
    points_to_check: [{ note: "Check this", appendix: ["A9"] }, { note: " ", appendix: [] }],
  };

  it("drops references to files that don't exist", () => {
    const clean = cleanCandidateReport(report, ["A1", "A2"]);
    expect(clean.sections[0].facts[0].appendix).toEqual(["A1"]);
    expect(clean.points_to_check).toEqual([{ note: "Check this", appendix: [] }]);
  });

  it("drops empty facts, and sections left with none", () => {
    const clean = cleanCandidateReport(report, ["A1"]);
    expect(clean.sections.map((s) => s.title)).toEqual(["Identity"]);
    expect(clean.sections[0].facts.map((f) => f.label)).toEqual(["NIC"]);
    expect(clean.sections[0].note).toBeNull();
  });
});

describe("a candidate's answer as text", () => {
  it("uses a plain answer as it is", () => {
    expect(answerText({ value: " Colombo " })).toBe("Colombo");
    // Lists and date ranges are answers too, and must not stop the report.
    expect(answerText({ value: { from: "2019-02-01", present: true } })).toBe("2019-02-01 to present");
    expect(answerText({ value: ["ol", "degree"] }, null, [{ value: "ol", label: "G.C.E. O/L" }, { value: "degree", label: "Degree" }])).toBe("G.C.E. O/L, Degree");
  });

  it("labels rows from the form, including periods", () => {
    const form = { min: 1, max: 5, item_label: "Employer", fields: [{ key: "company", label: "Company", type: "text", required: true, options: [] }] };
    expect(answerText({ rows: [{ company: "Saman", period: { from: "2015-03-02", present: true } }] }, form)).toBe("Company: Saman; period: 02/03/15 to present");
  });

  it("has nothing to say about a document request", () => {
    expect(answerText({})).toBe("");
    expect(answerText(null)).toBe("");
  });
});

describe("when a candidate should confirm", () => {
  const fresh = { confirmed_at: null, changed_since: false };
  const done = { confirmed_at: "2026-10-31T00:00:00Z", changed_since: false };

  it("waits until nothing is owed", () => {
    expect(shouldConfirm(false, fresh, "documents")).toBe(false);
    expect(shouldConfirm(true, fresh, "documents")).toBe(true);
  });

  it("stops once confirmed, until they give something new", () => {
    expect(shouldConfirm(true, done, "documents")).toBe(false);
    expect(shouldConfirm(true, { ...done, changed_since: true }, "pre_qc")).toBe(true);
  });

  it("never asks on a closed case", () => {
    expect(shouldConfirm(true, fresh, "released")).toBe(false);
    expect(shouldConfirm(true, fresh, "cancelled")).toBe(false);
  });

  it("doesn't ask once uploads have closed: the page no longer says what is outstanding", () => {
    expect(shouldConfirm(true, fresh, "verification")).toBe(true);
    expect(shouldConfirm(true, fresh, "post_qc")).toBe(false);
    expect(shouldConfirm(true, fresh, "report")).toBe(false);
  });
});

describe("what the AI is given", () => {
  const input: CandidateReportInput = {
    reference: "ONT-1",
    client: "Blue Lotus",
    position: null,
    candidate: { full_name: "Nimali Perera", nic: "199057501234", date_of_birth: null, email: "private@example.lk", phone: "+94771234567", address: null },
    checks: ["NIC verification"],
    answers: [{ question: "Employer", answer: "Saman" }],
    documents: [
      { ref: "A1", title: "NIC copy", filename: "nic.jpg", text: "National Identity Card" },
      { ref: "A2", title: "Service letter", filename: "photo.jpg", text: null },
    ],
  };
  const text = candidateReportContent(input);

  it("gives each file its appendix reference", () => {
    expect(text).toContain("--- A1: NIC copy, file nic.jpg");
  });

  it("says when a file couldn't be read", () => {
    expect(text).toContain("A2: Service letter, file photo.jpg\n(this file could not be read)");
  });

  it("leaves out contact details the report doesn't need the AI for", () => {
    expect(text).not.toContain("private@example.lk");
    expect(text).not.toContain("+94771234567");
  });
});

describe("the candidate's timeline", () => {
  it("says it in their language", () => {
    const entry = { kind: "candidate_confirmed", title: "Candidate confirmed their documents", data: { to: null, category: null } };
    expect(timelineTitle(candidateDict("en"), entry)).toBe("You confirmed your documents");
    expect(timelineTitle(candidateDict("si"), entry)).not.toBe(entry.title);
    expect(timelineTitle(candidateDict("ta"), entry)).not.toBe(entry.title);
  });
});
