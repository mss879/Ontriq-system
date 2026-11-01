import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, ArrowRight, Boxes, CheckCircle2, ClipboardList, FilePlus2, FileWarning, Inbox, LayoutTemplate, ShieldCheck, Timer } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { KpiTile } from "@/components/charts/kpi";
import { PortalCaseList } from "@/components/portal/case-list";
import { waitsOnClient } from "@/components/portal/portal-badges";
import { getClientViewer } from "@/lib/server/viewer";
import { portalDashboard } from "@/lib/server/portal/queries";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Client portal" };

export default function PortalHome() {
  return (
    <Page>
      <Suspense fallback={<div className="h-[84px] animate-pulse rounded-2xl bg-brand/90" aria-hidden />}>
        <Welcome />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </Page>
  );
}

async function Welcome() {
  const viewer = await getClientViewer();
  const first = viewer.fullName.split(" ")[0] || "there";
  const canCreate = can(viewer, "portal.cases.create");
  return (
    <section className="brand-glow relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-soft ring-1 ring-black/5 md:px-7 dark:ring-white/[0.07]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-xl leading-tight font-semibold tracking-tight md:text-2xl">Welcome, {first}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-white/65">
            <span>{viewer.clientName}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-brand-peach" aria-hidden /> Confidential by design
            </span>
          </p>
        </div>
        {canCreate ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/portal/cases"
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/10 px-3.5 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              All cases <ArrowRight className="size-4" />
            </Link>
            <Button asChild variant="inverse" size="lg" className="h-9 px-3.5">
              <Link href="/portal/cases/new">
                <FilePlus2 /> New request
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-card ring-1 ring-foreground/[0.07]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionSkeleton rows={5} className="lg:col-span-2" />
        <SectionSkeleton rows={5} />
      </div>
    </div>
  );
}

async function Dashboard() {
  const [viewer, d] = await Promise.all([getClientViewer(), portalDashboard()]);
  const canCreate = can(viewer, "portal.cases.create");
  // Only cases where the client supplies documents wait on them (Ontriq collects the rest from candidates).
  const needsAction = d.needs_action.filter(waitsOnClient);
  const actionCount = d.counts.action <= d.needs_action.length ? needsAction.length : d.counts.action;
  const tiles = [
    { label: "In progress", value: d.counts.active, sub: "active requests", icon: ClipboardList, href: "/portal/cases?status=active" },
    { label: "Needs you", value: actionCount, sub: actionCount === 1 ? "request waits on you" : "requests wait on you", icon: FileWarning, href: "/portal/cases?status=action", warn: actionCount > 0 },
    { label: "Released", value: d.counts.released_30d, sub: "in the last 30 days", icon: CheckCircle2, href: "/portal/cases?status=released" },
    { label: "Past due", value: d.counts.overdue, sub: "beyond the target date", icon: AlarmClock, href: "/portal/cases?status=active&sort=due", danger: d.counts.overdue > 0 },
    { label: "Turnaround", value: d.avg_tat_days === null ? "—" : `${d.avg_tat_days}d`, sub: "average, last 90 days", icon: Timer },
  ];
  const stages = [
    { key: "received", label: "Received", value: d.by_stage.received },
    { key: "documents", label: "Collecting documents", value: d.by_stage.documents },
    { key: "in_progress", label: "Verification", value: d.by_stage.in_progress },
    { key: "report", label: "Report", value: d.by_stage.report },
    { key: "released", label: "Released", value: d.by_stage.released },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  if (d.counts.total === 0) {
    return (
      <Card>
        <CardContent>
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-brand-orange/10 text-brand-orange-ink">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle className="font-display text-xl">No verification requests yet</EmptyTitle>
              <EmptyDescription>
                {canCreate ? "Send your first candidate to Ontriq. It takes about a minute, and you can follow every check here." : "Requests from your company appear here as soon as they are submitted."}
              </EmptyDescription>
            </EmptyHeader>
            {canCreate ? (
              <EmptyContent>
                <Button asChild>
                  <Link href="/portal/cases/new">
                    <FilePlus2 /> New request
                  </Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            label={t.label}
            value={String(t.value)}
            sub={t.sub}
            icon={t.icon}
            href={t.href}
            tone={t.danger ? "bad" : t.warn ? "warn" : "default"}
            alert={t.danger}
            className={t.warn ? "ring-brand-orange/30" : undefined}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {needsAction.length ? (
            <Card className="ring-brand-orange/25">
              <CardHeader className="border-b">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange-ink">
                    <FileWarning className="size-[18px]" />
                  </span>
                  <div>
                    <CardTitle>Needs your action</CardTitle>
                    <CardDescription>Ontriq is waiting for documents or an answer from you on these requests.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="-my-2 px-0">
                <PortalCaseList rows={needsAction} dense />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Recent requests</CardTitle>
                  <CardDescription>The latest verifications for {d.client.name}.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/portal/cases">
                    View all <ArrowRight />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="-my-2 px-0">
              <PortalCaseList rows={d.recent} dense />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Where things stand</CardTitle>
              <CardDescription>
                <span className="font-display text-2xl font-semibold text-foreground tabular-nums">{d.counts.total}</span> requests in total
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5">
              {stages.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-medium tabular-nums">{s.value}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", s.key === "released" ? "bg-success" : "bg-brand-blue dark:bg-brand-sky")}
                      style={{ width: `${(s.value / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Shortcuts</CardTitle>
              <CardDescription>Your SLA with Ontriq is {d.client.sla_days} working days.</CardDescription>
            </CardHeader>
            <CardContent className="-mx-2 -my-1">
              <ul className="space-y-0.5">
                {[
                  ...(canCreate ? [{ href: "/portal/cases/new", label: "Request a verification", text: "One candidate or a spreadsheet", icon: FilePlus2 }] : []),
                  { href: "/portal/packages", label: "Packages and prices", text: "What each package checks", icon: Boxes },
                  ...(canCreate ? [{ href: "/portal/templates", label: "Request templates", text: "One-click requests for common roles", icon: LayoutTemplate }] : []),
                ].map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                        <l.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{l.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{l.text}</span>
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
