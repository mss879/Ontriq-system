import { describe, expect, it } from "vitest";
import {
  aggregateDays,
  composite,
  DEFAULT_PERFORMANCE_WEIGHTS,
  fillSeries,
  heatmapCells,
  normaliseWeights,
  periodRange,
  scoreBoard,
  scoreParts,
  toBoardRow,
  trend,
  type BoardRow,
} from "@/domain/performance/score-core";
import { proposeRebalance, type OpenCheck } from "@/domain/performance/rebalance-core";
import type { StaffLoad } from "@/domain/assignment/assignment-core";

const row = (o: Partial<BoardRow> & { user_id: string; name: string }): BoardRow => ({
  role: "Verification Officer",
  checks_completed: 0,
  cases_closed: 0,
  avg_tat_hours: null,
  sla_met: 0,
  sla_missed: 0,
  qc_returns: 0,
  first_action_minutes: null,
  nudges_received: 0,
  days: [],
  open: 0,
  overdue: 0,
  at_risk: 0,
  ...o,
});

describe("weights", () => {
  it("defaults when missing or all zero, and rescales to 1", () => {
    expect(normaliseWeights(null)).toEqual(DEFAULT_PERFORMANCE_WEIGHTS);
    expect(normaliseWeights({ throughput: 0, timeliness: 0, quality: 0, responsiveness: 0 })).toEqual(DEFAULT_PERFORMANCE_WEIGHTS);
    const w = normaliseWeights({ throughput: 2, timeliness: 1, quality: 1, responsiveness: 0 });
    expect(w.throughput).toBeCloseTo(0.5);
    expect(w.responsiveness).toBe(0);
    expect(normaliseWeights({ throughput: -1, timeliness: "x" }).throughput).toBe(0);
  });
});

describe("parts and composite", () => {
  it("never produces NaN with no data", () => {
    const parts = scoreParts(row({ user_id: "a", name: "A" }), 0);
    expect(parts).toEqual({ throughput: null, timeliness: null, quality: null, responsiveness: null });
    expect(composite(parts, DEFAULT_PERFORMANCE_WEIGHTS)).toBeNull();
  });

  it("scores a perfect performer 100 and rescales missing parts", () => {
    const r = row({ user_id: "a", name: "A", checks_completed: 10, sla_met: 10, first_action_minutes: 30 });
    const parts = scoreParts(r, 10);
    expect(parts).toEqual({ throughput: 1, timeliness: 1, quality: 1, responsiveness: 1 });
    expect(composite(parts, DEFAULT_PERFORMANCE_WEIGHTS)).toBe(100);
    // Without a first-action time, the other three carry the score.
    expect(composite({ ...parts, responsiveness: null }, DEFAULT_PERFORMANCE_WEIGHTS)).toBe(100);
  });

  it("weighs throughput against the busiest person, lateness and QC returns", () => {
    const r = row({ user_id: "a", name: "A", checks_completed: 5, sla_met: 3, sla_missed: 1, qc_returns: 1, first_action_minutes: 480 });
    const p = scoreParts(r, 10);
    expect(p.throughput).toBe(0.5);
    expect(p.timeliness).toBe(0.75);
    expect(p.quality).toBe(0.8);
    expect(p.responsiveness).toBe(0.5);
    // 0.4×0.5 + 0.3×0.75 + 0.2×0.8 + 0.1×0.5 = 0.635
    expect(composite(p, DEFAULT_PERFORMANCE_WEIGHTS)).toBe(64);
  });

  it("clamps quality when returns exceed completions", () => {
    expect(scoreParts(row({ user_id: "a", name: "A", checks_completed: 1, qc_returns: 4 }), 1).quality).toBe(0);
  });
});

describe("scoreBoard", () => {
  it("ranks by score, shares ties and puts people without data last", () => {
    const board = scoreBoard([
      row({ user_id: "c", name: "Chamari" }),
      row({ user_id: "a", name: "Amal", checks_completed: 10, sla_met: 10 }),
      row({ user_id: "b", name: "Bimal", checks_completed: 10, sla_met: 10 }),
      row({ user_id: "d", name: "Dilani", checks_completed: 2, sla_met: 1, sla_missed: 1 }),
    ]);
    expect(board.map((r) => r.user_id)).toEqual(["a", "b", "d", "c"]);
    expect(board.map((r) => r.rank)).toEqual([1, 1, 3, null]);
    expect(board[3].score).toBeNull();
    expect(board[2].onTimePct).toBe(50);
  });

  it("coerces raw rows from the database", () => {
    const r = toBoardRow({ user_id: "x", name: "X", checks_completed: "3", sla_met: null, avg_tat_hours: "4.5", first_action_minutes: null, days: [{ day: "2026-10-01", checks: "2", overdue: 1 }] });
    expect(r.checks_completed).toBe(3);
    expect(r.sla_met).toBe(0);
    expect(r.avg_tat_hours).toBe(4.5);
    expect(r.first_action_minutes).toBeNull();
    expect(r.days[0]).toEqual({ day: "2026-10-01", checks: 2, overdue: 1 });
  });
});

describe("series", () => {
  it("builds the period and fills missing days", () => {
    expect(periodRange("week", "2026-10-30")).toEqual({ from: "2026-10-24", to: "2026-10-30", days: 7 });
    const s = fillSeries([{ day: "2026-10-26", checks: 3, overdue: 1 }], "2026-10-24", "2026-10-30");
    expect(s).toHaveLength(7);
    expect(s[2]).toEqual({ day: "2026-10-26", checks: 3, overdue: 1 });
    expect(s[0].checks).toBe(0);
  });

  it("buckets a quarter into weeks for the heatmap", () => {
    const { from, to } = periodRange("quarter", "2026-10-30");
    const cells = heatmapCells([{ day: "2026-10-29", checks: 0, overdue: 4 }], from, to);
    expect(cells).toHaveLength(13);
    expect(cells[cells.length - 1].overdue).toBe(4);
    expect(heatmapCells([], "2026-10-24", "2026-10-30")).toHaveLength(7);
  });

  it("reads the trend from the two halves", () => {
    expect(trend([1, 1, 1, 4, 4, 4])).toBe("up");
    expect(trend([4, 4, 1, 1])).toBe("down");
    expect(trend([2, 2, 2, 2])).toBe("flat");
    expect(trend([0, 0])).toBe("flat");
    expect(trend([5])).toBe("flat");
  });

  it("aggregates someone's own days", () => {
    const a = aggregateDays([
      { day: "2026-10-02", checks_completed: 2, cases_closed: 1, avg_tat_hours: 10, sla_met: 2, sla_missed: 0, qc_returns: 0, first_action_minutes: 60, overdue_eod: 0, nudges_received: 0 },
      { day: "2026-10-01", checks_completed: 1, cases_closed: 0, avg_tat_hours: null, sla_met: 0, sla_missed: 1, qc_returns: 1, first_action_minutes: null, overdue_eod: 2, nudges_received: 1 },
    ]);
    expect(a.checks_completed).toBe(3);
    expect(a.avg_tat_hours).toBe(10);
    expect(a.first_action_minutes).toBe(60);
    expect(a.days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(aggregateDays([]).avg_tat_hours).toBeNull();
  });
});

const person = (o: Partial<StaffLoad> & { userId: string; name: string }): StaffLoad => ({
  permissions: ["checks.verify", "cases.update"],
  autoAssign: true,
  onLeave: false,
  skills: [],
  regions: [],
  maxOpenCases: 25,
  maxOpenChecks: 10,
  openCases: 0,
  openChecks: 0,
  weightedLoad: 0,
  overdue: 0,
  completedLast7Days: 0,
  lastAssignedAt: null,
  isNew: false,
  ...o,
});

const check = (i: number, o: Partial<OpenCheck> = {}): OpenCheck => ({
  checkId: `k${i}`,
  caseId: `c${i}`,
  reference: `ONT-2026-${String(i).padStart(6, "0")}`,
  label: "Employment",
  checkTypeId: "emp",
  locationBound: false,
  district: null,
  state: "not_started",
  dueAt: null,
  assignedTo: "busy",
  ...o,
});

describe("rebalance", () => {
  const now = new Date("2026-10-30T06:00:00Z");
  const past = "2026-10-28T06:00:00Z";

  it("moves overdue checks from the overloaded person to the freest qualified one", () => {
    const staff = [
      person({ userId: "busy", name: "Busy Perera", openChecks: 12, weightedLoad: 12, overdue: 4 }),
      person({ userId: "free", name: "Free Silva", openChecks: 1, weightedLoad: 1 }),
      person({ userId: "leave", name: "Away Fernando", onLeave: true }),
    ];
    const checks = [check(1, { dueAt: past }), check(2, { dueAt: past }), check(3), check(4, { state: "in_progress", dueAt: past }), check(5, { state: "awaiting_response" })];
    const moves = proposeRebalance(staff, checks, { now });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.to.userId === "free" && m.from.userId === "busy")).toBe(true);
    expect(moves[0].overdue).toBe(true);
    // Work someone has started, or is waiting on a reply for, stays with them.
    expect(moves.some((m) => m.checkId === "k4" || m.checkId === "k5")).toBe(false);
    expect(moves.length).toBeLessThanOrEqual(2); // max(over capacity 2, overdue 4 / 2)
  });

  it("does nothing when nobody is overloaded or nobody can take work", () => {
    expect(proposeRebalance([person({ userId: "a", name: "A", openChecks: 3, weightedLoad: 3 })], [check(1, { assignedTo: "a" })], { now })).toEqual([]);
    const staff = [person({ userId: "busy", name: "Busy", openChecks: 12, weightedLoad: 12, overdue: 3 }), person({ userId: "x", name: "X", skills: ["edu"] })];
    expect(proposeRebalance(staff, [check(1, { dueAt: past })], { now })).toEqual([]);
  });

  it("stops before the receiver would carry as much as the giver", () => {
    const staff = [
      person({ userId: "busy", name: "Busy", openChecks: 11, maxOpenChecks: 10, weightedLoad: 6, overdue: 0 }),
      person({ userId: "other", name: "Other", openChecks: 9, weightedLoad: 5.5 }),
    ];
    expect(proposeRebalance(staff, [check(1), check(2)], { now })).toEqual([]);
  });
});
