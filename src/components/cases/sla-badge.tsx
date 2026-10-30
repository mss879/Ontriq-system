"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { slaStatus, timeLeft } from "@/domain/sla-core";
import { TONE_CLASSES } from "./badges";
import { formatShortDate } from "@/lib/format";

/** Live deadline: "2 days left", amber when at risk, red when overdue. */
export function SlaBadge({ dueAt, startedAt, done, className, compact }: { dueAt: string | null; startedAt: string; done?: boolean; className?: string; compact?: boolean }) {
  const now = useNow();
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (now === null) {
    // Server and hydration: the due date, which does not depend on the clock.
    return done ? null : (
      <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums", TONE_CLASSES.neutral.chip, className)}>
        <Clock className="size-3" aria-hidden />
        {compact ? formatShortDate(dueAt) : `Due ${formatShortDate(dueAt)}`}
      </span>
    );
  }
  const status = slaStatus(new Date(startedAt), due, new Date(now), done);
  if (status === "done") return null;
  const tone = status === "overdue" ? TONE_CLASSES.danger : status === "at_risk" ? TONE_CLASSES.warning : TONE_CLASSES.neutral;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums", tone.chip, className)} title={`Due ${due.toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}`}>
      <Clock className="size-3" aria-hidden />
      {compact ? timeLeft(due, new Date(now)).replace(" left", "") : timeLeft(due, new Date(now))}
    </span>
  );
}

/** "5 min ago" that keeps itself current. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow();
  const diff = now === null ? 0 : now - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  const text =
    now === null
      ? formatShortDate(iso)
      : min < 1
      ? "just now"
      : min < 60
        ? `${min} min ago`
        : min < 60 * 24
          ? `${Math.round(min / 60)} h ago`
          : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Colombo" });
  return (
    <time dateTime={iso} className={className} title={new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}>
      {text}
    </time>
  );
}
