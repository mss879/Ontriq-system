"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Download, ExternalLink, FilePlus2, FileText, PenLine, RotateCcw, Send, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { generateReportDraft, returnReport, reviseReport, sendReportForApproval } from "../report-actions";
import { cn } from "@/lib/utils";
import { formatBytes, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ResultBadge, ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import type { Stage, Tone } from "@/domain/workflow/stages";
import type { DraftSummary, ReleaseRecipient, ReportStatus, ReportVersion } from "@/lib/server/reports/queries";
import { ReasonDialog } from "./reason-dialog";
import { ApproveDialog, ReleaseDialog } from "./report-dialogs";

const STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "progress" },
  rendering: { label: "Generating", tone: "progress" },
  ready: { label: "Ready", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
  released: { label: "Released", tone: "success" },
};

export type ReportPerms = { preview: boolean; approve: boolean; release: boolean; superAdmin: boolean };

/**
 * The case's report: what to do next at this stage, and every version made.
 * Drafts carry a watermark; the final is made from the approved draft and
 * released by a second person (Super Admin excepted).
 */
export function ReportPanel({
  caseId,
  stage,
  onHold,
  clientName,
  versions,
  summary,
  recipients,
  missingAnnexures,
  perms,
  viewerId,
}: {
  caseId: string;
  stage: Stage;
  onHold: boolean;
  clientName: string;
  versions: ReportVersion[];
  summary: DraftSummary | null;
  recipients: ReleaseRecipient[];
  /** Checks whose fixed annexure has no file yet. */
  missingAnnexures: string[];
  perms: ReportPerms;
  viewerId: string;
}) {
  const latest = versions[0] ?? null;
  const busy = latest?.status === "queued" || latest?.status === "rendering";
  return (
    <div className="space-y-5">
      <NextStep caseId={caseId} stage={stage} onHold={onHold} clientName={clientName} latest={latest} summary={summary} recipients={recipients} missingAnnexures={missingAnnexures} perms={perms} viewerId={viewerId} />
      {versions.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Versions</p>
          <ul className="divide-y rounded-xl border">
            {versions.map((v) => (
              <VersionRow key={v.id} v={v} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <FileText className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium">No report yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {stage === "report" ? "Generate a draft to check how the report reads before it goes for approval." : "The report is drafted once verification and Post-QC are done."}
          </p>
        </div>
      )}
      {busy && latest ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Spinner className="size-3.5" /> Generating {latest.kind === "draft" ? "the draft" : "the final report"}. This page updates by itself when it’s ready.
        </p>
      ) : null}
    </div>
  );
}

function NextStep({
  caseId,
  stage,
  onHold,
  clientName,
  latest,
  summary,
  recipients,
  missingAnnexures,
  perms,
  viewerId,
}: {
  caseId: string;
  stage: Stage;
  onHold: boolean;
  clientName: string;
  latest: ReportVersion | null;
  summary: DraftSummary | null;
  recipients: ReleaseRecipient[];
  /** Checks whose fixed annexure has no file yet. */
  missingAnnexures: string[];
  perms: ReportPerms;
  viewerId: string;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<"approve" | "release" | "return" | "revise" | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });

  if (onHold && stage !== "released") {
    return <Callout tone="warning" icon={<TriangleAlert className="size-4" />} title="On hold" body="Resume the case to work on its report." />;
  }

  const draftReady = latest?.kind === "draft" && latest.status === "ready";
  const finalReady = latest?.kind === "final" && latest.status === "ready";
  const failed = latest?.status === "failed";
  const busy = latest?.status === "queued" || latest?.status === "rendering";
  const approvedByMe = Boolean(finalReady && latest?.approvedBy?.id === viewerId && !perms.superAdmin);

  const generate = (
    <Button variant={draftReady ? "outline" : "default"} disabled={pending || busy} onClick={() => run(() => generateReportDraft(caseId), "Draft requested. It takes a few seconds.")}>
      {pending ? <Spinner /> : failed ? <RotateCcw /> : <FilePlus2 />}
      {failed ? "Try again" : latest ? "Generate a new draft" : "Generate draft"}
    </Button>
  );

  let content: React.ReactNode = null;
  if (stage === "report" && missingAnnexures.length) {
    content = (
      <Callout
        tone="warning"
        icon={<TriangleAlert className="size-4" />}
        title={`${missingAnnexures.join(", ")} has no report attached`}
        body="It goes in the final report as its own annexure, so the draft can't be made without it. Upload the file under Documents."
      />
    );
  } else if (stage === "report") {
    content = (
      <Callout
        tone={failed ? "danger" : "info"}
        icon={failed ? <TriangleAlert className="size-4" /> : <FileText className="size-4" />}
        title={failed ? "The last draft couldn't be generated" : draftReady ? `Draft v${latest.version} is ready to check` : busy ? "Generating the draft…" : "Prepare the report"}
        body={
          failed
            ? (latest?.error ?? "Something went wrong while making the PDF.")
            : draftReady
              ? "Open the draft and read it through. When it's right, send it for final approval."
              : busy
                ? "The draft appears here in a moment."
                : "Generate a draft: it compiles every check, the evidence and the annexures into the report."
        }
        actions={
          perms.preview ? (
            <>
              {draftReady ? (
                <Button disabled={pending} onClick={() => run(() => sendReportForApproval(caseId), "Sent for approval")}>
                  {pending ? <Spinner /> : <Send />}
                  Send for approval
                </Button>
              ) : null}
              {generate}
            </>
          ) : null
        }
      />
    );
  } else if (stage === "approval") {
    content = finalReady ? (
      <Callout
        tone="success"
        icon={<CheckCircle2 className="size-4" />}
        title={`Final report v${latest.version} is ready to release`}
        body={
          approvedByMe
            ? "You approved this report, so a different person must release it."
            : `Approved by ${latest.approvedBy?.name ?? "a manager"}${latest.approvedAt ? ` on ${formatDateTime(latest.approvedAt)}` : ""}. Releasing makes it available to ${clientName}.`
        }
        actions={
          <>
            {perms.release ? (
              <Button disabled={pending || approvedByMe} onClick={() => setDialog("release")}>
                <Send /> Release to client
              </Button>
            ) : null}
            {perms.approve ? (
              <Button variant="outline" disabled={pending} onClick={() => setDialog("return")}>
                <Undo2 /> Send back
              </Button>
            ) : null}
          </>
        }
      />
    ) : busy && latest?.kind === "final" ? (
      <Callout tone="info" icon={<Spinner className="size-4" />} title="Making the final report…" body="It's built from the approved draft, with its verification code and fingerprint." />
    ) : draftReady ? (
      <Callout
        tone="info"
        icon={<ShieldCheck className="size-4" />}
        title={`Draft v${latest.version} is waiting for approval`}
        body="Read the draft, confirm the final result and approve, or send it back with what needs changing."
        actions={
          perms.approve ? (
            <>
              <Button disabled={pending} onClick={() => setDialog("approve")}>
                <ShieldCheck /> Approve
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => setDialog("return")}>
                <Undo2 /> Send back
              </Button>
            </>
          ) : null
        }
      />
    ) : failed ? (
      <Callout
        tone="danger"
        icon={<TriangleAlert className="size-4" />}
        title="The final report couldn't be generated"
        body={latest?.error ?? "Something went wrong while making the PDF. Send the case back to the report stage and draft again."}
        actions={
          perms.approve ? (
            <Button variant="outline" disabled={pending} onClick={() => setDialog("return")}>
              <Undo2 /> Send back
            </Button>
          ) : null
        }
      />
    ) : null;
  } else if (stage === "released") {
    const released = latest?.status === "released" ? latest : null;
    content = (
      <Callout
        tone="success"
        icon={<CheckCircle2 className="size-4" />}
        title={released ? `Released to ${clientName}` : "Report released"}
        body={
          released
            ? `Version ${released.version}${released.releasedBy ? `, released by ${released.releasedBy.name}` : ""}${released.releasedAt ? ` on ${formatDateTime(released.releasedAt)}` : ""}.`
            : "The client has the latest released version."
        }
        actions={
          perms.approve ? (
            <Button variant="outline" disabled={pending} onClick={() => setDialog("revise")}>
              <PenLine /> Revise
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <>
      {content}
      {latest && dialog === "approve" ? (
        <ApproveDialog open onOpenChange={(o) => !o && setDialog(null)} caseId={caseId} draftId={latest.id} draftVersion={latest.version} summary={summary} />
      ) : null}
      <ReleaseDialog open={dialog === "release"} onOpenChange={(o) => !o && setDialog(null)} caseId={caseId} clientName={clientName} recipients={recipients} />
      <ReasonDialog
        open={dialog === "return"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Send the report back"
        description="The case returns to the report stage. Say what needs changing; the owner sees it on the case."
        label="What needs changing"
        confirmLabel="Send back"
        success="Sent back to the report stage"
        onSubmit={(text) => returnReport(caseId, text)}
      />
      <ReasonDialog
        open={dialog === "revise"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Revise the released report"
        description="The case returns to the report stage for a new version. The client keeps the current report until the revision is released, and the new one states why it changed."
        label="Why it's being revised"
        confirmLabel="Start revision"
        success="Revision started"
        onSubmit={(text) => reviseReport(caseId, text)}
      />
    </>
  );
}

function Callout({ tone, icon, title, body, actions }: { tone: "info" | "success" | "warning" | "danger"; icon: React.ReactNode; title: string; body: string; actions?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between",
        tone === "success" && "border-success/30 bg-success/[0.06]",
        tone === "info" && "border-primary/20 bg-primary/[0.04]",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            tone === "success" && "text-success",
            tone === "info" && "text-primary dark:text-brand-sky",
            tone === "warning" && "text-warning-foreground dark:text-warning",
            tone === "danger" && "text-destructive",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function VersionRow({ v }: { v: ReportVersion }) {
  const s = STATUS[v.status];
  const openable = Boolean(v.pageCount) && (v.status === "ready" || v.status === "released" || v.status === "superseded");
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            v{v.version} · {v.kind === "draft" ? "Draft" : "Final"}
          </span>
          <ToneChip tone={s.tone}>
            {v.status === "queued" || v.status === "rendering" ? <Spinner className="size-3" /> : null}
            {s.label}
          </ToneChip>
          {v.kind === "final" && v.finalResult ? <ResultBadge result={v.finalResult} /> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <RelativeTime iso={v.createdAt} />
          {v.requestedBy ? ` · ${v.requestedBy.name}` : ""}
          {v.pageCount ? ` · ${v.pageCount} pages` : ""}
          {v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ""}
        </p>
        {v.status === "failed" && v.error ? <p className="text-xs text-destructive">{v.error}</p> : null}
        {v.revisionReason && v.kind === "final" ? <p className="text-xs text-muted-foreground">Revision: {v.revisionReason}</p> : null}
        {v.annexures.some((a) => a.kind === "fixed" && a.embedded) ? (
          <p className="text-xs text-muted-foreground">Attached unchanged: {v.annexures.filter((a) => a.kind === "fixed" && a.embedded).map((a) => a.title).join(", ")}</p>
        ) : null}
        {v.annexures.some((a) => !a.embedded) ? (
          <p className="text-xs text-warning-foreground dark:text-warning">Some annexures couldn’t be embedded: {v.annexures.filter((a) => !a.embedded).map((a) => a.filename).join(", ")}</p>
        ) : null}
        {v.sha256 && v.kind === "final" ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={v.sha256}>
            SHA-256 {v.sha256}
          </p>
        ) : null}
      </div>
      {openable ? (
        <div className="flex shrink-0 gap-1.5">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/reports/${v.id}`} target="_blank" rel="noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" aria-label={`Download version ${v.version}`}>
            <a href={`/api/reports/${v.id}?download=1`}>
              <Download />
            </a>
          </Button>
        </div>
      ) : null}
    </li>
  );
}
