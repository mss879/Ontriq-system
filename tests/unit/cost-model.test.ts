import { describe, expect, it } from "vitest";
import {
  COMPREHENSIVE_CASE,
  STANDARD_CASE,
  SCENARIOS,
  caseCost,
  invoiceCost,
  minutesSaved,
  monthly,
  monthsOnFreeStorage,
  onboardingCostLines,
  sum,
  taskCost,
  usageCost,
  usd,
} from "@/domain/ai/cost-model";

describe("cost model", () => {
  it("prices usage at list prices", () => {
    expect(usageCost({ tier: "sonnet", input: 1_000_000, output: 1_000_000 })).toBe(12);
    expect(usageCost({ tier: "haiku", input: 1_000_000, output: 0 })).toBeCloseTo(0.1);
    expect(usageCost({ tier: "opus", input: 0, cachedInput: 1_000_000, output: 0 })).toBeCloseTo(0.2);
  });

  it("matches the database pricing of an extraction call (0018_ai.sql test)", () => {
    expect(taskCost("extract_check")).toBeCloseTo(0.0175, 6);
  });

  it("keeps a comprehensive case well under one dollar", () => {
    const c = caseCost(COMPREHENSIVE_CASE);
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.8);
    expect(caseCost({ ...COMPREHENSIVE_CASE, postQcTier: "sonnet" })).toBeLessThan(c);
    expect(caseCost(STANDARD_CASE)).toBeLessThan(c);
  });

  it("prices onboarding and invoices in cents", () => {
    expect(sum(onboardingCostLines())).toBeLessThan(0.15);
    expect(invoiceCost()).toBeLessThan(0.001);
  });

  it("grows monthly totals with volume and switches email plans past 3,000 emails", () => {
    const [starter, growth, scale] = SCENARIOS.map(monthly);
    expect(starter.total).toBeLessThan(growth.total);
    expect(growth.total).toBeLessThan(scale.total);
    expect(starter.email).toBe(0);
    expect(scale.email).toBe(20);
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
