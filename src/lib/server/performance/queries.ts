import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import {
  aggregateDays,
  normaliseWeights,
  onTimePct,
  periodRange,
  scoreBoard,
  scoreParts,
  toBoardRow,
  trend,
  fillSeries,
  DEFAULT_PERFORMANCE_WEIGHTS,
  type BoardRow,
  type Part,
  type Period,
  type PerformanceWeights,
  type ScoredRow,
} from "@/domain/performance/score-core";

/** Reads for the performance page, scorecards, pushes and the briefing. Row level security decides who sees what. */

export function colomboToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(now);
}

export type AutoNudgeRule = { enabled: boolean; overdueItems: number; hours: number; escalate: boolean };
export type PerformanceRules = { weights: PerformanceWeights; rawWeights: PerformanceWeights; autoNudge: AutoNudgeRule };

export const getPerformanceRules = cache(async (orgId: string): Promise<PerformanceRules> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("assignment_rules").select("performance_weights, auto_nudge").eq("org_id", orgId).maybeSingle();
  const raw = { ...DEFAULT_PERFORMANCE_WEIGHTS, ...((data?.performance_weights ?? {}) as Partial<PerformanceWeights>) };
  const a = (data?.auto_nudge ?? {}) as Record<string, unknown>;
  const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);
  return {
    weights: normaliseWeights(raw),
    rawWeights: raw,
    autoNudge: { enabled: a.enabled === true, overdueItems: int(a.overdue_items, 3), hours: int(a.hours, 24), escalate: a.escalate !== false },
  };
});

export type Board = { period: Period; from: string; to: string; rows: ScoredRow[] };

/** The team leaderboard (staff.performance.read; the function refuses everyone else). */
export const performanceBoard = cache(async (orgId: string, period: Period): Promise<Board | null> => {
  const supabase = await createRequestClient();
  const { from, to } = periodRange(period, colomboToday());
  const [{ data, error }, rules] = await Promise.all([supabase.rpc("performance_board", { p_from: from, p_to: to }), getPerformanceRules(orgId)]);
  if (error) return null;
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(toBoardRow);
  return { period, from, to, rows: scoreBoard(rows, rules.weights, { from, to }) };
});

export type OpenItem = { kind: "case" | "check"; id: string; case_id: string; reference: string; label: string; due_at: string | null; overdue: boolean; at_risk: boolean };

/** Someone's open work now: themselves, or anyone for staff.performance.read. Empty when not allowed. */
export async function openItems(userId?: string): Promise<OpenItem[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("my_open_items", userId ? { p_user: userId } : {});
  if (error) return [];
  return ((data ?? []) as unknown as OpenItem[]).map((i) => ({ ...i, overdue: Boolean(i.overdue), at_risk: Boolean(i.at_risk) }));
}

export type OwnScorecard = {
  from: string;
  to: string;
  row: BoardRow;
  parts: Record<Part, number | null>;
  onTimePct: number | null;
  trend: "up" | "down" | "flat";
  series: number[];
};

/** Someone's own numbers for the period, without the team comparison (throughput isn't scored without a team). */
export async function ownScorecard(viewer: { userId: string; fullName: string; roleName: string }, period: Period): Promise<OwnScorecard> {
  const supabase = await createRequestClient();
  const { from, to } = periodRange(period, colomboToday());
  const [{ data }, items] = await Promise.all([
    supabase
      .from("staff_performance_daily")
      .select("day, checks_completed, cases_closed, avg_tat_hours, sla_met, sla_missed, qc_returns, first_action_minutes, overdue_eod, nudges_received")
      .eq("user_id", viewer.userId)
      .gte("day", from)
      .lte("day", to),
    openItems(),
  ]);
  const agg = aggregateDays(data ?? []);
  const row: BoardRow = {
    ...agg,
    user_id: viewer.userId,
    name: viewer.fullName,
    role: viewer.roleName,
    open: items.length,
    overdue: items.filter((i) => i.overdue).length,
    at_risk: items.filter((i) => i.at_risk).length,
  };
  const parts = { ...scoreParts(row, row.checks_completed), throughput: null };
  const series = fillSeries(row.days, from, to).map((d) => d.checks);
  return { from, to, row, parts, onTimePct: onTimePct(row), trend: trend(series), series };
}

export type NudgeRow = {
  id: string;
  fromName: string | null;
  toUserId: string;
  message: string;
  items: OpenItem[];
  channels: string[];
  auto: boolean;
  escalation: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
  reply: string | null;
};

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const supabase = await createRequestClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email]));
}

function toNudge(n: { id: string; from_user: string | null; to_user: string; message: string; items: unknown; channels: string[]; auto: boolean; escalation: boolean; created_at: string; acknowledged_at: string | null; reply: string | null }, names: Map<string, string>): NudgeRow {
  return {
    id: n.id,
    fromName: n.from_user ? (names.get(n.from_user) ?? "A manager") : null,
    toUserId: n.to_user,
    message: n.message,
    items: (Array.isArray(n.items) ? n.items : []) as OpenItem[],
    channels: n.channels ?? [],
    auto: n.auto,
    escalation: n.escalation,
    createdAt: n.created_at,
    acknowledgedAt: n.acknowledged_at,
    reply: n.reply,
  };
}

const NUDGE_COLS = "id, from_user, to_user, message, items, channels, auto, escalation, created_at, acknowledged_at, reply";

/** Pushes someone has received (themselves, the sender, or staff.performance.read). */
export async function nudgeHistory(userId: string, limit = 20): Promise<NudgeRow[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("nudges").select(NUDGE_COLS).eq("to_user", userId).order("created_at", { ascending: false }).limit(limit);
  const names = await namesFor([...new Set((data ?? []).map((n) => n.from_user).filter((x): x is string => Boolean(x)))]);
  return (data ?? []).map((n) => toNudge(n, names));
}

/** The viewer's pushes not yet acknowledged, newest first (the dashboard banner). */
export async function myOpenNudges(userId: string): Promise<NudgeRow[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("nudges").select(NUDGE_COLS).eq("to_user", userId).is("acknowledged_at", null).order("created_at", { ascending: false }).limit(3);
  const names = await namesFor([...new Set((data ?? []).map((n) => n.from_user).filter((x): x is string => Boolean(x)))]);
  return (data ?? []).map((n) => toNudge(n, names));
}

export type Person = { userId: string; name: string; email: string; roleName: string };

export async function staffPerson(userId: string): Promise<Person | null> {
  const supabase = await createRequestClient();
  const [{ data: m }, { data: p }] = await Promise.all([
    supabase.from("memberships").select("user_id, kind, role:roles(name)").eq("user_id", userId).eq("kind", "staff").maybeSingle(),
    supabase.from("profiles").select("id, full_name, email").eq("id", userId).maybeSingle(),
  ]);
  if (!m || !p) return null;
  return { userId, name: p.full_name || p.email, email: p.email, roleName: (m.role as unknown as { name: string } | null)?.name ?? "" };
}

export type Briefing = { headline: string; bullets: string[]; risks: string[]; day: string | null; createdAt: string; ai: boolean };

/** The latest morning briefing (briefing.daily job), or null before the first one. */
export async function latestBriefing(orgId: string): Promise<Briefing | null> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("ai_suggestions")
    .select("value, created_at, run_id")
    .eq("capability", "briefing.daily")
    .eq("entity_type", "org")
    .eq("entity_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const v = (data.value ?? {}) as { headline?: string; bullets?: unknown; risks?: unknown; day?: string };
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return { headline: v.headline ?? "Morning briefing", bullets: strings(v.bullets), risks: strings(v.risks), day: v.day ?? null, createdAt: data.created_at, ai: Boolean(data.run_id) };
}
