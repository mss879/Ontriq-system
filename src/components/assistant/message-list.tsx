"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import type { ActionState, Block, ChatMessage } from "@/lib/ai/assistant/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MarkdownText } from "./markdown-text";
import { CardsArtifact, MetricsArtifact, TableArtifact } from "./artifacts";
import { ActionCard } from "./action-card";

function BlockView({ block, actions, onAction }: { block: Block; actions: Record<string, ActionState>; onAction: (id: string, s: ActionState) => void }) {
  switch (block.type) {
    case "text":
      return block.text.trim() ? <MarkdownText text={block.text} /> : null;
    case "error":
      return (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-destructive/5 px-2.5 py-2 text-sm text-destructive ring-1 ring-destructive/15">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {block.text}
        </p>
      );
    case "table":
      return <TableArtifact artifact={block} />;
    case "cards":
      return <CardsArtifact artifact={block} />;
    case "metrics":
      return <MetricsArtifact artifact={block} />;
    case "action":
      return <ActionCard card={block} state={actions[block.action_id]} onState={(s) => onAction(block.action_id, s)} />;
  }
}

/** The conversation, newest at the bottom; follows the stream while you're at the bottom. */
export function MessageList({
  messages,
  actions,
  onAction,
  streaming,
  toolLabel,
  empty,
  className,
}: {
  messages: ChatMessage[];
  actions: Record<string, ActionState>;
  onAction: (id: string, s: ActionState) => void;
  streaming: boolean;
  toolLabel: string | null;
  empty?: React.ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, toolLabel]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      aria-live="polite"
      aria-busy={streaming}
    >
      {messages.length === 0 ? (
        empty
      ) : (
        <ol className="space-y-5 px-4 py-4">
          {messages.map((m, i) => {
            const last = i === messages.length - 1;
            if (m.role === "user") {
              const text = m.blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");
              return (
                <li key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{text}</p>
                </li>
              );
            }
            const working = last && streaming;
            return (
              <li key={m.id} className="flex gap-2.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange" aria-hidden>
                  <Sparkles className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  {m.blocks.map((b, j) => (
                    <BlockView key={j} block={b} actions={actions} onAction={onAction} />
                  ))}
                  {working && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="size-3" />
                      {toolLabel ? `${toolLabel}…` : "Writing…"}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
