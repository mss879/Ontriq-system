/**
 * Auto-assignment (plan §7). Picks the freest qualified person for a case or a
 * check and explains why in plain words. Pure: the assign.auto job feeds it
 * the load snapshot from public.staff_load_snapshot() and stores the result.
 *
 * Lowest score wins:
 *   score = w_load × load + w_overdue × overdue + w_recent × (1 − throughput) − w_new × newcomer
 * each term normalised to 0..1 across the eligible people. Ties go to whoever
 * has waited longest since their last assignment (round robin).
 */

export type Strategy = "least_loaded" | "round_robin" | "manual";

export type Weights = { load: number; overdue: number; recent: number; newcomer: number };
export const DEFAULT_WEIGHTS: Weights = { load: 0.6, overdue: 0.25, recent: 0.15, newcomer: 0.05 };

export type StaffLoad = {
  userId: string;
  name: string;
  permissions: string[];
  autoAssign: boolean;
  onLeave: boolean;
  /** Check type ids this person is qualified for. Empty means "any". */
  skills: string[];
  /** Districts this person covers for location-bound checks. Empty means "any". */
  regions: string[];
  maxOpenCases: number;
  maxOpenChecks: number;
  openCases: number;
  openChecks: number;
  /** Open checks weighted by effort (verification 1.0, data entry 0.5, waiting 0.3). */
  weightedLoad: number;
  overdue: number;
  completedLast7Days: number;
  lastAssignedAt: string | null;
  /** Joined in the last 30 days: gets a small boost so they ramp up. */
  isNew: boolean;
};

export type Need =
  | { kind: "case" }
  | { kind: "check"; checkTypeId: string; checkTypeName: string; locationBound: boolean; district?: string | null };

export type Candidate = { userId: string; name: string; score: number; breakdown: Record<string, number>; explanation: string };
export type Decision = { chosen: Candidate | null; considered: number; reason?: string };

const has = (s: StaffLoad, p: string) => s.permissions.includes("*") || s.permissions.includes(p);

export function eligibility(s: StaffLoad, need: Need): { ok: true } | { ok: false; reason: string } {
  if (!s.autoAssign) return { ok: false, reason: "auto-assign is off" };
  if (s.onLeave) return { ok: false, reason: "on leave" };
  if (!has(s, "checks.verify")) return { ok: false, reason: "cannot verify checks" };
  if (need.kind === "case") {
    if (!has(s, "cases.update")) return { ok: false, reason: "cannot work on cases" };
    if (s.openCases >= s.maxOpenCases) return { ok: false, reason: "at case capacity" };
    return { ok: true };
  }
  if (s.openChecks >= s.maxOpenChecks) return { ok: false, reason: "at check capacity" };
  if (s.skills.length && !s.skills.includes(need.checkTypeId)) return { ok: false, reason: `not set up for ${need.checkTypeName}` };
  if (need.locationBound && need.district && s.regions.length && !s.regions.includes(need.district)) return { ok: false, reason: `doesn't cover ${need.district}` };
  return { ok: true };
}

function normalise(values: number[]): (v: number) => number {
  const max = Math.max(...values, 0);
  return (v) => (max > 0 ? v / max : 0);
}

export function decide(staff: StaffLoad[], need: Need, opts: { strategy?: Strategy; weights?: Weights } = {}): Decision {
  const strategy = opts.strategy ?? "least_loaded";
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  if (strategy === "manual") return { chosen: null, considered: 0, reason: "Assignment is manual: the case waits in the manager queue." };

  const eligible = staff.filter((s) => eligibility(s, need).ok);
  if (eligible.length === 0) return { chosen: null, considered: 0, reason: "Nobody qualified has capacity right now." };

  const loadOf = (s: StaffLoad) => (need.kind === "case" ? s.openCases : s.weightedLoad);
  const nLoad = normalise(eligible.map(loadOf));
  const nOverdue = normalise(eligible.map((s) => s.overdue));
  const nThroughput = normalise(eligible.map((s) => s.completedLast7Days));
  const waited = (s: StaffLoad) => (s.lastAssignedAt ? Date.parse(s.lastAssignedAt) : 0);

  const scored = eligible.map((s) => {
    const breakdown: Record<string, number> =
      strategy === "round_robin"
        ? { wait: waited(s) }
        : {
            load: round(w.load * nLoad(loadOf(s))),
            overdue: round(w.overdue * nOverdue(s.overdue)),
            recent: round(w.recent * (1 - nThroughput(s.completedLast7Days))),
            newcomer: round(s.isNew ? -w.newcomer : 0),
          };
    const score = strategy === "round_robin" ? waited(s) : round(Object.values(breakdown).reduce((a, b) => a + b, 0));
    return { s, score, breakdown };
  });

  scored.sort((a, b) => a.score - b.score || waited(a.s) - waited(b.s) || a.s.name.localeCompare(b.s.name));
  const best = scored[0];
  return {
    chosen: { userId: best.s.userId, name: best.s.name, score: best.score, breakdown: best.breakdown, explanation: explain(best.s, eligible, need, strategy) },
    considered: eligible.length,
  };
}

function explain(s: StaffLoad, eligible: StaffLoad[], need: Need, strategy: Strategy): string {
  const first = s.name.split(" ")[0] || s.name;
  if (strategy === "round_robin") return `${first} was next in turn among ${eligible.length} qualified people.`;
  const parts: string[] = [];
  if (need.kind === "case") {
    const avg = average(eligible.map((x) => x.openCases));
    parts.push(`${s.openCases} open ${s.openCases === 1 ? "case" : "cases"} against a team average of ${fmt(avg)}`);
  } else {
    const avg = average(eligible.map((x) => x.openChecks));
    parts.push(`${s.openChecks} open ${s.openChecks === 1 ? "check" : "checks"} against a team average of ${fmt(avg)}`);
    if (s.skills.includes(need.checkTypeId)) parts.push(`set up for ${need.checkTypeName}`);
    if (need.locationBound && need.district && s.regions.includes(need.district)) parts.push(`covers ${need.district}`);
  }
  if (s.overdue === 0) parts.push("nothing overdue");
  else parts.push(`${s.overdue} overdue`);
  if (s.completedLast7Days > 0) parts.push(`completed ${s.completedLast7Days} in the last 7 days`);
  if (s.isNew) parts.push("new to the team");
  return `${first}: ${parts.join(", ")}.`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
