import { Suspense } from "react";
import Link from "@/components/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, Check, MessageSquareReply } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Badge } from "@/components/ui/badge";
import { PeriodSwitch } from "@/components/performance/period-switch";
import { PushDialog } from "@/components/performance/push-dialog";
import { Scorecard } from "@/components/performance/scorecard";
import { getStaffViewer } from "@/lib/server/viewer";
import { getPerformanceRules, nudgeHistory, openItems, ownScorecard, performanceBoard, staffPerson } from "@/lib/server/performance/queries";
import { fillSeries, parsePeriod, PERIODS } from "@/domain/performance/score-core";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance" };

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(iso)) : "No due date";

type Props = PageProps<"/app/team/performance/[userId]">;

export default function PersonPerformancePage({ params, searchParams }: Props) {
  return (
    <Page>
      <Link href="/app/team/performance" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Performance
      </Link>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <Header params={params} searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Card params={params} searchParams={searchParams} />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<SectionSkeleton rows={6} />}>
          <OpenWork params={params} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton rows={6} />}>
          <Nudges params={params} />
        </Suspense>
      </div>
    </Page>
  );
}

/** Themselves, or anyone with staff.performance.read; everyone else gets a 404. */
async function allowed(userId: string) {
  const viewer = await getStaffViewer();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  if (userId !== viewer.userId && !can(viewer, "staff.performance.read")) notFound();
  const person = await staffPerson(userId);
  if (!person) notFound();
  return { viewer, person };
}

async function Header({ params, searchParams }: Props) {
  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  const { viewer, person } = await allowed(userId);
  const period = parsePeriod(sp.period);
  const items = can(viewer, "staff.nudge") && userId !== viewer.userId ? await openItems(userId) : [];
  return (
    <PageHeader
      eyebrow={person.roleName}
      title={person.name}
      description={person.email}
      actions={
        <>
          <PeriodSwitch period={period} basePath={`/app/team/performance/${userId}`} />
          {can(viewer, "staff.nudge") && userId !== viewer.userId ? <PushDialog userId={userId} name={person.name} overdue={items.filter((i) => i.overdue).length} size="default" /> : null}
        </>
      }
    />
  );
}

async function Card({ params, searchParams }: Props) {
  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  const { viewer, person } = await allowed(userId);
  const period = parsePeriod(sp.period);
  const label = PERIODS.find((p) => p.key === period)!.label;

  if (can(viewer, "staff.performance.read")) {
    const [board, rules] = await Promise.all([performanceBoard(viewer.orgId, period), getPerformanceRules(viewer.orgId)]);
    const r = board?.rows.find((x) => x.user_id === userId);
    if (board && r) {
      return (
        <Surface>
          <SurfaceHeader title="Scorecard" description={`Last ${label}, compared with ${board.rows.length} people doing casework.`} />
          <Scorecard
            row={r}
            parts={r.parts}
            score={r.score}
            rank={r.rank}
            teamSize={board.rows.length}
            onTimePct={r.onTimePct}
            trend={r.trend}
            days={fillSeries(r.days, board.from, board.to).map((d) => ({ day: d.day, value: d.checks }))}
            weights={rules.weights}
          />
        </Surface>
      );
    }
    if (userId !== viewer.userId) {
      return (
        <Surface>
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{person.name} isn&apos;t on the leaderboard: their designation doesn&apos;t do casework.</p>
        </Surface>
      );
    }
  }
  const own = await ownScorecard(viewer, period);
  return (
    <Surface>
      <SurfaceHeader title="Scorecard" description={`Your own figures, last ${label}.`} />
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

async function OpenWork({ params }: Pick<Props, "params">) {
  const { userId } = await params;
  await allowed(userId);
  const items = await openItems(userId);
  const sorted = [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.at_risk) - Number(a.at_risk) || (a.due_at ?? "9").localeCompare(b.due_at ?? "9"));
  return (
    <Surface>
      <SurfaceHeader title="Open work" description={`${items.length} open · ${items.filter((i) => i.overdue).length} overdue · ${items.filter((i) => i.at_risk).length} due within a day`} />
      {sorted.length ? (
        <ul className="max-h-[28rem] divide-y overflow-y-auto">
          {sorted.map((i) => (
            <li key={`${i.kind}-${i.id}`}>
              <Link href={`/app/cases/${i.case_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{i.reference}</span>
                  <span className="block truncate text-xs text-muted-foreground">{i.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {when(i.due_at)}
                  {i.overdue ? <Badge className="bg-destructive/10 text-destructive">Overdue</Badge> : i.at_risk ? <Badge className="bg-warning/15 text-warning-foreground">Due soon</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing open.</p>
      )}
    </Surface>
  );
}

async function Nudges({ params }: Pick<Props, "params">) {
  const { userId } = await params;
  await allowed(userId);
  const nudges = await nudgeHistory(userId);
  return (
    <Surface>
      <SurfaceHeader title="Pushes" description={nudges.length ? `${nudges.length} most recent` : "None yet"} />
      {nudges.length ? (
        <ul className="max-h-[28rem] divide-y overflow-y-auto">
          {nudges.map((n) => (
            <li key={n.id} className="space-y-1.5 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <BellRing className="size-3.5 text-destructive" />
                <span className="font-medium text-foreground">{n.auto ? "Automatic" : (n.fromName ?? "A manager")}</span>
                <span>{when(n.createdAt)}</span>
                <span>· {n.items.length} item{n.items.length === 1 ? "" : "s"}</span>
                {n.escalation ? <Badge className="bg-destructive/10 text-destructive">Escalated</Badge> : null}
                <span className={cn("ml-auto inline-flex items-center gap-1", n.acknowledgedAt ? "text-success" : "text-brand-orange-ink")}>
                  {n.acknowledgedAt ? (
                    <>
                      <Check className="size-3.5" /> Acknowledged {when(n.acknowledgedAt)}
                    </>
                  ) : (
                    "Not acknowledged"
                  )}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line">{n.message}</p>
              {n.reply ? (
                <p className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{n.reply}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No pushes yet.</p>
      )}
    </Surface>
  );
}
