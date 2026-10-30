import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = {
  key: string;
  label: React.ReactNode;
  href: string;
  /** A count beside the label. */
  count?: number;
  /** Marks a non-zero count as needing attention. */
  alert?: boolean;
  icon?: React.ReactNode;
};

const FOCUS = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function Count({ value, alert }: { value: number; alert?: boolean }) {
  return (
    <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 tabular-nums", value && alert ? "bg-brand-orange/15 text-brand-orange-ink" : "bg-foreground/[0.06] text-muted-foreground")}>
      {value}
    </span>
  );
}

/** Pills on a tray, for switching a list or a view. The URL holds the choice. */
export function SegmentedTabs({ items, active, label, size = "md", className }: { items: TabItem[]; active: string; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0", className)}>
      <ul className={cn("inline-flex min-w-max gap-1 rounded-xl bg-muted", size === "sm" ? "p-0.5" : "p-1")}>
        {items.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.key === active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
                FOCUS,
                size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
                t.key === active ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
              {t.count !== undefined ? <Count value={t.count} alert={t.alert} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A line of links under a heading, for sections of one area. */
export function UnderlineTabs({ items, active, label, className }: { items: TabItem[]; active: string; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("flex items-end gap-1 overflow-x-auto no-scrollbar", className)}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "relative shrink-0 rounded-t-lg px-3 pt-2 pb-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            FOCUS,
            t.key === active && "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-orange",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
