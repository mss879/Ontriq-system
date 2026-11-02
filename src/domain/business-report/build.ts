import { colomboToday, daysBetween, MAX_PERIOD_DAYS, rangeLabel } from "@/domain/analytics/period";
import { AGING_LABELS, compactNumber, formatHours, formatPct, monthLabel, onTimePct, RESULT_META, stageLabel } from "@/domain/analytics/shape";
import { num, type OperationsData, type RevenueData } from "@/domain/analytics/types";
import { onTimePct as personOnTimePct, PARTS, PART_LABELS, type PerformanceWeights, type ScoredRow } from "@/domain/performance/score-core";
import { formatMoney } from "@/domain/pricing/money";

/**
 * Reports the assistant shows in chat and turns into PDFs. Every figure and the
 * ranking are worked out here, by code, from the same sources as the Performance
 * and Analytics pages. The AI may only add key points on top. A report is plain
 * data, so the PDF worker can draw it without reading the database.
 */

export const REPORT_KINDS = ["team_performance", "operations", "revenue"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export type ReportColumn = { label: string; width: number; align?: "left" | "right" | "center" };
export type ReportSection = { title: string; intro?: string; columns: ReportColumn[]; rows: string[][] };

export type BusinessReport = {
  kind: ReportKind;
  title: string;
  from: string;
  to: string;
  period: string;
  /** The client it's limited to, if any. */
  scope: string | null;
  /** The main finding, written by code from the figures. */
  headline: string;
  tiles: { label: string; value: string; sub?: string }[];
  sections: ReportSection[];
  notes: string[];
  /** Nothing was recorded in the period. */
  empty: boolean;
  /** Written by the AI from the figures, printed under their own label. */
  points: string[];
};

const TITLES: Record<ReportKind, string> = { team_performance: "Team performance", operations: "Operations", revenue: "Revenue" };
const right = (label: string, width: number): ReportColumn => ({ label, width, align: "right" });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""));
const percent = (part: number | null) => (part === null ? "—" : `${Math.round(part * 100)}%`);

/** Checks a period and stops it at today. Returns the dates, or a sentence saying what's wrong. */
export function cleanPeriod(from: string, to: string, now: Date = new Date()): { from: string; to: string } | string {
  const today = colomboToday(now);
  if (from > today) return `That period hasn't started yet. Today is ${today}.`;
  const end = to > today ? today : to;
  if (from > end) return "The start of the period is after its end.";
  if (daysBetween(from, end) > MAX_PERIOD_DAYS) return `A report can cover at most ${MAX_PERIOD_DAYS} days.`;
  return { from, to: end };
}

function performanceHeadline(top: ScoredRow[]): string {
  if (!top.length) return "Nobody finished any work in this period, so nobody is ranked.";
  const names = listNames(top.map((r) => r.name));
  return `${names} ${top.length > 1 ? "share first place" : "came first"} with a score of ${top[0].score} out of 100.`;
}

export function performanceReport(rows: ScoredRow[], weights: PerformanceWeights, from: string, to: string): BusinessReport {
  const ranked = rows.filter((r) => r.rank !== null);
  const unranked = rows.filter((r) => r.rank === null).map((r) => r.name);
  const busy = rows.filter((r) => r.open > 0 || r.overdue > 0);
  const met = rows.reduce((a, r) => a + r.sla_met, 0);
  const missed = rows.reduce((a, r) => a + r.sla_missed, 0);
  const checks = rows.reduce((a, r) => a + r.checks_completed, 0);
  const cases = rows.reduce((a, r) => a + r.cases_closed, 0);
  const qc = rows.reduce((a, r) => a + r.qc_returns, 0);
  const weightText = PARTS.map((p) => `${PART_LABELS[p]} ${Math.round(weights[p] * 100)}%`).join(", ");
  return {
    kind: "team_performance",
    title: TITLES.team_performance,
    from,
    to,
    period: rangeLabel(from, to),
    scope: null,
    headline: performanceHeadline(ranked.filter((r) => r.rank === 1)),
    tiles: [
      { label: "People ranked", value: String(ranked.length), sub: `of ${rows.length} on the team` },
      { label: "Checks completed", value: String(checks) },
      { label: "Cases closed", value: String(cases) },
      { label: "On time", value: formatPct(onTimePct(met, missed)), sub: `${qc} QC ${qc === 1 ? "return" : "returns"}` },
    ],
    sections: [
      {
        title: "Ranking",
        intro: "Highest score first.",
        columns: [right("#", 6), { label: "Person", width: 32 }, right("Score", 9), right("Checks", 10), right("Cases", 9), right("On time", 10), right("QC returns", 12), right("First action", 12)],
        rows: ranked.map((r) => [
          String(r.rank),
          `${r.name} (${r.role})`,
          String(r.score),
          String(r.checks_completed),
          String(r.cases_closed),
          formatPct(personOnTimePct(r)),
          String(r.qc_returns),
          r.first_action_minutes === null ? "—" : formatHours(r.first_action_minutes / 60),
        ]),
      },
      {
        title: "What makes up each score",
        intro: `Weights: ${weightText}. A part with no data is left out and the rest are rescaled.`,
        columns: [{ label: "Person", width: 36 }, ...PARTS.map((p) => right(PART_LABELS[p], 16))],
        rows: ranked.map((r) => [r.name, ...PARTS.map((p) => percent(r.parts[p]))]),
      },
      {
        title: "Workload today",
        intro: "Open work as it stands now, not at the end of the period. Anyone not listed has nothing open.",
        columns: [{ label: "Person", width: 52 }, right("Open", 16), right("Overdue", 16), right("At risk", 16)],
        rows: busy.sort((a, b) => b.overdue - a.overdue || b.open - a.open).map((r) => [r.name, String(r.open), String(r.overdue), String(r.at_risk)]),
      },
    ],
    notes: [
      ...(unranked.length ? [`Not ranked, because they finished no work in this period: ${listNames(unranked)}.`] : []),
      "Figures run up to the last daily update, which is the day before today.",
      "Throughput is measured against the busiest person in the period, so compare people doing similar work. Scores are a starting point for a conversation, not a verdict on anyone.",
    ],
    empty: checks === 0 && cases === 0,
    points: [],
  };
}

export function operationsReport(d: OperationsData, from: string, to: string, scope: string | null): BusinessReport {
  const s = d.summary;
  const received = num(s.received);
  const released = num(s.released);
  const onTime = onTimePct(s.sla_met, s.sla_missed);
  return {
    kind: "operations",
    title: TITLES.operations,
    from,
    to,
    period: rangeLabel(from, to),
    scope,
    headline: `${plural(received, "case")} received and ${released} released${onTime === null ? "" : `, ${formatPct(onTime)} on time`}.`,
    tiles: [
      { label: "Received", value: String(received) },
      { label: "Released", value: String(released), sub: `${num(s.cancelled)} cancelled` },
      { label: "On time", value: formatPct(onTime), sub: `${num(s.sla_met)} of ${num(s.sla_met) + num(s.sla_missed)}` },
      { label: "Typical turnaround", value: formatHours(s.median_tat_hours), sub: `average ${formatHours(s.avg_tat_hours)}` },
    ],
    sections: [
      {
        title: "Results",
        columns: [{ label: "Result", width: 70 }, right("Cases", 30)],
        rows: d.result_mix.map((r) => [RESULT_META[r.result].label, String(num(r.count))]),
      },
      {
        title: "Turnaround by package",
        columns: [{ label: "Package", width: 40 }, right("Released", 15), right("Typical", 15), right("Average", 15), right("On time", 15)],
        rows: d.tat_by_package.map((p) => [p.package, String(num(p.released)), formatHours(p.median_hours), formatHours(p.avg_hours), formatPct(onTimePct(p.sla_met, p.sla_missed))]),
      },
      {
        title: "Busiest clients",
        columns: [{ label: "Client", width: 55 }, right("Received", 15), right("Released", 15), right("Open now", 15)],
        rows: d.top_clients.map((c) => [c.name, String(num(c.received)), String(num(c.released)), String(num(c.open))]),
      },
      {
        title: "Cases open today, by stage",
        columns: [{ label: "Stage", width: 60 }, right("Cases", 20), right("On hold", 20)],
        rows: d.by_stage.map((r) => [stageLabel(r.stage), String(num(r.count)), String(num(r.on_hold))]),
      },
    ],
    notes: [`Today: ${num(s.open_now)} open, ${num(s.overdue_now)} overdue and ${num(s.on_hold_now)} on hold.`],
    empty: received === 0 && released === 0,
    points: [],
  };
}

export function revenueReport(d: RevenueData, from: string, to: string, scope: string | null): BusinessReport {
  const s = d.summary;
  const money = (v: unknown) => formatMoney(num(v as number), d.currency);
  // A tile holds about nine characters, so whole numbers there and the exact amount beneath.
  const tile = (label: string, v: unknown, sub?: string) => {
    const whole = Math.round(num(v as number)).toLocaleString("en-LK");
    return { label: `${label} (${d.currency})`, value: whole.length > 9 ? compactNumber(num(v as number)) : whole, sub: [money(v), sub].filter(Boolean).join(" · ") };
  };
  const others = num(d.other_currency_invoices);
  return {
    kind: "revenue",
    title: TITLES.revenue,
    from,
    to,
    period: rangeLabel(from, to),
    scope,
    headline: `${money(s.invoiced)} invoiced and ${money(s.collected)} collected, with ${money(s.outstanding)} outstanding.`,
    tiles: [
      tile("Invoiced", s.invoiced, plural(num(s.invoice_count), "invoice")),
      tile("Collected", s.collected, plural(num(s.payment_count), "payment")),
      tile("Outstanding", s.outstanding),
      tile("Overdue", s.overdue),
    ],
    sections: [
      {
        title: "By month",
        columns: [{ label: "Month", width: 40 }, right("Invoiced", 30), right("Collected", 30)],
        rows: d.monthly.map((m) => [monthLabel(m.month), money(m.invoiced), money(m.collected)]),
      },
      {
        title: "What's owed, by age",
        columns: [{ label: "Age", width: 50 }, right("Invoices", 20), right("Amount", 30)],
        rows: d.aging.map((a) => [AGING_LABELS[a.bucket], String(num(a.invoices)), money(a.amount)]),
      },
      {
        title: "Largest billed clients",
        columns: [{ label: "Client", width: 55 }, right("Invoices", 15), right("Amount", 30)],
        rows: d.top_billed.map((c) => [c.name, String(num(c.invoices)), money(c.amount)]),
      },
      {
        title: "Largest balances",
        columns: [{ label: "Client", width: 46 }, right("Invoices", 12), right("Outstanding", 21), right("Overdue", 21)],
        rows: d.top_outstanding.map((c) => [c.name, String(num(c.invoices)), money(c.amount), money(c.overdue)]),
      },
    ],
    notes: [
      "Outstanding and overdue are as they stand today.",
      ...(others ? [`${plural(others, "invoice")} in other currencies ${others === 1 ? "isn't" : "aren't"} included.`] : []),
    ],
    empty: num(s.invoiced) === 0 && num(s.collected) === 0,
    points: [],
  };
}

/** The figures as plain text, for the AI to read. */
export function reportSummary(r: BusinessReport): string {
  const lines = [`${r.title}, ${r.period}${r.scope ? `, ${r.scope}` : ""}.`, r.headline, r.tiles.map((t) => `${t.label}: ${t.value}${t.sub ? ` (${t.sub})` : ""}`).join("; ")];
  for (const section of r.sections) {
    if (!section.rows.length) continue;
    lines.push(`${section.title} [${section.columns.map((c) => c.label).join(" | ")}]`, ...section.rows.map((row) => row.join(" | ")));
  }
  lines.push(...r.notes);
  return lines.join("\n");
}
