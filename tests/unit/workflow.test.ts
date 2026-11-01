import { describe, expect, it } from "vitest";
import { availableActions, type CaseFacts } from "@/domain/workflow/transitions-core";
import { DEFAULT_QC_CHECKLISTS, parseWorkflowSettings } from "@/domain/workflow/settings";

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
    const f = facts({ stage: "data_entry", checks: [{ state: "in_progress", entryReady: true }, { state: "not_started", entryReady: false }, { state: "waived", entryReady: false }] });
    expect(availableActions(f, only("checks.data_entry"))[0]).toMatchObject({ action: "start_verification", allowed: false, reason: "1 check still has missing or invalid details." });
  });

  it("stops at consent that is missing or was sent back, not at an unused link", () => {
    const entry = facts({ stage: "data_entry", checks: [{ state: "in_progress", entryReady: true }] });
    expect(availableActions({ ...entry, consentRefused: true }, only("checks.data_entry"))[0]).toMatchObject({ allowed: false, reason: expect.stringMatching(/consent/) });
    expect(availableActions({ ...entry, consentMissing: true }, only("checks.data_entry"))[0].allowed).toBe(true);
    const verifying = facts({ stage: "verification", isOwner: true, checks: [{ state: "completed", entryReady: true }], consentRefused: true });
    expect(availableActions(verifying, only("cases.update"))[0]).toMatchObject({ action: "submit_post_qc", allowed: false, reason: expect.stringMatching(/consent/) });
  });

  it("offers no way round consent with pending checks", () => {
    const f = facts({ stage: "verification", checks: [{ state: "in_progress", entryReady: true }], consentRefused: true });
    expect(availableActions(f, all).some((a) => a.action === "submit_post_qc_pending")).toBe(false);
  });

  it("needs every check closed before Post-QC", () => {
    const f = facts({ stage: "verification", isOwner: true, checks: [{ state: "completed", entryReady: true }, { state: "awaiting_response", entryReady: true }] });
    expect(availableActions(f, only("cases.update"))[0]).toMatchObject({ action: "submit_post_qc", allowed: false, reason: "1 check still open." });
  });

  it("won't send a case to Post-QC while its fixed annexure has no file", () => {
    const f = facts({ stage: "verification", isOwner: true, checks: [{ state: "completed", entryReady: true }], annexuresMissing: ["Global sanction screening"] });
    expect(availableActions(f, only("cases.update"))[0]).toMatchObject({ action: "submit_post_qc", allowed: false, reason: "Global sanction screening has no report attached. Upload it first: it goes in the final report." });
    expect(availableActions({ ...f, annexuresMissing: [] }, only("cases.update"))[0]).toMatchObject({ action: "submit_post_qc", allowed: true });
  });

  it("lets a manager send open checks on, and nobody else", () => {
    const f = facts({ stage: "verification", isOwner: true, checks: [{ state: "completed", entryReady: true }, { state: "in_progress", entryReady: true }] });
    expect(availableActions(f, all).map((a) => a.action)).toContain("submit_post_qc_pending");
    expect(availableActions(f, only("cases.update")).map((a) => a.action)).not.toContain("submit_post_qc_pending");
    expect(availableActions({ ...f, checks: [{ state: "completed", entryReady: true }] }, all).map((a) => a.action)).not.toContain("submit_post_qc_pending");
  });

  it("offers only resume and cancel while on hold, and nothing once released", () => {
    expect(availableActions(facts({ onHold: true }), all).map((a) => a.action)).toEqual(["resume", "cancel"]);
    expect(availableActions(facts({ stage: "released" }), all)).toEqual([]);
  });

  it("lets the case owner send a case back to documents, not only a manager", () => {
    const f = facts({ stage: "verification", isOwner: true, checks: [{ state: "in_progress", entryReady: true }] });
    expect(availableActions(f, only("cases.update")).map((a) => a.action)).toContain("return_to_documents");
    expect(availableActions({ ...f, isOwner: false }, only("cases.update")).map((a) => a.action)).not.toContain("return_to_documents");
  });

  it("holds Pre-QC on a Type 2 case until the candidate was contacted", () => {
    const [a] = availableActions(facts({ contactGap: "log your call to the candidate first" }), all);
    expect(a.allowed).toBe(false);
    expect(a.reason).toBe("Log your call to the candidate first.");
  });

  it("waits for a person when the NIC matches a different name", () => {
    const [a] = availableActions(facts({ stage: "intake", candidateMatchOpen: true }), all);
    expect(a.allowed).toBe(false);
    expect(a.reason).toMatch(/different name/);
  });

  it("keeps hold and cancel at the report and approval stages", () => {
    for (const stage of ["report", "approval"] as const) {
      expect(availableActions(facts({ stage }), all).map((a) => a.action)).toEqual(["hold", "cancel"]);
      expect(availableActions(facts({ stage, onHold: true }), all).map((a) => a.action)).toEqual(["resume", "cancel"]);
    }
  });

  it("calls stopping a revision what it is", () => {
    const cancel = availableActions(facts({ stage: "report", revising: true }), all).find((a) => a.action === "cancel");
    expect(cancel?.label).toBe("Stop the revision");
  });

  it("offers no way to stop a revision that went back behind the report", () => {
    expect(availableActions(facts({ stage: "verification", reworking: true }), all).some((a) => a.action === "cancel")).toBe(false);
  });

  it("gives QC decisions only to QC permissions", () => {
    expect(availableActions(facts({ stage: "pre_qc" }), only("qc.pre"))[0].action).toBe("pre_qc_review");
    expect(availableActions(facts({ stage: "post_qc" }), only("qc.pre")).length).toBe(0);
  });
});

describe("workflow settings", () => {
  it("falls back to the standard checklists and free order", () => {
    expect(parseWorkflowSettings({})).toEqual({ qcChecklists: DEFAULT_QC_CHECKLISTS, enforceCheckOrder: false });
  });
  it("reads what Ontriq set, and ignores empty lists", () => {
    const parsed = parseWorkflowSettings({ workflow: { qc_checklists: { pre: ["Only this", " "], post: [] }, enforce_check_order: true } });
    expect(parsed.qcChecklists.pre).toEqual(["Only this"]);
    expect(parsed.qcChecklists.post).toEqual(DEFAULT_QC_CHECKLISTS.post);
    expect(parsed.enforceCheckOrder).toBe(true);
  });
});
