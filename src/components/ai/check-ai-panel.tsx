"use client";

import { useState, useTransition } from "react";
import { Check, ClipboardPaste, Copy, Loader2, Mail, Phone, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { acceptRemarks, captureReply, decideSuggestion, markOutreachUsed, requestOutreachDraft } from "@/app/(staff)/app/cases/[caseId]/ai-actions";
import { OutcomeForm, type OutcomeValues } from "@/app/(staff)/app/cases/[caseId]/checks/[checkId]/status-panel";
import type { OutreachResult, ResponseResult } from "@/lib/ai/prompts";
import type { ResultOption } from "@/domain/check-types/schema";
import { outcomeForResult, type SuggestionDecision } from "@/domain/ai/suggestions";
import { cn } from "@/lib/utils";
import { ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AiBadge, AiOffNote } from "./ai-badge";

type Item<T> = { id: string; decision: SuggestionDecision; value: T; createdAt: string; confidence: number | null };

export type CheckAiProps = {
  checkId: string;
  checkLabel: string;
  configured: boolean;
  working: string[];
  outreach?: Item<OutreachResult>;
  response?: Item<Partial<ResponseResult>>;
  remarks?: Item<{ text: string }>;
  currentRemarks: string | null;
  options: ResultOption[];
  /** checks.verify on this check (officer, case owner or manager). */
  canVerify: boolean;
  /** The outcome can be recorded now (verification stage, details complete, not closed). */
  canRecord: boolean;
  canRemarks: boolean;
  remarksLocked: boolean;
  closed: boolean;
};

const TONE = { green: "success", amber: "warning", red: "danger" } as const;

/** The AI's help on one check: an outreach draft, turning a reply into a proposed result, and report remarks. */
export function CheckAiPanel(props: CheckAiProps) {
  const { configured, outreach, response, remarks, canVerify, working } = props;
  const nothing = !outreach && !response && !remarks;
  if (!configured && nothing) return null;
  if (!canVerify && nothing) return null;
  return (
    <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-brand-blue dark:text-brand-sky" aria-hidden /> AI help
      </h2>
      {!configured ? <AiOffNote>AI isn&apos;t set up, so new drafts can&apos;t be made.</AiOffNote> : null}
      <Outreach {...props} busy={working.includes("ai.outreach_draft")} />
      <Reply {...props} busy={working.includes("ai.response_capture")} />
      {remarks ? <Remarks {...props} item={remarks} /> : null}
    </section>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it instead.");
  }
}

function Outreach({ checkId, outreach, configured, canVerify, closed, busy }: CheckAiProps & { busy: boolean }) {
  const [target, setTarget] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const draft = outreach?.value;
  const request = () =>
    start(async () => {
      const r = await requestOutreachDraft(checkId, target);
      if (r.ok) {
        toast.success("Drafting", { description: "The draft appears here in a moment." });
        setAsking(false);
      } else toast.error(r.error);
    });
  const used = (awaiting: boolean) =>
    start(async () => {
      if (!outreach) return;
      const r = await markOutreachUsed(outreach.id, awaiting);
      if (r.ok) toast.success(awaiting ? "Marked awaiting reply" : "Marked as used");
      else toast.error(r.error);
    });
  const mayAsk = configured && canVerify && !closed;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Verification request</h3>
        {outreach ? <AiBadge className="ml-auto" /> : null}
      </div>
      {busy ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Drafting…
        </p>
      ) : null}
      {draft ? (
        <div className={cn("space-y-2 rounded-lg border p-3 text-sm", outreach?.decision !== "pending" && "bg-muted/30")}>
          <p className="font-medium">{draft.subject}</p>
          <p className="whitespace-pre-line text-muted-foreground">{draft.body}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onClick={() => copy(`${draft.subject}\n\n${draft.body}`, "Email")}>
              <Copy /> Copy email
            </Button>
            {draft.call_script ? (
              <Button size="xs" variant="ghost" onClick={() => copy(draft.call_script ?? "", "Call script")}>
                <Phone /> Copy call script
              </Button>
            ) : null}
          </div>
          {draft.call_script ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Call script</summary>
              <p className="mt-1 whitespace-pre-line">{draft.call_script}</p>
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Follow up in {draft.follow_up_days} day{draft.follow_up_days === 1 ? "" : "s"} if there&apos;s no reply · <RelativeTime iso={outreach!.createdAt} />
          </p>
          {canVerify && !closed && outreach?.decision === "pending" ? (
            <div className="flex flex-wrap gap-1.5 border-t pt-2">
              <Button size="xs" onClick={() => used(true)} disabled={pending}>
                {pending ? <Spinner /> : <Check />} Sent · awaiting reply
              </Button>
              <Button size="xs" variant="ghost" onClick={() => used(false)} disabled={pending}>
                Mark used
              </Button>
            </div>
          ) : outreach?.decision !== "pending" ? (
            <p className="text-xs text-muted-foreground">Marked as used.</p>
          ) : null}
        </div>
      ) : !busy ? (
        <p className="text-xs text-muted-foreground">{mayAsk ? "Get a short email and call script to confirm these details with the source." : "No draft yet."}</p>
      ) : null}
      {mayAsk ? (
        asking ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              request();
            }}
          >
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Who to contact (optional), e.g. HR, ABC Ltd" maxLength={200} aria-label="Who to contact" />
            <div className="flex gap-1.5">
              <Button size="xs" type="submit" disabled={pending || busy}>
                {pending ? <Spinner /> : <Sparkles />} Draft
              </Button>
              <Button size="xs" variant="ghost" type="button" onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setAsking(true)} disabled={busy}>
            {draft ? <RefreshCw /> : <Sparkles />} {draft ? "New draft" : "Draft a request"}
          </Button>
        )
      ) : null}
    </div>
  );
}

function Reply({ checkId, response, options, configured, canVerify, canRecord, closed, busy }: CheckAiProps & { busy: boolean }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pending, start] = useTransition();
  const v = response?.value;
  const option = options.find((o) => o.key === v?.proposed_result);
  const outcome = outcomeForResult(option);
  const mayCapture = configured && canVerify && !closed;

  const submit = () =>
    start(async () => {
      const r = await captureReply(checkId, text);
      if (r.ok) {
        toast.success("Reading the reply", { description: "The proposed result appears here in a moment." });
        setText("");
        setOpen(false);
      } else toast.error(r.error);
    });
  const dismiss = () =>
    start(async () => {
      if (!response) return;
      const r = await decideSuggestion(response.id, "rejected");
      if (r.ok) toast.success("Dismissed");
      else toast.error(r.error);
    });
  const recorded = (values: OutcomeValues) =>
    start(async () => {
      setRecording(false);
      if (!response || response.decision !== "pending") return;
      const kept = values.result === v?.proposed_result;
      await decideSuggestion(response.id, kept ? "accepted" : "edited", kept ? undefined : { ...v, proposed_result: values.result, client_note: values.clientNote });
    });

  if (!mayCapture && !response) return null;
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center gap-2">
        <ClipboardPaste className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Reply from the source</h3>
        {response ? <AiBadge className="ml-auto" confidence={response.confidence} /> : null}
      </div>
      {busy ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the reply…
        </p>
      ) : null}
      {v ? (
        <div className={cn("space-y-2 rounded-lg border p-3 text-sm", response?.decision !== "pending" && "bg-muted/30")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Proposed</span>
            {option ? <ToneChip tone={TONE[option.tone]}>{option.label}</ToneChip> : <ToneChip tone="neutral">No clear result</ToneChip>}
            {response?.decision !== "pending" ? <span className="text-xs text-muted-foreground">{response?.decision === "edited" ? "Recorded with changes" : "Recorded"}</span> : null}
          </div>
          {v.comparisons?.length ? (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 text-left font-normal">Detail</th>
                  <th className="py-1 pr-2 text-left font-normal">Declared</th>
                  <th className="py-1 text-left font-normal">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {v.comparisons.map((c, n) => (
                  <tr key={n} className={cn(c.matches === false && "text-destructive")}>
                    <td className="py-1 pr-2 align-top">{c.field}</td>
                    <td className="py-1 pr-2 align-top">{c.claimed ?? "—"}</td>
                    <td className="py-1 align-top">
                      {c.confirmed ?? <span className="text-muted-foreground">Not confirmed</span>}
                      {c.matches === false ? <span className="sr-only"> (doesn&apos;t match)</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {v.reasoning ? <p className="text-xs text-muted-foreground">{v.reasoning}</p> : null}
          {v.client_note ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Note for the client: </span>
              {v.client_note}
            </p>
          ) : null}
          {response?.decision === "pending" && canVerify && !closed ? (
            <div className="flex flex-wrap gap-1.5 border-t pt-2">
              {outcome && canRecord ? (
                <Button size="xs" onClick={() => setRecording(true)} disabled={pending}>
                  <Check /> Review and record
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {!outcome ? "The reply doesn't settle the check yet." : "Record the outcome during verification, once the details are complete."}
                </span>
              )}
              <Button size="xs" variant="ghost" onClick={dismiss} disabled={pending}>
                <X /> Dismiss
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {mayCapture ? (
        open ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={8000} placeholder="Paste the email reply, or type what the source said on the phone." aria-label="Reply from the source" />
            <div className="flex items-center gap-1.5">
              <Button size="xs" type="submit" disabled={pending || busy || text.trim().length < 20}>
                {pending ? <Spinner /> : <Sparkles />} Read the reply
              </Button>
              <Button size="xs" variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <span className="ml-auto text-[11px] text-muted-foreground">{text.length}/8000</span>
            </div>
          </form>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setOpen(true)} disabled={busy}>
            <ClipboardPaste /> {v ? "Capture another reply" : "Capture a reply"}
          </Button>
        )
      ) : null}
      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent className="sm:max-w-md">
          {recording && outcome ? (
            <OutcomeForm
              checkId={checkId}
              options={options}
              initial={{ outcome, result: v?.proposed_result ?? undefined, clientNote: v?.client_note ?? "", note: v?.reasoning ? `From the reply: ${v.reasoning}` : "" }}
              description="Filled in from the AI's reading of the reply. Check it against the reply before you record it."
              onDone={recorded}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Remarks({ item, currentRemarks, canRemarks, remarksLocked }: CheckAiProps & { item: Item<{ text: string }> }) {
  const [text, setText] = useState(item.value.text);
  const [pending, start] = useTransition();
  const can = canRemarks && !remarksLocked;
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Suggested report remarks</h3>
        <AiBadge className="ml-auto" />
      </div>
      {currentRemarks ? <p className="text-xs text-muted-foreground">Now: {currentRemarks}</p> : null}
      {can ? <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Suggested report remarks" /> : <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">{item.value.text}</p>}
      {can ? (
        <div className="flex gap-1.5">
          <Button
            size="xs"
            onClick={() =>
              start(async () => {
                const r = await acceptRemarks(item.id, text);
                if (r.ok) toast.success("Remarks updated");
                else toast.error(r.error);
              })
            }
            disabled={pending || !text.trim()}
          >
            {pending ? <Spinner /> : <Check />} {currentRemarks ? "Replace remarks" : "Use as remarks"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              start(async () => {
                const r = await decideSuggestion(item.id, "rejected");
                if (r.ok) toast.success("Dismissed");
                else toast.error(r.error);
              })
            }
            disabled={pending}
          >
            <X /> Dismiss
          </Button>
        </div>
      ) : remarksLocked ? (
        <p className="text-xs text-muted-foreground">Remarks are locked once the report is with the approver.</p>
      ) : null}
    </div>
  );
}
