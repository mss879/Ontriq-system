/**
 * Rebalance (plan §7.2): when someone is over capacity or has a pile of
 * overdue work, propose moving some of their open checks to the freest
 * qualified people. Pure and rules-based: it reuses the auto-assignment
 * scoring (src/domain/assignment/assignment-core.ts). A manager reviews the
 * list and confirms; nothing moves on its own.
 *
 * Who is overloaded: more open checks than their capacity, or at least
 * `overdueThreshold` overdue items. From each, it moves overdue checks first,
 * then ones not started, never work already in progress or waiting for a
 * reply, until they are back under capacity and their overdue count is
 * halved (at most `maxPerPerson`). A move only happens when the receiver
 * would still carry clearly less than the giver.
 */
import { decide, type Need, type StaffLoad, type Strategy, type Weights } from "../assignment/assignment-core";

export type OpenCheck = {
  checkId: string;
  caseId: string;
  reference: string;
  label: string;
  checkTypeId: string;
  locationBound: boolean;
  district: string | null;
  state: string;
  dueAt: string | null;
  assignedTo: string;
};

export type Move = {
  checkId: string;
  caseId: string;
  reference: string;
  label: string;
  dueAt: string | null;
  overdue: boolean;
  from: { userId: string; name: string };
  to: { userId: string; name: string };
  reason: string;
};

export type RebalanceOptions = { overdueThreshold?: number; maxPerPerson?: number; maxMoves?: number; strategy?: Strategy; weights?: Weights; now?: Date };

const MOVABLE = new Set(["not_started", "pending_info", "returned"]);
/** What one check adds to someone's weighted load (assignment-core counts waiting work at 0.3, verification at 1). */
const CHECK_WEIGHT = 1;

export function overloaded(s: StaffLoad, overdueThreshold: number): boolean {
  return s.openChecks > s.maxOpenChecks || s.overdue >= overdueThreshold;
}

export function proposeRebalance(staff: StaffLoad[], checks: OpenCheck[], opts: RebalanceOptions = {}): Move[] {
  const threshold = opts.overdueThreshold ?? 3;
  const maxPerPerson = opts.maxPerPerson ?? 10;
  const maxMoves = opts.maxMoves ?? 30;
  const now = (opts.now ?? new Date()).getTime();
  // Work on copies so the running totals reflect the moves already proposed.
  const load = new Map(staff.map((s) => [s.userId, { ...s }]));
  const isOverdue = (c: OpenCheck) => c.dueAt !== null && Date.parse(c.dueAt) < now;

  const givers = [...load.values()]
    .filter((s) => overloaded(s, threshold))
    .sort((a, b) => b.overdue - a.overdue || b.openChecks - b.maxOpenChecks - (a.openChecks - a.maxOpenChecks) || a.name.localeCompare(b.name));

  const moves: Move[] = [];
  for (const giver of givers) {
    const mine = checks
      .filter((c) => c.assignedTo === giver.userId && MOVABLE.has(c.state))
      .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.reference.localeCompare(b.reference));
    const overCapacity = Math.max(0, giver.openChecks - giver.maxOpenChecks);
    const target = Math.min(maxPerPerson, Math.max(overCapacity, Math.ceil(giver.overdue / 2)));
    let moved = 0;
    for (const c of mine) {
      if (moved >= target || moves.length >= maxMoves) break;
      const need: Need = { kind: "check", checkTypeId: c.checkTypeId, checkTypeName: c.label, locationBound: c.locationBound, district: c.district };
      const others = [...load.values()].filter((s) => s.userId !== giver.userId && !overloaded(s, threshold));
      const d = decide(others, need, { strategy: opts.strategy === "manual" ? "least_loaded" : opts.strategy, weights: opts.weights });
      if (!d.chosen) continue;
      const receiver = load.get(d.chosen.userId)!;
      const g = load.get(giver.userId)!;
      if (receiver.weightedLoad + CHECK_WEIGHT >= g.weightedLoad - CHECK_WEIGHT && receiver.openChecks + 1 >= g.openChecks - 1) continue;
      moves.push({
        checkId: c.checkId,
        caseId: c.caseId,
        reference: c.reference,
        label: c.label,
        dueAt: c.dueAt,
        overdue: isOverdue(c),
        from: { userId: g.userId, name: g.name },
        to: { userId: receiver.userId, name: receiver.name },
        reason: `${g.name} has ${g.openChecks} open (${g.overdue} overdue). ${d.chosen.explanation}`,
      });
      moved++;
      g.openChecks -= 1;
      g.weightedLoad = Math.max(0, g.weightedLoad - CHECK_WEIGHT);
      if (isOverdue(c)) g.overdue = Math.max(0, g.overdue - 1);
      receiver.openChecks += 1;
      receiver.weightedLoad += CHECK_WEIGHT;
      receiver.lastAssignedAt = new Date(now).toISOString();
    }
  }
  return moves;
}

