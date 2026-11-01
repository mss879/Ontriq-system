import Link from "next/link";
import { ChevronRight, Download, FileWarning } from "lucide-react";
import { ChecksProgress, ResultBadge, PriorityBadge } from "@/components/cases/badges";
import { formatShortDate } from "@/lib/format";
import { SlaBadge } from "@/components/cases/sla-badge";
import { cn } from "@/lib/utils";
import type { PortalCaseRow } from "@/domain/portal/types";
import { PORTAL_CHECK_LABELS, PORTAL_REPORT_LABELS, PortalStatusChip, waitsOnClient } from "./portal-badges";

/** One case as a row: works as a table on wide screens and a card on phones. Spec 6.1's details sit underneath. */
export function PortalCaseItem({ row, dense }: { row: PortalCaseRow; dense?: boolean }) {
  // A revision leaves the released report with them until the new one comes.
  const reportReady = row.report_version_id && (row.report_status === "released" || row.report_status === "revising");
  return (
    <li>
      <Link
        href={`/portal/cases/${row.id}`}
        className={cn(
          "group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_9rem_6.5rem_1rem] md:px-5",
          dense && "md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_6.5rem_1rem]",
          !dense && "pb-1.5",
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
        </div>
        {!dense ? <div className="col-span-2 md:col-span-1">{row.checks_total !== null ? <ChecksProgress wide done={row.checks_done ?? 0} total={row.checks_total} /> : null}</div> : null}
        <div className="hidden text-xs text-muted-foreground tabular-nums md:block">
          {row.stage === "released" ? (
            `Released ${formatShortDate(row.released_at)}`
          ) : row.stage === "cancelled" ? (
            "Cancelled"
          ) : row.report_status === "revising" ? (
            "Being revised"
          ) : row.on_hold ? (
            "Paused"
          ) : row.due_at ? (
            <SlaBadge dueAt={row.due_at} startedAt={row.received_at} />
          ) : (
            "—"
          )}
        </div>
        <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" aria-hidden />
      </Link>
      {!dense ? (
        <div className="space-y-1 px-4 pb-3.5 text-xs text-muted-foreground md:px-5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Stage: {row.stage_label}</span>
            {row.package_name ? <span>· {row.package_name}</span> : null}
            <span>· Report: {PORTAL_REPORT_LABELS[row.report_status]}</span>
            {reportReady ? (
              <a href={`/api/reports/${row.report_version_id}?download=1`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline dark:text-brand-sky">
                <Download className="size-3.5" aria-hidden /> Download
              </a>
            ) : null}
            {waitsOnClient(row) ? (
              <span className="inline-flex items-center gap-1 font-medium text-brand-orange-ink">
                <FileWarning className="size-3.5" aria-hidden /> {row.needs_documents} needed from you
              </span>
            ) : null}
          </p>
          {row.checks.length ? <p className="leading-relaxed">{row.checks.map((c) => `${c.label}: ${PORTAL_CHECK_LABELS[c.state]}`).join(" · ")}</p> : null}
        </div>
      ) : null}
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
