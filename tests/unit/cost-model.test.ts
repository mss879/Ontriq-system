import { describe, expect, it } from "vitest";
import {
  COMPREHENSIVE_CASE,
  STANDARD_CASE,
  SCENARIOS,
  TASKS,
  averageCaseCost,
  caseCost,
  caseCostLines,
  combinedCaseCost,
  invoiceCost,
  minutesSaved,
  monthly,
  monthsOnFreeStorage,
  onboardingCostLines,
  packExtractCost,
  paidEmailFromCases,
  sum,
  task,
  taskCost,
  usageCost,
  usd,
} from "@/domain/ai/cost-model";

describe("cost model", () => {
  it("prices usage at list prices", () => {
    expect(usageCost({ tier: "sonnet", input: 1_000_000, output: 1_000_000 })).toBe(12);
    expect(usageCost({ tier: "haiku", input: 1_000_000, output: 0 })).toBeCloseTo(0.1);
    expect(usageCost({ tier: "opus", input: 0, cachedInput: 1_000_000, output: 0 })).toBeCloseTo(0.2);
    expect(usageCost({ tier: "sonnet", input: 0, cachedInput: 1_000_000, output: 0 })).toBeCloseTo(0.1);
  });

  it("prices an extraction call from the evaluation's measured tokens", () => {
    expect(taskCost("extract_check")).toBeCloseTo(0.0166, 6);
  });

  it("keeps a comprehensive case well under one dollar", () => {
    const c = caseCost(COMPREHENSIVE_CASE);
    expect(c).toBeGreaterThan(0.15);
    expect(c).toBeLessThan(0.5);
    expect(caseCost(STANDARD_CASE)).toBeLessThan(c);
  });

  it("fits the ledger's cost of a candidate report on six pages", () => {
    const line = caseCostLines(STANDARD_CASE).find((l) => l.label === task("candidate_report").label);
    expect(line?.cost).toBeCloseTo(0.0214, 2);
    expect(taskCost("candidate_report")).toBeCloseTo(caseCostLines(COMPREHENSIVE_CASE).find((l) => l.label === task("candidate_report").label)?.cost ?? 0, 6);
  });

  it("fits the ledger's cost of reading a four-page combined PDF into seven checks", () => {
    const seven = 7 * packExtractCost(4);
    expect(seven).toBeGreaterThan(0.14);
    expect(seven).toBeLessThan(0.16);
  });

  it("charges more when a case arrives as one PDF, and still under a dollar", () => {
    expect(combinedCaseCost(COMPREHENSIVE_CASE)).toBeGreaterThan(caseCost(COMPREHENSIVE_CASE));
    expect(combinedCaseCost(COMPREHENSIVE_CASE)).toBeLessThan(1);
  });

  it("averages the month's mix between its cheapest and dearest cases", () => {
    const average = averageCaseCost(SCENARIOS[1]);
    expect(average).toBeGreaterThan(caseCost(STANDARD_CASE));
    expect(average).toBeLessThan(combinedCaseCost(COMPREHENSIVE_CASE));
  });

  it("lists only AI calls the system really makes", () => {
    const keys = TASKS.map((t) => t.key as string);
    for (const unbuilt of ["tamper", "candidate_guidance", "status_explainer", "consent_check", "assignment_explanation", "cover_email"]) expect(keys).not.toContain(unbuilt);
  });

  it("prices onboarding and invoices in cents", () => {
    expect(sum(onboardingCostLines())).toBeLessThan(0.15);
    expect(invoiceCost()).toBeLessThan(0.001);
  });

  it("grows monthly totals with volume and pays for email before the free plan's daily limit bites", () => {
    const [starter, growth, scale] = SCENARIOS.map(monthly);
    expect(starter.total).toBeLessThan(growth.total);
    expect(growth.total).toBeLessThan(scale.total);
    expect(starter.email).toBe(0);
    expect(growth.email).toBe(20);
    expect(scale.email).toBe(20);
    expect(paidEmailFromCases(8)).toBe(113);
  });

  it("estimates storage headroom on the free tier", () => {
    expect(monthsOnFreeStorage(50)).toBeCloseTo(2.56, 1);
  });

  it("formats money", () => {
    expect(usd(0.00069)).toBe("$0.0007");
    expect(usd(0.0175)).toBe("$0.018");
    expect(usd(0.6522)).toBe("$0.65");
    expect(usd(79.95, { whole: true })).toBe("$80");
    expect(usd(12.345)).toBe("$12.35");
    expect(usd(1234.5)).toBe("$1,235");
    expect(minutesSaved()).toBeGreaterThan(120);
  });
});
