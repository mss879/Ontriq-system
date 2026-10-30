import { describe, expect, it } from "vitest";
import {
  applyFieldSuggestions,
  canDecide,
  canRerun,
  confidenceLabel,
  organizeSuggestions,
  outcomeForResult,
  sameValue,
  type Suggestion,
} from "@/domain/ai/suggestions";

const CASE = "c1";
let n = 0;
const s = (over: Partial<Suggestion>): Suggestion => ({
  id: `s${++n}`,
  capability: "document.extract",
  entityType: "case_check",
  entityId: "k1",
  fieldKey: null,
  value: {},
  confidence: null,
  rationale: null,
  sourceRefs: [],
  decision: "pending",
  createdAt: `2026-10-30T10:${String(n).padStart(2, "0")}:00Z`,
  ...over,
});

describe("organizeSuggestions", () => {
  it("keeps the newest pending value per field and ignores decided or replaced ones", () => {
    const old = s({ fieldKey: "institution", value: "Royal" });
    const fresh = s({ fieldKey: "institution", value: "Royal College" });
    const decided = s({ fieldKey: "year", value: 2015, decision: "accepted" });
    const replaced = s({ fieldKey: "index", value: "123", decision: "superseded" });
    const out = organizeSuggestions([old, fresh, decided, replaced], CASE);
    expect(out.checks.k1.extract.map((x) => x.id)).toEqual([fresh.id]);
    expect(out.pendingCount).toBe(2);
  });

  it("shows the latest case analysis even after it was reviewed, but not a replaced one", () => {
    const a = s({ capability: "case.postqc", entityType: "case", entityId: CASE, decision: "accepted" });
    const b = s({ capability: "case.postqc", entityType: "case", entityId: CASE, decision: "superseded" });
    expect(organizeSuggestions([a, b], CASE).postqc?.id).toBe(a.id);
  });

  it("splits narrative remarks per check from the case summary, and document signals per file", () => {
    const remarks = s({ capability: "report.narrative", fieldKey: "remarks", value: { text: "Verified." } });
    const summary = s({ capability: "report.narrative", entityType: "case", entityId: CASE, fieldKey: "executive_summary", value: { text: "All clear." } });
    const tamper = s({ capability: "document.tamper", entityType: "document", entityId: "d1", fieldKey: "tamper" });
    const out = organizeSuggestions([remarks, summary, tamper], CASE);
    expect(out.checks.k1.remarks?.id).toBe(remarks.id);
    expect(out.summary?.id).toBe(summary.id);
    expect(out.documents.d1.tamper?.id).toBe(tamper.id);
    expect(out.documents.d1.quality).toBeUndefined();
  });

  it("drops rejected outreach drafts", () => {
    const rejected = s({ capability: "check.outreach", fieldKey: "outreach", decision: "rejected" });
    expect(organizeSuggestions([rejected], CASE).checks.k1.outreach).toBeUndefined();
  });
});

describe("helpers", () => {
  it("labels confidence", () => {
    expect(confidenceLabel(0.92)).toBe("High · 92%");
    expect(confidenceLabel(0.7)).toBe("Medium · 70%");
    expect(confidenceLabel(0.2)).toBe("Low · 20%");
    expect(confidenceLabel(null)).toBeNull();
  });

  it("applies accepted values to top-level fields only", () => {
    expect(applyFieldSuggestions({ a: 1, b: 2 }, [{ fieldKey: "b", value: 3 }, { fieldKey: null, value: 9 }])).toEqual({ a: 1, b: 3 });
    expect(sameValue({ from: "2020-01-01", to: null }, { from: "2020-01-01", to: null })).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
  });

  it("maps a proposed result to an outcome, never settling 'pending'", () => {
    expect(outcomeForResult({ key: "clear", tone: "green" })).toBe("completed");
    expect(outcomeForResult({ key: "discrepancy", tone: "red" })).toBe("discrepancy");
    expect(outcomeForResult({ key: "unable_to_verify", tone: "amber" })).toBe("unable_to_verify");
    expect(outcomeForResult({ key: "pending", tone: "amber" })).toBeNull();
    expect(outcomeForResult(undefined)).toBeNull();
  });

  it("gates re-runs by stage, hold and permission", () => {
    const qc = (p: string) => p === "qc.pre";
    expect(canRerun("preqc", "pre_qc", false, qc)).toBe(true);
    expect(canRerun("preqc", "pre_qc", true, qc)).toBe(false);
    expect(canRerun("postqc", "post_qc", false, qc)).toBe(false);
    expect(canRerun("preqc", "released", false, () => true)).toBe(false);
  });

  it("gates decisions by capability", () => {
    expect(canDecide("document.extract", (p) => p === "checks.data_entry")).toBe(true);
    expect(canDecide("case.postqc", (p) => p === "qc.pre")).toBe(false);
    expect(canDecide("unknown", () => true)).toBe(false);
  });
});
