"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Download, ExternalLink, FilePlus2, FileText, PenLine, RotateCcw, Send, ShieldCheck, TriangleAlert, Undo2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { generateReportDraft, returnReport, returnToVerification, reviseReport, sendReportForApproval } from "../report-actions";
import { cn } from "@/lib/utils";
import { formatBytes, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ResultBadge, ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import type { Stage, Tone } from "@/domain/workflow/stages";
import type { DraftSummary, ReleaseRecipient, ReportStatus, ReportVersion } from "@/lib/server/reports/queries";
import { ReasonDialog } from "./reason-dialog";
import { AddRecipientsDialog, ApproveDialog, ReleaseDialog } from "./report-dialogs";

const STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "progress" },
  rendering: { label: "Generating", tone: "progress" },
  ready: { label: "Ready", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
  released: { label: "Released", tone: "success" },
};

export type ReportPerms = {
  preview: boolean;
  approve: boolean;
  release: boolean;
  superAdmin: boolean;
  /** May send a report on with a file that didn't arrive intact, giving the reason. */
  overrideEvidence: boolean;
  /** May open versions that hold sensitive evidence. */
  openSensitive: boolean;
};

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
  clientVisible,
  erased,
  versions,
  summary,
  recipients,
  missingAnnexures,
  unreported,
  closedChecks,
  canReturn,
  perms,
  viewerId,
  audience,
}: {
  caseId: string;
  stage: Stage;
  onHold: boolean;
  clientName: string;
  /** Off when the case is hidden from the client's portal. */
  clientVisible: boolean;
  /** The personal data is gone, so no new version can be made. */
  erased: boolean;
  versions: ReportVersion[];
  summary: DraftSummary | null;
  recipients: ReleaseRecipient[];
  /** Who can open the released report, when that's a named list. */
  audience: { named: { id: string; name: string }[] } | null;
  /** Checks whose fixed annexure has no file yet. */
  missingAnnexures: string[];
  /** Finished checks with no evidence in the report. */
  unreported: string[];
  /** Finished checks a person can send back to verification. */
  closedChecks: { id: string; label: string }[];
  canReturn: boolean;
  perms: ReportPerms;
  viewerId: string;
}) {
  const latest = versions[0] ?? null;
  const busy = latest?.status === "queued" || latest?.status === "rendering";
  return (
    <div className="space-y-5">
      <NextStep caseId={caseId} stage={stage} onHold={onHold} clientName={clientName} clientVisible={clientVisible} erased={erased} latest={latest} summary={summary} recipients={recipients} missingAnnexures={missingAnnexures} unreported={unreported} closedChecks={closedChecks} canReturn={canReturn} perms={perms} viewerId={viewerId} audience={audience} />
      {versions.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Versions</p>
          <ul className="divide-y rounded-xl border">
            {versions.map((v) => (
              <VersionRow key={v.id} v={v} canOpen={!v.sensitive || perms.openSensitive} />
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
  clientVisible,
  erased,
  latest,
  summary,
  recipients,
  missingAnnexures,
  unreported,
  closedChecks,
  canReturn,
  perms,
  viewerId,
  audience,
}: {
  caseId: string;
  stage: Stage;
  onHold: boolean;
  clientName: string;
  clientVisible: boolean;
  erased: boolean;
  latest: ReportVersion | null;
  summary: DraftSummary | null;
  recipients: ReleaseRecipient[];
  /** Checks whose fixed annexure has no file yet. */
  missingAnnexures: string[];
  /** Finished checks with no evidence in the report. */
  unreported: string[];
  /** Finished checks a person can send back to verification. */
  closedChecks: { id: string; label: string }[];
  canReturn: boolean;
  perms: ReportPerms;
  viewerId: string;
  audience: { named: { id: string; name: string }[] } | null;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<"approve" | "release" | "return" | "revise" | "evidence" | "add" | null>(null);
  const [goingBack, setGoingBack] = useState(false);

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
  const problems = summary?.problems ?? [];
  // The Global Sanction report goes as issued: nobody can send it on changed (public.submit_report).
  const fixedChanged = latest?.annexures.filter((a) => a.kind === "fixed" && a.altered).map((a) => a.filename) ?? [];

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
        title={failed ? "The last draft couldn't be generated" : draftReady ? (problems.length ? `Draft v${latest.version} is missing evidence` : `Draft v${latest.version} is ready to check`) : busy ? "Generating the draft…" : "Prepare the report"}
        body={
          failed
            ? (latest?.error ?? "Something went wrong while making the PDF.")
            : draftReady
              ? problems.length
                ? `${problems.join(", ")} didn't reach the report intact. Replace the file under Documents and make a new draft.${perms.overrideEvidence && !fixedChanged.length ? " If it can go without it, send it on and say why." : ""}`
                : "Open the draft and read it through. When it's right, send it for final approval."
              : busy
                ? "The draft appears here in a moment."
                : "Generate a draft: it compiles every check, the evidence and the annexures into the report."
        }
        actions={
          perms.preview ? (
            <>
              {draftReady && !problems.length && !unreported.length ? (
                <Button disabled={pending} onClick={() => run(() => sendReportForApproval(caseId), "Sent for approval")}>
                  {pending ? <Spinner /> : <Send />}
                  Send for approval
                </Button>
              ) : null}
              {draftReady && problems.length && perms.overrideEvidence && !fixedChanged.length && !unreported.length ? (
                <Button variant="outline" disabled={pending} onClick={() => setDialog("evidence")}>
                  <Send /> Send anyway
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
            : `Approved by ${latest.approvedBy?.name ?? "a manager"}${latest.approvedAt ? ` on ${formatDateTime(latest.approvedAt)}` : ""}. ${clientVisible ? `Releasing makes it available to ${clientName}.` : "This case is hidden from the client's portal, so they won't see it until you show the case."}`
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
        title={released && clientVisible ? `Released to ${clientName}` : "Report released"}
        body={
          released
            ? `Version ${released.version}${released.releasedBy ? `, released by ${released.releasedBy.name}` : ""}${released.releasedAt ? ` on ${formatDateTime(released.releasedAt)}` : ""}. ${!clientVisible ? "This case is hidden from the client's portal, so nobody there can open it until you show the case." : audience?.named.length ? `Open to ${audience.named.map((p) => p.name).join(", ")}.` : "Open to everyone at the client who can read cases."}`
            : "The client has the latest released version."
        }
        actions={
          <>
            {perms.release && audience?.named.length && !erased && !released?.fileRemoved ? (
              <Button variant="outline" disabled={pending} onClick={() => setDialog("add")}>
                <UserPlus /> Add people
              </Button>
            ) : null}
            {perms.approve && !erased ? (
              <Button variant="outline" disabled={pending} onClick={() => setDialog("revise")}>
                <PenLine /> Revise
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <>
      {content}
      {(stage === "report" || stage === "post_qc") && unreported.length ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-warning-foreground dark:text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {stage === "report"
            ? `No evidence in the report for ${unreported.join(", ")}. Set its files to “In the report” or waive the document, then make a new draft. It can't go for approval until then.`
            : `No evidence in the report for ${unreported.join(", ")}. Put its files in the report under Documents, or return the case. Post-QC can't approve until then.`}
        </p>
      ) : null}
      {stage === "report" && canReturn ? (
        <div className="mt-3">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setGoingBack(true)}>
            <Undo2 /> Back to verification
          </Button>
        </div>
      ) : null}
      <BackToVerification open={goingBack} onOpenChange={setGoingBack} caseId={caseId} checks={closedChecks} />
      {latest && dialog === "approve" ? (
        <ApproveDialog open onOpenChange={(o) => !o && setDialog(null)} caseId={caseId} draftId={latest.id} draftVersion={latest.version} summary={summary} />
      ) : null}
      <ReleaseDialog open={dialog === "release"} onOpenChange={(o) => !o && setDialog(null)} caseId={caseId} clientName={clientName} clientVisible={clientVisible} recipients={recipients} named={audience?.named.map((p) => p.id) ?? []} />
      <AddRecipientsDialog open={dialog === "add"} onOpenChange={(o) => !o && setDialog(null)} caseId={caseId} recipients={recipients} named={audience?.named.map((p) => p.id) ?? []} />
      <ReasonDialog
        open={dialog === "evidence"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Send without this evidence"
        description={`${problems.join(", ")} didn't reach the report intact. The approver sees your reason, and it stays on the record.`}
        label="Why it can go without it"
        placeholder="e.g. The employer sent only a protected copy, and the content was confirmed by phone."
        confirmLabel="Send for approval"
        success="Sent for approval"
        onSubmit={(text) => sendReportForApproval(caseId, text)}
      />
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

/** The way back when something in the report turns out wrong, or a pending check can now be finished. */
function BackToVerification({ open, onOpenChange, caseId, checks }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string; checks: { id: string; label: string }[] }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await returnToVerification({ caseId, reason, checks: chosen });
              if (r.ok) {
                toast.success("Back in verification");
                onOpenChange(false);
                setChosen([]);
                setReason("");
                setError(null);
              } else setError(r.error);
            });
          }}
        >
          <DialogHeader className="mb-4">
            <DialogTitle>Back to verification</DialogTitle>
            <DialogDescription>Reopens the checks you tick so their details and results can change. Checks still pending reopen by themselves. The case goes through Post-QC again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {checks.length ? (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Checks to reopen</legend>
                {checks.map((k) => (
                  <label key={k.id} className="flex items-center gap-2.5 text-sm">
                    <Checkbox checked={chosen.includes(k.id)} onCheckedChange={(c) => setChosen((list) => (c === true ? [...list, k.id] : list.filter((x) => x !== k.id)))} />
                    {k.label}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="back-reason" className="text-sm font-medium">
                What needs more work
              </label>
              <Textarea id="back-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-5">
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Send back
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

function VersionRow({ v, canOpen }: { v: ReportVersion; canOpen: boolean }) {
  const s = STATUS[v.status];
  const openable = canOpen && !v.fileRemoved && Boolean(v.pageCount) && (v.status === "ready" || v.status === "released" || v.status === "superseded");
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
        {v.resultReason ? <p className="text-xs text-muted-foreground">Result differs from the checks because: {v.resultReason}</p> : null}
        {v.evidenceNote ? <p className="text-xs text-muted-foreground">Sent with evidence problems: {v.evidenceNote}</p> : null}
        {!canOpen && v.pageCount ? <p className="text-xs text-muted-foreground">Holds sensitive evidence, which your role can&rsquo;t open.</p> : null}
        {v.fileRemoved && v.pageCount ? <p className="text-xs text-muted-foreground">File removed under the retention policy.</p> : null}
        {v.annexures.some((a) => a.kind === "fixed" && a.embedded && !a.altered) ? (
          <p className="text-xs text-muted-foreground">Attached unchanged: {v.annexures.filter((a) => a.kind === "fixed" && a.embedded && !a.altered).map((a) => a.title).join(", ")}</p>
        ) : null}
        {v.annexures.some((a) => !a.embedded) ? (
          <p className="text-xs text-warning-foreground dark:text-warning">Some annexures couldn’t be embedded: {v.annexures.filter((a) => !a.embedded).map((a) => a.filename).join(", ")}</p>
        ) : null}
        {v.annexures.some((a) => a.attached) ? (
          <p className="text-xs text-warning-foreground dark:text-warning">Protected, so held as a file inside the PDF rather than as pages: {v.annexures.filter((a) => a.attached).map((a) => a.filename).join(", ")}</p>
        ) : null}
        {v.annexures.some((a) => a.altered) ? (
          <p className="text-xs text-destructive">Changed since upload: {v.annexures.filter((a) => a.altered).map((a) => a.filename).join(", ")}. Check these files before going further.</p>
        ) : null}
        {v.parts.length ? <p className="text-xs text-muted-foreground">Evidence continues in {v.parts.length} more {v.parts.length === 1 ? "file" : "files"}: {v.parts.flatMap((p) => p.annexures).join(", ")}</p> : null}
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
          {v.parts.map((p) => (
            <Button key={p.part} asChild variant="ghost" size="sm">
              <a href={`/api/reports/${v.id}?download=1&part=${p.part}`} aria-label={`Download version ${v.version}, part ${p.part}`}>
                Part {p.part}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
