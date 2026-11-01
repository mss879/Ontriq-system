import Link from "@/components/link";
import { SURFACE } from "@/components/admin/surface";
import { cn } from "@/lib/utils";

/**
 * A link that makes its whole row clickable, with a visible keyboard focus.
 * Put ROW on the row. Anything else interactive in the row needs ROW_ACTION.
 */
export const ROW_LINK = "outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";
export const ROW = "relative [transform:translateZ(0)]";
export const ROW_ACTION = "relative z-10";

/** The header row of a table. */
export const HEAD_ROW = "bg-muted/40 hover:bg-muted/40";

/**
 * A list on a card: a table from `xl` (1280px) up, stacked cards below it, so a
 * list never scrolls sideways. The table's header stays in view while the page
 * scrolls, which only works because the table always fits: keep it that way by
 * hiding columns as the width drops, and run scripts/dev/layout-check.ts.
 */
export function DataTable({ header, footer, cards, children, className }: { header?: React.ReactNode; footer?: React.ReactNode; cards?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(SURFACE, "overflow-hidden xl:overflow-visible", className)}>
      {header}
      <div
        className={cn(
          cards ? "hidden xl:block" : undefined,
          "xl:**:data-[slot=table-container]:overflow-visible",
          "xl:[&_th]:sticky xl:[&_th]:top-14 xl:[&_th]:z-10 xl:[&_th]:bg-[color-mix(in_oklch,var(--card),var(--muted)_50%)]",
          !header && "xl:[&_th:first-child]:rounded-tl-2xl xl:[&_th:last-child]:rounded-tr-2xl",
        )}
      >
        {children}
      </div>
      {cards ? <ul className="divide-y xl:hidden">{cards}</ul> : null}
      {footer}
    </section>
  );
}

/** One row on a phone: a title that links, a line under it, an aside, and chips. */
export function ListCard({ href, title, subtitle, aside, children }: { href?: string; title: React.ReactNode; subtitle?: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="relative px-4 py-3.5 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className={cn(ROW_LINK, "block text-sm font-medium")}>
              {title}
            </Link>
          ) : (
            <div className="text-sm font-medium">{title}</div>
          )}
          {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {aside ? <div className={cn("shrink-0 text-sm", ROW_ACTION)}>{aside}</div> : null}
      </div>
      {children ? <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div> : null}
    </li>
  );
}
