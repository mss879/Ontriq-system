"use client";

import { useState, useTransition } from "react";
import { Check, CheckCircle2, Copy, FileQuestion, Loader2, MailQuestion, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { acceptRemarks, decideSuggestion, rerunCaseAi } from "@/app/(staff)/app/cases/[caseId]/ai-actions";
import { AskCandidateDialog, type AskCheck, type AskPrefill } from "@/app/(staff)/app/cases/[caseId]/_components/candidate-dialogs";
import { RequestDialog } from "@/app/(staff)/app/cases/[caseId]/_components/documents-panel";
import type { ConsistencyResult, PostQcResult, PreQcResult } from "@/lib/ai/prompts";
import type { RerunCapability, SuggestionDecision } from "@/domain/ai/suggestions";
import { RERUN } from "@/domain/ai/suggestions";
import { cn } from "@/lib/utils";
import { ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AiBadge, AiOffNote } from "./ai-badge";

type Item<T> = { id: string; decision: SuggestionDecision; value: T; createdAt: string; confidence: number | null };

export type CopilotData = {
  consistency?: Item<ConsistencyResult>;
  preqc?: Item<PreQcResult>;
  postqc?: Item<PostQcResult>;
  summary?: Item<{ text: string }>;
  /** canUse: this person may word this check (public.set_check_remarks). */
  remarks: (Item<{ text: string }> & { checkId: string; checkLabel: string; current: string | null; canUse: boolean })[];
};

export type CopilotProps = {
  caseId: string;
  data: CopilotData;
  /** New runs are possible (API key present). Existing suggestions show either way. */
  configured: boolean;
  /** Job kinds still queued or running for this case. */
  working: string[];
  perms: { rerun: Partial<Record<RerunCapability, boolean>>; pre: boolean; post: boolean; remarks: boolean; askCandidate: boolean; requestClient: boolean; askDocuments: boolean };
  /** Why remarks can't be used now, if they can't. */
  remarksLocked: string | null;
  candidate: { checks: AskCheck[]; categories: { key: string; name: string; guide: string }[]; linkActive: boolean } | null;
  request: { categories: { key: string; name: string }[]; checks: { id: string; label: string }[]; candidateCollected: boolean };
};

const SEVERITY = { high: "danger", medium: "warning", low: "neutral" } as const;
const RESULT = { green: { tone: "success", label: "Green (clear)" }, amber: { tone: "warning", label: "Amber (review)" }, red: { tone: "danger", label: "Red (discrepancy)" } } as const;

export function CaseCopilot(props: CopilotProps) {
  const { data, configured, working } = props;
  const has = Boolean(data.consistency || data.preqc || data.postqc || data.summary || data.remarks.length);
  const anyRerun = Object.values(props.perms.rerun).some(Boolean);
  if (!has && !working.length) {
    if (!configured) return <AiOffNote />;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Nothing yet. The AI reads each file as it arrives, checks the case for consistency at Pre-QC, cross-checks it at Post-QC and drafts the report remarks. Its suggestions appear here for you to accept or dismiss.
        </p>
        {anyRerun ? <RerunRow {...props} /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {!configured ? <AiOffNote>AI isn&apos;t set up, so these suggestions won&apos;t be refreshed. You can still use them.</AiOffNote> : null}
      {working.length ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Working on {working.map(jobLabel).join(", ")}…
        </p>
      ) : null}
      {data.postqc ? <PostQc {...props} item={data.postqc} /> : null}
      {data.remarks.length || data.summary ? <Narrative {...props} /> : null}
      {data.preqc ? <PreQc {...props} item={data.preqc} /> : null}
      {data.consistency ? <Consistency {...props} item={data.consistency} /> : null}
      {anyRerun && configured ? <RerunRow {...props} /> : null}
    </div>
  );
}

const JOB_LABELS: Record<string, string> = {
  "ai.consistency": "the consistency check",
  "ai.preqc_copilot": "the Pre-QC review",
  "ai.postqc": "the Post-QC cross-check",
  "ai.narrative": "the report remarks",
  "ai.classify_document": "reading files",
  "ai.extract_fields": "pre-filling checks",
  "ai.outreach_draft": "an outreach draft",
  "ai.response_capture": "a reply",
};
const jobLabel = (k: string) => JOB_LABELS[k] ?? k.replace(/^ai\./, "").replace(/_/g, " ");

function Card({ icon, title, item, children, actions }: { icon: React.ReactNode; title: string; item: Item<unknown>; children: React.ReactNode; actions?: React.ReactNode }) {
  const decided = item.decision !== "pending";
  return (
    <article className={cn("rounded-xl border p-4", decided && "bg-muted/30")}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-brand-blue dark:text-brand-sky" aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <AiBadge confidence={item.confidence} />
        {decided ? (
          <ToneChip tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
            {item.decision === "rejected" ? "Dismissed" : "Reviewed"}
          </ToneChip>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          <RelativeTime iso={item.createdAt} />
        </span>
      </header>
      {children}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">{actions}</div> : null}
    </article>
  );
}

function useDecide(id: string) {
  const [pending, start] = useTransition();
  const decide = (decision: "accepted" | "rejected", success: string) =>
    start(async () => {
      const r = await decideSuggestion(id, decision);
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });
  return { pending, decide };
}

function ReviewButtons({ item, allowed, keepLabel = "Mark reviewed" }: { item: Item<unknown>; allowed: boolean; keepLabel?: string }) {
  const { pending, decide } = useDecide(item.id);
  if (!allowed || item.decision !== "pending") return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => decide("accepted", "Marked reviewed")} disabled={pending}>
        {pending ? <Spinner /> : <Check />} {keepLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => decide("rejected", "Dismissed")} disabled={pending}>
        <X /> Dismiss
      </Button>
    </>
  );
}

function Consistency({ item, perms }: CopilotProps & { item: Item<ConsistencyResult> }) {
  const v = item.value;
  return (
    <Card icon={<FileQuestion className="size-4" />} title="Consistency across documents" item={item} actions={<ReviewButtons item={item} allowed={perms.pre || perms.post} />}>
      <p className="text-sm">{v.summary}</p>
      {v.issues.length ? (
        <ul className="mt-3 space-y-2">
          {v.issues.map((i, n) => (
            <li key={n} className="flex gap-2 text-sm">
              <ToneChip tone={SEVERITY[i.severity]} className="mt-0.5 h-5 px-2 text-[11px]">
                {i.severity}
              </ToneChip>
              <div className="min-w-0">
                <p>
                  <span className="font-medium capitalize">{i.topic}</span>: {i.description}
                </p>
                {i.documents.length ? <p className="text-xs text-muted-foreground">{i.documents.join(", ")}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden /> No inconsistencies found.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">A possible issue is not proof of wrongdoing. Check the originals before deciding.</p>
    </Card>
  );
}

function PreQc(props: CopilotProps & { item: Item<PreQcResult> }) {
  const { item, perms, candidate, request, caseId } = props;
  const v = item.value;
  const [ask, setAsk] = useState<AskPrefill | null>(null);
  const [req, setReq] = useState<{ category?: string; note?: string } | null>(null);
  return (
    <Card icon={<ShieldCheck className="size-4" />} title="Pre-QC review" item={item} actions={<ReviewButtons item={item} allowed={perms.pre} />}>
      <p className="text-sm">{v.summary}</p>
      {v.checklist.length ? (
        <ul className="mt-3 space-y-1">
          {v.checklist.map((c, n) => (
            <li key={n} className="flex gap-2 text-sm">
              <span aria-hidden className={cn("mt-0.5", c.ok ? "text-success" : "text-warning-foreground dark:text-warning")}>
                {c.ok ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
              </span>
              <span className="sr-only">{c.ok ? "OK:" : "Needs attention:"}</span>
              <span className="min-w-0">
                {c.item}
                {c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {v.requests.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Drafted requests</p>
          {v.requests.map((r, n) => {
            const toCandidate = r.to === "candidate";
            const enabled = toCandidate ? perms.askCandidate && Boolean(candidate) && (r.kind !== "document" || perms.askDocuments) : perms.requestClient;
            return (
              <div key={n} className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <ToneChip tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                    To the {r.to}
                  </ToneChip>
                </div>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{r.message}</p>
                {enabled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() =>
                      toCandidate
                        ? setAsk(r.kind === "document" && r.category ? { kind: "document", category: r.category, title: r.title, help: r.message } : { kind: "question", title: r.title, help: r.message })
                        : setReq({ category: r.category ?? undefined, note: r.message })
                    }
                  >
                    {toCandidate ? <UserRound /> : <MailQuestion />} {toCandidate ? "Ask the candidate" : "Request from the client"}
                  </Button>
                ) : null}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Each opens the usual request form, filled in. Check the wording before you send it.</p>
        </div>
      ) : null}
      {candidate ? (
        <AskCandidateDialog
          open={ask !== null}
          onOpenChange={(o) => !o && setAsk(null)}
          caseId={caseId}
          checks={candidate.checks}
          categories={candidate.categories}
          linkActive={candidate.linkActive}
          initial={ask ?? undefined}
          askDocuments={perms.askDocuments}
        />
      ) : null}
      <RequestDialog open={req !== null} onOpenChange={(o) => !o && setReq(null)} caseId={caseId} categories={request.categories} checks={request.checks} candidateCollected={request.candidateCollected} initial={req ?? undefined} />
    </Card>
  );
}

function PostQc({ item, perms }: CopilotProps & { item: Item<PostQcResult> }) {
  const v = item.value;
  const result = RESULT[v.proposed_result];
  return (
    <Card icon={<ShieldCheck className="size-4" />} title="Post-QC cross-check" item={item} actions={<ReviewButtons item={item} allowed={perms.post} />}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Proposed result</span>
        <ToneChip tone={result.tone}>{result.label}</ToneChip>
      </div>
      <p className="mt-2 text-sm">{v.reasoning}</p>
      {v.checks.some((c) => !c.ok || c.concerns.length) ? (
        <ul className="mt-3 space-y-2">
          {v.checks
            .filter((c) => !c.ok || c.concerns.length)
            .map((c, n) => (
              <li key={n} className="text-sm">
                <p className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-3.5 text-warning-foreground dark:text-warning" aria-hidden /> {c.check}
                </p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-6 text-muted-foreground">
                  {c.concerns.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden /> No concerns with the recorded checks.
        </p>
      )}
      {v.missing.length ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">Still missing:</span> <span className="text-muted-foreground">{v.missing.join("; ")}</span>
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">The approver sets the final result. This is a second pair of eyes, not a decision.</p>
    </Card>
  );
}

function Narrative(props: CopilotProps) {
  const { data, perms, remarksLocked } = props;
  return (
    <article className="rounded-xl border p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-brand-blue dark:text-brand-sky" aria-hidden />
        <h3 className="text-sm font-semibold">Report remarks</h3>
        <AiBadge />
      </header>
      {remarksLocked ? <p className="mb-3 text-xs text-muted-foreground">{remarksLocked}</p> : null}
      <div className="space-y-4">
        {data.remarks.map((r) => (
          <RemarksDraft key={r.id} item={r} canAccept={perms.remarks && r.canUse && !remarksLocked} />
        ))}
        {data.summary ? <SummaryDraft item={data.summary} canDecide={perms.remarks} /> : null}
      </div>
    </article>
  );
}

function RemarksDraft({ item, canAccept }: { item: CopilotData["remarks"][number]; canAccept: boolean }) {
  const [text, setText] = useState(item.value.text);
  const [pending, start] = useTransition();
  const { pending: deciding, decide } = useDecide(item.id);
  const accept = () =>
    start(async () => {
      const r = await acceptRemarks(item.id, text);
      if (r.ok) toast.success(`Remarks added to ${item.checkLabel}`);
      else toast.error(r.error);
    });
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{item.checkLabel}</p>
      {item.current ? <p className="text-xs text-muted-foreground">Now: {item.current}</p> : null}
      {canAccept ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={`Suggested remarks for ${item.checkLabel}`} />
      ) : (
        <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">{item.value.text}</p>
      )}
      {canAccept ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={accept} disabled={pending || deciding || !text.trim()}>
            {pending ? <Spinner /> : <Check />} {item.current ? "Replace remarks" : "Use as remarks"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide("rejected", "Dismissed")} disabled={pending || deciding}>
            <X /> Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SummaryDraft({ item, canDecide }: { item: Item<{ text: string }>; canDecide: boolean }) {
  const { pending, decide } = useDecide(item.id);
  return (
    <div className="space-y-1.5 border-t pt-4">
      <p className="text-sm font-medium">Summary of the case</p>
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">{item.value.text}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(item.value.text).catch(() => undefined);
            toast.success("Copied");
          }}
        >
          <Copy /> Copy
        </Button>
        {canDecide ? (
          <Button size="sm" variant="ghost" onClick={() => decide("rejected", "Dismissed")} disabled={pending}>
            <X /> Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RerunRow({ caseId, perms, working, configured }: CopilotProps) {
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<RerunCapability | null>(null);
  const caps = (Object.keys(RERUN) as RerunCapability[]).filter((k) => perms.rerun[k]);
  if (!caps.length || !configured) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <span className="text-xs text-muted-foreground">Run again:</span>
      {caps.map((k) => {
        const busy = working.includes(RERUN[k].job) || (pending && which === k);
        return (
          <Button
            key={k}
            size="xs"
            variant="outline"
            disabled={busy || pending}
            onClick={() => {
              setWhich(k);
              start(async () => {
                const r = await rerunCaseAi(caseId, k);
                if (r.ok) toast.success(`${RERUN[k].label} queued`, { description: "The result appears here in a minute or two." });
                else toast.error(r.error);
              });
            }}
          >
            {busy ? <Spinner /> : <RefreshCw />} {RERUN[k].label}
          </Button>
        );
      })}
    </div>
  );
}
