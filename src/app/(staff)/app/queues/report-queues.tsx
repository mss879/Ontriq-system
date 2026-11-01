import Link from "@/components/link";
import { ArrowRight, FileCheck2, Send } from "lucide-react";
import type { ReportQueueItem } from "@/lib/server/reports/queries";
import { ResultBadge } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import { QueueEmpty } from "./queue-empty";

/** Reports waiting for a decision: drafts to approve, or finals to release. Oldest first. */
export function ReportQueue({ items, kind }: { items: ReportQueueItem[]; kind: "approve" | "release" }) {
  if (!items.length) return <QueueEmpty text={kind === "approve" ? "No reports are waiting for approval." : "No approved reports are waiting to be released."} />;
  const Icon = kind === "approve" ? FileCheck2 : Send;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      {items.map((r) => (
        <li key={r.versionId}>
          <Link href={`/app/cases/${r.caseId}#report`} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary dark:text-brand-sky">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-primary group-hover:underline dark:text-brand-sky">{r.reference}</span>
                <span className="truncate text-sm font-medium">{r.candidateName}</span>
                {kind === "release" && r.finalResult ? <ResultBadge result={r.finalResult} /> : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {r.clientName} · {kind === "approve" ? `Draft v${r.version}` : `Final v${r.version}`} · <RelativeTime iso={r.at} />
                {kind === "release" && r.approvedBy ? ` · approved by ${r.approvedByMe ? "you (someone else must release it)" : r.approvedBy}` : ""}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
