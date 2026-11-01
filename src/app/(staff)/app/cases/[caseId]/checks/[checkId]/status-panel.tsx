"use client";

import { useState, useTransition } from "react";
import { Ban, CheckCircle2, Clock, HelpCircle, MessageCircleQuestion, PenLine, PlayCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { assignCheck, requestCheckInformation, setCheckRemarks, setCheckState } from "../../../actions";
import type { Person, StaffOption } from "@/lib/server/cases/queries";
import type { ResultOption } from "@/domain/check-types/schema";
import { cn } from "@/lib/utils";
import { CheckStatePill, ToneChip } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { CHECK_STATE_LABELS, isTerminalCheck, STAGE_LABELS, type CheckState, type Stage } from "@/domain/workflow/stages";
import { ReasonDialog } from "../../_components/reason-dialog";

const TONE = { green: "success", amber: "warning", red: "danger" } as const;
const UNASSIGNED = "__none__";

export function StatusPanel({
  caseId,
  processType,
  checkId,
  state,
  result,
  resultTone,
  clientNote,
  options,
  stage,
  onHold,
  valuesValid,
  entryReady,
  canVerify,
  canWaive,
  canWord,
}: {
  caseId: string;
  processType: "client_supplied" | "candidate_collected";
  checkId: string;
  state: CheckState;
  result: string | null;
  resultTone: "green" | "amber" | "red" | null;
  clientNote: string | null;
  options: ResultOption[];
  stage: Stage;
  onHold: boolean;
  valuesValid: boolean;
  /** Data Entry's part is done: enough to say a source couldn't confirm. */
  entryReady: boolean;
  canVerify: boolean;
  canWaive: boolean;
  /** May reword what the report says for this check, now (public.set_check_remarks). */
  canWord: boolean;
}) {
  const [pending, start] = useTransition();
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeKey, setOutcomeKey] = useState(0);
  const [waiving, setWaiving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [wording, setWording] = useState(false);
  const terminal = isTerminalCheck(state);
  const working = ["intake", "documents", "pre_qc", "data_entry", "verification"].includes(stage);
  const option = options.find((o) => o.key === result);

  const quick = (next: CheckState, success: string) =>
    start(async () => {
      const r = await setCheckState(checkId, { state: next });
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });

  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <h2 className="text-sm font-semibold">Status</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CheckStatePill state={state} />
        {option && resultTone && option.label !== CHECK_STATE_LABELS[state] ? <ToneChip tone={TONE[resultTone]}>{option.label}</ToneChip> : null}
      </div>
      {clientNote ? (
        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="block text-xs text-muted-foreground">Shown to the client</span>
          {clientNote}
        </p>
      ) : null}
      {terminal && canWord ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setWording(true)}>
          <PenLine /> {clientNote ? "Edit the remarks" : "Add remarks"}
        </Button>
      ) : null}

      <div className="mt-4 space-y-2 border-t pt-4">
        {onHold ? (
          <p className="text-sm text-muted-foreground">The case is on hold. Resume it to update this check.</p>
        ) : !canVerify ? (
          <>
            <p className="text-sm text-muted-foreground">Only the officer on this check, the case owner or a manager can change its status.</p>
            {canWaive && working && state !== "waived" && state !== "discrepancy" && (!terminal || stage === "verification") ? (
              <Button variant="ghost" size="sm" onClick={() => setWaiving(true)} disabled={pending}>
                <Ban /> Waive
              </Button>
            ) : null}
          </>
        ) : terminal ? (
          stage === "verification" ? (
            <Button variant="outline" className="w-full" onClick={() => quick("in_progress", "Check reopened")} disabled={pending}>
              {pending ? <Spinner /> : <RotateCcw />} Reopen check
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">The outcome is recorded. It can be reopened only during verification.</p>
          )
        ) : working ? (
          <>
            {stage === "verification" ? (
              <>
                <Button className="w-full" onClick={() => setOutcomeOpen(true)} disabled={pending || (!valuesValid && !entryReady)}>
                  <CheckCircle2 /> Record outcome
                </Button>
                {!valuesValid ? (
                  <p className="text-xs text-muted-foreground">
                    {entryReady ? "Record what the source confirmed to verify this check. Until then it can only be marked unable to verify." : "Complete the check’s details first, then record the outcome."}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Outcomes are recorded during verification. This case is at {STAGE_LABELS[stage].toLowerCase()}.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {state !== "awaiting_response" ? (
                <Button variant="outline" size="sm" onClick={() => quick("awaiting_response", "Marked awaiting response")} disabled={pending}>
                  <Clock /> Awaiting reply
                </Button>
              ) : null}
              {state !== "pending_info" ? (
                <Button variant="outline" size="sm" onClick={() => setAsking(true)} disabled={pending}>
                  <MessageCircleQuestion /> Needs info
                </Button>
              ) : null}
              {state !== "in_progress" ? (
                <Button variant="outline" size="sm" onClick={() => quick("in_progress", "Back in progress")} disabled={pending}>
                  <PlayCircle /> In progress
                </Button>
              ) : null}
              {canWaive ? (
                <Button variant="ghost" size="sm" onClick={() => setWaiving(true)} disabled={pending}>
                  <Ban /> Waive
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This check is locked at {STAGE_LABELS[stage].toLowerCase()}.</p>
        )}
      </div>

      <Dialog
        open={outcomeOpen}
        onOpenChange={(o) => {
          setOutcomeOpen(o);
          if (!o) setOutcomeKey((k) => k + 1);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <OutcomeForm
            key={outcomeKey}
            checkId={checkId}
            options={options}
            sourceRecorded={valuesValid}
            earlierFinding={clientNote}
            onDone={() => {
              setOutcomeOpen(false);
              setOutcomeKey((k) => k + 1);
            }}
          />
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={waiving}
        onOpenChange={setWaiving}
        title="Waive this check"
        description="The check won't count towards the result. The report shows it as Not required, with your reason."
        placeholder="e.g. The client removed this check from the request."
        confirmLabel="Waive check"
        success="Check waived"
        onSubmit={(note) => setCheckState(checkId, { state: "waived", note })}
      />
      <ReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title="Ask for the information"
        description={`The ${processType === "candidate_collected" ? "candidate" : "client"} gets this as a question, and the check waits for the answer. If you're waiting on a school, employer or other source, use Awaiting reply.`}
        label="What do you need?"
        placeholder="e.g. Which branch of the company did they work at?"
        confirmLabel="Send the question"
        success="Sent. The check shows as waiting for information"
        onSubmit={async (text) => {
          const r = await requestCheckInformation(caseId, checkId, text);
          if (r.ok && r.warning) toast.warning(r.warning);
          return r;
        }}
      />
      <ReasonDialog
        key={clientNote ?? ""}
        open={wording}
        onOpenChange={setWording}
        title={clientNote ? "Edit the remarks" : "Add remarks"}
        description="The final report prints this, and the client reads it once the report is released. If a draft exists, make a new one afterwards."
        label="Remarks"
        required={state === "discrepancy" || state === "unable_to_verify"}
        initial={clientNote ?? ""}
        confirmLabel="Save remarks"
        success="Remarks saved"
        onSubmit={(text) => setCheckRemarks(checkId, text)}
      />
    </section>
  );
}

export type Outcome = "completed" | "discrepancy" | "unable_to_verify";
export type OutcomeValues = { outcome: Outcome; result: string; note: string; clientNote: string };
const OUTCOMES: { key: Outcome; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: "completed", label: "Verified", icon: CheckCircle2, hint: "Confirmed with the source." },
  { key: "discrepancy", label: "Discrepancy", icon: TriangleAlert, hint: "Something doesn't match. Explain it." },
  { key: "unable_to_verify", label: "Unable to verify", icon: HelpCircle, hint: "The source couldn't confirm." },
];

/** Record a check's outcome. `initial` pre-fills it (e.g. from a captured reply); the person still confirms. */
export function OutcomeForm({
  checkId,
  options,
  onDone,
  initial,
  earlierFinding,
  sourceRecorded = true,
  description = "A person decides every result, and Post-QC reviews each one before the report.",
}: {
  checkId: string;
  options: ResultOption[];
  onDone: (values: OutcomeValues) => void;
  initial?: Partial<OutcomeValues>;
  /** The check's note from before it was reopened. It stays out of a clear result unless someone puts it back. */
  earlierFinding?: string | null;
  /** What the source confirmed is on the check. Without it, only "unable to verify" can be said. */
  sourceRecorded?: boolean;
  description?: string;
}) {
  const offered = sourceRecorded ? OUTCOMES : OUTCOMES.filter((o) => o.key === "unable_to_verify");
  const [outcome, setOutcome] = useState<Outcome>(sourceRecorded ? (initial?.outcome ?? "completed") : "unable_to_verify");
  const pick = (o: Outcome) =>
    o === "completed"
      ? options.filter((x) => x.tone !== "red" && x.key !== "unable_to_verify" && x.key !== "pending")
      : o === "discrepancy"
        ? options.filter((x) => x.tone === "red")
        : options.filter((x) => x.tone === "amber" && x.key !== "pending").sort((a, b) => Number(b.key === "unable_to_verify") - Number(a.key === "unable_to_verify"));
  const [result, setResult] = useState<string>(() => (initial?.result && pick(outcome).some((o) => o.key === initial.result) ? initial.result : (pick(outcome)[0]?.key ?? "")));
  const [note, setNote] = useState(initial?.note ?? "");
  const [clientNote, setClientNote] = useState(initial?.clientNote ?? (outcome === "completed" ? "" : (earlierFinding ?? "")));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const choices = pick(outcome);
  const choose = (next: Outcome) => {
    setOutcome(next);
    setResult(pick(next)[0]?.key ?? "");
    if (!earlierFinding) return;
    if (next === "completed" && clientNote === earlierFinding) setClientNote("");
    if (next !== "completed" && !clientNote.trim()) setClientNote(earlierFinding);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (outcome !== "completed" && !clientNote.trim()) return setError("Write the finding. It prints in the report.");
        start(async () => {
          const r = await setCheckState(checkId, { state: outcome, result: result || undefined, note, clientNote });
          if (r.ok) {
            toast.success("Outcome recorded");
            onDone({ outcome, result, note, clientNote });
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Record the outcome</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Outcome" className="grid gap-2 sm:grid-cols-3">
          {offered.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={outcome === o.key}
              onClick={() => choose(o.key)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                outcome === o.key ? "border-brand-blue/50 bg-brand-blue/5 dark:border-brand-sky/50 dark:bg-brand-sky/10" : "hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <o.icon className="size-4" /> {o.label}
              </span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
        {choices.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="outcome-result" className="text-sm font-medium">
              Result
            </label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger id="outcome-result" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="outcome-note" className="text-sm font-medium">
            Internal note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea id="outcome-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What the source said, who confirmed it and when." />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="outcome-client" className="text-sm font-medium">
            {outcome === "completed" ? (
              <>
                Note for the client <span className="font-normal text-muted-foreground">(optional)</span>
              </>
            ) : (
              "Finding for the report"
            )}
          </label>
          <Textarea id="outcome-client" value={clientNote} onChange={(e) => setClientNote(e.target.value)} rows={2} placeholder={outcome === "completed" ? "A short, factual summary the client may read." : "What was found. The client reads this in the report."} />
          {outcome === "completed" && earlierFinding && clientNote !== earlierFinding ? (
            <p className="text-xs text-muted-foreground">
              This check had a note: “{earlierFinding}”{" "}
              <button type="button" onClick={() => setClientNote(earlierFinding)} className="font-medium text-foreground underline-offset-4 hover:underline">
                Use it again
              </button>
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending || (choices.length > 0 && !result)}>
          {pending ? <Spinner /> : null}
          Record outcome
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CheckAssignment({ checkId, assignee, staff, canAssign, closed }: { checkId: string; assignee: Person | null; staff: StaffOption[]; canAssign: boolean; closed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <h2 className="mb-3 text-sm font-semibold">Officer</h2>
      {canAssign && !closed ? (
        <Select
          value={assignee?.id ?? UNASSIGNED}
          disabled={pending}
          onValueChange={(v) =>
            start(async () => {
              const r = await assignCheck(checkId, v === UNASSIGNED ? null : v);
              if (r.ok) toast.success(v === UNASSIGNED ? "Unassigned" : `Assigned to ${staff.find((s) => s.id === v)?.name ?? "them"}`);
              else toast.error(r.error);
            })
          }
        >
          <SelectTrigger className="w-full" aria-label="Officer on this check">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Nobody yet</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} <span className="text-xs text-muted-foreground">{s.roleName}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <PersonChip person={assignee} />
      )}
    </section>
  );
}
