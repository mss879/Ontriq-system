import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { cn } from "@/lib/utils";
import { getStaffViewer } from "@/lib/server/viewer";
import { staffOptions } from "@/lib/server/cases/queries";
import { myOpenChecks, QUEUE_LABELS, QUEUE_TABS, queueCases, queueCounts, queueTabsFor, type QueueTab } from "@/lib/server/cases/list-queries";
import { QueueList, MyChecks } from "./queue-list";
import { getCandidateReplies } from "@/lib/server/cases/candidate-queries";
import { CandidateReplies } from "./candidate-replies";
import { can, canAny } from "@/domain/permissions";
import { getReportQueues } from "@/lib/server/reports/queries";
import { ReportQueue } from "./report-queues";

export const metadata: Metadata = { title: "My work" };

const DESCRIPTION = "Everything waiting on you or your team, sorted by what is due first.";

export default function QueuesPage({ searchParams }: PageProps<"/app/queues">) {
  return (
    <Page className="max-w-7xl">
      <PageHeader eyebrow="Workspace" title="My work" description={DESCRIPTION} />
      <Suspense fallback={<QueueSkeleton />}>
        <Queues searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Queues({ searchParams }: Pick<PageProps<"/app/queues">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  const tabs = queueTabsFor(viewer);
  const requested = (Array.isArray(params.tab) ? params.tab[0] : params.tab) as QueueTab | undefined;
  const tab: QueueTab = requested && (QUEUE_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : "mine";

  const showReplies = tab === "mine" && canAny(viewer, ["candidates.requests", "cases.update"]);
  const showApprove = tab === "mine" && can(viewer, "reports.approve");
  const showRelease = tab === "mine" && can(viewer, "reports.release");
  const [counts, cases, checks, staff, replies, reports] = await Promise.all([
    queueCounts(viewer, tabs),
    queueCases(viewer, tab),
    tab === "mine" ? myOpenChecks(viewer.userId) : Promise.resolve([]),
    tab === "unassigned" ? staffOptions() : Promise.resolve([]),
    showReplies ? getCandidateReplies() : Promise.resolve([]),
    showApprove || showRelease ? getReportQueues(viewer.userId) : Promise.resolve({ toApprove: [], toRelease: [] }),
  ]);
  const label = QUEUE_LABELS[tab];
  const otherChecks = checks.filter((k) => k.caseAssignee !== viewer.userId);

  return (
    <div className="space-y-5">
      <RealtimeRefresh sources={[{ table: "cases" }, { table: "case_checks" }, { table: "candidate_requests" }, { table: "consent_forms" }, { table: "report_versions" }]} />
      <nav aria-label="Queues" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-1 rounded-xl bg-muted p-1">
          {tabs.map((t) => (
            <li key={t}>
              <Link
                href={t === "mine" ? "/app/queues" : `/app/queues?tab=${t}`}
                aria-current={t === tab ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  t === tab ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {QUEUE_LABELS[t].title}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 tabular-nums",
                    counts[t] && (t === "overdue" || t === "returned" || t === "unassigned") ? "bg-brand-orange/15 text-brand-orange-ink" : "bg-foreground/[0.06] text-muted-foreground",
                  )}
                >
                  {counts[t] ?? 0}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p className="text-sm text-muted-foreground">{label.description}</p>

      {tab === "mine" ? (
        <div className="space-y-6">
          {showApprove ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Reports to approve</h2>
              <ReportQueue items={reports.toApprove} kind="approve" />
            </section>
          ) : null}
          {showRelease ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Reports ready to release</h2>
              <ReportQueue items={reports.toRelease} kind="release" />
            </section>
          ) : null}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Cases you own</h2>
            <QueueList items={cases} empty="You don't own any active cases." />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Checks assigned to you on other cases</h2>
            <MyChecks checks={otherChecks} empty={checks.length ? "Every check assigned to you sits on a case you own." : "No checks are assigned to you."} />
          </section>
          {showReplies ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Candidate replies to review</h2>
              <CandidateReplies replies={replies} />
            </section>
          ) : null}
        </div>
      ) : (
        <QueueList
          items={cases}
          empty={label.empty}
          assign={tab === "unassigned" ? { staff: staff.map(({ id, name, roleName }) => ({ id, name, roleName })) } : undefined}
        />
      )}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="h-10 w-full max-w-2xl animate-pulse rounded-xl bg-muted" />
      <SectionSkeleton rows={6} />
    </div>
  );
}
