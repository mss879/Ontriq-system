import { describe, expect, it } from "vitest";
import { cleanPeriod, operationsReport, performanceReport, reportSummary, revenueReport } from "@/domain/business-report/build";
import type { OperationsData, RevenueData } from "@/domain/analytics/types";
import { DEFAULT_PERFORMANCE_WEIGHTS, scoreBoard, type BoardRow } from "@/domain/performance/score-core";

const person = (name: string, checks: number, extra: Partial<BoardRow> = {}): BoardRow => ({
  user_id: name,
  name,
  role: "Officer",
  checks_completed: checks,
  cases_closed: 0,
  avg_tat_hours: null,
  sla_met: checks,
  sla_missed: 0,
  qc_returns: 0,
  first_action_minutes: 60,
  nudges_received: 0,
  days: [],
  open: 0,
  overdue: 0,
  at_risk: 0,
  ...extra,
});
const board = (rows: BoardRow[]) => performanceReport(scoreBoard(rows, DEFAULT_PERFORMANCE_WEIGHTS), DEFAULT_PERFORMANCE_WEIGHTS, "2026-07-01", "2026-09-30");

describe("cleanPeriod", () => {
  const now = new Date("2026-11-02T06:00:00Z");
  it("keeps a past period", () => expect(cleanPeriod("2026-07-01", "2026-09-30", now)).toEqual({ from: "2026-07-01", to: "2026-09-30" }));
  it("stops at today", () => expect(cleanPeriod("2026-10-01", "2026-12-31", now)).toEqual({ from: "2026-10-01", to: "2026-11-02" }));
  it("refuses a period that hasn't started", () => expect(cleanPeriod("2026-12-01", "2026-12-31", now)).toContain("hasn't started"));
  it("refuses a backwards period", () => expect(cleanPeriod("2026-09-30", "2026-07-01", now)).toContain("after its end"));
});

describe("performanceReport", () => {
  it("names who the scores put first", () => {
    const r = board([person("Low", 2, { sla_met: 0, sla_missed: 2 }), person("High", 10)]);
    expect(r.headline).toContain("High came first");
    expect(r.sections[0].rows[0][1]).toContain("High");
    expect(r.empty).toBe(false);
  });
  it("names everyone sharing first place", () => {
    expect(board([person("Ana", 5), person("Ben", 5)]).headline).toMatch(/Ana and Ben share first place/);
  });
  it("names people with nothing to score without ranking them", () => {
    const r = board([person("Busy", 5), person("New", 0, { sla_met: 0, first_action_minutes: null })]);
    expect(r.sections[0].rows).toHaveLength(1);
    expect(r.notes[0]).toContain("finished no work in this period: New.");
  });
  it("leaves people with nothing open out of today's workload", () => {
    const r = board([person("Busy", 5, { open: 2 }), person("Clear", 5)]);
    expect(r.sections[2].rows.map((row) => row[0])).toEqual(["Busy"]);
  });
  it("is empty when nobody finished anything", () => {
    const r = board([person("New", 0, { sla_met: 0, first_action_minutes: null })]);
    expect(r.empty).toBe(true);
    expect(r.headline).toContain("nobody is ranked");
  });
});

const operations = {
  period: { from: "2026-07-01", to: "2026-09-30" },
  summary: { received: "12", released: 9, cancelled: 1, open_now: 3, overdue_now: 1, on_hold_now: 0, avg_tat_hours: 60, median_tat_hours: 50, sla_met: 8, sla_missed: 1 },
  weekly: [],
  by_stage: [{ stage: "verification", count: 2, on_hold: 0 }],
  stage_hours: [],
  tat_by_package: [],
  result_mix: [{ result: "green", count: 7 }],
  officers: [],
  top_clients: [{ client_id: "c", name: "Hemas", received: 5, released: 4, open: 1 }],
} as OperationsData;

const revenue = {
  period: { from: "2026-07-01", to: "2026-09-30" },
  currency: "LKR",
  other_currency_invoices: 1,
  summary: { invoiced: 1000, invoice_count: 2, collected: 400, payment_count: 1, credited: 0, outstanding: 600, overdue: 100, open_invoices: 1 },
  aging: [{ bucket: "1-30", amount: 100, invoices: 1 }],
  monthly: [{ month: "2026-07", invoiced: 1000, collected: 400 }],
  top_billed: [],
  top_outstanding: [],
} as unknown as RevenueData;

describe("operations and revenue reports", () => {
  it("reads numbers that arrive as text", () => {
    const r = operationsReport(operations, "2026-07-01", "2026-09-30", null);
    expect(r.headline).toBe("12 cases received and 9 released, 88.9% on time.");
    expect(r.empty).toBe(false);
  });
  it("is empty with no cases in the period", () => {
    const quiet = { ...operations, summary: { ...operations.summary, received: 0, released: 0 } };
    expect(operationsReport(quiet, "2026-07-01", "2026-09-30", null).empty).toBe(true);
  });
  it("shows money in the report's currency and flags other currencies", () => {
    const r = revenueReport(revenue, "2026-07-01", "2026-09-30", "Hemas");
    expect(r.tiles[0]).toMatchObject({ label: "Invoiced (LKR)", value: "1,000", sub: "LKR 1,000.00 · 2 invoices" });
    expect(r.notes.join(" ")).toContain("1 invoice in other currencies isn't included");
    expect(r.scope).toBe("Hemas");
  });
  it("shortens amounts too long for a tile and keeps the exact one beneath", () => {
    const large = { ...revenue, summary: { ...revenue.summary, invoiced: 123456789 } };
    const tile = revenueReport(large, "2026-07-01", "2026-09-30", null).tiles[0];
    expect(tile.value.length).toBeLessThanOrEqual(9);
    expect(tile.sub).toContain("123,456,789.00");
  });
  it("gives the AI every figure as text", () => {
    const text = reportSummary(operationsReport(operations, "2026-07-01", "2026-09-30", null));
    expect(text).toContain("Hemas | 5 | 4 | 1");
    expect(text).toContain("Today: 3 open");
  });
});
