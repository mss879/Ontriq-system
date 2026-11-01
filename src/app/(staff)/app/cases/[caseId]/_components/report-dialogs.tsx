"use client";

import { useState, useTransition } from "react";
import { CircleAlert, FilePlus2, Send } from "lucide-react";
import { toast } from "sonner";
import { addReportRecipients, approveReport, releaseReport, returnReport } from "../report-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ResultBadge, ToneChip } from "@/components/cases/badges";
import { RESULT_WORDS } from "@/domain/reports/compile-core";
import { FINAL_RESULT_LABELS, type FinalResult } from "@/domain/workflow/stages";
import type { DraftSummary, ReleaseRecipient } from "@/lib/server/reports/queries";

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  verified: "success",
  discrepancy: "danger",
  unable_to_verify: "warning",
  not_required: "neutral",
  incomplete: "warning",
};

/** Green needs every counted check verified and clear (mirrors public.approve_report). */
export function greenAllowed(summary: DraftSummary | null): boolean {
  if (!summary) return false;
  const counted = summary.checks.filter((c) => c.status !== "not_required");
  return counted.length > 0 && counted.every((c) => c.status === "verified" && c.resultTone === "green");
}

export function ApproveDialog({
  open,
  onOpenChange,
  caseId,
  draftId,
  draftVersion,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  draftId: string;
  draftVersion: number;
  summary: DraftSummary | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <ApproveForm caseId={caseId} draftId={draftId} draftVersion={draftVersion} summary={summary} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({ caseId, draftId, draftVersion, summary, onDone }: { caseId: string; draftId: string; draftVersion: number; summary: DraftSummary | null; onDone: () => void }) {
  const canGreen = greenAllowed(summary);
  const proposed = summary?.proposedResult ?? null;
  const [result, setResult] = useState<FinalResult | null>(proposed && (proposed !== "green" || canGreen) ? proposed : null);
  const [reason, setReason] = useState("");
  const [shareSensitive, setShareSensitive] = useState(false);
  const [evidenceAck, setEvidenceAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();
  const sensitive = summary?.sensitive ?? [];
  const problems = summary?.problems ?? [];
  const differs = result !== null && result !== proposed;
  const ready = Boolean(result) && (!differs || reason.trim() !== "") && (!sensitive.length || shareSensitive) && (!problems.length || evidenceAck);

  const submit = () => {
    if (!result) {
      setError("Choose the final result.");
      return;
    }
    start(async () => {
      const r = await approveReport({ caseId, draftId, finalResult: result, reason: reason.trim() || undefined, shareSensitive, evidenceAck });
      if (r.ok) {
        toast.success("Approved. The final report is being prepared.");
        onDone();
        return;
      }
      setError(r.error);
      setStale(/changed after this draft/i.test(r.error));
    });
  };

  // A new draft is made at the report stage, so a stale one goes back there first.
  const sendBack = () =>
    start(async () => {
      const r = await returnReport(caseId, "The case changed after this draft was made. Make a new draft.");
      if (r.ok) {
        toast.success("Sent back. Make a new draft at the report stage.");
        onDone();
      } else setError(r.error);
    });

  return (
    <div>
      <DialogHeader className="mb-4">
        <DialogTitle>Approve the report</DialogTitle>
        <DialogDescription>
          You’re approving draft v{draftVersion}. The final report is made from exactly this content, with a verification code and fingerprint, and goes to the client once
          someone releases it.
        </DialogDescription>
      </DialogHeader>

      {summary ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Proposed by the checks</span>
            <ResultBadge result={proposed} />
          </div>
          <ul className="divide-y rounded-xl border text-sm">
            {summary.checks.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">{c.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.resultLabel && c.resultTone ? <ResultBadge result={c.resultTone} label={c.resultLabel} /> : <ToneChip tone={STATUS_TONE[c.status] ?? "neutral"}>{c.statusLabel}</ToneChip>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">The draft’s summary isn’t available. Check the PDF before approving.</p>
      )}

      <fieldset className="mt-5 space-y-2">
        <legend className="mb-2 text-sm font-medium">Final result</legend>
        {(["green", "amber", "red"] as const).map((r) => {
          const disabled = r === "green" && !canGreen;
          return (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                result === r ? "border-primary bg-primary/[0.04] ring-1 ring-primary/30" : "hover:bg-muted/50",
                disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <input type="radio" name="final-result" value={r} checked={result === r} disabled={disabled} onChange={() => setResult(r)} className="mt-1 accent-[var(--primary)]" />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <ResultBadge result={r} />
                  {proposed === r ? <span className="text-xs text-muted-foreground">Proposed</span> : null}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {disabled ? `${FINAL_RESULT_LABELS.green} needs every check completed and clear.` : RESULT_WORDS[r].meaning}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {differs ? (
        <div className="mt-4 space-y-1.5">
          <label htmlFor="result-reason" className="text-sm font-medium">
            Why this result, when the checks propose {proposed ? FINAL_RESULT_LABELS[proposed] : "none"}?
          </label>
          <Textarea id="result-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="The audit log keeps your reason." />
        </div>
      ) : null}

      {problems.length ? (
        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
          <Checkbox className="mt-0.5" checked={evidenceAck} onCheckedChange={(v) => setEvidenceAck(v === true)} />
          <span>
            {problems.join(", ")} didn&rsquo;t reach this report intact.
            {summary?.evidenceNote ? ` The team said: ${summary.evidenceNote}` : ""} I&rsquo;ve seen that and it can still go out.
          </span>
        </label>
      ) : null}

      {sensitive.length ? (
        <label className="mt-4 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm">
          <Checkbox className="mt-0.5" checked={shareSensitive} onCheckedChange={(v) => setShareSensitive(v === true)} />
          <span>This report holds sensitive evidence: {sensitive.join(", ")}. I&rsquo;ve decided it can go to the client.</span>
        </label>
      ) : null}

      {error ? (
        <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <DialogFooter className="mt-5 gap-2">
        {stale ? (
          <Button variant="outline" onClick={sendBack} disabled={pending}>
            <FilePlus2 /> Send back for a new draft
          </Button>
        ) : null}
        <Button onClick={submit} disabled={pending || !ready}>
          {pending ? <Spinner /> : null}
          Approve as {result ? FINAL_RESULT_LABELS[result] : "…"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ReleaseDialog({
  open,
  onOpenChange,
  caseId,
  clientName,
  clientVisible,
  recipients,
  named,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  clientName: string;
  /** Off when the case is hidden from the client's portal. */
  clientVisible: boolean;
  recipients: ReleaseRecipient[];
  /** Who could open the version this one replaces, when that was a named list. */
  named: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <ReleaseForm caseId={caseId} clientName={clientName} clientVisible={clientVisible} recipients={recipients} named={named} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReleaseForm({ caseId, clientName, clientVisible, recipients, named, onDone }: { caseId: string; clientName: string; clientVisible: boolean; recipients: ReleaseRecipient[]; named: string[]; onDone: () => void }) {
  const readers = recipients.filter((r) => r.readsCases);
  const kept = named.filter((id) => readers.some((r) => r.id === id));
  // Open by default, so someone who joins the client later can still find it. A revision keeps the last version's
  // list, and if nobody on it can read cases now, who opens it is for the person releasing to say.
  const [everyone, setEveryone] = useState(named.length === 0 || readers.length === 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set(kept));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const submit = () =>
    start(async () => {
      const r = await releaseReport({ caseId, recipients: everyone ? [] : [...chosen] });
      if (r.ok) {
        toast.success(clientVisible ? `Released to ${clientName}` : "Released. The client can't see it while the case is hidden");
        onDone();
      } else setError(r.error);
    });

  return (
    <div>
      <DialogHeader className="mb-4">
        <DialogTitle>Release to {clientName}</DialogTitle>
        <DialogDescription>
          {clientVisible
            ? kept.length
              ? "The last version went only to the people ticked below. The report appears in their portal straight away, and whoever can open it is told."
              : named.length && readers.length
                ? "The last version went to named people, and none of them can read cases now. Choose who can open this one."
                : "The report appears in their portal straight away, and whoever can open it is told."
            : "This case is hidden from the client's portal, so nobody there sees the report or is told until you show the case."}
        </DialogDescription>
      </DialogHeader>
      {readers.length ? (
        <div role="radiogroup" aria-label="Who can open it" className="mb-3 space-y-1.5 text-sm">
          <label className="flex items-center gap-2.5">
            <input type="radio" name="release-to" checked={everyone} onChange={() => setEveryone(true)} className="accent-[var(--primary)]" />
            Everyone at {clientName} who can read cases, now and later
          </label>
          <label className="flex items-center gap-2.5">
            <input type="radio" name="release-to" checked={!everyone} onChange={() => setEveryone(false)} className="accent-[var(--primary)]" />
            Only the people I choose
          </label>
        </div>
      ) : null}
      {!readers.length ? (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {clientName} has no portal users yet. The report is still released; anyone they invite later finds it in their portal.
        </p>
      ) : !everyone ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {readers.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                <Checkbox checked={chosen.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.email}
                    {r.roleName ? ` · ${r.roleName}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="mt-5">
        <Button onClick={submit} disabled={pending || (!everyone && chosen.size === 0)}>
          {pending ? <Spinner /> : <Send />}
          Release report
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Someone joined the client after a report went to named people. */
export function AddRecipientsDialog({ open, onOpenChange, caseId, recipients, named }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string; recipients: ReleaseRecipient[]; named: string[] }) {
  const choices = recipients.filter((r) => r.readsCases && !named.includes(r.id));
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await addReportRecipients({ caseId, users: chosen });
      if (!r.ok) return void toast.error(r.error);
      toast.success("They can open the report now");
      setChosen([]);
      onOpenChange(false);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add people to this report</DialogTitle>
          <DialogDescription>They&rsquo;re told, and the report appears in their portal.</DialogDescription>
        </DialogHeader>
        {choices.length ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {choices.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <Checkbox checked={chosen.includes(r.id)} onCheckedChange={(v) => setChosen((list) => (v === true ? [...list, r.id] : list.filter((x) => x !== r.id)))} />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Everyone at this client who can read cases can already open it.</p>
        )}
        <DialogFooter>
          <Button onClick={add} disabled={pending || !chosen.length}>
            {pending ? <Spinner /> : null} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
