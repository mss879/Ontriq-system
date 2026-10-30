import { describe, expect, it } from "vitest";
import { availableActions, nextStage, type CaseFacts } from "@/domain/workflow/transitions-core";
import { progress, proposedResult, statusFor } from "@/domain/workflow/rollup-core";

const facts = (over: Partial<CaseFacts>): CaseFacts => ({
  stage: "documents",
  onHold: false,
  documentsOutstanding: 0,
  verificationDocumentsOutstanding: 0,
  checks: [],
  isOwner: false,
  ...over,
});
const all = () => true;
const only = (...perms: string[]) => (p: string) => perms.includes(p);

describe("stage transitions", () => {
  it("follows the flowchart and its return loops", () => {
    expect(nextStage("documents", "submit_pre_qc")).toBe("pre_qc");
    expect(nextStage("pre_qc", "pre_qc_approve")).toBe("data_entry");
    expect(nextStage("pre_qc", "pre_qc_return")).toBe("documents");
    expect(nextStage("data_entry", "start_verification")).toBe("verification");
    expect(nextStage("verification", "submit_post_qc")).toBe("post_qc");
    expect(nextStage("post_qc", "post_qc_approve")).toBe("report");
    expect(nextStage("post_qc", "post_qc_return")).toBe("verification");
    expect(nextStage("documents", "post_qc_approve")).toBeNull();
  });

  it("blocks Pre-QC until required documents are in, and says why", () => {
    const [a] = availableActions(facts({ documentsOutstanding: 2 }), all);
    expect(a).toMatchObject({ action: "submit_pre_qc", allowed: false });
    expect(a.reason).toMatch(/2 required documents still missing/);
    expect(availableActions(facts({}), all)[0].allowed).toBe(true);
  });

  it("needs the candidate's consent before Pre-QC once a link was issued", () => {
    const [a] = availableActions(facts({ consentMissing: true }), all);
    expect(a).toMatchObject({ action: "submit_pre_qc", allowed: false });
    expect(a.reason).toMatch(/consent/);
    // Missing documents are explained first.
    expect(availableActions(facts({ consentMissing: true, documentsOutstanding: 1 }), all)[0].reason).toMatch(/1 required document/);
  });

  it("only lets the owner or a manager move a case", () => {
    expect(availableActions(facts({}), only("cases.update")).some((a) => a.action === "submit_pre_qc")).toBe(false);
    expect(availableActions(facts({ isOwner: true }), only("cases.update")).some((a) => a.action === "submit_pre_qc")).toBe(true);
  });

  it("needs valid details on every check to start verification", () => {
    const f = facts({ stage: "data_entry", checks: [{ state: "in_progress", valuesValid: true }, { state: "not_started", valuesValid: false }, { state: "waived", valuesValid: false }] });
    expect(availableActions(f, only("checks.data_entry"))[0]).toMatchObject({ action: "start_verification", allowed: false, reason: "1 check still has missing or invalid details." });
  });

  it("needs every check closed before Post-QC", () => {
    const f = facts({ stage: "verification", isOwner: true, checks: [{ state: "completed", valuesValid: true }, { state: "awaiting_response", valuesValid: true }] });
    expect(availableActions(f, only("cases.update"))[0]).toMatchObject({ action: "submit_post_qc", allowed: false, reason: "1 check still open." });
  });

  it("offers only resume and cancel while on hold, and nothing once released", () => {
    expect(availableActions(facts({ onHold: true }), all).map((a) => a.action)).toEqual(["resume", "cancel"]);
    expect(availableActions(facts({ stage: "released" }), all)).toEqual([]);
  });

  it("gives QC decisions only to QC permissions", () => {
    expect(availableActions(facts({ stage: "pre_qc" }), only("qc.pre"))[0].action).toBe("pre_qc_review");
    expect(availableActions(facts({ stage: "post_qc" }), only("qc.pre")).length).toBe(0);
  });
});

describe("case roll-ups", () => {
  it("is red only when a person marked a discrepancy", () => {
    expect(proposedResult([{ state: "completed", resultTone: "green" }, { state: "discrepancy", resultTone: "red" }])).toBe("red");
  });
  it("is amber while anything is open or unverifiable", () => {
    expect(proposedResult([{ state: "completed", resultTone: "green" }, { state: "in_progress" }])).toBe("amber");
    expect(proposedResult([{ state: "unable_to_verify", resultTone: "amber" }])).toBe("amber");
    expect(proposedResult([])).toBe("amber");
  });
  it("is green only when every counted check is clear", () => {
    expect(proposedResult([{ state: "completed", resultTone: "green" }, { state: "waived" }])).toBe("green");
  });
  it("marks verification partially complete", () => {
    expect(statusFor("verification", [{ state: "completed" }, { state: "in_progress" }])).toBe("partially_completed");
    expect(statusFor("verification", [{ state: "in_progress" }])).toBe("verification_in_progress");
    expect(statusFor("documents", [], { returned: true })).toBe("returned_for_correction");
    expect(progress([{ state: "completed" }, { state: "in_progress" }, { state: "waived" }])).toEqual({ done: 1, total: 2, percent: 50 });
  });
});
