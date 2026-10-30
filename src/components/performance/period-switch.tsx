import Link from "next/link";
import { PERIODS, type Period } from "@/domain/performance/score-core";
import { cn } from "@/lib/utils";

/** Week / month / quarter, kept in the URL. */
export function PeriodSwitch({ period, basePath }: { period: Period; basePath: string }) {
  return (
    <nav aria-label="Period" className="inline-flex rounded-xl bg-muted p-1 ring-1 ring-foreground/[0.05]">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={p.key === "week" ? basePath : `${basePath}?period=${p.key}`}
          aria-current={p.key === period ? "page" : undefined}
          className={cn(
            "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
            p.key === period ? "bg-card text-foreground shadow-soft ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
