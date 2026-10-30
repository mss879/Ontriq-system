"use client";

import { useState, useTransition } from "react";
import { CircleAlert, FilePlus2, Send } from "lucide-react";
import { toast } from "sonner";
import { approveReport, generateReportDraft, releaseReport } from "../report-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ResultBadge, ToneChip } from "@/components/cases/badges";
import { FINAL_RESULT_LABELS, type FinalResult } from "@/domain/workflow/stages";
import type { DraftSummary, ReleaseRecipient } from "@/lib/server/reports/queries";

const RESULT_MEANING: Record<FinalResult, string> = {
  green: "Every check completed and verified without discrepancies.",
  amber: "Something could not be verified or is pending; the client should read the findings.",
  red: "At least one check found information that does not match what was declared.",
};

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
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!result) {
      setError("Choose the final result.");
      return;
    }
    start(async () => {
      const r = await approveReport({ caseId, draftId, finalResult: result });
      if (r.ok) {
        toast.success("Approved. The final report is being prepared.");
        onDone();
        return;
      }
      setError(r.error);
      setStale(/changed after this draft/i.test(r.error));
    });
  };

  const regenerate = () =>
    start(async () => {
      const r = await generateReportDraft(caseId);
      if (r.ok) {
        toast.success("A new draft is being generated");
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
                  {disabled ? `${FINAL_RESULT_LABELS.green} needs every check completed and clear.` : RESULT_MEANING[r]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error ? (
        <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <DialogFooter className="mt-5 gap-2">
        {stale ? (
          <Button variant="outline" onClick={regenerate} disabled={pending}>
            <FilePlus2 /> Generate a new draft
          </Button>
        ) : null}
        <Button onClick={submit} disabled={pending || !result}>
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
  recipients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  clientName: string;
  recipients: ReleaseRecipient[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <ReleaseForm caseId={caseId} clientName={clientName} recipients={recipients} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReleaseForm({ caseId, clientName, recipients, onDone }: { caseId: string; clientName: string; recipients: ReleaseRecipient[]; onDone: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(recipients.filter((r) => r.readsCases).map((r) => r.id)));
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
      const r = await releaseReport({ caseId, recipients: [...chosen] });
      if (r.ok) {
        toast.success(`Released to ${clientName}`);
        onDone();
      } else setError(r.error);
    });

  return (
    <div>
      <DialogHeader className="mb-4">
        <DialogTitle>Release to {clientName}</DialogTitle>
        <DialogDescription>
          The report appears in their portal straight away and their portal users are told. Choose who is recorded as receiving it.
        </DialogDescription>
      </DialogHeader>
      {recipients.length ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {recipients.map((r) => (
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
      ) : (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {clientName} has no portal users yet. The report is still released; anyone they invite later finds it in their portal.
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="mt-5">
        <Button onClick={submit} disabled={pending}>
          {pending ? <Spinner /> : <Send />}
          Release report
        </Button>
      </DialogFooter>
    </div>
  );
}
