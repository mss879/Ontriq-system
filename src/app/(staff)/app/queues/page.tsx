import { Suspense } from "react";
import type { Metadata } from "next";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { SegmentedTabs } from "@/components/layout/tabs";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { getStaffViewer } from "@/lib/server/viewer";
import { staffOptions } from "@/lib/server/cases/queries";
import { myOpenChecks, QUEUE_LABELS, QUEUE_TABS, queueCases, queueCounts, queueTabsFor, type QueueTab } from "@/lib/server/cases/list-queries";
import { QueueList, MyChecks } from "./queue-list";
import { QueueEmpty } from "./queue-empty";
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
  const asked = requested && (QUEUE_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : null;

  const canReply = canAny(viewer, ["candidates.requests", "cases.update"]);
  const canApprove = can(viewer, "reports.approve");
  const canRelease = can(viewer, "reports.release");
  const [counts, replies, reports] = await Promise.all([
    queueCounts(viewer, tabs),
    canReply ? getCandidateReplies() : Promise.resolve([]),
    canApprove || canRelease ? getReportQueues(viewer.userId) : Promise.resolve({ toApprove: [], toRelease: [] }),
  ]);
  const toApprove = canApprove ? reports.toApprove : [];
  const toRelease = canRelease ? reports.toRelease : [];

  // Mine also holds reports and replies, so its count covers everything on that tab.
  const shown: Partial<Record<QueueTab, number>> = { ...counts, mine: counts.mine + toApprove.length + toRelease.length + replies.length };
  // Open where the work is: Mine first, otherwise the first tab with something in it.
  const tab: QueueTab = asked ?? (shown.mine ? "mine" : (tabs.find((t) => shown[t]) ?? "mine"));

  const [cases, checks, staff] = await Promise.all([
    queueCases(viewer, tab),
    tab === "mine" ? myOpenChecks(viewer.userId) : Promise.resolve([]),
    tab === "unassigned" ? staffOptions() : Promise.resolve([]),
  ]);
  const label = QUEUE_LABELS[tab];
  const otherChecks = checks.filter((k) => k.caseAssignee !== viewer.userId);
  const busyTabs = tabs.filter((t) => t !== "mine" && shown[t]);

  return (
    <div className="space-y-4">
      <RealtimeRefresh sources={[{ table: "cases" }, { table: "case_checks" }, { table: "candidate_requests" }, { table: "consent_forms" }, { table: "report_versions" }]} />
      <SegmentedTabs
        label="Queues"
        active={tab}
        items={tabs.map((t) => ({
          key: t,
          label: QUEUE_LABELS[t].title,
          href: t === "mine" ? "/app/queues?tab=mine" : `/app/queues?tab=${t}`,
          count: shown[t] ?? 0,
          alert: t === "overdue" || t === "returned" || t === "unassigned",
        }))}
      />

      <p className="text-sm text-muted-foreground">{label.description}</p>

      {tab === "mine" ? (
        <div className="space-y-5">
          {toApprove.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Reports to approve</h2>
              <ReportQueue items={toApprove} kind="approve" />
            </section>
          ) : null}
          {toRelease.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Reports ready to release</h2>
              <ReportQueue items={toRelease} kind="release" />
            </section>
          ) : null}
          {cases.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Cases you own</h2>
              <QueueList items={cases} empty={label.empty} hideOwner />
            </section>
          ) : null}
          {otherChecks.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Checks assigned to you on other cases</h2>
              <MyChecks checks={otherChecks} empty="" />
            </section>
          ) : null}
          {replies.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Candidate replies to review</h2>
              <CandidateReplies replies={replies} />
            </section>
          ) : null}
          {!shown.mine ? (
            <QueueEmpty
              title="You're all caught up"
              text={busyTabs.length ? `Your team's queues still have work in ${busyTabs.map((t) => QUEUE_LABELS[t].title).join(", ")}.` : "Nothing is assigned to you right now. New work appears here as soon as it reaches you."}
            />
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
