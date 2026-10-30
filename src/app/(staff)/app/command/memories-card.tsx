"use client";

import { useState, useTransition } from "react";
import { Brain, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Memory } from "@/lib/ai/assistant/queries";
import { decideAssistantMemory } from "../assistant-actions";

/**
 * Standing instructions the assistant keeps in mind ("always use the
 * Executive template for banks"). Pending ones wait for approval; approved
 * ones can be removed.
 */
export function MemoriesCard({ initial }: { initial: Memory[] }) {
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const decide = (m: Memory, decision: "approved" | "rejected") =>
    start(async () => {
      const r = await decideAssistantMemory(m.id, decision);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setItems((prev) => (decision === "approved" ? prev.map((x) => (x.id === m.id ? { ...x, status: "approved" } : x)) : prev.filter((x) => x.id !== m.id)));
    });

  return (
    <section aria-label="Memories" className="space-y-1.5">
      <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Brain className="size-3" /> Memories
      </p>
      {items.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Ask the assistant to remember a preference and it will appear here once you confirm it.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 break-words">
                {m.content}
                {m.status === "pending" && <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">Pending</span>}
              </span>
              {m.status === "pending" && (
                <Button size="icon-xs" variant="ghost" disabled={pending} aria-label="Keep this memory" onClick={() => decide(m, "approved")}>
                  <Check />
                </Button>
              )}
              <Button size="icon-xs" variant="ghost" disabled={pending} aria-label={m.status === "pending" ? "Reject this memory" : "Forget this memory"} onClick={() => decide(m, "rejected")}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
