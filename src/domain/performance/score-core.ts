/**
 * Staff performance scoring (plan §7.3). Pure: the leaderboard feeds it the
 * rows from public.performance_board() and the weights Ontriq set in
 * assignment_rules.performance_weights.
 *
 * Each part is 0..1:
 *   throughput      checks completed, against the busiest person in the team
 *   timeliness      share of completed checks finished by their due date
 *   quality         1 − QC returns per completed check
 *   responsiveness  minutes from assignment to first action, against a target
 * A part with no data (nothing completed, no due dates, never started) is left
 * out and the remaining weights are rescaled, so nobody is marked down for
 * work they never had. Someone with no data at all gets no score.
 */

export type PerformanceWeights = { throughput: number; timeliness: number; quality: number; responsiveness: number };
export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceWeights = { throughput: 0.4, timeliness: 0.3, quality: 0.2, responsiveness: 0.1 };
export const PARTS = ["throughput", "timeliness", "quality", "responsiveness"] as const;
export type Part = (typeof PARTS)[number];
export const PART_LABELS: Record<Part, string> = { throughput: "Throughput", timeliness: "On time", quality: "Quality", responsiveness: "Responsiveness" };

/** Four hours from assignment to first action counts as fully responsive. */
export const RESPONSE_TARGET_MINUTES = 240;

export type DayPoint = { day: string; checks: number; overdue: number };

export type BoardRow = {
  user_id: string;
  name: string;
  role: string;
  checks_completed: number;
  cases_closed: number;
  avg_tat_hours: number | null;
  sla_met: number;
  sla_missed: number;
  qc_returns: number;
  first_action_minutes: number | null;
  nudges_received: number;
  days: DayPoint[];
  open: number;
  overdue: number;
  at_risk: number;
};

export type ScoredRow = BoardRow & {
  parts: Record<Part, number | null>;
  /** 0..100, or null when there is nothing to score yet. */
  score: number | null;
  rank: number | null;
  onTimePct: number | null;
  trend: "up" | "down" | "flat";
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/** Weights from settings, cleaned: non-negative, defaults when missing, summing to 1. */
export function normaliseWeights(input: Partial<Record<Part, unknown>> | null | undefined): PerformanceWeights {
  const raw = { ...DEFAULT_PERFORMANCE_WEIGHTS };
  for (const p of PARTS) {
    const v = input?.[p];
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) raw[p] = Math.max(0, Number(v));
  }
  const sum = PARTS.reduce((a, p) => a + raw[p], 0);
  if (sum <= 0) return { ...DEFAULT_PERFORMANCE_WEIGHTS };
  const share = (p: Part) => round(raw[p] / sum, 4);
  return { throughput: share("throughput"), timeliness: share("timeliness"), quality: share("quality"), responsiveness: share("responsiveness") };
}

/** Coerce a raw jsonb row (numbers may arrive as strings) into a BoardRow. */
export function toBoardRow(r: Record<string, unknown>): BoardRow {
  return {
    user_id: String(r.user_id ?? ""),
    name: String(r.name ?? "Unnamed"),
    role: String(r.role ?? ""),
    checks_completed: num(r.checks_completed),
    cases_closed: num(r.cases_closed),
    avg_tat_hours: numOrNull(r.avg_tat_hours),
    sla_met: num(r.sla_met),
    sla_missed: num(r.sla_missed),
    qc_returns: num(r.qc_returns),
    first_action_minutes: numOrNull(r.first_action_minutes),
    nudges_received: num(r.nudges_received),
    days: Array.isArray(r.days) ? (r.days as Record<string, unknown>[]).map((d) => ({ day: String(d.day), checks: num(d.checks), overdue: num(d.overdue) })) : [],
    open: num(r.open),
    overdue: num(r.overdue),
    at_risk: num(r.at_risk),
  };
}

export function onTimePct(row: Pick<BoardRow, "sla_met" | "sla_missed">): number | null {
  const total = row.sla_met + row.sla_missed;
  return total > 0 ? Math.round((100 * row.sla_met) / total) : null;
}

/** The parts for one person, given the team's highest throughput. */
export function scoreParts(row: BoardRow, teamMaxCompleted: number, targetMinutes = RESPONSE_TARGET_MINUTES): Record<Part, number | null> {
  const slaTotal = row.sla_met + row.sla_missed;
  const minutes = row.first_action_minutes;
  return {
    throughput: row.checks_completed > 0 && teamMaxCompleted > 0 ? round(clamp01(row.checks_completed / teamMaxCompleted)) : row.checks_completed > 0 ? 1 : slaTotal > 0 || minutes !== null ? 0 : null,
    timeliness: slaTotal > 0 ? round(row.sla_met / slaTotal) : null,
    quality: row.checks_completed > 0 ? round(clamp01(1 - row.qc_returns / row.checks_completed)) : null,
    responsiveness: minutes === null ? null : round(minutes <= targetMinutes ? 1 : clamp01(targetMinutes / minutes)),
  };
}

/** Combine parts with the weights; parts without data drop out and the rest are rescaled. */
export function composite(parts: Record<Part, number | null>, weights: PerformanceWeights): number | null {
  let weight = 0;
  let total = 0;
  for (const p of PARTS) {
    const v = parts[p];
    if (v === null) continue;
    weight += weights[p];
    total += weights[p] * v;
  }
  if (weight <= 0) return null;
  return Math.round((100 * total) / weight);
}

/** Up when the second half of the period beats the first by 10 %, down when it trails by 10 %. */
export function trend(series: number[]): "up" | "down" | "flat" {
  if (series.length < 2) return "flat";
  const mid = Math.floor(series.length / 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const first = avg(series.slice(0, mid));
  const second = avg(series.slice(series.length - mid));
  if (first === 0 && second === 0) return "flat";
  if (second > first * 1.1) return "up";
  if (second < first * 0.9) return "down";
  return "flat";
}

/** Score and rank the team. Highest score first; ties share a rank; no score goes last. */
export function scoreBoard(rows: BoardRow[], weightsInput?: Partial<Record<Part, unknown>> | null, opts: { from?: string; to?: string; targetMinutes?: number } = {}): ScoredRow[] {
  const weights = normaliseWeights(weightsInput);
  const max = Math.max(0, ...rows.map((r) => r.checks_completed));
  const scored = rows.map((r) => {
    const parts = scoreParts(r, max, opts.targetMinutes);
    const series = opts.from && opts.to ? fillSeries(r.days, opts.from, opts.to).map((d) => d.checks) : r.days.map((d) => d.checks);
    return { ...r, parts, score: composite(parts, weights), rank: null as number | null, onTimePct: onTimePct(r), trend: trend(series) };
  });
  scored.sort((a, b) => {
    if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score || b.checks_completed - a.checks_completed || a.name.localeCompare(b.name);
  });
  let lastScore: number | null = null;
  let lastRank = 0;
  scored.forEach((r, i) => {
    if (r.score === null) return;
    if (r.score !== lastScore) {
      lastRank = i + 1;
      lastScore = r.score;
    }
    r.rank = lastRank;
  });
  return scored;
}

// ---------------------------------------------------------------- periods and series

export type Period = "week" | "month" | "quarter";
export const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: "week", label: "7 days", days: 7 },
  { key: "month", label: "30 days", days: 30 },
  { key: "quarter", label: "90 days", days: 90 },
];

export function parsePeriod(value: unknown): Period {
  return value === "month" || value === "quarter" ? value : "week";
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The period's first and last day, ending on `today` (a YYYY-MM-DD Colombo date). */
export function periodRange(period: Period, today: string): { from: string; to: string; days: number } {
  const days = PERIODS.find((p) => p.key === period)!.days;
  return { from: isoDay(dayMs(today) - (days - 1) * DAY_MS), to: today, days };
}

/** One point per day from `from` to `to`, zero where nothing was rolled up. */
export function fillSeries(days: DayPoint[], from: string, to: string): DayPoint[] {
  const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
  const out: DayPoint[] = [];
  for (let t = dayMs(from); t <= dayMs(to); t += DAY_MS) {
    const day = isoDay(t);
    const d = byDay.get(day);
    out.push({ day, checks: d?.checks ?? 0, overdue: d?.overdue ?? 0 });
  }
  return out;
}

/** Heatmap cells: daily for up to a month, weekly (the worst day in each week) beyond. */
export function heatmapCells(days: DayPoint[], from: string, to: string): { label: string; from: string; overdue: number }[] {
  const series = fillSeries(days, from, to);
  if (series.length <= 31) return series.map((d) => ({ label: d.day, from: d.day, overdue: d.overdue }));
  const out: { label: string; from: string; overdue: number }[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const week = series.slice(i, i + 7);
    out.push({ label: `${week[0].day} – ${week[week.length - 1].day}`, from: week[0].day, overdue: Math.max(...week.map((d) => d.overdue)) });
  }
  return out;
}

/**
 * Someone's own numbers from their staff_performance_daily rows, for people
 * who can see only themselves (no team to compare throughput against).
 */
export function aggregateDays(
  rows: { day: string; checks_completed: number; cases_closed: number; avg_tat_hours: number | null; sla_met: number; sla_missed: number; qc_returns: number; first_action_minutes: number | null; overdue_eod: number; nudges_received: number }[],
): Omit<BoardRow, "user_id" | "name" | "role" | "open" | "overdue" | "at_risk"> {
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + num(f(r)), 0);
  const avgOf = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null && Number.isFinite(Number(x))).map(Number);
    return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null;
  };
  return {
    checks_completed: sum((r) => r.checks_completed),
    cases_closed: sum((r) => r.cases_closed),
    avg_tat_hours: avgOf(rows.map((r) => r.avg_tat_hours)),
    sla_met: sum((r) => r.sla_met),
    sla_missed: sum((r) => r.sla_missed),
    qc_returns: sum((r) => r.qc_returns),
    first_action_minutes: avgOf(rows.map((r) => r.first_action_minutes)),
    nudges_received: sum((r) => r.nudges_received),
    days: [...rows].sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ day: r.day, checks: num(r.checks_completed), overdue: num(r.overdue_eod) })),
  };
}
