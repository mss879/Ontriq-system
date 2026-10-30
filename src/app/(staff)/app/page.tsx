import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Check,
  ClipboardCheck,
  ClipboardList,
  Cog,
  FileCheck2,
  FileClock,
  FileSignature,
  FolderKanban,
  Inbox,
  ListChecks,
  Mail,
  PauseCircle,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Eyebrow, Page, SectionSkeleton } from "@/components/layout/page";
import { SectionBoundary } from "@/components/layout/section-boundary";
import { OpenPaletteButton } from "@/components/command/command-trigger";
import { KpiTile } from "@/components/charts/kpi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer, type Viewer } from "@/lib/server/viewer";
import { integrationStatus } from "@/lib/env";
import { can, canAny } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { stageCounts } from "@/lib/server/cases/queries";
import { myWorkSummary, needsAttention, queueCases, queueCounts, queueTabsFor } from "@/lib/server/cases/list-queries";
import { getReportQueues } from "@/lib/server/reports/queries";
import { invoiceHeadline } from "@/lib/server/billing/queries";
import { listQuotes } from "@/lib/server/quotes/queries";
import { formatMoney } from "@/domain/pricing/money";
import { ACTIVE_STAGES, STAGE_LABELS, stageStep } from "@/domain/workflow/stages";
import { stageColor } from "@/components/cases/badges";
import { NudgeBanner } from "@/components/performance/nudge-banner";
import { ScorePill, TrendIcon } from "@/components/performance/score";
import { Sparkline } from "@/components/performance/sparkline";
import { latestBriefing, myOpenNudges, ownScorecard, performanceBoard } from "@/lib/server/performance/queries";
import { fillSeries } from "@/domain/performance/score-core";
import { QueueList } from "./queues/queue-list";

export const metadata: Metadata = { title: "Dashboard" };

const DOES_CASEWORK = ["checks.verify", "checks.data_entry", "qc.pre", "qc.post"] as const;

/** What this person's day is about, which decides the numbers they see first. */
type Focus = "manager" | "qc" | "data_entry" | "officer" | "relations" | "viewer";

function focusFor(viewer: Viewer): Focus {
  if (can(viewer, "cases.assign")) return "manager";
  if (canAny(viewer, ["qc.pre", "qc.post"])) return "qc";
  if (can(viewer, "checks.data_entry")) return "data_entry";
  if (can(viewer, "checks.verify")) return "officer";
  if (canAny(viewer, ["invoices.manage", "quotes.manage"])) return "relations";
  return "viewer";
}

export default function DashboardPage({ searchParams }: PageProps<"/app">) {
  return (
    <Page>
      <Suspense fallback={<HeroSkeleton />}>
        <Hero />
      </Suspense>
      <Suspense fallback={null}>
        <Pushes searchParams={searchParams} />
      </Suspense>
      <SectionBoundary label="your numbers">
        <Suspense fallback={<WorkSkeleton />}>
          <Headline />
        </Suspense>
      </SectionBoundary>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="w-full min-w-0 space-y-5 lg:flex-[2]">
          <SectionBoundary label="your next work">
            <Suspense fallback={null}>
              <NextUp />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary label="the briefing">
            <Suspense fallback={<SectionSkeleton rows={4} />}>
              <Briefing />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary label="the pipeline">
            <Suspense fallback={<SectionSkeleton rows={6} />}>
              <Pipeline />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary label="the setup checklist">
            <Suspense fallback={null}>
              <SetupChecklist />
            </Suspense>
          </SectionBoundary>
        </div>
        <Suspense fallback={<SectionSkeleton rows={6} className="w-full lg:flex-1" />}>
          <SideRail />
        </Suspense>
      </div>
    </Page>
  );
}

/** Only the cards this person can use, so a role with none gets the full width. */
async function SideRail() {
  const viewer = await getStaffViewer();
  const scorecard = can(viewer, "staff.performance.read") || DOES_CASEWORK.some((p) => can(viewer, p));
  const attention = can(viewer, "cases.assign") || can(viewer, "cases.stage.change");
  const status = canAny(viewer, ["settings.manage", "users.manage", "jobs.read"]);
  const team = can(viewer, "users.manage");
  if (!scorecard && !attention && !status && !team) return null;
  return (
    <div className="w-full min-w-0 space-y-5 lg:flex-1">
      {scorecard ? (
        <SectionBoundary label="your scorecard">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <MyScorecard />
          </Suspense>
        </SectionBoundary>
      ) : null}
      {attention ? (
        <SectionBoundary label="what needs attention">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <NeedsAttention />
          </Suspense>
        </SectionBoundary>
      ) : null}
      {status ? (
        <SectionBoundary label="system status">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <SystemStatus />
          </Suspense>
        </SectionBoundary>
      ) : null}
      {team ? (
        <SectionBoundary label="the team">
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <TeamSnapshot />
          </Suspense>
        </SectionBoundary>
      ) : null}
    </div>
  );
}

function HeroSkeleton() {
  return <div className="h-[84px] animate-pulse rounded-2xl bg-brand/90" aria-hidden />;
}

async function Hero() {
  const viewer = await getStaffViewer();
  await connection();
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Colombo" }).format(now));
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Colombo" }).format(now);
  const first = viewer.fullName.split(" ")[0] || "there";
  const canInvite = can(viewer, "users.manage");
  const canSettings = can(viewer, "settings.manage");
  const canCreate = can(viewer, "cases.create");

  return (
    <section className="brand-glow relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-soft ring-1 ring-black/5 md:px-7 dark:ring-white/[0.07]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-xl leading-tight font-semibold tracking-tight md:text-2xl">
            {part}, {first}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-white/65">
            <span>{date}</span>
            <span aria-hidden>·</span>
            <span>{viewer.roleName}</span>
            {viewer.aal === "aal2" ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 text-on-dark-success">
                  <ShieldCheck className="size-3.5" aria-hidden /> Two-step on
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <OpenPaletteButton className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/10 px-3.5 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60">
            <Search className="size-4" /> Search
            <Kbd className="hidden bg-white/10 text-white/80 sm:inline-flex">⌘K</Kbd>
          </OpenPaletteButton>
          {canCreate ? (
            <Button asChild variant="inverse" size="lg" className="h-9 px-3.5">
              <Link href="/app/cases/new">
                <Plus /> New case
              </Link>
            </Button>
          ) : canInvite ? (
            <Button asChild variant="inverse" size="lg" className="h-9 px-3.5">
              <Link href="/app/team?invite=1">
                <UserPlus /> Invite a team member
              </Link>
            </Button>
          ) : canSettings ? (
            <Button asChild variant="inverse" size="lg" className="h-9 px-3.5">
              <Link href="/app/settings">
                <Settings /> Settings
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 56 56" className="size-16 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke="url(#ontriq-ring)"
          strokeDasharray={`${(value / 100) * c} ${c}`}
        />
        <defs>
          <linearGradient id="ontriq-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-orange)" />
            <stop offset="100%" stopColor="var(--brand-blue)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{value}%</span>
    </div>
  );
}

async function SetupChecklist() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "settings.manage") && !can(viewer, "users.manage")) return null;

  const supabase = await createRequestClient();
  const [{ data: org }, { count: members }] = await Promise.all([
    supabase.from("orgs").select("branding").eq("id", viewer.orgId).single(),
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("kind", "staff"),
  ]);
  const branding = (org?.branding ?? {}) as Record<string, string>;
  const integrations = Object.fromEntries(integrationStatus().map((i) => [i.key, i.configured]));

  const items: { done: boolean; title: string; text: string; href?: string; icon: LucideIcon }[] = [
    { done: viewer.aal === "aal2", title: "Two-step verification", text: "Your account is protected with an authenticator app.", icon: ShieldCheck },
    {
      done: Boolean(branding.address && branding.phone),
      title: "Company details and branding",
      text: "Address, phone and registration details appear on quotations, invoices and reports.",
      href: "/app/settings",
      icon: Building2,
    },
    { done: (members ?? 0) > 1, title: "Invite your team", text: "Add managers, verification and QC officers with the right designations.", href: "/app/team?invite=1", icon: Users },
    { done: Boolean(integrations.resend), title: "Email delivery", text: "Connect Resend so invitations, reminders and reports are emailed from your domain.", href: "/app/settings#integrations", icon: Mail },
    { done: Boolean(integrations.anthropic), title: "AI", text: "Add the Anthropic key to switch on document reading, drafting and the assistants.", href: "/app/settings#integrations", icon: Bot },
    { done: Boolean(integrations.jobs), title: "Background jobs", text: "Set the worker and scheduler secrets so emails and AI tasks run on time.", href: "/app/settings#integrations", icon: Cog },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const percent = Math.round((doneCount / items.length) * 100);
  const left = items.filter((i) => !i.done);

  if (!left.length) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Check className="size-4 text-success" aria-hidden /> Ontriq is set up: everything is connected.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-5">
          <ProgressRing value={percent} />
          <div className="space-y-1">
            <Eyebrow>Getting started</Eyebrow>
            <CardTitle className="text-lg">Set up Ontriq</CardTitle>
            <CardDescription>{`${doneCount} of ${items.length} done. Finish these to go live.`}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="-my-1 px-3">
        <ul className="divide-y divide-border/70">
          {left.map((item) => {
            const Icon = item.icon;
            const body = (
              <div className="flex items-center gap-4 rounded-xl px-2 py-3 transition-colors group-hover:bg-muted/60">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange-ink">
                  <Icon className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{item.text}</p>
                </div>
                {item.href ? <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" /> : null}
              </div>
            );
            return (
              <li key={item.title}>
                {item.href ? (
                  <Link href={item.href} className="group block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

async function SystemStatus() {
  const supabase = await createRequestClient();
  const { data } = await supabase.rpc("queue_depth");
  const depth = (data ?? {}) as { queued?: number; running?: number; dead?: number; live_workers?: number };
  const integrations = integrationStatus();
  const configured = integrations.filter((i) => i.configured).length;
  const dead = depth.dead ?? 0;

  const tiles = [
    { label: "Services", value: `${configured}/${integrations.length}`, sub: "connected" },
    { label: "Waiting", value: String(depth.queued ?? 0), sub: "jobs queued" },
    { label: "Running", value: String(depth.running ?? 0), sub: "jobs in progress" },
    { label: "Attention", value: String(dead), sub: dead ? "jobs failed" : "all clear", warn: dead > 0 },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>System status</CardTitle>
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", dead ? "text-destructive" : "text-success")}>
            <span className={cn("size-1.5 rounded-full", dead ? "bg-destructive" : "bg-success")} />
            {dead ? "Needs attention" : "Operational"}
          </span>
        </div>
        <CardDescription>Background work and connected services.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2.5">
          {tiles.map((t) => (
            <div key={t.label} className={cn("rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/[0.04]", t.warn && "bg-destructive/8 ring-destructive/20")}>
              <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.label}</dt>
              <dd className={cn("mt-1.5 font-display text-2xl leading-none font-semibold tabular-nums", t.warn && "text-destructive")}>{t.value}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{t.sub}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

async function TeamSnapshot() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "users.manage")) return null;
  const supabase = await createRequestClient();
  const [{ data: memberships }, { count: pending }] = await Promise.all([
    supabase.from("memberships").select("status, role:roles(name)").eq("kind", "staff"),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const byRole = new Map<string, number>();
  for (const m of memberships ?? []) {
    const name = (m.role as { name: string } | null)?.name ?? "Unknown";
    byRole.set(name, (byRole.get(name) ?? 0) + 1);
  }
  const total = memberships?.length ?? 0;
  const max = Math.max(1, ...byRole.values());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          <span className="font-display text-2xl font-semibold text-foreground tabular-nums">{total}</span> staff
          {pending ? ` · ${pending} invitation${pending === 1 ? "" : "s"} pending` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {[...byRole.entries()].map(([role, n]) => (
          <div key={role} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{role}</span>
              <span className="font-medium tabular-nums">{n}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </div>
        ))}
        <Link href="/app/team" className="group inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
          Manage team <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

function WorkSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

type Tile = { label: string; value: string; sub?: string; href?: string; icon: LucideIcon; tone?: "default" | "good" | "warn" | "bad"; alert?: boolean };

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

async function headlineTiles(viewer: Viewer, focus: Focus): Promise<{ tiles: Tile[]; own?: { cases: number; checks: number; dueToday: number } }> {
  if (focus === "manager") {
    const money = canAny(viewer, ["invoices.manage", "billing.export"]);
    const [counts, a, reports, billing, work] = await Promise.all([
      stageCounts(),
      needsAttention(),
      can(viewer, "reports.approve") ? getReportQueues(viewer.userId) : null,
      money ? invoiceHeadline() : null,
      myWorkSummary(viewer.userId),
    ]);
    const open = ACTIVE_STAGES.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
    const toApprove = reports?.toApprove.length ?? 0;
    const tiles: Tile[] = [
      { label: "Open cases", value: String(open), sub: counts.on_hold ? `${counts.on_hold} on hold` : "across every stage", href: "/app/cases", icon: FolderKanban },
      ...(reports ? [{ label: "To approve", value: String(toApprove), sub: `${plural(toApprove, "report")} waiting for you`, href: "/app/queues?tab=mine", icon: FileCheck2, tone: toApprove ? ("warn" as const) : undefined }] : []),
      { label: "Unassigned", value: String(a.unassigned), sub: a.unassigned ? "cases nobody owns" : "every case has an owner", href: "/app/queues?tab=unassigned", icon: Inbox, tone: a.unassigned ? "warn" : undefined },
      { label: "Overdue", value: String(a.overdue), sub: a.overdue ? "past their due date" : "nothing late", href: "/app/queues?tab=overdue", icon: AlarmClock, tone: a.overdue ? "bad" : undefined, alert: a.overdue > 0 },
      ...(billing
        ? [
            { label: "Outstanding", value: formatMoney(billing.outstanding), sub: "confirmed, not yet paid", href: "/app/invoices?status=open", icon: Wallet },
            { label: "Unpaid and late", value: formatMoney(billing.overdue), sub: "past the due date", href: "/app/invoices?status=overdue", icon: AlertTriangle, tone: billing.overdue > 0 ? ("bad" as const) : undefined, alert: billing.overdue > 0 },
          ]
        : []),
    ];
    return { tiles, own: { cases: work.openCases, checks: work.openChecks, dueToday: work.dueToday } };
  }

  if (focus === "qc") {
    const counts = await queueCounts(viewer, queueTabsFor(viewer));
    return {
      tiles: [
        { label: "Pre-QC", value: String(counts.pre_qc ?? 0), sub: "cases to review", href: "/app/queues?tab=pre_qc", icon: ClipboardCheck, tone: counts.pre_qc ? "warn" : undefined },
        { label: "Post-QC", value: String(counts.post_qc ?? 0), sub: "cases to review", href: "/app/queues?tab=post_qc", icon: ClipboardList, tone: counts.post_qc ? "warn" : undefined },
        { label: "Returned", value: String(counts.returned ?? 0), sub: "waiting for corrections", href: "/app/queues?tab=returned", icon: RotateCcw },
        { label: "Overdue", value: String(counts.overdue ?? 0), sub: counts.overdue ? "past their due date" : "nothing late", href: "/app/queues?tab=overdue", icon: AlarmClock, tone: counts.overdue ? "bad" : undefined, alert: Boolean(counts.overdue) },
      ],
    };
  }

  if (focus === "relations") {
    const [billing, quotes] = await Promise.all([invoiceHeadline(), listQuotes({ status: "open" })]);
    return {
      tiles: [
        { label: "Outstanding", value: formatMoney(billing.outstanding), sub: "confirmed, not yet paid", href: "/app/invoices?status=open", icon: Wallet },
        { label: "Unpaid and late", value: formatMoney(billing.overdue), sub: "past the due date", href: "/app/invoices?status=overdue", icon: AlertTriangle, tone: billing.overdue > 0 ? "bad" : undefined, alert: billing.overdue > 0 },
        { label: "Drafts to check", value: String(billing.drafts), sub: `${plural(billing.drafts, "invoice")} to confirm`, href: "/app/invoices?status=draft", icon: FileClock, tone: billing.drafts ? "warn" : undefined },
        { label: "Quotes out", value: String(quotes.length), sub: "waiting for the client", href: "/app/quotes?status=open", icon: FileSignature },
      ],
    };
  }

  if (focus === "viewer") return { tiles: [] };

  const work = await myWorkSummary(viewer.userId);
  const held: Tile =
    focus === "data_entry"
      ? { label: "Data entry", value: String((await queueCounts(viewer, ["data_entry"])).data_entry ?? 0), sub: "cases waiting for details", href: "/app/queues?tab=data_entry", icon: Briefcase }
      : { label: "My cases", value: String(work.openCases), sub: "active cases you own", href: "/app/queues?tab=mine", icon: Briefcase };
  return {
    tiles: [
      held,
      { label: "My checks", value: String(work.openChecks), sub: "checks still open", href: "/app/queues?tab=mine", icon: ListChecks },
      { label: "Due today", value: String(work.dueToday), sub: "by close of business", href: "/app/queues?tab=mine", icon: AlarmClock, tone: work.dueToday ? "warn" : undefined },
      { label: "Overdue", value: String(work.overdue), sub: work.overdue ? "past their due date" : "nothing late", href: "/app/queues?tab=overdue", icon: AlarmClock, tone: work.overdue ? "bad" : undefined, alert: work.overdue > 0 },
    ],
  };
}

/** The first row of numbers, chosen for what this person does all day. */
async function Headline() {
  const viewer = await getStaffViewer();
  const { tiles, own } = await headlineTiles(viewer, focusFor(viewer));
  if (!tiles.length) return null;
  const mine = own ? own.cases + own.checks : 0;
  return (
    <section aria-label="Key numbers" className="space-y-2.5">
      <div className={cn("grid grid-cols-2 gap-3", tiles.length > 4 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
        {tiles.map((t) => (
          <KpiTile key={t.label} {...t} />
        ))}
      </div>
      {own && mine ? (
        <Link href="/app/queues?tab=mine" className="group inline-flex items-center gap-1.5 rounded px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          You hold {own.cases} {plural(own.cases, "case")} and {own.checks} {plural(own.checks, "check")} yourself
          {own.dueToday ? `, ${own.dueToday} due today` : ""}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

/** For people working through a queue: the few things to open next, soonest deadline first. */
async function NextUp() {
  const viewer = await getStaffViewer();
  const focus = focusFor(viewer);
  if (focus !== "qc" && focus !== "data_entry" && focus !== "officer") return null;
  const tab = focus === "qc" ? "pre_qc" : focus === "data_entry" ? "data_entry" : "mine";
  const cases = await queueCases(viewer, tab);
  const next = [...cases].sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")).slice(0, 5);
  return (
    <section aria-label="Next up" className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Next up</h2>
        <Link href={`/app/queues?tab=${tab}`} className="group inline-flex items-center gap-1 text-sm font-medium text-primary dark:text-brand-sky">
          See all <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
      <QueueList items={next} empty="Nothing is waiting for you right now." hideOwner={tab === "mine"} />
    </section>
  );
}

async function Pipeline() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "cases.read")) return null;
  const counts = await stageCounts();
  const total = ACTIVE_STAGES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const max = Math.max(1, ...ACTIVE_STAGES.map((s) => counts[s] ?? 0));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Eyebrow>Pipeline</Eyebrow>
            <CardTitle className="text-lg">Active cases by stage</CardTitle>
          </div>
          <Link href="/app/cases" className="group inline-flex items-center gap-1 text-sm font-medium text-primary dark:text-brand-sky">
            {total} active <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
        <CardDescription>
          From documents to approval{counts.on_hold ? `, with ${counts.on_hold} on hold` : ""}. Select a stage to see its cases.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">No active cases yet. New requests appear here as soon as they arrive.</p>
        ) : (
          <ul className="space-y-2.5">
            {ACTIVE_STAGES.map((stage) => {
              const n = counts[stage] ?? 0;
              return (
                <li key={stage}>
                  <Link href={`/app/cases?stage=${stage}`} className="group grid grid-cols-[minmax(0,10.5rem)_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="flex items-center gap-2 truncate text-muted-foreground group-hover:text-foreground">
                      <span className="w-3 shrink-0 text-right text-xs tabular-nums opacity-60">{stageStep(stage)}</span>
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full transition-all" style={{ width: `${n ? Math.max(4, (n / max) * 100) : 0}%`, background: stageColor(stage) }} />
                    </span>
                    <span className="text-right font-medium tabular-nums">{n}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function NeedsAttention() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "cases.assign") && !can(viewer, "cases.stage.change")) return null;
  const a = await needsAttention();
  const manager = focusFor(viewer) === "manager";
  // The tiles at the top already count unassigned and overdue work.
  const rows: { label: string; text: string; value: number; href: string; icon: LucideIcon }[] = [
    ...(manager ? [{ label: "Returned by QC", text: "Waiting for corrections", value: a.returned, href: "/app/queues?tab=returned", icon: RotateCcw }] : []),
    { label: "On hold", text: "Paused at the client's request", value: a.onHold, href: "/app/cases?stage=on_hold", icon: PauseCircle },
  ];
  const all = rows.reduce((x, r) => x + r.value, 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Needs attention</CardTitle>
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", all ? "text-brand-orange-ink" : "text-success")}>
            {all ? <ClipboardCheck className="size-3.5" /> : <Check className="size-3.5" />}
            {all ? `${all} to look at` : "All clear"}
          </span>
        </div>
        <CardDescription>Work that has stopped and needs someone to move it.</CardDescription>
      </CardHeader>
      <CardContent className="-mx-2 px-3">
        <ul className="space-y-0.5">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.label}>
                <Link href={r.href} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", r.value ? "bg-brand-orange/10 text-brand-orange-ink" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground">{r.text}</span>
                  </span>
                  <span className={cn("font-display text-lg font-semibold tabular-nums", !r.value && "text-muted-foreground")}>{r.value}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

async function Pushes({ searchParams }: Pick<PageProps<"/app">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  const nudges = await myOpenNudges(viewer.userId);
  if (!nudges.length) return null;
  return <NudgeBanner nudges={nudges} highlight={typeof params.nudge === "string" ? params.nudge : null} />;
}

async function MyScorecard() {
  const viewer = await getStaffViewer();
  const team = can(viewer, "staff.performance.read");
  const board = team ? await performanceBoard(viewer.orgId, "week") : null;
  const mine = board?.rows.find((r) => r.user_id === viewer.userId);
  if (!mine && !DOES_CASEWORK.some((p) => can(viewer, p))) return null;

  if (board && mine) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>My scorecard</CardTitle>
            <span className="text-xs text-muted-foreground">Last 7 days</span>
          </div>
          <CardDescription>{mine.rank ? `Rank ${mine.rank} of ${board.rows.length} doing casework.` : "Not ranked yet: nothing completed this week."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <ScorePill score={mine.score} className="h-12 min-w-14 rounded-xl text-xl" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex items-center gap-1 font-medium">
                {mine.checks_completed} checks completed <TrendIcon trend={mine.trend} />
              </p>
              <p className="text-xs text-muted-foreground">
                {mine.onTimePct === null ? "No due dates yet" : `${mine.onTimePct}% on time`} · {mine.qc_returns} QC return{mine.qc_returns === 1 ? "" : "s"}
              </p>
            </div>
            <Sparkline values={fillSeries(mine.days, board.from, board.to).map((d) => d.checks)} label="Your checks per day" width={72} />
          </div>
          <Link href={`/app/team/performance/${viewer.userId}`} className="group inline-flex items-center gap-1 text-sm font-medium text-primary">
            See the details <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const own = await ownScorecard(viewer, "week");
  const r = own.row;
  const tiles = [
    { label: "Completed", value: String(r.checks_completed) },
    { label: "On time", value: own.onTimePct === null ? "—" : `${own.onTimePct}%` },
    { label: "QC returns", value: String(r.qc_returns) },
    { label: "Overdue now", value: String(r.overdue), warn: r.overdue > 0 },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>My scorecard</CardTitle>
          <span className="text-xs text-muted-foreground">Last 7 days</span>
        </div>
        <CardDescription className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1">
            <TrendIcon trend={own.trend} /> {own.trend === "up" ? "Picking up" : own.trend === "down" ? "Slower than last week" : "Steady"}
          </span>
          <Sparkline values={own.series} label="Your checks per day" width={72} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2.5">
          {tiles.map((t) => (
            <div key={t.label} className={cn("rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/[0.04]", t.warn && "bg-destructive/8 ring-destructive/20")}>
              <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.label}</dt>
              <dd className={cn("mt-1.5 font-display text-2xl leading-none font-semibold tabular-nums", t.warn && "text-destructive")}>{t.value}</dd>
            </div>
          ))}
        </dl>
        <Link href="/app/team/performance" className="group inline-flex items-center gap-1 text-sm font-medium text-primary">
          See the details <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

async function Briefing() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "staff.performance.read") && !can(viewer, "analytics.read")) return null;
  const b = await latestBriefing(viewer.orgId);
  if (!b) return null;
  const written = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(b.createdAt));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Eyebrow>Morning briefing</Eyebrow>
            <CardTitle className="text-lg">{b.headline}</CardTitle>
          </div>
          {b.ai ? (
            <Badge className="bg-brand-orange/10 text-brand-orange-ink">
              <Sparkles className="size-3" /> AI summary
            </Badge>
          ) : null}
        </div>
        <CardDescription>{written}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {b.bullets.length ? (
          <ul className="space-y-1.5">
            {b.bullets.map((x, i) => (
              <li key={i} className="flex gap-2.5 leading-relaxed">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {x}
              </li>
            ))}
          </ul>
        ) : null}
        {b.risks.length ? (
          <div className="space-y-1.5 rounded-xl bg-destructive/[0.06] p-3 ring-1 ring-destructive/15">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <TriangleAlert className="size-3.5" /> At risk today
            </p>
            <ul className="space-y-1">
              {b.risks.map((x, i) => (
                <li key={i} className="leading-relaxed">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
