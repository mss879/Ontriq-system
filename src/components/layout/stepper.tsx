import { Check, Pause, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "upcoming" | "returned" | "on_hold";
export type Step = { key: string; label: string; state: StepState; /** A short note under the label, such as a date. */ note?: string };

const CIRCLE: Record<StepState, string> = {
  done: "bg-brand-blue text-white dark:bg-brand-sky dark:text-brand",
  current: "bg-brand-orange text-white ring-4 ring-brand-orange/15",
  returned: "bg-warning text-warning-foreground ring-4 ring-warning/20",
  on_hold: "bg-muted text-foreground ring-2 ring-warning/60",
  upcoming: "bg-muted text-muted-foreground",
};

const SEGMENT: Record<StepState, string> = {
  done: "bg-brand-blue dark:bg-brand-sky",
  current: "bg-brand-orange",
  returned: "bg-warning",
  on_hold: "bg-warning/60",
  upcoming: "bg-muted",
};

/**
 * Numbered steps with connectors. Blue is done, orange is where things are now.
 * Phones get one line and a segmented bar, because nine labels can't fit.
 * Pure markup, so it renders on the server.
 */
export function Stepper({ steps, label, cancelled, className }: { steps: Step[]; label: string; cancelled?: boolean; className?: string }) {
  const index = steps.findIndex((s) => s.state === "current" || s.state === "returned" || s.state === "on_hold");
  const now = index >= 0 ? steps[index] : steps.findLast((s) => s.state === "done");
  const position = index >= 0 ? index + 1 : steps.filter((s) => s.state === "done").length;
  return (
    <div className={className}>
      <div className="sm:hidden">
        <p className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">{cancelled ? "Cancelled" : (now?.label ?? steps[0]?.label)}</span>
          {cancelled ? null : (
            <span className="shrink-0 tabular-nums">
              Step {Math.max(position, 1)} of {steps.length}
            </span>
          )}
        </p>
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {steps.map((s) => (
            <span key={s.key} className={cn("h-1.5 flex-1 rounded-full", cancelled ? "bg-muted" : SEGMENT[s.state])} />
          ))}
        </div>
      </div>
      <ol aria-label={label} className="hidden sm:flex">
        {steps.map((s, i) => {
          const live = s.state === "current" || s.state === "returned" || s.state === "on_hold";
          return (
            <li key={s.key} aria-current={live ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
              {i < steps.length - 1 ? (
                <span aria-hidden className={cn("absolute top-3.5 left-1/2 h-0.5 w-full", s.state === "done" && !cancelled ? "bg-brand-blue/50 dark:bg-brand-sky/50" : "bg-border")} />
              ) : null}
              <span className={cn("relative z-[1] flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums", cancelled ? CIRCLE.upcoming : CIRCLE[s.state])}>
                {cancelled ? (
                  i + 1
                ) : s.state === "done" ? (
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                ) : s.state === "returned" ? (
                  <RotateCcw className="size-3.5" aria-hidden />
                ) : s.state === "on_hold" ? (
                  <Pause className="size-3.5" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span className={cn("w-full truncate px-0.5 text-[11px] leading-tight", live && !cancelled ? "font-semibold text-foreground" : "text-muted-foreground", cancelled && "line-through decoration-muted-foreground/40")}>
                {s.label}
              </span>
              {s.note ? <span className="-mt-1 w-full truncate px-0.5 text-[10px] leading-tight text-muted-foreground tabular-nums">{s.note}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
