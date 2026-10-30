import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_FLOW, STAGE_SHORT, type Stage } from "@/domain/workflow/stages";

/** The nine-step flow from the BGV flowchart, with the current step highlighted. */
export function StageRail({ stage, returned, onHold }: { stage: Stage; returned: boolean; onHold: boolean }) {
  const current = STAGE_FLOW.indexOf(stage);
  const cancelled = stage === "cancelled";
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-1" aria-label="Case progress">
        {STAGE_FLOW.map((s, i) => {
          const done = !cancelled && i < current;
          const active = !cancelled && i === current;
          return (
            <li key={s} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                  done && "bg-brand-blue/10 text-brand-blue dark:bg-brand-sky/10 dark:text-brand-sky",
                  active && !onHold && !returned && "bg-brand-blue text-white shadow-sm dark:bg-brand-sky dark:text-brand",
                  active && returned && !onHold && "bg-warning text-warning-foreground shadow-sm",
                  active && onHold && "bg-muted text-foreground ring-1 ring-warning/60",
                  !done && !active && "text-muted-foreground",
                  cancelled && "line-through decoration-muted-foreground/40",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : <span className="tabular-nums opacity-70">{i + 1}</span>}
                {STAGE_SHORT[s]}
              </span>
              {i < STAGE_FLOW.length - 1 ? <span aria-hidden className={cn("h-px w-3 sm:w-4", done ? "bg-brand-blue/40 dark:bg-brand-sky/40" : "bg-border")} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
