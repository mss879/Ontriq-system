"use client";

import { Sparkles } from "lucide-react";
import type { AssistantKind } from "@/lib/ai/assistant/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { useChat } from "./use-chat";
import { MessageList } from "./message-list";
import { Composer } from "./composer";

export const STAFF_SUGGESTIONS = ["What's on my plate today?", "Which of my checks are overdue?", "Show cases waiting for documents", "Who on the team is behind this week?"];
export const COMMAND_SUGGESTIONS = [
  "Make a PDF of last quarter's team performance",
  "Show me all unpaid invoices over 30 days",
  "Who is behind this week?",
  "How did revenue look last quarter?",
  "Create a client called Hemas Holdings with 30-day terms",
];

/** A conversation and its composer; the parent owns the chat state (useChat) so it can switch threads. */
export function ChatView({
  chat,
  kind,
  canRecord,
  suggestions,
  compact,
  className,
}: {
  chat: ReturnType<typeof useChat>;
  kind: AssistantKind;
  canRecord: boolean;
  suggestions: string[];
  compact?: boolean;
  className?: string;
}) {
  const empty = (
    <div className={cn("flex h-full flex-col items-center justify-center gap-4 px-6 text-center", compact ? "py-8" : "py-16")}>
      <span className="flex size-10 items-center justify-center rounded-2xl bg-brand-orange/10 text-brand-orange">
        <Sparkles className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold">{kind === "command" ? "What should we get done?" : "Ask Ontriq"}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {kind === "command"
            ? "Ask about anything in the system, or tell it what to do. Every change waits for your Confirm."
            : "Ask about the cases, clients and work you can see. Changes always wait for your Confirm."}
        </p>
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void chat.send(s)}
            className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {chat.loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      ) : (
        <MessageList messages={chat.messages} actions={chat.actions} onAction={chat.setAction} streaming={chat.streaming} toolLabel={chat.toolLabel} empty={empty} />
      )}
      <Composer onSend={(t) => void chat.send(t)} onStop={chat.stop} streaming={chat.streaming} canRecord={canRecord} threadId={chat.threadId} autoFocus={!compact} />
    </div>
  );
}
