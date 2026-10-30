"use client";

import { useState, useTransition } from "react";
import { ArrowDown, CheckCircle2, MessageSquareReply, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { answerRequest } from "@/app/(candidate)/c/session/actions";
import type { CandidateRow, CandidateRowForm } from "@/domain/candidate/view";
import { errorText } from "./errors";
import { DateField } from "@/components/forms/date-field";
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
  answer: string | null;
  reviewNote: string | null;
  /** Set when the candidate fills in rows, such as referees or employers. */
  rowForm?: CandidateRowForm | null;
  rows?: CandidateRow[];
};

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** One thing Ontriq asked for: a detail, a question, or a pointer to a document slot. */
export function RequestCard({ lang, request }: { lang: CandidateLang; request: RequestData }) {
  const t = candidateDict(lang);
  const [editing, setEditing] = useState(request.status === "open");
  const [value, setValue] = useState(request.answer ?? "");
  const [rangeTo, setRangeTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = request.status === "accepted";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const answer = request.fieldType === "date_range" ? [value, rangeTo].filter(Boolean).join(" – ") : value.trim();
    if (!answer) return setError(t.errors.answerNeeded);
    setError(null);
    start(async () => {
      const r = await answerRequest({ requestId: request.id, value: answer });
      if (!r.ok) return setError(errorText(t, r.error));
      toast.success(t.requests.sent);
      setEditing(false);
    });
  }

  const field = (() => {
    switch (request.fieldType) {
      case "textarea":
      case "address":
        return <Textarea id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="text-[15px]" />;
      case "date":
        return <DateField id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />;
      case "date_range":
        return (
          <div className="grid grid-cols-2 gap-2">
            <DateField id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />
            <DateField value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="h-11 text-[15px]" aria-label={t.requests.yourAnswer} />
          </div>
        );
      case "number":
        return <Input id={`answer-${request.id}`} type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />;
      case "email":
        return <Input id={`answer-${request.id}`} type="email" inputMode="email" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />;
      case "phone":
        return <Input id={`answer-${request.id}`} type="tel" inputMode="tel" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />;
      case "select":
      case "boolean":
        return (
          <select id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} className={selectClass}>
            <option value="">{t.requests.choose}</option>
            {(request.fieldType === "boolean" && !request.options.length ? [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] : request.options).map((o) => (
              <option key={o.value} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "multi_select": {
        const picked = new Set(value ? value.split(", ") : []);
        return (
          <div className="flex flex-wrap gap-2">
            {request.options.map((o) => (
              <label key={o.value} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", picked.has(o.label) && "border-primary bg-primary/5")}>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={picked.has(o.label)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(o.label);
                    else next.delete(o.label);
                    setValue([...next].join(", "));
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      default:
        return request.kind === "question" ? (
          <Textarea id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="text-[15px]" />
        ) : (
          <Input id={`answer-${request.id}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-[15px]" />
        );
    }
  })();

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
          {request.answer ? <p className="mt-0.5 whitespace-pre-wrap text-foreground">{request.answer}</p> : null}
        </div>
      ) : request.rowForm ? (
        <RowsForm lang={lang} requestId={request.id} form={request.rowForm} initial={request.rows ?? []} answered={request.status === "answered"} />
      ) : editing ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label htmlFor={`answer-${request.id}`} className="text-xs font-medium text-muted-foreground">
            {t.requests.yourAnswer}
          </label>
          {field}
          {error ? <p className="text-xs leading-relaxed text-destructive">{error}</p> : null}
          <Button type="submit" className="h-11 w-full text-[14px] sm:w-auto" disabled={pending}>
            {pending ? <Spinner /> : <Send />} {request.status === "answered" ? t.requests.update : t.requests.send}
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="text-xs font-medium text-success">{t.requests.sent}</p>
            <p className="mt-0.5 whitespace-pre-wrap">{value || request.answer}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t.requests.update}
          </Button>
        </div>
      )}
    </article>
  );
}
