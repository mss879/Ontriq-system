import { describe, expect, it } from "vitest";
import { decide, eligibility, type StaffLoad } from "@/domain/assignment/assignment-core";

const person = (over: Partial<StaffLoad>): StaffLoad => ({
  userId: over.name ?? "x",
  name: "Someone",
  permissions: ["cases.update", "checks.verify", "cases.read_assigned"],
  autoAssign: true,
  onLeave: false,
  skills: [],
  regions: [],
  maxOpenCases: 20,
  maxOpenChecks: 40,
  openCases: 0,
  openChecks: 0,
  weightedLoad: 0,
  overdue: 0,
  completedLast7Days: 0,
  lastAssignedAt: null,
  isNew: false,
  ...over,
});

const employment = { kind: "check" as const, checkTypeId: "emp", checkTypeName: "Employment", locationBound: false };

describe("auto-assignment", () => {
  it("gives a check to the least loaded qualified person and explains why", () => {
    const team = [
      person({ name: "Nimal Perera", openChecks: 3, weightedLoad: 3, completedLast7Days: 14 }),
      person({ name: "Kasun Silva", openChecks: 9, weightedLoad: 8, completedLast7Days: 20 }),
    ];
    const d = decide(team, employment);
    expect(d.chosen?.name).toBe("Nimal Perera");
    expect(d.chosen?.explanation).toBe("Nimal: 3 open checks against a team average of 6, nothing overdue, completed 14 in the last 7 days.");
  });

  it("respects skills, regions, leave, capacity and the auto-assign switch", () => {
    expect(eligibility(person({ skills: ["edu"] }), employment)).toEqual({ ok: false, reason: "not set up for Employment" });
    expect(eligibility(person({ skills: ["emp"] }), employment).ok).toBe(true);
    const address = { kind: "check" as const, checkTypeId: "addr", checkTypeName: "Address", locationBound: true, district: "Kandy" };
    expect(eligibility(person({ regions: ["Colombo"] }), address)).toEqual({ ok: false, reason: "doesn't cover Kandy" });
    expect(eligibility(person({ regions: [] }), address).ok).toBe(true);
    expect(eligibility(person({ onLeave: true }), employment).ok).toBe(false);
    expect(eligibility(person({ openChecks: 40 }), employment).ok).toBe(false);
    expect(eligibility(person({ autoAssign: false }), employment).ok).toBe(false);
    expect(eligibility(person({ permissions: ["cases.read"] }), employment).ok).toBe(false);
  });

  it("weighs overdue work, so a busy but punctual officer can win", () => {
    const team = [
      person({ name: "A", openChecks: 4, weightedLoad: 4, overdue: 4 }),
      person({ name: "B", openChecks: 5, weightedLoad: 5, overdue: 0 }),
    ];
    expect(decide(team, employment).chosen?.name).toBe("B");
  });

  it("breaks ties by who waited longest", () => {
    const team = [person({ name: "A", lastAssignedAt: "2026-10-29T08:00:00Z" }), person({ name: "B", lastAssignedAt: "2026-10-28T08:00:00Z" })];
    expect(decide(team, employment).chosen?.name).toBe("B");
    expect(decide(team, employment, { strategy: "round_robin" }).chosen?.name).toBe("B");
  });

  it("sends work to the manager queue when nobody fits or assignment is manual", () => {
    expect(decide([person({ onLeave: true })], employment)).toMatchObject({ chosen: null, reason: "Nobody qualified has capacity right now." });
    expect(decide([person({})], employment, { strategy: "manual" }).chosen).toBeNull();
  });

  it("balances case ownership by open cases", () => {
    const team = [person({ name: "A", openCases: 6 }), person({ name: "B", openCases: 2 })];
    const d = decide(team, { kind: "case" });
    expect(d.chosen?.name).toBe("B");
    expect(d.chosen?.explanation).toMatch(/^B: 2 open cases against a team average of 4/);
  });
});
