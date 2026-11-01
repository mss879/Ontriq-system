import { Suspense } from "react";
import Link from "@/components/link";
import type { Metadata } from "next";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { DataTable, HEAD_ROW, ListCard, ROW_ACTION } from "@/components/layout/data-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodSwitch } from "@/components/performance/period-switch";
import { PushDialog } from "@/components/performance/push-dialog";
import { RebalanceDialog } from "@/components/performance/rebalance-dialog";
import { ScorePill, TrendIcon } from "@/components/performance/score";
import { Scorecard } from "@/components/performance/scorecard";
import { Sparkline } from "@/components/performance/sparkline";
import { WorkloadHeatmap } from "@/components/performance/heatmap";
import { getStaffViewer } from "@/lib/server/viewer";
import { getPerformanceRules, ownScorecard, performanceBoard } from "@/lib/server/performance/queries";
import { fillSeries, heatmapCells, parsePeriod, PERIODS, PARTS, PART_LABELS } from "@/domain/performance/score-core";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance" };

const BASE = "/app/team/performance";

export default function PerformancePage({ searchParams }: PageProps<"/app/team/performance">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Workspace" title="Performance" description="Throughput, timeliness, quality and responsiveness for everyone doing casework." />}>
        <Header searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Leaderboard searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Heatmap searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header({ searchParams }: Pick<PageProps<"/app/team/performance">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  const period = parsePeriod(params.period);
  const team = can(viewer, "staff.performance.read");
  return (
    <PageHeader
      eyebrow="Workspace"
      title={team ? "Performance" : "Your scorecard"}
      description={
        team
          ? "Throughput, timeliness, quality and responsiveness for everyone doing casework, from the nightly roll-up. Push anyone who is behind."
          : "Your own figures for the period, from the nightly roll-up."
      }
      actions={
        <>
          <PeriodSwitch period={period} basePath={BASE} />
          {team && can(viewer, "cases.assign") ? <RebalanceDialog /> : null}
        </>
      }
    />
  );
}

async function Leaderboard({ searchParams }: Pick<PageProps<"/app/team/performance">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  const period = parsePeriod(params.period);
  const label = PERIODS.find((p) => p.key === period)!.label;

  if (!can(viewer, "staff.performance.read")) {
    const own = await ownScorecard(viewer, period);
    return (
      <Surface>
        <SurfaceHeader title={viewer.fullName} description={`${viewer.roleName} · last ${label}`} aside={<Link href="/app/queues" className="text-sm font-medium text-primary">Your open work</Link>} />
        <Scorecard
          row={own.row}
          parts={own.parts}
          score={null}
          rank={null}
          teamSize={null}
          onTimePct={own.onTimePct}
          trend={own.trend}
          days={fillSeries(own.row.days, own.from, own.to).map((d) => ({ day: d.day, value: d.checks }))}
        />
      </Surface>
    );
  }

  const [board, rules] = await Promise.all([performanceBoard(viewer.orgId, period), getPerformanceRules(viewer.orgId)]);
  if (!board) return <Surface><p className="px-5 py-8 text-center text-sm text-muted-foreground">The leaderboard couldn&apos;t be loaded. Try again in a moment.</p></Surface>;
  const nudge = can(viewer, "staff.nudge");
  const weights = PARTS.map((p) => `${PART_LABELS[p]} ${Math.round(rules.weights[p] * 100)}%`).join(" · ");

  const header = <SurfaceHeader title="Leaderboard" description={`Last ${label}. Score weights: ${weights}.`} aside={can(viewer, "assignment.configure") ? <Link href="/app/settings/assignment" className="text-xs font-medium text-primary">Change weights</Link> : null} />;
  if (board.rows.length === 0) {
    return (
      <Surface>
        {header}
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nobody on the team does casework yet.</p>
      </Surface>
    );
  }

  return (
    <DataTable
      header={header}
      cards={board.rows.map((r) => (
        <ListCard
          key={r.user_id}
          href={`${BASE}/${r.user_id}${period === "week" ? "" : `?period=${period}`}`}
          title={r.name}
          subtitle={r.role}
          aside={
            <span className="flex items-center gap-1.5">
              <ScorePill score={r.score} />
              {r.score !== null ? <TrendIcon trend={r.trend} /> : null}
            </span>
          }
        >
          <span className="text-xs text-muted-foreground tabular-nums">
            {r.checks_completed} completed · {r.onTimePct === null ? "—" : `${r.onTimePct}%`} on time · {r.open} open
          </span>
          {r.overdue ? <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">{r.overdue} late</span> : null}
          {nudge && r.user_id !== viewer.userId ? (
            <span className={`ml-auto ${ROW_ACTION}`}>
              <PushDialog userId={r.user_id} name={r.name} overdue={r.overdue} />
            </span>
          ) : null}
        </ListCard>
      ))}
    >
          <Table>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={cn(TH, "w-12 pl-5")}>#</TableHead>
                <TableHead className={TH}>Person</TableHead>
                <TableHead className={TH}>Score</TableHead>
                <TableHead className={cn(TH, "text-right")}>Completed</TableHead>
                <TableHead className={cn(TH, "text-right")}>On time</TableHead>
                <TableHead className={cn(TH, "text-right")}>QC returns</TableHead>
                <TableHead className={cn(TH, "text-right")}>Open</TableHead>
                <TableHead className={TH}>Daily checks</TableHead>
                {nudge ? <TableHead className="w-24 pr-5" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.rows.map((r) => (
                <TableRow key={r.user_id}>
                  <TableCell className="pl-5 font-display font-semibold tabular-nums text-muted-foreground">{r.rank ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`${BASE}/${r.user_id}${period === "week" ? "" : `?period=${period}`}`} className="group block min-w-0">
                      <span className="block truncate font-medium group-hover:text-primary">
                        {r.name}
                        {r.user_id === viewer.userId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{r.role}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <ScorePill score={r.score} />
                      {r.score !== null ? <TrendIcon trend={r.trend} /> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.checks_completed}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.onTimePct === null ? "—" : `${r.onTimePct}%`}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.qc_returns}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.open}
                    {r.overdue ? <span className="ml-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">{r.overdue} late</span> : null}
                  </TableCell>
                  <TableCell>
                    <Sparkline values={fillSeries(r.days, board.from, board.to).map((d) => d.checks)} label={`${r.name}, checks per day`} />
                  </TableCell>
                  {nudge ? (
                    <TableCell className="pr-5 text-right">{r.user_id !== viewer.userId ? <PushDialog userId={r.user_id} name={r.name} overdue={r.overdue} /> : null}</TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
    </DataTable>
  );
}

async function Heatmap({ searchParams }: Pick<PageProps<"/app/team/performance">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "staff.performance.read")) return null;
  const period = parsePeriod(params.period);
  const board = await performanceBoard(viewer.orgId, period);
  if (!board || !board.rows.length) return null;
  const weekly = period === "quarter";
  const rows = [...board.rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ userId: r.user_id, name: r.name, cells: heatmapCells(r.days, board.from, board.to).map((c) => ({ label: c.label, overdue: c.overdue })) }));
  return (
    <Surface>
      <SurfaceHeader title="Workload heatmap" description={`Items overdue at the end of each ${weekly ? "week (the worst day)" : "day"}. Darker means more late work.`} />
      <WorkloadHeatmap rows={rows} weekly={weekly} />
    </Surface>
  );
}
