"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileSignature,
  FileText,
  FileUp,
  Link2,
  Link2Off,
  Lock,
  MessageCircleQuestion,
  MessageSquarePlus,
  RotateCcw,
  Send,
  SendHorizontal,
  Sparkles,
  TextCursorInput,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { copyCandidateLink, makeCandidateReport, markCandidateMessagesRead, replyToCandidate, reviewConsent, reviewRequest, revokeLink, sendBgvForm, type AnswerClash } from "../candidate-actions";
import { decideSuggestion } from "../ai-actions";
import type { CandidatePanelData, CandidateRequestItem, ConsentInfo } from "@/lib/server/cases/candidate-queries";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/format";
import { ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { RelativeTime } from "@/components/cases/sla-badge";
import { useNow } from "@/hooks/use-now";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { answerText } from "@/domain/candidate/answers";
import { fieldDate } from "@/domain/reports/compile-core";
import type { Tone } from "@/domain/workflow/stages";
import { ReasonDialog } from "./reason-dialog";
import { AskCandidateDialog, copyText, CreateLinkDialog, PaperConsentDialog, ResendDialog, type AskCheck, type ContactAvailability } from "./candidate-dialogs";

const LANGUAGE = { en: "English", si: "Sinhala", ta: "Tamil" } as const;
const CHANNEL = { email: "email", sms: "SMS" } as Record<string, string>;

function SubHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{children}</p>
      {aside}
    </div>
  );
}

export function CandidatePanel({
  caseId,
  data,
  contact,
  checks,
  categories,
  consentDocuments,
  canManage,
  canReviewConsent,
  canUseAnswers,
  askDocuments,
  closed,
  erased,
  candidateCollected,
}: {
  caseId: string;
  data: CandidatePanelData;
  contact: ContactAvailability;
  checks: AskCheck[];
  categories: { key: string; name: string; guide: string }[];
  consentDocuments: { id: string; filename: string; createdAt: string }[];
  canManage: boolean;
  canReviewConsent: boolean;
  /** May copy an answer into its check (public.save_check_values). */
  canUseAnswers: boolean;
  /** Files can still come in, so they can still be asked for. */
  askDocuments: boolean;
  closed: boolean;
  /** The files are gone, so there is nothing to open. */
  erased: boolean;
  candidateCollected: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [sendingForm, startSendingForm] = useTransition();
  const linkActive = data.link?.state === "active";
  const unread = data.messages.filter((m) => m.fromKind === "candidate" && !m.readAt).length;
  const editable = canManage && !closed;

  // Opening the case marks the candidate's new messages as read.
  useEffect(() => {
    if (unread > 0 && canManage) void markCandidateMessagesRead(caseId);
  }, [unread, canManage, caseId]);

  return (
    <div className="@container space-y-6">
      <LinkCard caseId={caseId} data={data} contact={contact} editable={editable} candidateCollected={candidateCollected} />
      <ReportCard caseId={caseId} data={data} editable={editable} canMarkRead={canReviewConsent && !closed} erased={erased} />

      <div>
        <SubHeading
          aside={
            editable ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={sendingForm || !linkActive}
                  title={linkActive ? "Everything the checks let the candidate fill in, on their page" : "Send the candidate a link first"}
                  onClick={() =>
                    startSendingForm(async () => {
                      const r = await sendBgvForm(caseId);
                      if (!r.ok) toast.error(r.error);
                      else if (r.added) toast.success(`BGV form sent: ${r.added} ${r.added === 1 ? "part" : "parts"} on their page`);
                      else toast.info("The form is already on their page, or the details are all in.");
                    })
                  }
                >
                  {sendingForm ? <Spinner /> : <ClipboardList />} Send BGV form
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
                  <MessageSquarePlus /> Ask candidate
                </Button>
              </div>
            ) : null
          }
        >
          Requests
        </SubHeading>
        {data.requests.length ? (
          <ul className="divide-y rounded-xl border">
            {data.requests.map((q) => (
              <RequestRow key={q.id} q={q} checkLabel={checks.find((c) => c.id === q.caseCheckId)?.label ?? null} editable={editable} canUseAnswers={canUseAnswers && !closed} askDocuments={askDocuments} />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center">
            <p className="text-sm font-medium">Nothing asked yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Ask for a document, one detail of a check, or anything else. The required documents are already on their page.</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 @3xl:grid-cols-2">
        <ConsentBlock caseId={caseId} consent={data.consent} everIssued={data.everIssued} documents={consentDocuments} canReview={canReviewConsent && !closed} askDocuments={askDocuments} erased={erased} />
        <Messages caseId={caseId} data={data} editable={editable} />
      </div>

      <AskCandidateDialog open={asking} onOpenChange={setAsking} caseId={caseId} checks={checks} categories={categories} linkActive={linkActive} askDocuments={askDocuments} />
    </div>
  );
}

// ---------------------------------------------------------------- report

/** What the AI wrote up once the candidate confirmed. It sits with the candidate's work, apart from the verified report. */
function ReportCard({ caseId, data, editable, canMarkRead, erased }: { caseId: string; data: CandidatePanelData; editable: boolean; canMarkRead: boolean; erased: boolean }) {
  const [pending, start] = useTransition();
  const r = data.report;
  const make = () =>
    start(async () => {
      const result = await makeCandidateReport(caseId);
      if (result.ok) toast.success("Writing the report");
      else toast.error(result.error);
    });
  const markRead = (id: string) =>
    start(async () => {
      const result = await decideSuggestion(id, "accepted");
      if (!result.ok) toast.error(result.error);
    });
  if ((!r && !data.hasFiles) || erased) return null;
  const again = editable && !r?.locked && data.hasFiles && r?.status !== "queued";
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Candidate report</p>
          <p className="text-xs text-muted-foreground">
            {r?.locked ? "It holds sensitive evidence, which your role can't open." : !r ? "Written when the candidate confirms." : r.status === "queued" ? "The AI is writing it. This page updates by itself." : r.status === "failed" ? "It couldn't be made." : `Version ${r.version}${r.pageCount ? ` · ${r.pageCount} pages` : ""} · not verified`}
            {r?.confirmedAt ? (
              <>
                {" · confirmed "}
                <RelativeTime iso={r.confirmedAt} />
              </>
            ) : null}
          </p>
        </div>
        {r?.locked ? <Lock className="size-4 text-muted-foreground" aria-label="Sensitive evidence" /> : null}
        {r?.status === "queued" ? <Spinner /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {r?.status === "ready" && !r.locked ? (
            <>
              <Button size="sm" asChild>
                <a href={`/api/documents/${r.id}`} target="_blank" rel="noopener">
                  <ExternalLink /> Open
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/documents/${r.id}?download=1`}>
                  <Download /> Download
                </a>
              </Button>
            </>
          ) : null}
          {again ? (
            <Button variant="outline" size="sm" onClick={make} disabled={pending}>
              <RotateCcw /> {r ? "Make it again" : "Make it now"}
            </Button>
          ) : null}
        </div>
      </div>
      {r?.status === "ready" && r.ai ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm leading-relaxed">{r.ai.summary}</p>
          {r.ai.points_to_check.length ? (
            <div>
              <p className="text-xs font-semibold">To check</p>
              <ul className="mt-1 space-y-1">
                {r.ai.points_to_check.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
                    <span>
                      {p.note}
                      {p.appendix.length ? ` (${p.appendix.join(", ")})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden /> Written by AI from what the candidate provided. Check it against the appendix.
            </p>
            {r.suggestionId && canMarkRead ? (
              <Button variant="ghost" size="sm" onClick={() => markRead(r.suggestionId as string)} disabled={pending}>
                <Check /> Mark as read
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- link

function LinkCard({ caseId, data, contact, editable, candidateCollected }: { caseId: string; data: CandidatePanelData; contact: ContactAvailability; editable: boolean; candidateCollected: boolean }) {
  const [creating, setCreating] = useState(false);
  const [resending, setResending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copying, startCopy] = useTransition();
  const link = data.link;

  const status: { label: string; tone: Tone } = !link
    ? { label: "Not sent", tone: "neutral" }
    : link.state === "active"
      ? { label: `Active until ${formatDate(link.expiresAt)}`, tone: "success" }
      : link.state === "expired"
        ? { label: "Expired", tone: "warning" }
        : { label: "Turned off", tone: "neutral" };

  const copy = () =>
    startCopy(async () => {
      if (!link) return;
      const r = await copyCandidateLink(link.id);
      if (r.ok) await copyText(r.url);
      else toast.error(r.error);
    });

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", link?.state === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
            {link && link.state !== "active" ? <Link2Off className="size-4" /> : <Link2 className="size-4" />}
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Secure candidate page</p>
              <ToneChip tone={status.tone}>{status.label}</ToneChip>
            </div>
            {!link ? (
              <p className="text-sm text-muted-foreground">
                {candidateCollected
                  ? "Ontriq collects this candidate's documents. Send them a private page to upload, answer and sign the consent form."
                  : "Optional for client-supplied cases: send one if the candidate should upload or sign anything themselves. Their consent is then needed before Pre-QC."}
              </p>
            ) : (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>
                  {link.sentAt ? (
                    <>
                      Sent by {link.sentVia.map((c) => CHANNEL[c] ?? c).join(" and ") || "hand"} <RelativeTime iso={link.sentAt} />
                      {link.sentCount > 1 ? ` · sent ${link.sentCount} times` : ""}
                    </>
                  ) : (
                    "Created, not sent yet"
                  )}
                  {" · "}
                  {LANGUAGE[link.language]}
                </li>
                <li>
                  {link.openCount ? (
                    <>
                      Opened {link.openCount === 1 ? "once" : `${link.openCount} times`}
                      {link.lastOpenedAt ? (
                        <>
                          , last <RelativeTime iso={link.lastOpenedAt} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    "Not opened yet"
                  )}
                  {link.remindersSent ? ` · ${link.remindersSent} ${link.remindersSent === 1 ? "reminder" : "reminders"} sent` : ""}
                </li>
                {link.state === "revoked" && link.revokedReason ? <li>Turned off: {link.revokedReason}</li> : null}
              </ul>
            )}
            {link?.escalatedAt && link.state === "active" ? (
              <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-warning-foreground dark:text-warning">
                <TriangleAlert className="size-3.5" /> No response after every reminder. Call the candidate or the client.
              </p>
            ) : null}
          </div>
        </div>
        {editable ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            {link?.state === "active" ? (
              <>
                <Button variant="outline" size="sm" onClick={copy} disabled={copying}>
                  {copying ? <Spinner /> : <Copy />} Copy link
                </Button>
                <Button variant="outline" size="sm" onClick={() => setResending(true)} disabled={!contact.email && !contact.phone}>
                  <Send /> Send again
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRevoking(true)}>
                  <Link2Off /> Turn off
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Send /> {link ? "Create a new link" : "Create and send link"}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <CreateLinkDialog open={creating} onOpenChange={setCreating} caseId={caseId} contact={contact} replacing={Boolean(link)} />
      {link ? (
        <>
          <ResendDialog open={resending} onOpenChange={setResending} linkId={link.id} contact={contact} />
          <ReasonDialog
            open={revoking}
            onOpenChange={setRevoking}
            title="Turn off the candidate's link?"
            description="It stops working at once. Their uploads and answers stay on the case, and you can send a new link later."
            label="Reason (optional)"
            placeholder="Documents collected another way."
            confirmLabel="Turn off"
            required={false}
            destructive
            success="Link turned off"
            onSubmit={(reason) => revokeLink(link.id, reason)}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- requests

const REQUEST_STATUS: Record<CandidateRequestItem["status"], { label: string; tone: Tone }> = {
  open: { label: "Waiting", tone: "warning" },
  answered: { label: "To review", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

const KIND_ICON = { document: FileUp, field: TextCursorInput, question: MessageCircleQuestion } as const;

/** One row the candidate filled in, labelled and in the check's order: "Full name: Ruwan Perera · Contact number: 077 123 4567". */
function rowText(row: Record<string, unknown>, fields: CandidateRequestItem["rowFields"]): string {
  const known = fields.filter((f) => row[f.key] !== undefined).map((f) => [f.label, row[f.key], f.options] as const);
  const rest = Object.entries(row)
    .filter(([key]) => !fields.some((f) => f.key === key))
    .map(([key, v]) => [key.replace(/_/g, " "), v, undefined] as const);
  return [...known, ...rest]
    .map(([label, v, options]) => {
      const text = answerText(v, options ?? [], { date: (iso) => fieldDate(iso) ?? iso });
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

function RequestRow({ q, checkLabel, editable, canUseAnswers, askDocuments }: { q: CandidateRequestItem; checkLabel: string | null; editable: boolean; canUseAnswers: boolean; askDocuments: boolean }) {
  const [pending, start] = useTransition();
  const [reopening, setReopening] = useState(false);
  const [clashes, setClashes] = useState<AnswerClash[] | null>(null);
  const status = REQUEST_STATUS[q.status];
  const Icon = KIND_ICON[q.kind];
  const now = useNow();
  const overdue = q.status === "open" && q.dueAt && now !== null && new Date(q.dueAt).getTime() < now;
  const run = (decision: "accept" | "cancel", ok: string, onConflict?: "replace" | "keep") =>
    start(async () => {
      const r = await reviewRequest(q.id, decision, undefined, onConflict);
      if (!r.ok) return void toast.error(r.error);
      if (r.conflicts?.length) return setClashes(r.conflicts);
      setClashes(null);
      toast.success(ok);
    });

  return (
    <li className="space-y-2 px-3.5 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{q.title}</p>
          <p className="text-xs text-muted-foreground">
            {q.kind === "document" ? "Document" : q.kind === "field" ? "Detail" : "Question"}
            {checkLabel ? ` · ${checkLabel}` : ""}
            {q.createdBy ? ` · asked by ${q.createdBy.name}` : ""} · <RelativeTime iso={q.createdAt} />
            {q.dueAt ? <span className={overdue ? "font-medium text-destructive" : undefined}> · needed by {formatDate(q.dueAt)}</span> : null}
          </p>
          {q.help ? <p className="mt-1 text-xs text-muted-foreground">{q.help}</p> : null}
        </div>
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
      </div>

      {q.answer && q.status !== "open" ? (
        q.kind === "document" ? (
          <a href="#documents" className="ml-11 inline-flex items-center gap-1 text-sm text-primary hover:underline dark:text-brand-sky">
            File received: review it under Documents
          </a>
        ) : (
          <blockquote className="ml-11 rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">
            {q.answer.rows ? q.answer.rows.map((row) => rowText(row, q.rowFields)).join("\n") : answerText(q.answer.value, q.options, { date: (iso) => fieldDate(iso) ?? iso })}
            {q.answeredAt ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                Answered <RelativeTime iso={q.answeredAt} />
              </span>
            ) : null}
          </blockquote>
        )
      ) : null}
      {q.status === "open" && q.reviewNote ? <p className="ml-11 text-xs text-muted-foreground">Asked again: {q.reviewNote}</p> : null}
      {q.status === "accepted" && q.reviewedBy ? (
        <p className="ml-11 text-xs text-muted-foreground">
          Accepted by {q.reviewedBy.name}
          {q.kind === "field" ? ", and copied into the check" : ""}
        </p>
      ) : null}

      {editable && (q.status === "answered" || q.status === "open") ? (
        <div className="ml-11 flex flex-wrap gap-2">
          {q.status === "answered" ? (
            <>
              {q.kind !== "field" || canUseAnswers ? (
                <Button size="sm" onClick={() => run("accept", q.kind === "field" ? "Answer accepted and added to the check" : "Accepted")} disabled={pending}>
                  {pending ? <Spinner /> : <Check />} {q.kind === "field" ? "Use answer" : "Accept"}
                </Button>
              ) : null}
              {q.kind !== "document" || askDocuments ? (
                <Button variant="outline" size="sm" onClick={() => setReopening(true)} disabled={pending}>
                  <RotateCcw /> Ask again
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => run("cancel", "Request withdrawn")} disabled={pending}>
            <X /> Withdraw
          </Button>
        </div>
      ) : null}
      <Dialog open={clashes !== null} onOpenChange={(o) => !o && setClashes(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>This answer differs from the check</DialogTitle>
            <DialogDescription>Gaps are filled either way. Choose what happens to these details.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-xl border text-sm">
            {(clashes ?? []).map((c) => (
              <li key={c.label} className="px-3 py-2">
                <p className="font-medium">{c.label}</p>
                <p className="text-muted-foreground">On the check: {c.current}</p>
                <p className="text-muted-foreground">The candidate says: {c.answer}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => run("accept", "Answer used. The check's details stayed", "keep")}>
              Keep what&apos;s on the check
            </Button>
            <Button disabled={pending} onClick={() => run("accept", "Answer used, and the details replaced", "replace")}>
              {pending ? <Spinner /> : null} Use the candidate&apos;s
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Ask again"
        description="The candidate sees your note and answers again. They're emailed about it."
        label="What should they change?"
        placeholder="Please give the exact month you left."
        confirmLabel="Ask again"
        success="Sent back to the candidate"
        onSubmit={(note) => reviewRequest(q.id, "reopen", note)}
      />
    </li>
  );
}

// ---------------------------------------------------------------- consent

const CONSENT_STATUS: Record<ConsentInfo["status"], { label: string; tone: Tone }> = {
  pending: { label: "Not signed yet", tone: "warning" },
  submitted: { label: "Signed, to review", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Sent back", tone: "danger" },
};

const METHOD = { esign: "Signed on the candidate page", upload: "Photo of the signed paper form", staff: "Paper form recorded by staff" } as const;

function ConsentBlock({
  caseId,
  consent,
  everIssued,
  documents,
  canReview,
  askDocuments,
  erased,
}: {
  caseId: string;
  consent: ConsentInfo | null;
  everIssued: boolean;
  documents: { id: string; filename: string; createdAt: string }[];
  canReview: boolean;
  /** The candidate can still sign again, so it can still go back to them. */
  askDocuments: boolean;
  erased: boolean;
}) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [paper, setPaper] = useState(false);
  const status = consent ? CONSENT_STATUS[consent.status] : { label: everIssued ? "Not signed yet" : "Not requested", tone: "neutral" as Tone };
  const signed = consent && consent.status !== "pending";

  const accept = () =>
    start(async () => {
      const r = await reviewConsent(caseId, true);
      if (r.ok) toast.success("Consent accepted");
      else toast.error(r.error);
    });

  return (
    <div>
      <SubHeading>Consent</SubHeading>
      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <FileSignature className="size-4 text-muted-foreground" /> Consent and authorisation
          </span>
          <ToneChip tone={status.tone}>{status.label}</ToneChip>
        </div>
        {signed && consent ? (
          <dl className="space-y-1 text-xs">
            {consent.method ? (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">How</dt>
                <dd>{METHOD[consent.method]}</dd>
              </div>
            ) : null}
            {consent.signedName ? (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Signed as</dt>
                <dd className="font-medium">{consent.signedName}</dd>
              </div>
            ) : null}
            {consent.signedAt ? (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">When</dt>
                <dd>{formatDateTime(consent.signedAt)}</dd>
              </div>
            ) : null}
            {consent.ip ? (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">From</dt>
                <dd className="font-mono">{consent.ip}</dd>
              </div>
            ) : null}
            {consent.reviewedBy ? (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Reviewed</dt>
                <dd>{consent.reviewedBy.name}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            {everIssued ? "Needed before Pre-QC. The candidate signs it on their page, or uploads a photo of the signed paper form." : "Sent with the candidate's link. Record a paper form if they signed one in person."}
          </p>
        )}
        {consent?.status === "rejected" && consent.reviewNote ? <p className="text-xs text-destructive">Sent back: {consent.reviewNote}</p> : null}
        <div className="flex flex-wrap gap-2">
          {consent?.documentId && !erased ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/files/${consent.documentId}`} target="_blank" rel="noopener">
                <ExternalLink /> Open the signed form
              </a>
            </Button>
          ) : null}
          {canReview && consent?.status === "submitted" ? (
            <Button size="sm" onClick={accept} disabled={pending}>
              {pending ? <Spinner /> : <Check />} Accept
            </Button>
          ) : null}
          {canReview && askDocuments && (consent?.status === "submitted" || consent?.status === "accepted") ? (
            <Button variant="outline" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
              <RotateCcw /> Send back
            </Button>
          ) : null}
          {canReview && consent?.status !== "accepted" && consent?.status !== "submitted" ? (
            <Button variant="outline" size="sm" onClick={() => setPaper(true)}>
              <FileSignature /> Record a paper form
            </Button>
          ) : null}
        </div>
      </div>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Send the consent back"
        description="The candidate reads your note and signs again. They're emailed about it."
        label="What is wrong?"
        placeholder="The signature is missing on page 2."
        confirmLabel="Send back"
        success="Consent sent back to the candidate"
        onSubmit={async (note) => {
          const r = await reviewConsent(caseId, false, note);
          if (r.ok && r.warning) toast.warning(r.warning);
          return r;
        }}
      />
      <PaperConsentDialog open={paper} onOpenChange={setPaper} caseId={caseId} documents={documents} />
    </div>
  );
}

// ---------------------------------------------------------------- messages

function Messages({ caseId, data, editable }: { caseId: string; data: CandidatePanelData; editable: boolean }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await replyToCandidate(caseId, body);
      if (!r.ok) return void toast.error(r.error);
      setBody("");
      toast.success("Message sent", { description: r.emailed ? "The candidate was emailed." : "It's on their page. They have no active link to be emailed." });
    });
  };
  return (
    <div className="flex flex-col">
      <SubHeading>Messages</SubHeading>
      <div className="flex flex-1 flex-col rounded-xl border">
        {data.messages.length ? (
          <ol className="max-h-80 flex-1 space-y-3 overflow-y-auto p-3.5">
            {data.messages.map((m) => {
              const mine = m.fromKind === "staff";
              return (
                <li key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                  {mine && m.author ? <PersonAvatar id={m.author.id} name={m.author.name} size="sm" /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-orange/15 text-[10px] font-semibold text-brand-orange-ink">C</span>}
                  <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-tr-sm bg-primary/[0.08]" : "rounded-tl-sm bg-muted")}>
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {mine ? (m.author?.name ?? "Ontriq") : "Candidate"} · <RelativeTime iso={m.createdAt} />
                      {!mine && !m.readAt ? <span className="ml-1 font-medium text-primary dark:text-brand-sky">· new</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="flex-1 px-4 py-6 text-center text-sm text-muted-foreground">No messages yet. The candidate can write to you from their page.</p>
        )}
        {editable ? (
          <form onSubmit={send} className="flex items-end gap-2 border-t p-2.5">
            <Textarea
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write to the candidate…"
              className="max-h-32 min-h-9 resize-none"
              aria-label="Message to the candidate"
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button type="submit" size="icon" disabled={pending || !body.trim()} aria-label="Send message">
              {pending ? <Spinner /> : <SendHorizontal />}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
