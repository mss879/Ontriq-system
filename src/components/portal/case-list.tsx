import Link from "next/link";
import { ChevronRight, FileWarning } from "lucide-react";
import { ResultBadge, PriorityBadge } from "@/components/cases/badges";
import { formatShortDate } from "@/lib/format";
import { SlaBadge } from "@/components/cases/sla-badge";
import { cn } from "@/lib/utils";
import type { PortalCaseRow } from "@/domain/portal/types";
import { ChecksProgress, PortalStatusChip, waitsOnClient } from "./portal-badges";

/** One case as a row: works as a table on wide screens and a card on phones. */
export function PortalCaseItem({ row, dense }: { row: PortalCaseRow; dense?: boolean }) {
  return (
    <li>
      <Link
        href={`/portal/cases/${row.id}`}
        className={cn(
          "group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_9rem_6.5rem_1rem] md:px-5",
          dense && "md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_6.5rem_1rem]",
        )}
      >
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{row.candidate_name}</span>
            <PriorityBadge priority={row.priority} />
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.reference}</span>
            {row.position_title ? ` · ${row.position_title}` : ""}
            {row.client_reference ? ` · ${row.client_reference}` : ""}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 justify-self-end md:justify-self-start">
          <PortalStatusChip row={row} />
          {row.stage === "released" && row.final_result ? <ResultBadge result={row.final_result} /> : null}
          {waitsOnClient(row) ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange-ink md:hidden">
              <FileWarning className="size-3.5" /> {row.needs_documents}
            </span>
          ) : null}
        </div>
        {!dense ? (
          <div className="col-span-2 md:col-span-1">
            <ChecksProgress done={row.checks_done} total={row.checks_total} />
          </div>
        ) : null}
        <div className="hidden text-xs text-muted-foreground tabular-nums md:block">
          {row.stage === "released" ? (
            `Released ${formatShortDate(row.released_at)}`
          ) : row.stage === "cancelled" ? (
            "Cancelled"
          ) : row.due_at ? (
            <SlaBadge dueAt={row.due_at} startedAt={row.received_at} />
          ) : (
            "—"
          )}
        </div>
        <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" aria-hidden />
      </Link>
    </li>
  );
}

export function PortalCaseList({ rows, dense, className }: { rows: PortalCaseRow[]; dense?: boolean; className?: string }) {
  return (
    <ul className={cn("divide-y divide-border/70", className)}>
      {rows.map((r) => (
        <PortalCaseItem key={r.id} row={r} dense={dense} />
      ))}
    </ul>
  );
}
