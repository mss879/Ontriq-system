import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CheckCircle2, ChevronLeft, CircleDashed, Download, Eye, FileCheck2, FileText, Hourglass, Mail, PauseCircle, UserRound } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { PriorityBadge, ResultBadge, ToneChip } from "@/components/cases/badges";
import { SlaBadge } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { PortalCheckState, PortalProgressRail, PortalStatusChip } from "@/components/portal/portal-badges";
import { getClientViewer } from "@/lib/server/viewer";
import { portalCaseDetail } from "@/lib/server/portal/queries";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PortalCaseDetail } from "@/domain/portal/types";
import { DocumentSlots } from "./document-slots";
import { PortalQuestions } from "./questions";
import { fieldDate } from "@/domain/reports/compile-core";
import { getPortalReport } from "@/lib/server/reports/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Pick<PageProps<"/portal/cases/[caseId]">, "params">;

async function load(params: Params["params"]): Promise<PortalCaseDetail> {
  const { caseId } = await params;
  await getClientViewer();
  const detail = UUID.test(caseId) ? await portalCaseDetail(caseId) : null;
  if (!detail) notFound();
  return detail;
}

export async function generateMetadata({ params }: PageProps<"/portal/cases/[caseId]">): Promise<Metadata> {
  const { caseId } = await params;
  const d = UUID.test(caseId) ? await portalCaseDetail(caseId) : null;
  // The reference only: candidate names stay out of tabs and history.
  return { title: d?.case.reference ?? "Case" };
}

export default function PortalCasePage({ params }: PageProps<"/portal/cases/[caseId]">) {
  return (
    <Page>
      <Suspense fallback={<HeaderSkeleton />}>
        <Header params={params} />
      </Suspense>
      {/* On a phone the report comes first: it is what a client opens this page for. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <ReportCard params={params} />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Suspense fallback={null}>
            <Asked params={params} />
          </Suspense>
          <Suspense fallback={null}>
            <Needed params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <Checks params={params} />
          </Suspense>
          <Suspense fallback={null}>
            <Documents params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={5} />}>
            <Timeline params={params} />
          </Suspense>
        </div>
        <aside className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-2">
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <Summary params={params} />
          </Suspense>
          <Suspense fallback={null}>
            <CandidateProgress params={params} />
          </Suspense>
        </aside>
      </div>
    </Page>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded-full bg-muted" />
    </div>
  );
}

function Section({ title, description, children, className, id }: { title: string; description?: string; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-28 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07] md:p-6", className)}>
      <div className="mb-4 space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

async function Header({ params }: Params) {
  const { case: c } = await load(params);
  return (
    <div className="space-y-3">
      <Link href="/portal/cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" /> Cases
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs tracking-wide text-muted-foreground">{c.reference}</p>
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-balance md:text-[1.75rem]">{c.candidate_name}</h1>
          <p className="text-sm text-muted-foreground">
            {[c.position_title, c.department, c.package_name].filter(Boolean).join(" · ") || "Background verification"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PortalStatusChip row={c} />
          <PriorityBadge priority={c.priority} />
          {c.stage === "released" && c.final_result ? <ResultBadge result={c.final_result} prefix="Result:" /> : null}
          {c.stage !== "released" && c.stage !== "cancelled" && c.due_at ? <SlaBadge dueAt={c.due_at} startedAt={c.received_at} /> : null}
        </div>
      </div>
      <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07] md:p-5">
        <PortalProgressRail stage={c.stage} onHold={c.on_hold} />
      </div>
      {c.on_hold ? (
        <p className="flex items-center gap-2.5 rounded-xl bg-warning/10 px-4 py-3 text-sm ring-1 ring-warning/25">
          <PauseCircle className="size-4 shrink-0 text-warning-foreground dark:text-warning" />
          Ontriq has put this case on hold. They will contact you if anything is needed.
        </p>
      ) : null}
      {c.stage === "cancelled" ? (
        <p className="flex items-center gap-2.5 rounded-xl bg-muted px-4 py-3 text-sm ring-1 ring-border">
          <Ban className="size-4 shrink-0 text-muted-foreground" /> This request was cancelled{c.cancelled_at ? ` on ${formatDate(c.cancelled_at)}` : ""}.
        </p>
      ) : null}
      {c.stage === "intake" ? (
        <p className="flex items-center gap-2.5 rounded-xl bg-info/8 px-4 py-3 text-sm ring-1 ring-info/20">
          <Hourglass className="size-4 shrink-0 text-info" /> Ontriq has your request and will confirm it shortly.
        </p>
      ) : null}
    </div>
  );
}

async function Asked({ params }: Params) {
  const d = await load(params);
  if (!d.questions.length) return null;
  const open = d.questions.filter((q) => q.status === "open").length;
  return (
    <Section
      id="questions"
      title="Questions from Ontriq"
      description={open ? `Ontriq needs ${open === 1 ? "an answer" : `${open} answers`} from you to continue.` : "Thank you. Ontriq has your answers."}
      className={open ? "ring-brand-orange/30" : undefined}
    >
      <PortalQuestions questions={d.questions} canAnswer={d.can_answer} />
    </Section>
  );
}

async function Needed({ params }: Params) {
  const d = await load(params);
  const slots = d.requirements.filter((r) => r.status !== "optional" || r.received_count > 0);
  if (!d.requirements.length && !d.can_upload) return null;
  const pending = d.requirements.filter((r) => r.status === "pending" && r.min_count > r.received_count).length;
  const fromCandidate = d.case.process_type === "candidate_collected";
  const title = pending && !fromCandidate ? "Documents we need from you" : "Documents";
  const description = fromCandidate
    ? pending
      ? `Ontriq is collecting ${pending === 1 ? "1 document" : `${pending} documents`} from the candidate. If you already have any of them, you can upload them here.`
      : "Every document Ontriq needs has arrived."
    : pending
      ? `${pending} ${pending === 1 ? "document is" : "documents are"} still needed before Ontriq can continue.`
      : slots.length
        ? "Everything Ontriq asked you for has arrived. Thank you."
        : "You can add a CV or any supporting document.";
  return (
    <Section id="documents-needed" title={title} description={description} className={pending && !fromCandidate ? "ring-brand-orange/30" : undefined}>
      <DocumentSlots caseId={d.case.id} requirements={d.requirements} canUpload={d.can_upload} fromCandidate={fromCandidate} />
    </Section>
  );
}

async function Checks({ params }: Params) {
  const d = await load(params);
  if (!d.visibility.show_check_progress) return null;
  return (
    <Section
      title="Checks"
      description={
        d.case.results_visible ? "Results for each check, as released by Ontriq." : "Each check's progress. Results appear here once Ontriq releases the report."
      }
    >
      {d.checks.length ? (
        <ul className="divide-y divide-border/70">
          {d.checks.map((k) => (
            <li key={k.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      k.state === "done" ? "bg-success/12 text-success" : k.state === "needs_information" ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {k.state === "done" ? <CheckCircle2 className="size-4" /> : <CircleDashed className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{k.label}</p>
                    {k.completed_at ? <p className="text-xs text-muted-foreground">Completed {formatDate(k.completed_at)}</p> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {k.result_tone ? <ResultBadge result={k.result_tone} label={k.result_label ?? undefined} /> : <PortalCheckState state={k.state} />}
                </div>
              </div>
              {k.client_note || k.fields.length ? (
                <div className="ml-11 space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
                  {k.client_note ? <p className="leading-relaxed">{k.client_note}</p> : null}
                  {k.fields.length ? (
                    <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      {k.fields.map((f) => (
                        <div key={f.label} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{f.label}</dt>
                          <dd className="break-words">{fieldText(f.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Ontriq will list the checks here.</p>
      )}
    </Section>
  );
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fieldDate(value) ?? value;
  if (Array.isArray(value)) return value.map(fieldText).join(", ");
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("from" in v || "to" in v) return `${fieldDate(v.from as string) ?? "?"} – ${fieldDate(v.to as string) ?? "present"}`;
    return Object.values(v).map(fieldText).join(", ");
  }
  return String(value);
}

const FROM_LABEL: Record<string, string> = { staff: "Ontriq", client: "You", candidate: "Candidate", system: "Ontriq" };

async function Documents({ params }: Params) {
  const d = await load(params);
  if (!d.visibility.show_documents || !d.documents.length) return null;
  return (
    <Section title="Shared documents" description="Files Ontriq shared with you, and the files you uploaded.">
      <ul className="divide-y divide-border/70">
        {d.documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
              {doc.status === "accepted" ? <FileCheck2 className="size-4" /> : <FileText className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{doc.filename}</p>
              <p className="truncate text-xs text-muted-foreground">
                {doc.label || doc.category_name || "Document"} · {FROM_LABEL[doc.from] ?? "Ontriq"} · {formatDate(doc.created_at)} · {formatBytes(doc.size)}
              </p>
              {doc.status === "rejected" ? (
                <p className="mt-1 text-xs text-destructive">Needs replacing{doc.rejection_reason ? `: ${doc.rejection_reason}` : ""}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="ghost" size="icon-sm" aria-label={`View ${doc.filename}`}>
                <a href={`/api/files/${doc.id}`} target="_blank" rel="noopener noreferrer">
                  <Eye />
                </a>
              </Button>
              <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${doc.filename}`}>
                <a href={`/api/files/${doc.id}?download=1`}>
                  <Download />
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

async function Timeline({ params }: Params) {
  const d = await load(params);
  if (!d.visibility.show_timeline) return null;
  return (
    <Section title="Activity">
      {d.timeline.length ? (
        <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
          {d.timeline.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pl-6">
              <span aria-hidden className={cn("absolute top-1.5 left-0 size-[11px] rounded-full ring-4 ring-card", i === 0 ? "bg-brand-orange" : "bg-muted-foreground/40")} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{e.title}</p>
                {e.body ? <p className="mt-0.5 text-sm text-muted-foreground">{e.body}</p> : null}
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Updates appear here as Ontriq works on the case.</p>
      )}
    </Section>
  );
}

async function ReportCard({ params }: Params) {
  const { report, case: c } = await load(params);
  // A released report stays available while a revision is prepared.
  const file = await getPortalReport(c.id);
  const revising = Boolean(file) && report.status !== "released";
  const tone = report.status === "released" ? "success" : revising ? "warning" : report.status === "in_preparation" ? "progress" : "neutral";
  const label = revising ? "Being revised" : { released: "Released", in_preparation: "In preparation", not_ready: "Not ready yet", cancelled: "Cancelled" }[report.status];
  return (
    <section className={cn("rounded-2xl p-5 shadow-soft ring-1", report.status === "released" ? "bg-success/6 ring-success/25" : "bg-card ring-foreground/[0.07]")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Report</h2>
        <ToneChip tone={tone}>{label}</ToneChip>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {revising
          ? "Ontriq is revising this report. The version below stays yours until the new one is released."
          : report.status === "released"
          ? file
            ? `Released on ${formatDate(file.releasedAt ?? report.released_at)}${file.version > 2 ? " (revised)" : ""}${file.pageCount ? ` · ${file.pageCount} pages` : ""}.`
            : `Ontriq released the report on ${formatDate(report.released_at)} to the people your company named. Ask your Ontriq contact if you need a copy.`
          : report.status === "cancelled"
            ? "No report will be issued for a cancelled request."
            : report.status === "in_preparation"
              ? "Ontriq is preparing and approving the report. You can download it here as soon as it's released."
              : "Your report will be available here once Ontriq releases it."}
      </p>
      {c.stage === "released" && c.final_result ? <ResultBadge result={c.final_result} prefix="Overall:" className="mt-3" /> : null}
      {file ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={`/api/reports/${file.versionId}?download=1`}>
              <Download /> Download PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/${file.versionId}`} target="_blank" rel="noreferrer">
              <Eye /> Open
            </a>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

async function Summary({ params }: Params) {
  const { case: c, visibility } = await load(params);
  const rows: [string, React.ReactNode][] = [
    ["Candidate", c.candidate.full_name],
    ...(visibility.show_candidate_details
      ? ([
          ["NIC", c.candidate.nic ? <span className="font-mono">{c.candidate.nic}</span> : "—"],
          ["Email", c.candidate.email ?? "—"],
          ["Phone", c.candidate.phone ?? "—"],
        ] as [string, React.ReactNode][])
      : []),
    ["Package", c.package.name ?? "—"],
    ["Documents", c.process_type === "client_supplied" ? "Sent by you" : "Collected by Ontriq"],
    ["Your reference", c.client_reference ?? "—"],
    ["Received", formatDate(c.received_at)],
    [c.stage === "released" ? "Released" : "Target date", formatDate(c.stage === "released" ? c.released_at : c.due_at)],
  ];
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <h2 className="font-display text-base font-semibold">Request details</h2>
      <dl className="mt-3 space-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {c.instructions ? (
        <div className="mt-4 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Your instructions</p>
          <p className="mt-1 leading-relaxed whitespace-pre-line">{c.instructions}</p>
        </div>
      ) : null}
    </section>
  );
}

async function CandidateProgress({ params }: Params) {
  const d = await load(params);
  const p = d.candidate_progress;
  if (!p) return null;
  const steps = [
    { done: Boolean(p.invited_at), label: p.invited_at ? `Invited ${formatDate(p.invited_at)}` : "Not invited yet", icon: Mail },
    { done: p.opened, label: p.opened ? "Opened their secure page" : "Hasn't opened their page yet", icon: UserRound },
    { done: p.consent, label: p.consent ? "Signed the consent form" : "Consent not signed yet", icon: FileCheck2 },
  ];
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <h2 className="font-display text-base font-semibold">Candidate</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ontriq is collecting documents directly from the candidate.</p>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-sm">
            <span className={cn("flex size-6 items-center justify-center rounded-full", s.done ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")}>
              <s.icon className="size-3.5" />
            </span>
            <span className={cn(!s.done && "text-muted-foreground")}>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
