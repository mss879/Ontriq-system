"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import type { PortalQuestion } from "@/domain/portal/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { answerQuestion } from "../actions";

/** What Ontriq asked this client, and a place to answer (0041). */
export function PortalQuestions({ questions, canAnswer }: { questions: PortalQuestion[]; canAnswer: boolean }) {
  return (
    <ul className="space-y-3">
      {questions.map((q) => (
        <Question key={q.id} q={q} canAnswer={canAnswer} />
      ))}
    </ul>
  );
}

function Question({ q, canAnswer }: { q: PortalQuestion; canAnswer: boolean }) {
  const [editing, setEditing] = useState(q.status === "open");
  const [text, setText] = useState(q.answer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answered = q.status === "answered";
  return (
    <li className="rounded-xl border p-3.5">
      <div className="flex items-start gap-2.5">
        {answered ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-brand-orange-ink" aria-hidden />}
        <div className="min-w-0">
          <p className="text-sm font-medium whitespace-pre-line">{q.question}</p>
          {q.check_label ? <p className="text-xs text-muted-foreground">{q.check_label}</p> : null}
        </div>
      </div>
      {editing && canAnswer ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await answerQuestion(q.id, text);
              if (r.ok) {
                toast.success("Answer sent to Ontriq");
                setEditing(false);
                setError(null);
              } else setError(r.error);
            });
          }}
        >
          <label htmlFor={`answer-${q.id}`} className="sr-only">
            Your answer
          </label>
          <Textarea id={`answer-${q.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Your answer" />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Spinner /> : <Send />} Send answer
          </Button>
        </form>
      ) : answered || text ? (
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <p className="min-w-0 whitespace-pre-line">{text || q.answer}</p>
          {canAnswer ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Someone at your company with request access can answer this.</p>
      )}
    </li>
  );
}
