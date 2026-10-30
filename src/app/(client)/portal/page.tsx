import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, ArrowRight, ArrowUpRight, Boxes, CheckCircle2, ClipboardList, FilePlus2, FileWarning, Inbox, LayoutTemplate, ShieldCheck, Timer } from "lucide-react";
import { Eyebrow, Page, SectionSkeleton } from "@/components/layout/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { PortalCaseList } from "@/components/portal/case-list";
import { waitsOnClient } from "@/components/portal/portal-badges";
import { getClientViewer } from "@/lib/server/viewer";
import { portalDashboard } from "@/lib/server/portal/queries";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Client portal" };

export default function PortalHome() {
  return (
    <Page className="space-y-8">
      <Suspense fallback={<div className="h-[212px] animate-pulse rounded-3xl bg-brand/90" aria-hidden />}>
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
    <section className="brand-glow relative overflow-hidden rounded-3xl px-6 py-8 text-white shadow-lift ring-1 ring-black/5 md:px-9 md:py-10 dark:ring-white/[0.07]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Eyebrow tone="onDark">{viewer.clientName}</Eyebrow>
          <h1 className="font-display text-[2rem] leading-[1.1] font-semibold tracking-tight md:text-[2.5rem]">Welcome, {first}</h1>
          <p className="max-w-xl text-sm leading-relaxed text-white/70">
            Track every background check for your candidates, see what’s needed from you, and download reports the moment they’re released.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[13px] text-white/75">
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-[#ffb08f]" /> Confidential by design
            </li>
            <li className="flex items-center gap-1.5">
              <ArrowUpRight className="size-4 text-[#ffb08f]" /> Live status, no phone calls
            </li>
          </ul>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portal/cases/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0A1A2F] shadow-[0_8px_24px_-8px_rgb(247_88_52/0.6)] transition-transform hover:-translate-y-px"
            >
              <FilePlus2 className="size-4 text-brand-orange" /> New request
            </Link>
            <Link
              href="/portal/cases"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15"
            >
              All cases <ArrowRight className="size-4" />
            </Link>
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
    { label: "Needs you", value: actionCount, sub: actionCount === 1 ? "request waits on documents" : "requests wait on documents", icon: FileWarning, href: "/portal/cases?status=action", warn: actionCount > 0 },
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
                <Button asChild variant="brand">
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
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon;
          const body = (
            <div
              className={cn(
                "flex h-full flex-col gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07] transition-all",
                t.href && "group-hover:-translate-y-0.5 group-hover:shadow-lift",
                t.warn && "ring-brand-orange/30",
                t.danger && "ring-destructive/30",
              )}
            >
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.label}</dt>
                <Icon className={cn("size-4 text-muted-foreground", t.warn && "text-brand-orange", t.danger && "text-destructive")} aria-hidden />
              </div>
              <dd className={cn("font-display text-[1.75rem] leading-none font-semibold tabular-nums", t.danger && "text-destructive")}>{t.value}</dd>
              <dd className="text-xs text-muted-foreground">{t.sub}</dd>
            </div>
          );
          return (
            <div key={t.label} className={cn(t.label === "Turnaround" && "col-span-2 lg:col-span-1")}>
              {t.href ? (
                <Link href={t.href} className="group block h-full">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </dl>

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
                    <CardDescription>Ontriq is waiting for documents from you on these requests.</CardDescription>
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
                      className={cn("h-full rounded-full", s.key === "released" ? "bg-success" : s.key === "documents" ? "bg-brand-orange" : "bg-brand-blue dark:bg-brand-sky")}
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
                  { href: "/portal/templates", label: "Request templates", text: "One-click requests for common roles", icon: LayoutTemplate },
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
