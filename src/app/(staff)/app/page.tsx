import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  AlarmClock,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Check,
  ClipboardCheck,
  Cog,
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
  type LucideIcon,
} from "lucide-react";
import { Eyebrow, Page, SectionSkeleton } from "@/components/layout/page";
import { OpenPaletteButton } from "@/components/command/command-trigger";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { createRequestClient } from "@/lib/supabase/server";
import { getStaffViewer } from "@/lib/server/viewer";
import { integrationStatus } from "@/lib/env";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { stageCounts } from "@/lib/server/cases/queries";
import { myWorkSummary, needsAttention } from "@/lib/server/cases/list-queries";
import { ACTIVE_STAGES, STAGE_LABELS, STAGE_TONES } from "@/domain/workflow/stages";
import { TONE_CLASSES } from "@/components/cases/badges";
import { NudgeBanner } from "@/components/performance/nudge-banner";
import { ScorePill, TrendIcon } from "@/components/performance/score";
import { Sparkline } from "@/components/performance/sparkline";
import { latestBriefing, myOpenNudges, ownScorecard, performanceBoard } from "@/lib/server/performance/queries";
import { fillSeries } from "@/domain/performance/score-core";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/app">) {
  return (
    <Page className="space-y-8">
      <Suspense fallback={<HeroSkeleton />}>
        <Hero />
      </Suspense>
      <Suspense fallback={null}>
        <Pushes searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<WorkSkeleton />}>
        <MyWork />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <Briefing />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <Pipeline />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <SetupChecklist />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <MyScorecard />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <NeedsAttention />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <SystemStatus />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <TeamSnapshot />
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

function HeroSkeleton() {
  return <div className="h-[212px] animate-pulse rounded-3xl bg-brand/90" aria-hidden />;
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
    <section className="brand-glow relative overflow-hidden rounded-3xl px-6 py-7 text-white shadow-lift ring-1 ring-black/5 md:px-9 md:py-9 dark:ring-white/[0.07]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Eyebrow tone="onDark">{date}</Eyebrow>
          <h1 className="font-display text-[2rem] leading-[1.1] font-semibold tracking-tight md:text-[2.5rem]">
            {part}, {first}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/10">
              {viewer.roleName}
            </span>
            {viewer.aal === "aal2" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-300/20">
                <ShieldCheck className="size-3.5" /> Two-step verification on
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenPaletteButton className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15">
            <Search className="size-4" /> Search
            <Kbd className="bg-white/10 text-white/80">⌘K</Kbd>
          </OpenPaletteButton>
          {canCreate ? (
            <Link
              href="/app/cases/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0A1A2F] shadow-[0_8px_24px_-8px_rgb(247_88_52/0.6)] transition-transform hover:-translate-y-px"
            >
              <Plus className="size-4 text-brand-orange" /> New case
            </Link>
          ) : canInvite ? (
            <Link
              href="/app/team?invite=1"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0A1A2F] shadow-[0_8px_24px_-8px_rgb(247_88_52/0.6)] transition-transform hover:-translate-y-px"
            >
              <UserPlus className="size-4 text-brand-orange" /> Invite a team member
            </Link>
          ) : canSettings ? (
            <Link
              href="/app/settings"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0A1A2F] transition-transform hover:-translate-y-px"
            >
              <Settings className="size-4 text-brand-orange" /> Settings
            </Link>
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
            <stop offset="0%" stopColor="#F78F1E" />
            <stop offset="55%" stopColor="#F75834" />
            <stop offset="100%" stopColor="#0C5A9A" />
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

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-5">
          <ProgressRing value={percent} />
          <div className="space-y-1">
            <Eyebrow>Getting started</Eyebrow>
            <CardTitle className="text-lg">Set up Ontriq</CardTitle>
            <CardDescription>
              {doneCount === items.length ? "Everything is in place." : `${doneCount} of ${items.length} done. Finish these to go live.`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="-my-1 px-3">
        <ul className="divide-y divide-border/70">
          {items.map((item) => {
            const Icon = item.icon;
            const body = (
              <div className="flex items-center gap-4 rounded-xl px-2 py-3 transition-colors group-hover:bg-muted/60">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl",
                    item.done ? "bg-success/12 text-success" : "bg-brand-orange/10 text-brand-orange-ink",
                  )}
                >
                  {item.done ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", item.done && "text-muted-foreground")}>{item.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{item.done ? "Done" : item.text}</p>
                </div>
                {!item.done && item.href ? (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
                ) : null}
              </div>
            );
            return (
              <li key={item.title}>
                {item.href && !item.done ? (
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
  await getStaffViewer();
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
        <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

async function MyWork() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "cases.read") && !can(viewer, "cases.read_assigned") && !can(viewer, "checks.verify")) return null;
  const work = await myWorkSummary(viewer.userId);
  const tiles: { label: string; value: number; sub: string; href: string; icon: LucideIcon; tone?: "warn" | "danger" }[] = [
    { label: "My cases", value: work.openCases, sub: "active cases you own", href: "/app/queues", icon: Briefcase },
    { label: "My checks", value: work.openChecks, sub: "checks still open", href: "/app/queues", icon: ListChecks },
    { label: "Due today", value: work.dueToday, sub: "by close of business", href: "/app/queues", icon: AlarmClock, tone: work.dueToday ? "warn" : undefined },
    { label: "Overdue", value: work.overdue, sub: work.overdue ? "past their due date" : "nothing late", href: "/app/queues?tab=overdue", icon: AlarmClock, tone: work.overdue ? "danger" : undefined },
  ];
  return (
    <section aria-label="My work" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "group rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07] transition hover:-translate-y-px hover:shadow-lift",
              t.tone === "danger" && "ring-destructive/25",
              t.tone === "warn" && "ring-warning/40",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.label}</span>
              <Icon className={cn("size-4 text-muted-foreground", t.tone === "danger" && "text-destructive", t.tone === "warn" && "text-warning")} />
            </div>
            <p className={cn("mt-2 font-display text-3xl leading-none font-semibold tabular-nums", t.tone === "danger" && "text-destructive")}>{t.value}</p>
            <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              {t.sub}
              <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
          </Link>
        );
      })}
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
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No active cases yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {ACTIVE_STAGES.map((stage) => {
              const n = counts[stage] ?? 0;
              return (
                <li key={stage}>
                  <Link href={`/app/cases?stage=${stage}`} className="group grid grid-cols-[minmax(0,10.5rem)_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="flex items-center gap-2 truncate text-muted-foreground group-hover:text-foreground">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[STAGE_TONES[stage]].dot)} />
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-[linear-gradient(90deg,#0c5a9a,#0098f3)] transition-all" style={{ width: `${n ? Math.max(4, (n / max) * 100) : 0}%` }} />
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
  const rows: { label: string; text: string; value: number; href: string; icon: LucideIcon }[] = [
    { label: "Manager queue", text: "Cases nobody owns", value: a.unassigned, href: "/app/queues?tab=unassigned", icon: Inbox },
    { label: "Returned by QC", text: "Waiting for corrections", value: a.returned, href: "/app/queues?tab=returned", icon: RotateCcw },
    { label: "Overdue", text: "Past their due date", value: a.overdue, href: "/app/queues?tab=overdue", icon: AlarmClock },
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
        <CardDescription>Work that is stuck, late or waiting for a manager.</CardDescription>
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

const DOES_CASEWORK = ["checks.verify", "checks.data_entry", "qc.pre", "qc.post"] as const;

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
        <CardDescription className="flex items-center gap-1">
          <TrendIcon trend={own.trend} /> {own.trend === "up" ? "Picking up" : own.trend === "down" ? "Slower than last week" : "Steady"}
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
