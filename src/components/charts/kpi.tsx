import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SURFACE } from "@/components/admin/surface";
import { Sparkline } from "@/components/performance/sparkline";
import { cn } from "@/lib/utils";

const TONES = {
  default: "bg-primary/8 text-primary dark:text-brand-sky",
  good: "bg-success/12 text-success",
  warn: "bg-warning/15 text-warning-foreground dark:text-warning",
  bad: "bg-destructive/10 text-destructive",
} as const;

/**
 * A headline number with its label and a short note. It links to the list behind
 * it when there is one. `alert` turns the number red for something overdue, and
 * `series` adds a small trend line.
 */
export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  href,
  alert,
  series,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  href?: string;
  alert?: boolean;
  series?: number[];
  className?: string;
}) {
  const body = (
    <div className={cn(SURFACE, "flex h-full items-start gap-3 p-4", href && "transition hover:-translate-y-px hover:shadow-lift", alert && "ring-destructive/25", className)}>
      <span className={cn("hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex", TONES[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("font-display leading-snug font-semibold tabular-nums", value.length > 9 ? "text-lg" : "text-2xl", alert && "text-destructive")}>{value}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      {series && series.length > 1 ? <Sparkline values={series} label={`${label} trend`} width={64} height={28} className="mt-1 hidden shrink-0 sm:block" /> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(SURFACE, "flex items-start gap-3 p-4")}>
          <div className="size-9 animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
