/**
 * Turning the analytics summaries into what the page draws and the CSV
 * exports write: labels, percentages, durations, chart series. Pure module
 * (tests/unit/analytics.test.ts).
 */
import { STAGE_FLOW, STAGE_SHORT, type Stage } from "../workflow/stages";
import type { CsvCell } from "./csv";
import { num, numOrNull, type AgingBucket, type AiData, type OperationsData, type RevenueData } from "./types";

/** Share of on-time releases, or null when nothing had a due date. */
export function onTimePct(met: unknown, missed: unknown): number | null {
  const m = num(met as number);
  const total = m + num(missed as number);
  return total ? Math.round((1000 * m) / total) / 10 : null;
}

/** "5 h", "1.5 days", or "—". */
export function formatHours(hours: number | string | null | undefined): string {
  const h = numOrNull(hours as number | null);
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function formatPct(p: number | null): string {
  return p === null ? "—" : `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export function formatUsd(v: number | string | null | undefined, digits = 2): string {
  const n = num(v as number);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n > 0 && n < 0.01 ? 4 : digits) })}`;
}

/** Compact amounts for chart axes: 1.2M, 950K, 800. */
export function compactNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

const UTC = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "3 Nov" for a YYYY-MM-DD date. */
export function dayLabel(iso: string): string {
  return UTC(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Oct 2026" for YYYY-MM. */
export function monthLabel(ym: string): string {
  return UTC(`${ym}-01`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export const stageLabel = (s: string) => STAGE_SHORT[s as Stage] ?? s.replace(/_/g, " ");

/** Open cases per stage in workflow order, with zeros for empty stages. */
export function stagePipeline(rows: OperationsData["by_stage"]): { stage: Stage; label: string; count: number; onHold: number }[] {
  const by = new Map(rows.map((r) => [r.stage, r]));
  return STAGE_FLOW.filter((s) => s !== "released").map((stage) => ({
    stage,
    label: STAGE_SHORT[stage],
    count: num(by.get(stage)?.count),
    onHold: num(by.get(stage)?.on_hold),
  }));
}

/** Average time in each stage, in workflow order (stages nobody passed through are left out). */
export function stageDurations(rows: OperationsData["stage_hours"]): { stage: string; label: string; avg: number; median: number; samples: number }[] {
  const order = (s: string) => {
    const i = STAGE_FLOW.indexOf(s as Stage);
    return i < 0 ? 99 : i;
  };
  return [...rows]
    .sort((a, b) => order(a.stage) - order(b.stage))
    .map((r) => ({ stage: r.stage, label: stageLabel(r.stage), avg: num(r.avg_hours), median: num(r.median_hours), samples: num(r.samples) }));
}

export const RESULT_META: Record<"green" | "amber" | "red" | "none", { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  green: { label: "Green (clear)", tone: "green" },
  amber: { label: "Amber (review)", tone: "amber" },
  red: { label: "Red (discrepancy)", tone: "red" },
  none: { label: "No result set", tone: "slate" },
};

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Not yet due",
  "1-30": "1–30 days late",
  "31-60": "31–60 days late",
  "61-90": "61–90 days late",
  "90+": "Over 90 days late",
};

/** Share helper for donut/legend rows; percentages add up to 100 after rounding. */
export function shares<T extends { value: number }>(items: T[]): (T & { pct: number })[] {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return items.map((i) => ({ ...i, pct: 0 }));
  const raw = items.map((i) => (100 * i.value) / total);
  const floored = raw.map(Math.floor);
  let left = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floored[i] += 1;
    left -= 1;
  }
  return items.map((it, i) => ({ ...it, pct: floored[i] }));
}

// ---------------------------------------------------------------- CSV sections

export function operationsCsv(d: OperationsData): CsvCell[][] {
  const s = d.summary;
  const rows: CsvCell[][] = [
    ["Operations", `${d.period.from} to ${d.period.to}`],
    [],
    ["Measure", "Value"],
    ["Cases received", num(s.received)],
    ["Reports released", num(s.released)],
    ["Cases cancelled", num(s.cancelled)],
    ["Open now", num(s.open_now)],
    ["Overdue now", num(s.overdue_now)],
    ["On hold now", num(s.on_hold_now)],
    ["Average turnaround (hours)", numOrNull(s.avg_tat_hours)],
    ["Median turnaround (hours)", numOrNull(s.median_tat_hours)],
    ["Released on time", num(s.sla_met)],
    ["Released late", num(s.sla_missed)],
    ["On time %", onTimePct(s.sla_met, s.sla_missed)],
    [],
    ["Week starting", "Received", "Released"],
    ...d.weekly.map((w) => [w.week, num(w.received), num(w.released)]),
    [],
    ["Stage", "Open cases", "On hold"],
    ...stagePipeline(d.by_stage).map((r) => [r.label, r.count, r.onHold]),
    [],
    ["Stage", "Average hours", "Median hours", "Cases"],
    ...stageDurations(d.stage_hours).map((r) => [r.label, r.avg, r.median, r.samples]),
    [],
    ["Package", "Released", "Average turnaround (hours)", "Median turnaround (hours)", "On time %"],
    ...d.tat_by_package.map((p) => [p.package, num(p.released), numOrNull(p.avg_hours), numOrNull(p.median_hours), onTimePct(p.sla_met, p.sla_missed)]),
    [],
    ["Result", "Released cases"],
    ...d.result_mix.map((r) => [RESULT_META[r.result]?.label ?? r.result, num(r.count)]),
    [],
    ["Officer", "Open checks", "Overdue checks", "Completed in period"],
    ...d.officers.map((o) => [o.name, num(o.open_checks), num(o.overdue_checks), num(o.completed)]),
    [],
    ["Client", "Received", "Released", "Open now"],
    ...d.top_clients.map((c) => [c.name, num(c.received), num(c.released), num(c.open)]),
  ];
  return rows;
}

export function revenueCsv(d: RevenueData): CsvCell[][] {
  const s = d.summary;
  return [
    ["Revenue", `${d.period.from} to ${d.period.to}`, d.currency],
    [],
    ["Measure", `Amount (${d.currency})`],
    ["Invoiced", num(s.invoiced)],
    ["Invoices issued", num(s.invoice_count)],
    ["Collected", num(s.collected)],
    ["Payments", num(s.payment_count)],
    ["Credited", num(s.credited)],
    ["Outstanding now", num(s.outstanding)],
    ["Overdue now", num(s.overdue)],
    ["Open invoices", num(s.open_invoices)],
    [],
    ["Age", `Amount (${d.currency})`, "Invoices"],
    ...d.aging.map((a) => [AGING_LABELS[a.bucket] ?? a.bucket, num(a.amount), num(a.invoices)]),
    [],
    ["Month", `Invoiced (${d.currency})`, `Collected (${d.currency})`],
    ...d.monthly.map((m) => [m.month, num(m.invoiced), num(m.collected)]),
    [],
    ["Client", `Billed (${d.currency})`, "Invoices"],
    ...d.top_billed.map((c) => [c.name, num(c.amount), num(c.invoices)]),
    [],
    ["Client", `Outstanding (${d.currency})`, `Overdue (${d.currency})`, "Invoices"],
    ...d.top_outstanding.map((c) => [c.name, num(c.amount), num(c.overdue), num(c.invoices)]),
  ];
}

export function aiCsv(d: AiData): CsvCell[][] {
  const s = d.summary;
  return [
    ["AI cost", `${d.period.from} to ${d.period.to}`, "USD"],
    [],
    ["Measure", "Value"],
    ["Cost (USD)", num(s.cost_usd)],
    ["Runs", num(s.runs)],
    ["Failed runs", num(s.failed_runs)],
    ["Input tokens", num(s.input_tokens)],
    ["Output tokens", num(s.output_tokens)],
    ["Cache read tokens", num(s.cache_read_tokens)],
    ["Reports released", num(s.released_cases)],
    ["AI cost per released case (USD)", numOrNull(s.cost_per_released_case)],
    [],
    ["Day", "Cost (USD)", "Runs"],
    ...d.daily.map((x) => [x.day, num(x.cost_usd), num(x.runs)]),
    [],
    ["Capability", "Key", "Runs", "Cost (USD)", "Input tokens", "Output tokens"],
    ...d.by_capability.map((c) => [c.label, c.key, num(c.runs), num(c.cost_usd), num(c.input_tokens), num(c.output_tokens)]),
    [],
    ["Model", "Runs", "Cost (USD)"],
    ...d.by_model.map((m) => [m.model, num(m.runs), num(m.cost_usd)]),
  ];
}
