import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  default: "bg-primary/8 text-primary",
  good: "bg-success/12 text-success",
  warn: "bg-warning/15 text-warning-foreground dark:text-warning",
  bad: "bg-destructive/10 text-destructive",
} as const;

/** A headline number with its label and a short note, optionally linking to the list behind it. */
export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  href,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  href?: string;
  className?: string;
}) {
  const body = (
    <div className={cn("flex h-full items-start gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07]", href && "transition-colors hover:bg-muted/30", className)}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg font-semibold tabular-nums">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
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
        <div key={i} className="flex items-start gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07]">
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
