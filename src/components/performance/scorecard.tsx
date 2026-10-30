import type { BoardRow, Part } from "@/domain/performance/score-core";
import { PartBars, ScorePill, TrendIcon } from "./score";
import { DayBars } from "./sparkline";

const hours = (h: number | null) => (h === null ? "—" : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} d`);
const minutes = (m: number | null) => (m === null ? "—" : m < 120 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

/** One person's numbers for a period: score and rank when compared with the team, otherwise their own figures. */
export function Scorecard({
  row,
  parts,
  score,
  rank,
  teamSize,
  onTimePct,
  trend,
  days,
  weights,
}: {
  row: BoardRow;
  parts: Record<Part, number | null>;
  score: number | null;
  rank: number | null;
  teamSize: number | null;
  onTimePct: number | null;
  trend: "up" | "down" | "flat";
  days: { day: string; value: number }[];
  weights?: Record<Part, number>;
}) {
  const stats = [
    { label: "Checks completed", value: String(row.checks_completed) },
    { label: "Cases closed", value: String(row.cases_closed) },
    { label: "On time", value: onTimePct === null ? "—" : `${onTimePct}%` },
    { label: "QC returns", value: String(row.qc_returns) },
    { label: "Average turnaround", value: hours(row.avg_tat_hours) },
    { label: "First action", value: minutes(row.first_action_minutes) },
    { label: "Open now", value: `${row.open}${row.overdue ? ` · ${row.overdue} overdue` : ""}` },
    { label: "Pushes received", value: String(row.nudges_received) },
  ];
  return (
    <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,15rem)_1fr]">
      <div className="space-y-5">
        {teamSize !== null ? (
          <div className="flex items-center gap-4">
            <ScorePill score={score} className="h-14 min-w-16 rounded-2xl text-2xl" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">{score === null ? "No score yet" : rank ? `Rank ${rank} of ${teamSize}` : "Not ranked"}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendIcon trend={trend} /> {trend === "up" ? "Picking up" : trend === "down" ? "Slowing down" : "Steady"} over the period
              </p>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendIcon trend={trend} /> {trend === "up" ? "Picking up" : trend === "down" ? "Slowing down" : "Steady"} over the period
          </p>
        )}
        <PartBars parts={parts} weights={weights} />
      </div>
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/[0.04]">
              <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{s.label}</dt>
              <dd className="mt-1.5 font-display text-lg leading-none font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Checks completed per day</p>
          <DayBars days={days} label="Checks completed per day" />
        </div>
      </div>
    </div>
  );
}
