import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { PARTS, PART_LABELS, type Part } from "@/domain/performance/score-core";
import { cn } from "@/lib/utils";

export function scoreTone(score: number | null) {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 80) return "bg-success/12 text-success";
  if (score >= 60) return "bg-primary/10 text-primary dark:text-brand-sky";
  if (score >= 40) return "bg-warning/15 text-warning-foreground dark:text-warning";
  return "bg-destructive/10 text-destructive";
}

export function ScorePill({ score, className }: { score: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-10 items-center justify-center rounded-lg px-2 py-0.5 font-display text-sm font-semibold tabular-nums", scoreTone(score), className)}>
      {score === null ? "—" : score}
    </span>
  );
}

export function TrendIcon({ trend, className }: { trend: "up" | "down" | "flat"; className?: string }) {
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowRight;
  const label = trend === "up" ? "Trending up" : trend === "down" ? "Trending down" : "Steady";
  return <Icon aria-label={label} className={cn("size-3.5", trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground", className)} />;
}

/** One bar per scoring part, 0..100 %. Parts without data say so. */
export function PartBars({ parts, weights }: { parts: Record<Part, number | null>; weights?: Record<Part, number> }) {
  return (
    <ul className="space-y-2.5">
      {PARTS.map((p) => {
        const v = parts[p];
        return (
          <li key={p} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {PART_LABELS[p]}
                {weights ? <span className="ml-1.5 text-muted-foreground">{Math.round(weights[p] * 100)}%</span> : null}
              </span>
              <span className="tabular-nums text-muted-foreground">{v === null ? "No data yet" : `${Math.round(v * 100)}%`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              {v !== null ? <div className="h-full rounded-full bg-brand-bar" style={{ width: `${Math.max(2, v * 100)}%` }} /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
