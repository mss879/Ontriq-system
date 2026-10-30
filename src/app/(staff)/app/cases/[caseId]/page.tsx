import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, PauseCircle, RotateCcw, ShieldCheck, ShieldOff } from "lucide-react";
import { SURFACE } from "@/components/admin/surface";
import { SetCrumbs } from "@/components/layout/crumbs";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { SectionBoundary } from "@/components/layout/section-boundary";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PriorityBadge, ProcessTypeBadge, ResultBadge, shownResult, StagePill, statusNote, ToneChip } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { RelativeTime, SlaBadge } from "@/components/cases/sla-badge";
import { getStaffViewer } from "@/lib/server/viewer";
import { getAssignments, getCase, getCaseChecks, getDocuments, getQcReviews, getRequirements, getStageDates, getTimeline, staffOptions } from "@/lib/server/cases/queries";
import { getDocumentCategories } from "@/lib/server/cases/detail-queries";
import { consentMissing, getCandidatePanel } from "@/lib/server/cases/candidate-queries";
import { can, type Permission } from "@/domain/permissions";
import { availableActions } from "@/domain/workflow/transitions-core";
import { CaseActions } from "./_components/case-actions";
import { EraseCaseDialog } from "./_components/erase-dialog";
import { CheckCards } from "./_components/check-cards";
import { CaseSectionsBar, type SectionLink } from "./_components/case-sections-bar";
import { StageRail } from "./_components/stage-rail";
import { DocumentsPanel } from "./_components/documents-panel";
import { Timeline } from "./_components/timeline";
import { AssignmentCard } from "./_components/assignment-card";
import { CandidateCard, DetailsCard } from "./_components/info-cards";
import { CandidatePanel } from "./_components/candidate-panel";
import { ReportPanel } from "./_components/report-panel";
import { getMissingAnnexures, getReleaseRecipients, getReportVersions, getUnreportedEvidence } from "@/lib/server/reports/queries";
import { getCheckTypeOptions, getClientQuestions, getContactLog } from "@/lib/server/cases/detail-queries";
import { AddCheck } from "./_components/add-check";
import { ClientQuestions } from "./_components/client-questions";
import { ContactLogSection } from "./_components/contact-log-section";
import { validateCheckValues } from "@/domain/check-types/validate";
import type { FieldDef } from "@/domain/check-types/schema";
import { fixedAnnexureCategories } from "@/domain/reports/compile-core";
import { aiItem, getAiStatus, getAiWork, getCaseAi, getDocumentAi } from "@/lib/server/ai/queries";
import { canDecide, canRerun, RERUN, type RerunCapability } from "@/domain/ai/suggestions";
import type { ConsistencyResult, PostQcResult, PreQcResult } from "@/lib/ai/prompts";
import { CaseCopilot } from "@/components/ai/case-copilot";
import { AiOffNote } from "@/components/ai/ai-badge";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCase(caseId: string) {
  return UUID.test(caseId) ? getCase(caseId) : null;
}

export async function generateMetadata({ params }: PageProps<"/app/cases/[caseId]">): Promise<Metadata> {
  const { caseId } = await params;
  const c = await loadCase(caseId);
  // Titles carry the reference only: candidate names stay out of tabs and history.
  return { title: c?.reference ?? "Case" };
}

export default function CasePage({ params }: PageProps<"/app/cases/[caseId]">) {
  return (
    <Page className="max-w-7xl">
      <Suspense fallback={<HeaderSkeleton />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<div className="-mt-5 h-11" aria-hidden />}>
        <SectionsBar params={params} />
      </Suspense>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <SectionBoundary label="the report">
            <Suspense fallback={null}>
              <Report params={params} />
            </Suspense>
          </SectionBoundary>
          <SectionBoundary label="AI suggestions">
            <Suspense fallback={<SectionSkeleton rows={3} />}>
              <Copilot params={params} />
            </Suspense>
          </SectionBoundary>
          <Section
            title="Checks"
            id="checks"
            action={
              <Suspense fallback={null}>
                <AddCheckButton params={params} />
              </Suspense>
            }
          >
            <Suspense fallback={<SectionSkeleton rows={4} className="shadow-none ring-0" />}>
              <Checks params={params} />
            </Suspense>
          </Section>
          <Section title="Documents" id="documents">
            <Suspense fallback={<SectionSkeleton rows={5} className="shadow-none ring-0" />}>
              <Documents params={params} />
            </Suspense>
          </Section>
          <Section title="Questions for the client" id="questions">
            <Suspense fallback={<SectionSkeleton rows={2} className="shadow-none ring-0" />}>
              <Questions params={params} />
            </Suspense>
          </Section>
          <Section title="Candidate" id="candidate">
            <Suspense fallback={<SectionSkeleton rows={4} className="shadow-none ring-0" />}>
              <Candidate params={params} />
            </Suspense>
          </Section>
          <Section title="Contact log" id="contacts">
            <Suspense fallback={<SectionSkeleton rows={2} className="shadow-none ring-0" />}>
              <Contacts params={params} />
            </Suspense>
          </Section>
          <Section title="Activity" id="activity">
            <Suspense fallback={<SectionSkeleton rows={6} className="shadow-none ring-0" />}>
              <Activity params={params} />
            </Suspense>
          </Section>
        </div>
        <aside id="details" className="min-w-0 scroll-mt-32 space-y-5">
          <Suspense fallback={<SectionSkeleton rows={3} />}>
            <Owner params={params} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton rows={6} />}>
            <People params={params} />
          </Suspense>
          <Suspense fallback={null}>
            <QcHistory params={params} />
          </Suspense>
        </aside>
      </div>
    </Page>
  );
}

function Section({ title, id, children, action }: { title: string; id?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className={cn(SURFACE, "scroll-mt-32 p-5 md:p-6")}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="h-7 w-full animate-pulse rounded-full bg-muted" />
    </div>
  );
}

type Params = Pick<PageProps<"/app/cases/[caseId]">, "params">;

async function Header({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) notFound();
  const [checks, reqs, candidate] = await Promise.all([getCaseChecks(caseId), getRequirements(caseId), getCandidatePanel(caseId)]);
  const missing = (stageFilter: (s: string) => boolean) => reqs.filter((r) => r.status === "pending" && r.minCount > r.receivedCount && stageFilter(r.stage)).length;
  // Mirrors public.case_transition: a document for an open or waived check doesn't hold the case back.
  const closedChecks = new Set(checks.filter((k) => k.state === "completed" || k.state === "discrepancy" || k.state === "unable_to_verify").map((k) => k.id));
  const actions = availableActions(
    {
      stage: c.stage,
      onHold: c.onHold,
      documentsOutstanding: missing((s) => s === "documents"),
      verificationDocumentsOutstanding: reqs.filter((r) => r.status === "pending" && r.minCount > r.receivedCount && (!r.caseCheckId || closedChecks.has(r.caseCheckId))).length,
      checks: checks.map((k) => ({ state: k.state, entryReady: k.valuesValid || validateCheckValues(k.schema.fields, k.values, "entry").ok })),
      annexuresMissing: c.stage === "verification" ? await getMissingAnnexures(caseId) : [],
      isOwner: c.assignee?.id === viewer.userId,
      consentMissing: consentMissing(candidate, c.processType),
    },
    (p) => can(viewer, p as Permission),
  );
  const closed = c.stage === "released" || c.stage === "cancelled";
  const stageDates = await getStageDates(caseId);
  const result = shownResult(c);
  const note = statusNote(c.statusKey);

  return (
    <header className="space-y-3">
      <SetCrumbs items={[{ label: c.reference }]} />
      <RealtimeRefresh
        sources={[
          { table: "cases", filter: `id=eq.${c.id}` },
          { table: "case_checks", filter: `case_id=eq.${c.id}` },
          { table: "case_events", filter: `case_id=eq.${c.id}` },
          { table: "documents", filter: `case_id=eq.${c.id}` },
          { table: "case_check_requirements", filter: `case_id=eq.${c.id}` },
          { table: "candidate_requests", filter: `case_id=eq.${c.id}` },
          { table: "candidate_messages", filter: `case_id=eq.${c.id}` },
          { table: "consent_forms", filter: `case_id=eq.${c.id}` },
          { table: "report_versions", filter: `case_id=eq.${c.id}` },
        ]}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight md:text-[1.75rem]">{c.reference}</h1>
            <PriorityBadge priority={c.priority} />
          </div>
          <p className="text-base">
            <span className="font-medium">{c.candidate.fullName}</span>
            {c.positionTitle ? <span className="text-muted-foreground"> · {c.positionTitle}</span> : null}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Link href={`/app/clients/${c.client.id}`} className="font-medium text-foreground hover:underline">
              {c.client.name}
            </Link>
            <span aria-hidden>·</span>
            <span>{c.package.name}</span>
            <ProcessTypeBadge type={c.processType} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {note ? (
            <ToneChip tone={c.statusKey === "returned_for_correction" ? "warning" : "neutral"} dot={false}>
              {note}
            </ToneChip>
          ) : null}
          {result ? <ResultBadge result={result} prefix={c.finalResult ? "Result:" : "Proposed:"} /> : null}
          {!closed && c.stage !== "report" && c.stage !== "approval" ? <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} /> : null}
          <PersonChip person={c.assignee} empty="Manager queue" className="max-w-44" />
        </div>
      </div>

      {c.onHold ? (
        <Banner tone="warning" icon={<PauseCircle className="size-4" />} title="On hold">
          {c.holdReason}
        </Banner>
      ) : null}
      {c.returnedAt && !c.onHold && !closed ? (
        <Banner tone="warning" icon={<RotateCcw className="size-4" />} title="Returned for correction">
          {c.returnNote}
          <span className="ml-1 text-xs opacity-80">
            <RelativeTime iso={c.returnedAt} />
          </span>
        </Banner>
      ) : null}
      {c.stage === "cancelled" && !c.erasedAt ? (
        <Banner tone="danger" icon={<Ban className="size-4" />} title="Cancelled">
          {c.cancelReason}
        </Banner>
      ) : null}
      {c.erasedAt ? (
        <Banner tone="warning" icon={<ShieldOff className="size-4" />} title="Personal data erased">
          The candidate&apos;s details and files were erased on {new Date(c.erasedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" })}. The
          reference, results and invoices are kept.
        </Banner>
      ) : null}

      <div className={cn(SURFACE, "px-4 py-3.5 sm:px-3")}>
        <StageRail stage={c.stage} returned={Boolean(c.returnedAt)} onHold={c.onHold} enteredAt={stageDates} />
      </div>
      <CaseActions
        caseId={c.id}
        stage={c.stage}
        processType={c.processType}
        actions={actions}
        checks={checks.map((k) => ({ id: k.id, label: k.label, state: k.state }))}
      />
      {closed && !c.erasedAt && viewer.roleKey === "super_admin" ? (
        <div className="flex justify-end">
          <EraseCaseDialog caseId={c.id} reference={c.reference} />
        </div>
      ) : null}
    </header>
  );
}

/** Jump links: what is on this page, and how much of it is finished. */
async function SectionsBar({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const canReport = can(viewer, "reports.preview");
  const [reqs, versions] = await Promise.all([getRequirements(caseId), canReport ? getReportVersions(caseId) : null]);
  const missing = reqs.filter((r) => r.status === "pending" && r.minCount > r.receivedCount).length;
  const closed = c.stage === "released" || c.stage === "cancelled";
  const atReport = canReport && (c.stage === "report" || c.stage === "approval" || c.stage === "released" || Boolean(versions?.versions.length));
  const links: SectionLink[] = [
    ...(atReport ? [{ href: "#report", label: "Report" }] : []),
    { href: "#checks", label: "Checks", note: `${c.checksDone}/${c.checksTotal}` },
    { href: "#documents", label: "Documents", note: missing ? `${missing} missing` : undefined, alert: missing > 0 },
    { href: "#questions", label: "Questions" },
    { href: "#candidate", label: "Candidate" },
    { href: "#contacts", label: "Contacts" },
    { href: "#activity", label: "Activity" },
    { href: "#details", label: "Details", phoneOnly: true },
  ];
  return (
    <CaseSectionsBar
      reference={c.reference}
      candidate={c.candidate.fullName}
      links={links}
      status={
        <>
          <StagePill stage={c.stage} onHold={c.onHold} />
          {!closed ? <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} compact /> : null}
        </>
      }
    />
  );
}

function Banner({ tone, icon, title, children }: { tone: "warning" | "danger"; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      className={
        tone === "warning"
          ? "flex gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          : "flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
      }
    >
      <span className={tone === "warning" ? "mt-0.5 text-warning-foreground dark:text-warning" : "mt-0.5 text-destructive"}>{icon}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children ? <p className="text-muted-foreground">{children}</p> : null}
      </div>
    </div>
  );
}

/** The final report: shown once the case reaches the report stage, or whenever a version exists. */
async function Report({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c || !can(viewer, "reports.preview")) return null;
  const { versions, draftSummary } = await getReportVersions(caseId);
  const atReport = c.stage === "report" || c.stage === "approval" || c.stage === "released";
  if (!atReport && !versions.length) return null;
  const [missingAnnexures, unreported, checks] = await Promise.all([
    c.stage === "report" ? getMissingAnnexures(caseId) : [],
    c.stage === "report" ? getUnreportedEvidence(caseId) : [],
    getCaseChecks(caseId),
  ]);
  const canRelease = can(viewer, "reports.release");
  const recipients = canRelease && c.stage === "approval" ? await getReleaseRecipients(c.client.id) : [];
  return (
    <Section title="Report" id="report">
      <ReportPanel
        caseId={caseId}
        stage={c.stage}
        onHold={c.onHold}
        clientName={c.client.name}
        versions={versions}
        summary={draftSummary}
        recipients={recipients}
        missingAnnexures={missingAnnexures}
        unreported={unreported}
        closedChecks={checks.filter((k) => k.state === "completed" || k.state === "discrepancy" || k.state === "unable_to_verify").map((k) => ({ id: k.id, label: k.label }))}
        canReturn={can(viewer, "cases.stage.change") || can(viewer, "reports.approve") || can(viewer, "qc.post")}
        perms={{
          preview: can(viewer, "cases.stage.change") || can(viewer, "reports.approve") || c.assignee?.id === viewer.userId,
          approve: can(viewer, "reports.approve"),
          release: canRelease,
          superAdmin: viewer.roleKey === "super_admin",
        }}
        viewerId={viewer.userId}
      />
    </Section>
  );
}

/** The AI copilot: consistency, Pre-QC and Post-QC reviews and drafted remarks, each for a person to decide. */
async function Copilot({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const [ai, status, checks, docs] = await Promise.all([getCaseAi(caseId), getAiStatus(), getCaseChecks(caseId), getDocuments(caseId)]);
  const work = await getAiWork(caseId, [...checks.map((k) => k.id), ...docs.map((d) => d.id)]);
  const may = (p: string) => can(viewer, p as Permission);
  const remarks = checks.flatMap((k) => {
    const item = aiItem<{ text: string }>(ai.checks[k.id]?.remarks);
    return item ? [{ ...item, checkId: k.id, checkLabel: k.label, current: k.clientNote }] : [];
  });
  const data = {
    consistency: aiItem<ConsistencyResult>(ai.consistency),
    preqc: aiItem<PreQcResult>(ai.preqc),
    postqc: aiItem<PostQcResult>(ai.postqc),
    summary: aiItem<{ text: string }>(ai.summary),
    remarks,
  };
  const working = [...new Set(work.filter((w) => w.entityId === caseId || !w.entityId).map((w) => w.kind))];
  const has = Boolean(data.consistency || data.preqc || data.postqc || data.summary || remarks.length || working.length);
  const live = (
    <RealtimeRefresh
      sources={[
        { table: "ai_suggestions", filter: `entity_id=in.(${[caseId, ...checks.map((k) => k.id), ...docs.map((d) => d.id)].slice(0, 100).join(",")})` },
        { table: "jobs", filter: `entity_id=eq.${caseId}` },
      ]}
    />
  );
  if (!status.configured && !has) {
    return (
      <>
        {live}
        {can(viewer, "ai.configure") ? (
          <AiOffNote className="px-1">
            AI isn&apos;t switched on, so suggestions won&apos;t appear here.{" "}
            <Link href="/app/settings/ai" className="underline underline-offset-2 hover:text-foreground">
              Set it up
            </Link>
          </AiOffNote>
        ) : null}
      </>
    );
  }
  const closed = c.stage === "released" || c.stage === "cancelled";
  const rerun = Object.fromEntries((Object.keys(RERUN) as RerunCapability[]).map((k) => [k, !closed && canRerun(k, c.stage, c.onHold, may)]));
  const askCandidate = !closed && (may("candidates.requests") || may("cases.update"));
  const [candidate, categories] = askCandidate ? await Promise.all([getCandidatePanel(caseId), getDocumentCategories()]) : [null, await getDocumentCategories()];
  return (
    <Section title="AI copilot" id="ai">
      {live}
      <CaseCopilot
        caseId={caseId}
        data={data}
        configured={status.configured}
        working={working}
        perms={{
          rerun,
          pre: canDecide("case.preqc", may),
          post: canDecide("case.postqc", may),
          remarks: canDecide("report.narrative", may),
          askCandidate,
          requestClient: !closed && may("cases.update"),
        }}
        remarksLocked={["approval", "released", "cancelled"].includes(c.stage)}
        candidate={
          candidate
            ? {
                checks: checks.map((k) => ({
                  id: k.id,
                  label: k.label,
                  fields: askableFields(k.schema.fields),
                })),
                categories: categories.filter((cat) => !STAFF_ONLY_CATEGORIES.has(cat.key)),
                linkActive: candidate.link?.state === "active",
              }
            : null
        }
        request={{ categories, checks: checks.map((k) => ({ id: k.id, label: k.label })) }}
      />
    </Section>
  );
}

async function Checks({ params }: Params) {
  const { caseId } = await params;
  const c = await loadCase(caseId);
  if (!c) return null;
  const [checks, ai] = await Promise.all([getCaseChecks(caseId), getCaseAi(caseId)]);
  return <CheckCards caseId={caseId} checks={checks} stage={c.stage} receivedAt={c.receivedAt} found={Object.fromEntries(Object.entries(ai.checks).map(([id, k]) => [id, k.extract.length]))} />;
}

const OPEN_FOR_CHECKS = ["intake", "documents", "pre_qc", "data_entry", "verification"];

async function AddCheckButton({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c || !can(viewer, "cases.stage.change") || !OPEN_FOR_CHECKS.includes(c.stage) || c.onHold) return null;
  return <AddCheck caseId={caseId} types={await getCheckTypeOptions()} />;
}

async function Questions({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const closed = c.stage === "released" || c.stage === "cancelled";
  return <ClientQuestions caseId={caseId} questions={await getClientQuestions(caseId)} canAsk={!closed && can(viewer, "cases.update")} clientName={c.client.name || "The client"} />;
}

async function Contacts({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const [entries, checks] = await Promise.all([getContactLog(caseId), getCaseChecks(caseId)]);
  const labels = Object.fromEntries(checks.map((k) => [k.id, k.label]));
  return <ContactLogSection caseId={caseId} entries={entries} canLog={can(viewer, "cases.update") || can(viewer, "checks.verify")} labels={labels} candidate={c.candidate.fullName} />;
}

async function Documents({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const [reqs, docs, categories, checks] = await Promise.all([getRequirements(caseId), getDocuments(caseId), getDocumentCategories(), getCaseChecks(caseId)]);
  const docAi = await getDocumentAi(
    caseId,
    docs.map((d) => d.id),
  );
  return (
    <DocumentsPanel
      ai={docAi}
      canDismissAi={can(viewer, "cases.update") || can(viewer, "qc.pre")}
      caseId={caseId}
      requirements={reqs}
      documents={docs}
      categories={categories}
      checks={checks.map((k) => ({ id: k.id, label: k.label }))}
      fixedCategories={fixedAnnexureCategories(checks)}
      perms={{
        upload: can(viewer, "cases.update") || can(viewer, "candidates.manage"),
        review: can(viewer, "cases.update") || can(viewer, "qc.pre"),
        waive: can(viewer, "cases.stage.change") || can(viewer, "qc.pre"),
        request: can(viewer, "cases.update"),
        visibility: can(viewer, "documents.manage_visibility"),
      }}
      closed={c.stage === "released" || c.stage === "cancelled"}
    />
  );
}

/** Categories only Ontriq staff provide (public.candidate_providable in 0041). */
const STAFF_ONLY_CATEGORIES = new Set(["field_verification", "sanction_report", "consent_form"]);

/** What a candidate can be asked to fill in: single details, and rows of a group they can fill. */
const askableFields = (fields: FieldDef[]) =>
  fields
    .filter((f) => f.type !== "repeatable_group" || (f.fields ?? []).some((s) => s.fill_by?.includes("candidate")))
    .map((f) => ({ key: f.key, label: f.label, type: f.type, help: f.help ?? undefined }));

async function Candidate({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const [data, checks, categories, docs] = await Promise.all([getCandidatePanel(caseId), getCaseChecks(caseId), getDocumentCategories(), getDocuments(caseId)]);
  const canManage = can(viewer, "candidates.requests") || can(viewer, "cases.update");
  return (
    <CandidatePanel
      caseId={caseId}
      data={data}
      contact={{ email: c.candidate.email, phone: c.candidate.phone, preferredLanguage: (["si", "ta"].includes(c.candidate.preferredLanguage) ? c.candidate.preferredLanguage : "en") as "en" | "si" | "ta" }}
      checks={checks.map((k) => ({
        id: k.id,
        label: k.label,
        fields: askableFields(k.schema.fields),
      }))}
      categories={categories.filter((cat) => !STAFF_ONLY_CATEGORIES.has(cat.key))}
      consentDocuments={docs.filter((d) => d.category === "consent_form" && (d.status === "uploaded" || d.status === "accepted")).map((d) => ({ id: d.id, filename: d.filename, createdAt: d.createdAt }))}
      canManage={canManage}
      canReviewConsent={canManage && (can(viewer, "cases.update") || can(viewer, "qc.pre"))}
      closed={c.stage === "released" || c.stage === "cancelled"}
      candidateCollected={c.processType === "candidate_collected"}
    />
  );
}

async function Activity({ params }: Params) {
  const { caseId } = await params;
  const c = await loadCase(caseId);
  if (!c) return null;
  const [events, checks] = await Promise.all([getTimeline(caseId), getCaseChecks(caseId)]);
  return <Timeline caseId={caseId} events={events} checks={checks.map((k) => ({ id: k.id, label: k.label }))} canNote />;
}

async function Owner({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const canAssign = can(viewer, "cases.assign");
  const [history, staff] = await Promise.all([getAssignments(caseId), canAssign ? staffOptions() : Promise.resolve([])]);
  const explanation = history.find((h) => !h.caseCheckId && h.mode !== "manual")?.explanation ?? null;
  return (
    <AssignmentCard
      caseId={caseId}
      owner={c.assignee}
      explanation={c.assignee ? (history.find((h) => !h.caseCheckId && h.assignee?.id === c.assignee?.id)?.explanation ?? null) : explanation}
      history={history}
      staff={staff}
      canAssign={canAssign}
      closed={c.stage === "released" || c.stage === "cancelled"}
    />
  );
}

async function People({ params }: Params) {
  const { caseId } = await params;
  const [viewer, c] = await Promise.all([getStaffViewer(), loadCase(caseId)]);
  if (!c) return null;
  const closed = c.stage === "released" || c.stage === "cancelled";
  return (
    <>
      <CandidateCard candidate={c.candidate} canEdit={!closed && (can(viewer, "candidates.manage") || can(viewer, "cases.update"))} />
      <DetailsCard
        caseId={caseId}
        details={{
          priority: c.priority,
          positionTitle: c.positionTitle,
          department: c.department,
          clientReference: c.clientReference,
          instructions: c.instructions,
          receivedAt: c.receivedAt,
          dueAt: c.dueAt,
          processType: c.processType,
          createdVia: c.createdVia,
          package: c.package,
          clientVisible: c.clientVisible,
        }}
        canEdit={!closed && can(viewer, "cases.update")}
        canSetDue={can(viewer, "cases.assign")}
        canHide={can(viewer, "documents.manage_visibility")}
      />
    </>
  );
}

async function QcHistory({ params }: Params) {
  const { caseId } = await params;
  const c = await loadCase(caseId);
  if (!c) return null;
  const [reviews, checks] = await Promise.all([getQcReviews(caseId), getCaseChecks(caseId)]);
  if (!reviews.length) return null;
  const label = (id: string) => checks.find((k) => k.id === id)?.label ?? "a check";
  return (
    <section className={cn(SURFACE, "p-5")}>
      <h2 className="mb-3 text-sm font-semibold">Quality reviews</h2>
      <ol className="space-y-4">
        {reviews.map((r) => (
          <li key={r.id} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-4 text-brand-blue dark:text-brand-sky" aria-hidden />
              <span className="text-sm font-medium">{r.kind === "pre" ? "Pre-QC" : "Post-QC"}</span>
              <ToneChip tone={r.decision === "approved" ? "success" : "warning"}>{r.decision === "approved" ? "Approved" : "Returned"}</ToneChip>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.reviewer?.name ?? "Someone"} · <RelativeTime iso={r.at} />
            </p>
            {r.remarks ? <p className="text-sm">{r.remarks}</p> : null}
            {r.returnedCheckIds.length ? <p className="text-xs text-muted-foreground">Reopened: {r.returnedCheckIds.map(label).join(", ")}</p> : null}
            {r.checklist.length ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {r.checklist.map((item) => (
                  <li key={item.item} className="flex gap-1.5">
                    <span aria-hidden className={item.ok ? "text-success" : "text-muted-foreground/60"}>
                      {item.ok ? "✓" : "–"}
                    </span>
                    <span className={item.ok ? undefined : "line-through opacity-70"}>{item.item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
