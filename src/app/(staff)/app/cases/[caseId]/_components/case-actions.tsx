"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Ban, CheckCircle2, ChevronDown, Pause, Play, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordQcReview, setCaseHold, transitionCase, cancelCase } from "../../actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { CHECK_STATE_LABELS, type CheckState, type ProcessType, type Stage } from "@/domain/workflow/stages";
import type { ActionAvailability, CaseAction } from "@/domain/workflow/transitions-core";
import type { QcChecklists } from "@/domain/workflow/settings";
import { ReasonDialog } from "./reason-dialog";

const ICONS: Partial<Record<CaseAction, React.ComponentType<{ className?: string }>>> = {
  accept_request: CheckCircle2,
  submit_pre_qc: ArrowRight,
  pre_qc_review: ShieldCheck,
  start_verification: ArrowRight,
  submit_post_qc: ArrowRight,
  submit_post_qc_pending: ArrowRight,
  post_qc_review: ShieldCheck,
  return_to_documents: Undo2,
  hold: Pause,
  resume: Play,
  cancel: Ban,
};

const TRANSITION_EVENTS = ["accept_request", "submit_pre_qc", "start_verification", "submit_post_qc"] as const;
const SUCCESS: Partial<Record<CaseAction, string>> = {
  accept_request: "Request accepted",
  submit_pre_qc: "Sent to Pre-QC",
  start_verification: "Verification started",
  submit_post_qc: "Sent to Post-QC",
  resume: "Case resumed",
};

export function CaseActions({
  caseId,
  stage,
  processType,
  actions,
  revising,
  checks,
  checklists,
  filesWithoutOriginalNote,
}: {
  caseId: string;
  stage: Stage;
  processType: ProcessType;
  actions: ActionAvailability[];
  /** A released report is being revised: stopping leaves it standing. */
  revising: boolean;
  checks: { id: string; label: string; state: CheckState }[];
  checklists: QcChecklists;
  /** Files nobody has marked as an original or a copy (the flowchart's Pre-QC). */
  filesWithoutOriginalNote: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<CaseAction | null>(null);

  const run = (a: ActionAvailability) => {
    if (a.action === "pre_qc_review" || a.action === "post_qc_review" || a.action === "return_to_documents" || a.action === "hold" || a.action === "cancel" || a.action === "submit_post_qc_pending") {
      setDialog(a.action);
      return;
    }
    start(async () => {
      const result =
        a.action === "resume"
          ? await setCaseHold(caseId, false)
          : (TRANSITION_EVENTS as readonly string[]).includes(a.action)
            ? await transitionCase(caseId, a.action as (typeof TRANSITION_EVENTS)[number])
            : { ok: false as const, error: "Unknown action." };
      if (!result.ok) return void toast.error(result.error);
      toast.success(SUCCESS[a.action] ?? "Done");
      // Data entry's part is over, and the case has left their list.
      if ("left" in result && result.left) router.push("/app/queues");
    });
  };

  const primary = actions.filter((a) => a.emphasis === "primary");
  const secondary = actions.filter((a) => a.emphasis !== "primary");
  const blocked = primary.find((a) => !a.allowed && a.reason);

  // The report stage does its work in the Report section. Hold, resume and cancel stay here.
  const reportNote =
    stage === "report" && !actions.some((a) => a.action === "resume") ? (
      <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Post-QC is complete. The final report is prepared in the{" "}
        <a href="#report" className="font-medium text-foreground underline-offset-4 hover:underline">
          Report
        </a>{" "}
        section below.
      </div>
    ) : null;
  if (!actions.length) return reportNote;

  return (
    <div className="space-y-2">
      {reportNote}
      <div className="flex flex-wrap items-center gap-2">
        {primary.map((a) => {
          const Icon = ICONS[a.action];
          return (
            <Button key={a.action} size="lg" disabled={!a.allowed || pending} onClick={() => run(a)} className="px-3.5">
              {pending ? <Spinner /> : Icon ? <Icon /> : null}
              {a.label}
            </Button>
          );
        })}
        {secondary.filter((a) => a.emphasis === "secondary").length ? (
          <div className="hidden flex-wrap gap-2 sm:flex">
            {secondary
              .filter((a) => a.emphasis === "secondary")
              .map((a) => {
                const Icon = ICONS[a.action];
                return (
                  <Button key={a.action} size="lg" variant="outline" disabled={pending} onClick={() => run(a)}>
                    {Icon ? <Icon /> : null}
                    {a.label}
                  </Button>
                );
              })}
          </div>
        ) : null}
        {secondary.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="lg" variant="outline" aria-label="More case actions" className={cn(!secondary.some((a) => a.emphasis === "danger") && "sm:hidden")}>
                More <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {secondary.map((a) => {
                const Icon = ICONS[a.action];
                return (
                  <DropdownMenuItem
                    key={a.action}
                    onSelect={() => run(a)}
                    variant={a.emphasis === "danger" ? "destructive" : "default"}
                    className={cn(a.emphasis === "secondary" && "sm:hidden")}
                  >
                    {Icon ? <Icon /> : null}
                    {a.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {blocked ? <p className="text-sm text-muted-foreground">{blocked.reason}</p> : null}

      <ReasonDialog
        open={dialog === "submit_post_qc_pending"}
        onOpenChange={(o) => setDialog(o ? "submit_post_qc_pending" : null)}
        title="Send to Post-QC with pending checks"
        description="The report shows these checks as pending and the result can't be Clear. Say why it can't wait."
        placeholder="e.g. The police report is delayed and the client needs the rest now."
        confirmLabel="Send to Post-QC"
        success="Sent to Post-QC"
        onSubmit={(reason) => transitionCase(caseId, "submit_post_qc", reason)}
      />
      <ReasonDialog
        open={dialog === "hold"}
        onOpenChange={(o) => setDialog(o ? "hold" : null)}
        title="Put the case on hold"
        description="Work on the case stops and nothing more goes out. The clock stops counting against the team. The client sees the case as on hold, and they and the candidate can still send in what was asked for."
        placeholder="e.g. Client asked us to pause until the candidate accepts the offer."
        confirmLabel="Put on hold"
        success="Case on hold"
        onSubmit={(reason) => setCaseHold(caseId, true, reason)}
      />
      <ReasonDialog
        open={dialog === "return_to_documents"}
        onOpenChange={(o) => setDialog(o ? "return_to_documents" : null)}
        title="Send back to document collection"
        description={`Use this when a document is missing or wrong. The ${processType === "candidate_collected" ? "candidate" : "client"} reads what you write here, so say what is needed.`}
        label="What is missing or wrong"
        placeholder="e.g. The service letter is for a different employer. Please send the one from your last employer."
        confirmLabel="Send back"
        success="Sent back to documents"
        onSubmit={async (reason) => {
          const r = await transitionCase(caseId, "return_to_documents", reason);
          if (r.ok && r.warning) toast.warning(r.warning);
          // Data entry's part is over here too.
          if (r.ok && r.left) router.push("/app/queues");
          return r;
        }}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title={revising ? "Stop the revision" : "Cancel this case"}
        description={revising ? "The released report stands, and the case goes back to released." : "Cancelling closes the case for good. It stays in the records with your reason."}
        placeholder={revising ? "e.g. The client confirmed no change is needed." : "e.g. The candidate withdrew."}
        confirmLabel={revising ? "Stop the revision" : "Cancel case"}
        destructive
        success={revising ? "Revision stopped" : "Case cancelled"}
        onSubmit={(reason) => cancelCase(caseId, reason)}
      />
      <QcDialog
        open={dialog === "pre_qc_review" || dialog === "post_qc_review"}
        onOpenChange={(o) => !o && setDialog(null)}
        kind={dialog === "post_qc_review" ? "post" : "pre"}
        caseId={caseId}
        processType={processType}
        checks={checks}
        checklist={dialog === "post_qc_review" ? checklists.post : checklists.pre}
        filesWithoutOriginalNote={filesWithoutOriginalNote}
      />
    </div>
  );
}

function QcDialog({
  open,
  onOpenChange,
  kind,
  caseId,
  processType,
  checks,
  checklist,
  filesWithoutOriginalNote,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: "pre" | "post";
  caseId: string;
  processType: ProcessType;
  checks: { id: string; label: string; state: CheckState }[];
  checklist: string[];
  filesWithoutOriginalNote: number;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setFormKey((k) => k + 1);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <QcForm
          key={`${kind}-${formKey}`}
          kind={kind}
          caseId={caseId}
          processType={processType}
          checks={checks}
          checklist={checklist}
          filesWithoutOriginalNote={filesWithoutOriginalNote}
          onDone={() => {
            onOpenChange(false);
            setFormKey((k) => k + 1);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function QcForm({
  kind,
  caseId,
  processType,
  checks,
  checklist,
  filesWithoutOriginalNote,
  onDone,
}: {
  kind: "pre" | "post";
  caseId: string;
  processType: ProcessType;
  checks: { id: string; label: string; state: CheckState }[];
  checklist: string[];
  filesWithoutOriginalNote: number;
  onDone: () => void;
}) {
  const items = kind === "pre" && processType === "candidate_collected" ? [...checklist, "Signed consent form received"] : checklist;
  const [ticks, setTicks] = useState<boolean[]>(() => items.map(() => false));
  const [decision, setDecision] = useState<"approved" | "returned">("approved");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [returnIds, setReturnIds] = useState<string[]>([]);
  const [returnTo, setReturnTo] = useState<"verification" | "data_entry">("verification");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const unticked = ticks.filter((t) => !t).length;

  const submit = () => {
    if (decision === "returned" && !remarks.trim()) return setError("Say what needs correcting.");
    if (kind === "post" && decision === "returned" && returnIds.length === 0) return setError("Choose the checks that need more work.");
    if (kind === "pre" && decision === "returned" && !message.trim()) return setError("Say what you need sent or corrected.");
    if (decision === "approved" && unticked > 0 && !remarks.trim()) return setError("Say in the remarks why you are approving with items unticked.");
    start(async () => {
      const r = await recordQcReview(caseId, {
        kind,
        decision,
        checklist: items.map((item, i) => ({ item, ok: ticks[i] })),
        remarks: remarks.trim() || undefined,
        returnCheckIds: decision === "returned" ? returnIds : [],
        returnTo,
        message: decision === "returned" && message.trim() ? message.trim() : undefined,
      });
      if (r.ok) {
        toast.success(decision === "approved" ? (kind === "pre" ? "Pre-QC approved: on to data entry" : "Post-QC approved: ready for the report") : "Returned for correction");
        if (r.warning) toast.warning(r.warning);
        onDone();
      } else setError(r.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>{kind === "pre" ? "Pre-QC review" : "Post-QC review"}</DialogTitle>
        <DialogDescription>
          {kind === "pre"
            ? "Check the documents before data entry. Approving sends the case to data entry; returning sends it back to document collection."
            : "Check the findings before the report. Approving sends the case to the final report; returning reopens the checks you pick, at verification or data entry."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Checklist</legend>
          {items.map((item, i) => (
            <label key={item} className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={ticks[i]} onCheckedChange={(c) => setTicks((t) => t.map((v, j) => (j === i ? c === true : v)))} />
              {item}
            </label>
          ))}
        </fieldset>

        <div role="radiogroup" aria-label="Decision" className="grid grid-cols-2 gap-2">
          {(["approved", "returned"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={decision === d}
              onClick={() => setDecision(d)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                decision === d
                  ? d === "approved"
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-warning/50 bg-warning/15 text-warning-foreground dark:text-warning"
                  : "hover:bg-muted",
              )}
            >
              {d === "approved" ? <CheckCircle2 className="size-4" /> : <RotateCcw className="size-4" />}
              {d === "approved" ? "Approve" : "Return"}
            </button>
          ))}
        </div>

        {kind === "post" && decision === "returned" ? (
          <div role="radiogroup" aria-label="Where the case goes back to" className="grid grid-cols-2 gap-2">
            {(
              [
                ["verification", "Back to verification", "The finding or evidence needs more work."],
                ["data_entry", "Back to data entry", "The details themselves are wrong."],
              ] as const
            ).map(([to, title, hint]) => (
              <button
                key={to}
                type="button"
                role="radio"
                aria-checked={returnTo === to}
                onClick={() => setReturnTo(to)}
                className={cn("rounded-xl border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50", returnTo === to ? "border-brand-blue/50 bg-brand-blue/5 dark:border-brand-sky/50 dark:bg-brand-sky/10" : "hover:bg-muted")}
              >
                <span className="block font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        {kind === "post" && decision === "returned" ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Checks that need more work</legend>
            {checks.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={returnIds.includes(c.id)} onCheckedChange={(v) => setReturnIds((ids) => (v ? [...ids, c.id] : ids.filter((x) => x !== c.id)))} />
                <span>{c.label}</span>
                <span className="text-xs text-muted-foreground">{CHECK_STATE_LABELS[c.state]}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="qc-remarks" className="text-sm font-medium">
            Remarks {decision === "approved" && unticked === 0 ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
          </label>
          <Textarea
            id="qc-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder={decision === "returned" ? "What needs correcting, and where." : "Anything the next stage should know."}
          />
        </div>

        {kind === "pre" && decision === "returned" ? (
          <div className="space-y-1.5">
            <label htmlFor="qc-message" className="text-sm font-medium">
              Message to the {processType === "candidate_collected" ? "candidate" : "client"}
            </label>
            <Textarea
              id="qc-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="What they need to send or correct. They see exactly this."
            />
          </div>
        ) : null}

        {kind === "pre" && filesWithoutOriginalNote > 0 ? (
          <p className="text-sm text-muted-foreground">
            {filesWithoutOriginalNote} {filesWithoutOriginalNote === 1 ? "file isn't" : "files aren't"} marked as an original or a copy yet. Mark them under Documents.
          </p>
        ) : null}
        {decision === "approved" && unticked > 0 ? (
          <p className="text-sm text-warning-foreground dark:text-warning">
            {unticked} checklist {unticked === 1 ? "item isn't" : "items aren't"} ticked. To approve anyway, say why in the remarks: the review records it.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending} variant={decision === "approved" ? "default" : "destructive"}>
          {pending ? <Spinner /> : null}
          {decision === "approved" ? "Approve" : "Return for correction"}
        </Button>
      </DialogFooter>
    </form>
  );
}
