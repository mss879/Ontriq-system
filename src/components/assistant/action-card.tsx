"use client";

import { useState, useTransition } from "react";
import { Check, CircleAlert, CircleSlash, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cancelAssistantAction, confirmAssistantAction, undoAssistantAction } from "@/app/(staff)/app/assistant-actions";
import type { ActionState, Artifact } from "@/lib/ai/assistant/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";

type Card = Extract<Artifact, { type: "action" }>;

function useMinutesLeft(until: string | null | undefined) {
  const now = useNow();
  if (!until || now === null) return 0;
  return Math.min(10, Math.max(0, Math.ceil((Date.parse(until) - now) / 60_000)));
}

const TONE: Record<ActionState["status"], string> = {
  proposed: "ring-primary/25 bg-primary/[0.03]",
  confirmed: "ring-primary/25",
  done: "ring-success/30 bg-success/[0.04]",
  failed: "ring-destructive/30 bg-destructive/[0.04]",
  cancelled: "ring-foreground/10 opacity-75",
  undone: "ring-foreground/10 opacity-75",
};

/**
 * A confirm card: what the assistant proposes, and the person's decision.
 * Nothing happens until Confirm; the server re-checks permission. Reversible
 * actions offer Undo for ten minutes.
 */
export function ActionCard({ card, state, onState }: { card: Card; state: ActionState | undefined; onState: (s: ActionState) => void }) {
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"confirm" | "cancel" | "undo" | null>(null);
  const s: ActionState = state ?? { status: card.status };
  const minutes = useMinutesLeft(s.status === "done" ? s.undoUntil : null);

  const run = (kind: "confirm" | "cancel" | "undo") =>
    start(async () => {
      setWhich(kind);
      if (kind === "confirm") {
        onState({ ...s, status: "confirmed" });
        const r = await confirmAssistantAction(card.action_id);
        if (r.ok) {
          onState({ status: "done", summary: r.summary, undoUntil: r.undoable ? new Date(Date.now() + 10 * 60_000).toISOString() : null });
          toast.success(r.summary);
        } else {
          onState({ status: /already handled|cancelled/.test(r.error) ? s.status : "failed", error: r.error });
          toast.error(r.error);
        }
      } else if (kind === "cancel") {
        const r = await cancelAssistantAction(card.action_id);
        if (r.ok) onState({ status: "cancelled" });
        else toast.error(r.error);
      } else {
        const r = await undoAssistantAction(card.action_id);
        if (r.ok) {
          onState({ status: "undone", summary: r.summary });
          toast.success(r.summary);
        } else toast.error(r.error);
      }
      setWhich(null);
    });

  return (
    <section className={cn("rounded-xl p-3 ring-1 transition-colors", TONE[s.status])} aria-label={`Proposed action: ${card.title}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-primary">
          {s.status === "done" ? <Check className="size-4 text-success" /> : s.status === "failed" ? <CircleAlert className="size-4 text-destructive" /> : s.status === "cancelled" ? <CircleSlash className="size-4 text-muted-foreground" /> : s.status === "undone" ? <RotateCcw className="size-4 text-muted-foreground" /> : <ShieldCheck className="size-4" />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">{card.title}</p>
          {card.lines.length > 0 && (
            <ul className="max-h-48 space-y-0.5 overflow-auto text-xs text-muted-foreground">
              {card.lines.map((l, i) => (
                <li key={i} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          )}
          {s.status === "done" && s.summary && <p className="text-xs font-medium text-success">{s.summary}</p>}
          {s.status === "undone" && <p className="text-xs text-muted-foreground">{s.summary ?? "Undone."}</p>}
          {s.status === "cancelled" && <p className="text-xs text-muted-foreground">Cancelled. Nothing was changed.</p>}
          {s.status === "failed" && <p className="text-xs text-destructive">{s.error ?? "It didn't work."}</p>}
        </div>
      </div>
      {s.status === "proposed" && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("cancel")}>
            {pending && which === "cancel" ? <Spinner /> : null}
            Cancel
          </Button>
          <Button size="sm" disabled={pending} onClick={() => run("confirm")}>
            {pending && which === "confirm" ? <Spinner /> : <Check />}
            Confirm
          </Button>
        </div>
      )}
      {s.status === "confirmed" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" /> Working on it…
        </p>
      )}
      {s.status === "done" && minutes > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-[11px] text-muted-foreground">Undo available for {minutes} min</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run("undo")}>
            {pending && which === "undo" ? <Spinner /> : <Undo2 />}
            Undo
          </Button>
        </div>
      )}
    </section>
  );
}
