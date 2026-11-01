"use client";

import { useState, useTransition } from "react";
import { ArrowDown, CheckCircle2, MessageSquareReply, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { answerRequest } from "@/app/(candidate)/c/session/actions";
import { answerText, type AnswerValue } from "@/domain/candidate/answers";
import { fieldDate } from "@/domain/reports/compile-core";
import type { CandidateRow, CandidateRowForm } from "@/domain/candidate/view";
import { errorText } from "./errors";
import { AnswerField, type AnswerDraft } from "./answer-field";
import { RowsForm } from "./rows-form";

export type RequestData = {
  id: string;
  kind: "document" | "field" | "question";
  title: string;
  help: string | null;
  fieldType: string | null;
  options: { value: string; label: string }[];
  requirementId: string | null;
  dueText: string | null;
  status: "open" | "answered" | "accepted";
  /** What they sent, as stored. */
  answer: AnswerValue | null;
  reviewNote: string | null;
  /** Set when the candidate fills in rows, such as referees or employers. */
  rowForm?: CandidateRowForm | null;
  rows?: CandidateRow[];
};

/** One thing Ontriq asked for: a detail, a question, or a pointer to a document slot. */
export function RequestCard({ lang, request }: { lang: CandidateLang; request: RequestData }) {
  const t = candidateDict(lang);
  const given = request.answer;
  const [editing, setEditing] = useState(request.status === "open");
  const [draft, setDraft] = useState<AnswerDraft | undefined>(given ?? undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = request.status === "accepted";
  const options = request.fieldType === "boolean" && !request.options.length ? [{ value: "yes", label: t.requests.yes }, { value: "no", label: t.requests.no }] : request.options;
  const shown = (v: AnswerValue | null) => answerText(v, options, { to: t.requests.to, present: t.requests.stillHere, date: (iso) => fieldDate(iso) ?? iso });

  /** What this kind of question stores: a value, a list of values, or a range. */
  const answerNow = (): string | string[] | { from: string; to?: string; present?: boolean } | null => {
    if (Array.isArray(draft)) return draft.length ? draft : null;
    if (typeof draft === "object") return draft.from && (draft.to || draft.present) ? { from: draft.from, ...(draft.present ? { present: true } : { to: draft.to }) } : null;
    return draft?.trim() || null;
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const answer = answerNow();
    if (!answer) return setError(t.errors.answerNeeded);
    setError(null);
    start(async () => {
      const r = await answerRequest({ requestId: request.id, value: answer });
      if (!r.ok) return setError(errorText(t, r.error));
      toast.success(t.requests.sent);
      setEditing(false);
    });
  }

  return (
    <article className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", done || !editing ? "bg-success/12 text-success" : "bg-primary/8 text-primary")}>
          {done || (!editing && request.kind !== "document") ? <CheckCircle2 className="size-[18px]" /> : <MessageSquareReply className="size-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold">{request.title}</h3>
          {request.help ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{request.help}</p> : null}
          {request.dueText && request.status === "open" ? <p className="mt-1 text-xs font-medium text-brand-orange-ink">{request.dueText}</p> : null}
        </div>
      </div>

      {request.reviewNote && request.status === "open" ? (
        <p className="mt-3 rounded-xl bg-brand-orange/8 px-3 py-2.5 text-sm leading-relaxed ring-1 ring-brand-orange/15">
          <span className="font-medium">{t.requests.askedAgain}: </span>
          {request.reviewNote}
        </p>
      ) : null}

      {request.kind === "document" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">{request.status === "open" ? t.requests.documentRequest : t.requests.sent}</span>
          {request.requirementId && request.status === "open" ? (
            <Button asChild variant="outline" size="sm">
              <a href={`#slot-${request.requirementId}`}>
                <ArrowDown /> {t.requests.goToDocument}
              </a>
            </Button>
          ) : null}
        </div>
      ) : done ? (
        <div className="mt-3 rounded-xl bg-success/8 px-3 py-2.5 text-sm">
          <p className="font-medium text-success">{t.requests.accepted}</p>
          {request.answer ? <p className="mt-0.5 whitespace-pre-wrap text-foreground">{shown(request.answer)}</p> : null}
        </div>
      ) : request.rowForm ? (
        <RowsForm lang={lang} requestId={request.id} form={request.rowForm} initial={request.rows ?? []} answered={request.status === "answered"} />
      ) : editing ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label htmlFor={`answer-${request.id}`} className="text-xs font-medium text-muted-foreground">
            {t.requests.yourAnswer}
          </label>
          <AnswerField id={`answer-${request.id}`} lang={lang} type={request.fieldType ?? "text"} options={options} value={draft} onChange={setDraft} question={request.kind === "question"} />
          {error ? <p className="text-xs leading-relaxed text-destructive">{error}</p> : null}
          <Button type="submit" className="h-11 w-full text-[14px] sm:w-auto" disabled={pending}>
            {pending ? <Spinner /> : <Send />} {request.status === "answered" ? t.requests.update : t.requests.send}
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="text-xs font-medium text-success">{t.requests.sent}</p>
            <p className="mt-0.5 whitespace-pre-wrap">{shown(answerNow() ?? request.answer)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t.requests.update}
          </Button>
        </div>
      )}
    </article>
  );
}
