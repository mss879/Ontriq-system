import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SURFACE } from "@/components/admin/surface";
import { SetCrumbs } from "@/components/layout/crumbs";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { CheckStatePill, RESULT_TONE, StagePill, ToneChip } from "@/components/cases/badges";
import { SlaBadge } from "@/components/cases/sla-badge";
import { getStaffViewer } from "@/lib/server/viewer";
import { getCase, getCaseChecks, getDocuments, getRequirements, getTimeline, staffOptions } from "@/lib/server/cases/queries";
import { getDocumentCategories } from "@/lib/server/cases/detail-queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { can, type Permission } from "@/domain/permissions";
import { isTerminalCheck, STAGE_LABELS } from "@/domain/workflow/stages";
import { CheckIcon } from "../../_components/check-cards";
import { DocumentsPanel } from "../../_components/documents-panel";
import { Timeline } from "../../_components/timeline";
import { CheckForm } from "./check-form";
import { CheckAssignment, StatusPanel } from "./status-panel";
import { aiItem, getAiStatus, getAiWork, getCaseAi, getDocumentAi } from "@/lib/server/ai/queries";
import { canDecide } from "@/domain/ai/suggestions";
import { fixedAnnexureCategories } from "@/domain/reports/compile-core";
import type { OutreachResult, ResponseResult } from "@/lib/ai/prompts";
import { CheckAiPanel } from "@/components/ai/check-ai-panel";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Pick<PageProps<"/app/cases/[caseId]/checks/[checkId]">, "params">;

async function load(caseId: string, checkId: string) {
  if (!UUID.test(caseId) || !UUID.test(checkId)) return null;
  const c = await getCase(caseId);
  if (!c) return null;
  const checks = await getCaseChecks(caseId);
  const check = checks.find((k) => k.id === checkId);
  return check ? { c, check, checks } : null;
}

export async function generateMetadata({ params }: PageProps<"/app/cases/[caseId]/checks/[checkId]">): Promise<Metadata> {
  const { caseId, checkId } = await params;
  const data = await load(caseId, checkId);
  return { title: data ? `${data.check.label} · ${data.c.reference}` : "Check" };
}

export default function CheckPage({ params }: PageProps<"/app/cases/[caseId]/checks/[checkId]">) {
  return (
    <Page className="max-w-7xl">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-muted/60" aria-hidden />}>
        <Header params={params} />
      </Suspense>
      {/* Phones read top to bottom, so what you do with a check comes before its details. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <aside className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-1">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <Actions params={params} />
          </Suspense>
        </aside>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Section title="Details">
            <Suspense fallback={<SectionSkeleton rows={8} className="shadow-none ring-0" />}>
              <Form params={params} />
            </Suspense>
          </Section>
          <Section title="Documents">
            <Suspense fallback={<SectionSkeleton rows={4} className="shadow-none ring-0" />}>
              <Documents params={params} />
            </Suspense>
          </Section>
          <Section title="Notes and activity">
            <Suspense fallback={<SectionSkeleton rows={4} className="shadow-none ring-0" />}>
              <Notes params={params} />
            </Suspense>
          </Section>
        </div>
        <aside className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-2">
          <Suspense fallback={<SectionSkeleton rows={4} />}>
            <About params={params} />
          </Suspense>
        </aside>
      </div>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn(SURFACE, "p-5 md:p-6")}>
      <h2 className="mb-4 font-display text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

async function Header({ params }: Params) {
  const { caseId, checkId } = await params;
  const data = await load(caseId, checkId);
  if (!data) notFound();
  const { c, check } = data;
  const option = check.schema.result.options.find((o) => o.key === check.result);
  return (
    <header className="space-y-3">
      <SetCrumbs items={[{ label: c.reference, href: `/app/cases/${c.id}` }, { label: check.label }]} />
      <RealtimeRefresh
        sources={[
          { table: "case_checks", filter: `id=eq.${check.id}` },
          { table: "cases", filter: `id=eq.${c.id}` },
          { table: "documents", filter: `case_id=eq.${c.id}` },
          { table: "case_check_requirements", filter: `case_id=eq.${c.id}` },
          { table: "case_events", filter: `case_id=eq.${c.id}` },
          { table: "ai_suggestions", filter: `entity_id=eq.${check.id}` },
          { table: "jobs", filter: `entity_id=eq.${check.id}` },
        ]}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue dark:bg-brand-sky/10 dark:text-brand-sky">
            <CheckIcon icon={check.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight">{check.label}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {c.candidate.fullName} · {c.client.name}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CheckStatePill state={check.state} />
          {option && check.resultTone ? <ToneChip tone={RESULT_TONE[check.resultTone]}>{option.label}</ToneChip> : null}
          <StagePill stage={c.stage} onHold={c.onHold} />
          {!isTerminalCheck(check.state) ? <SlaBadge dueAt={check.dueAt} startedAt={check.startedAt ?? c.receivedAt} /> : null}
        </div>
      </div>
    </header>
  );
}

async function Form({ params }: Params) {
  const { caseId, checkId } = await params;
  const [viewer, data] = await Promise.all([getStaffViewer(), load(caseId, checkId)]);
  if (!data) return null;
  const { c, check } = data;
  const terminal = isTerminalCheck(check.state);
  const working = ["intake", "documents", "pre_qc", "data_entry", "verification"].includes(c.stage);
  const mayEdit = can(viewer, "cases.update") && (can(viewer, "checks.data_entry") || can(viewer, "checks.verify"));
  const editable = mayEdit && working && !terminal && !c.onHold;
  const manager = can(viewer, "cases.stage.change") || can(viewer, "cases.assign");
  const canVerify = can(viewer, "checks.verify") && (check.assignee?.id === viewer.userId || c.assignee?.id === viewer.userId || manager);
  const lockedReason = !mayEdit
    ? "You can read these details. Editing needs data entry or verification access."
    : c.onHold
      ? "The case is on hold. Resume it to edit."
      : !working
        ? `Details are locked at ${STAGE_LABELS[c.stage].toLowerCase()}.`
        : terminal
          ? "The outcome is recorded, so the details are locked. Reopen the check to change them."
          : undefined;
  const ai = await getCaseAi(caseId);
  const suggestions = (ai.checks[check.id]?.extract ?? []).flatMap((s) => (s.fieldKey ? [{ id: s.id, fieldKey: s.fieldKey, value: s.value, confidence: s.confidence, rationale: s.rationale }] : []));
  return (
    <CheckForm
      key={check.id}
      checkId={check.id}
      fields={check.schema.fields}
      stage={c.stage}
      initialValues={check.values}
      editable={editable}
      lockedReason={lockedReason}
      canReopen={terminal && c.stage === "verification" && canVerify && !c.onHold}
      suggestions={suggestions}
      canDecideAi={canDecide("document.extract", (p) => can(viewer, p as Permission))}
    />
  );
}

async function Documents({ params }: Params) {
  const { caseId, checkId } = await params;
  const [viewer, data] = await Promise.all([getStaffViewer(), load(caseId, checkId)]);
  if (!data) return null;
  const [reqs, docs, categories] = await Promise.all([getRequirements(caseId), getDocuments(caseId), getDocumentCategories()]);
  const docAi = await getDocumentAi(
    caseId,
    docs.map((d) => d.id),
  );
  return (
    <DocumentsPanel
      ai={docAi}
      canDismissAi={can(viewer, "cases.update") || can(viewer, "qc.pre")}
      caseId={caseId}
      checkId={checkId}
      requirements={reqs}
      documents={docs}
      categories={categories}
      checks={data.checks.map((k) => ({ id: k.id, label: k.label }))}
      fixedCategories={fixedAnnexureCategories(data.checks)}
      perms={{
        upload: can(viewer, "cases.update") || can(viewer, "candidates.manage"),
        review: can(viewer, "cases.update") || can(viewer, "qc.pre"),
        waive: can(viewer, "cases.stage.change") || can(viewer, "qc.pre"),
        request: can(viewer, "cases.update"),
        visibility: can(viewer, "documents.manage_visibility"),
      }}
      closed={data.c.stage === "released" || data.c.stage === "cancelled"}
    />
  );
}

async function Notes({ params }: Params) {
  const { caseId, checkId } = await params;
  const data = await load(caseId, checkId);
  if (!data) return null;
  const events = await getTimeline(caseId, 200);
  return <Timeline caseId={caseId} checkId={checkId} events={events} checks={data.checks.map((k) => ({ id: k.id, label: k.label }))} canNote />;
}

async function Actions({ params }: Params) {
  const { caseId, checkId } = await params;
  const [viewer, data] = await Promise.all([getStaffViewer(), load(caseId, checkId)]);
  if (!data) return null;
  const { c, check } = data;
  const manager = can(viewer, "cases.stage.change") || can(viewer, "cases.assign");
  const canVerify = can(viewer, "checks.verify") && (check.assignee?.id === viewer.userId || c.assignee?.id === viewer.userId || manager);
  return (
    <>
      <StatusPanel
        checkId={check.id}
        state={check.state}
        result={check.result}
        resultTone={check.resultTone}
        clientNote={check.clientNote}
        options={check.schema.result.options}
        stage={c.stage}
        onHold={c.onHold}
        valuesValid={check.valuesValid}
        canVerify={canVerify}
        canWaive={manager || can(viewer, "qc.post")}
      />
      <CheckAi caseId={caseId} checkId={checkId} canVerify={canVerify} />
    </>
  );
}

async function About({ params }: Params) {
  const { caseId, checkId } = await params;
  const [viewer, data] = await Promise.all([getStaffViewer(), load(caseId, checkId)]);
  if (!data) return null;
  const { c, check } = data;
  const canAssign = can(viewer, "cases.assign");
  const staff = canAssign ? await staffOptions() : [];
  const closed = c.stage === "released" || c.stage === "cancelled";
  return (
    <>
      <CheckAssignment checkId={check.id} assignee={check.assignee} staff={staff} canAssign={canAssign} closed={closed} />
      <section className={cn(SURFACE, "p-5")}>
        <h2 className="mb-2 text-sm font-semibold">About this check</h2>
        <dl className="divide-y text-sm">
          {[
            ["Definition", check.version ? `Version ${check.version}` : "Draft"],
            ["Due", formatDate(check.dueAt)],
            ["Started", formatDateTime(check.startedAt)],
            ["Completed", formatDateTime(check.completedAt)],
            ["Last change", formatDateTime(check.updatedAt)],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

/** Outreach draft, reply capture and drafted remarks for this check. */
async function CheckAi({ caseId, checkId, canVerify }: { caseId: string; checkId: string; canVerify: boolean }) {
  const [viewer, data, ai, status] = await Promise.all([getStaffViewer(), load(caseId, checkId), getCaseAi(caseId), getAiStatus()]);
  if (!data) return null;
  const { c, check } = data;
  const work = await getAiWork(caseId, [check.id]);
  const mine = ai.checks[check.id];
  const closed = c.stage === "released" || c.stage === "cancelled";
  return (
    <CheckAiPanel
      checkId={check.id}
      checkLabel={check.label}
      configured={status.configured}
      working={work.filter((w) => w.entityId === check.id).map((w) => w.kind)}
      outreach={aiItem<OutreachResult>(mine?.outreach)}
      response={aiItem<Partial<ResponseResult>>(mine?.response)}
      remarks={aiItem<{ text: string }>(mine?.remarks)}
      currentRemarks={check.clientNote}
      options={check.schema.result.options}
      canVerify={canVerify && !c.onHold}
      canRecord={canVerify && c.stage === "verification" && check.valuesValid && !isTerminalCheck(check.state) && !c.onHold}
      canRemarks={canDecide("report.narrative", (p) => can(viewer, p as Permission))}
      remarksLocked={["approval", "released", "cancelled"].includes(c.stage)}
      closed={closed}
    />
  );
}
