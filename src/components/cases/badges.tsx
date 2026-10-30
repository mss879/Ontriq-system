import { cn } from "@/lib/utils";
import {
  CHECK_STATE_LABELS,
  CHECK_STATE_TONES,
  FINAL_RESULT_LABELS,
  PRIORITY_LABELS,
  PROCESS_TYPE_SHORT,
  STAGE_SHORT,
  STAGE_TONES,
  STATUS_LABELS,
  type CheckState,
  type FinalResult,
  type Priority,
  type ProcessType,
  type Stage,
  type Tone,
} from "@/domain/workflow/stages";

/** Tone → classes. Matches the Team page status chips. */
export const TONE_CLASSES: Record<Tone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-muted text-muted-foreground ring-1 ring-border", dot: "bg-muted-foreground/60" },
  info: { chip: "bg-info/10 text-info ring-1 ring-info/20", dot: "bg-info" },
  progress: { chip: "bg-brand-blue/10 text-brand-blue ring-1 ring-brand-blue/20 dark:text-brand-sky dark:bg-brand-sky/10 dark:ring-brand-sky/25", dot: "bg-brand-blue dark:bg-brand-sky" },
  warning: { chip: "bg-warning/15 text-warning-foreground ring-1 ring-warning/30 dark:text-warning", dot: "bg-warning" },
  success: { chip: "bg-success/10 text-success ring-1 ring-success/20", dot: "bg-success" },
  danger: { chip: "bg-destructive/10 text-destructive ring-1 ring-destructive/20", dot: "bg-destructive" },
};

export function ToneChip({ tone, children, className, dot = true }: { tone: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  const t = TONE_CLASSES[tone];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", t.chip, className)}>
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}

export function StagePill({ stage, onHold, className }: { stage: Stage; onHold?: boolean; className?: string }) {
  if (onHold) return <ToneChip tone="warning" className={className}>On hold</ToneChip>;
  return (
    <ToneChip tone={STAGE_TONES[stage]} className={className}>
      {STAGE_SHORT[stage]}
    </ToneChip>
  );
}

export function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key.replace(/_/g, " ");
}

export function CheckStatePill({ state, className }: { state: CheckState; className?: string }) {
  return (
    <ToneChip tone={CHECK_STATE_TONES[state]} className={className}>
      {CHECK_STATE_LABELS[state]}
    </ToneChip>
  );
}

const RESULT_TONE: Record<FinalResult, Tone> = { green: "success", amber: "warning", red: "danger" };

/** Green / amber / red result, with the label beside the dot. */
export function ResultBadge({ result, label, className, prefix }: { result: FinalResult | null | undefined; label?: string; className?: string; prefix?: string }) {
  if (!result) return <ToneChip tone="neutral" className={className}>{prefix ? `${prefix} ` : ""}Not yet</ToneChip>;
  return (
    <ToneChip tone={RESULT_TONE[result]} className={className}>
      {prefix ? `${prefix} ` : ""}
      {label ?? FINAL_RESULT_LABELS[result]}
    </ToneChip>
  );
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === "normal") return null;
  return (
    <ToneChip tone={priority === "urgent" ? "danger" : "warning"} className={className} dot={false}>
      {PRIORITY_LABELS[priority]}
    </ToneChip>
  );
}

export function ProcessTypeBadge({ type, className }: { type: ProcessType; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground", className)}>{PROCESS_TYPE_SHORT[type]}</span>
  );
}

/** A thin progress bar: checks done out of total. */
export function ChecksProgress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${done} of ${total} checks done`}>
        <div className="h-full rounded-full bg-brand-blue transition-all dark:bg-brand-sky" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}
