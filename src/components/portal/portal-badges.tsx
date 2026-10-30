import { Check } from "lucide-react";
import { ToneChip } from "@/components/cases/badges";
import { cn } from "@/lib/utils";
import { PORTAL_STEPS, PORTAL_STEP_LABELS, portalStep } from "@/domain/candidate/steps";
import type { Tone } from "@/domain/workflow/stages";
import type { PortalCaseRow, PortalCheck } from "@/domain/portal/types";

type ActionRow = Pick<PortalCaseRow, "stage" | "needs_documents" | "process_type">;

/**
 * Does this case wait on documents from the client? Only when the client
 * supplies them: when Ontriq collects from the candidate, open slots are the
 * candidate's to fill.
 */
export const waitsOnClient = (row: ActionRow) => row.process_type === "client_supplied" && row.needs_documents > 0 && (row.stage === "intake" || row.stage === "documents");

/** The client-facing status of a case: Ontriq's client label, coloured by where it stands. */
export function PortalStatusChip({ row, className }: { row: ActionRow & Pick<PortalCaseRow, "on_hold" | "status_label">; className?: string }) {
  if (row.on_hold) return <ToneChip tone="warning" className={className}>On hold</ToneChip>;
  const action = waitsOnClient(row);
  const tone: Tone = row.stage === "released" ? "success" : row.stage === "cancelled" ? "neutral" : action ? "warning" : row.stage === "intake" ? "info" : "progress";
  return (
    <ToneChip tone={tone} className={className}>
      {action ? "Documents needed" : row.status_label}
    </ToneChip>
  );
}

const CHECK_STATE: Record<PortalCheck["state"], { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "progress" },
  needs_information: { label: "Information needed", tone: "warning" },
  done: { label: "Completed", tone: "success" },
  not_required: { label: "Not required", tone: "neutral" },
};

export function PortalCheckState({ state, className }: { state: PortalCheck["state"]; className?: string }) {
  const s = CHECK_STATE[state];
  return (
    <ToneChip tone={s.tone} className={className}>
      {s.label}
    </ToneChip>
  );
}

/** Checks done out of total as a thin bar with the count. */
export function ChecksProgress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} checks completed`}
      >
        <div className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-blue transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

/** Received → Documents → Verification → Report → Released, with the current step marked. */
export function PortalProgressRail({ stage, onHold }: { stage: PortalCaseRow["stage"]; onHold: boolean }) {
  const cancelled = stage === "cancelled";
  const current = cancelled ? -1 : PORTAL_STEPS.indexOf(portalStep(stage));
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Progress">
      {PORTAL_STEPS.map((step, i) => {
        const done = i < current || (stage === "released" && i === current);
        const here = i === current && stage !== "released";
        return (
          <li key={step} className="min-w-0 space-y-2" aria-current={here ? "step" : undefined}>
            <div
              className={cn(
                "h-1.5 rounded-full",
                done ? "bg-brand-blue dark:bg-brand-sky" : here ? (onHold ? "bg-warning" : "bg-brand-orange") : "bg-muted",
              )}
            />
            <p className={cn("flex items-center gap-1 truncate text-[11px] font-medium sm:text-xs", done || here ? "text-foreground" : "text-muted-foreground")}>
              {done ? <Check className="size-3 shrink-0 text-brand-blue dark:text-brand-sky" strokeWidth={3} aria-hidden /> : null}
              <span className="truncate">{PORTAL_STEP_LABELS[step]}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
