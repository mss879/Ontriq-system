"use client";

import { useState, useTransition } from "react";
import { Check, MessageCircleQuestion, Plus } from "lucide-react";
import { toast } from "sonner";
import { askClient, closeClientRequest } from "../../actions";
import type { ClientQuestion } from "@/lib/server/cases/detail-queries";
import { Button } from "@/components/ui/button";
import { ToneChip } from "@/components/cases/badges";
import { RelativeTime } from "@/components/cases/sla-badge";
import type { Tone } from "@/domain/workflow/stages";
import { ReasonDialog } from "./reason-dialog";

const STATUS: Record<ClientQuestion["status"], { label: string; tone: Tone }> = {
  open: { label: "Waiting for the client", tone: "warning" },
  answered: { label: "Answered", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

/** Questions to the client, for information that isn't a document (spec 6.1). */
export function ClientQuestions({ caseId, questions, canAsk, clientName }: { caseId: string; questions: ClientQuestion[]; canAsk: boolean; clientName: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const close = (id: string) =>
    start(async () => {
      const r = await closeClientRequest(id);
      if (r.ok) toast.success("Question closed");
      else toast.error(r.error);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Ask {clientName} for anything that isn&rsquo;t a document. They answer in their portal.</p>
        {canAsk ? (
          <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
            <Plus /> Ask the client
          </Button>
        ) : null}
      </div>
      {questions.length ? (
        <ul className="divide-y rounded-xl border">
          {questions.map((q) => {
            const s = STATUS[q.status];
            return (
              <li key={q.id} className="space-y-2 px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium whitespace-pre-line">{q.question}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.askedBy ? `${q.askedBy.name} · ` : ""}
                      <RelativeTime iso={q.createdAt} />
                    </p>
                  </div>
                  <ToneChip tone={s.tone}>{s.label}</ToneChip>
                </div>
                {q.answer ? (
                  <blockquote className="ml-7 rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">
                    {q.answer}
                    {q.answeredAt ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {q.answeredBy ? `${q.answeredBy.name} · ` : ""}
                        <RelativeTime iso={q.answeredAt} />
                      </span>
                    ) : null}
                  </blockquote>
                ) : null}
                {canAsk && q.status !== "closed" ? (
                  <div className="ml-7">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => close(q.id)}>
                      <Check /> {q.status === "answered" ? "Done with this" : "Withdraw"}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <ReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title="Ask the client"
        description="They're told straight away, and the case shows Pending Information until they answer."
        label="Your question"
        placeholder="e.g. What was the candidate's employee number at your company?"
        confirmLabel="Send question"
        success="Question sent"
        onSubmit={(text) => askClient(caseId, text)}
      />
    </div>
  );
}
