"use client";

import { useState } from "react";
import { MessageSquarePlus, PanelLeft, Sparkles } from "lucide-react";
import type { ThreadDetail, ThreadSummary } from "@/lib/ai/assistant/types";
import type { Briefing, Memory } from "@/lib/ai/assistant/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useChat } from "@/components/assistant/use-chat";
import { ChatView, COMMAND_SUGGESTIONS } from "@/components/assistant/chat-view";
import { ThreadMenu } from "@/components/assistant/thread-menu";
import { cn } from "@/lib/utils";
import { MemoriesCard } from "./memories-card";

type Usage = { runs: number; costUsd: number; dailyCapUsd: number | null };

const urlFor = (id: string | null) => (id ? `/app/command?t=${id}` : "/app/command");

export function CommandWorkspace({
  initialThreads,
  initial,
  memories,
  usage,
  briefing,
  canRecord,
}: {
  initialThreads: ThreadSummary[];
  initial: ThreadDetail | null;
  memories: Memory[];
  usage: Usage;
  briefing: Briefing | null;
  canRecord: boolean;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [drawer, setDrawer] = useState(false);
  const [showBriefing, setShowBriefing] = useState(true);
  const chat = useChat({
    kind: "command",
    initial,
    onThread: (id, title) => {
      window.history.replaceState(null, "", urlFor(id));
      setThreads((prev) => (prev.some((t) => t.id === id) ? prev : [{ id, title, updated_at: new Date().toISOString() }, ...prev]));
    },
    onDone: () => {
      void fetch("/api/assistant/threads?kind=command", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { threads: ThreadSummary[] } | null) => j && setThreads(j.threads))
        .catch(() => undefined);
    },
  });

  const go = (id: string | null) => {
    setDrawer(false);
    window.history.replaceState(null, "", urlFor(id));
    void chat.open(id);
  };
  const current = threads.find((t) => t.id === chat.threadId);

  const side = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Button variant="outline" className="w-full justify-start" onClick={() => go(null)}>
        <MessageSquarePlus /> New conversation
      </Button>
      <nav aria-label="Conversations" className="space-y-0.5">
        <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Conversations</p>
        {threads.length === 0 && <p className="px-2 text-xs text-muted-foreground">Nothing yet. Ask your first question.</p>}
        {threads.map((t) => (
          <div key={t.id} className={cn("group flex items-center gap-1 rounded-lg pr-1 hover:bg-muted", t.id === chat.threadId && "bg-muted")}>
            <button type="button" onClick={() => go(t.id)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm" aria-current={t.id === chat.threadId ? "page" : undefined}>
              {t.title}
            </button>
            <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <ThreadMenu
                id={t.id}
                title={t.title}
                onRenamed={(title) => setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, title } : x)))}
                onArchived={() => {
                  setThreads((prev) => prev.filter((x) => x.id !== t.id));
                  if (t.id === chat.threadId) go(null);
                }}
              />
            </span>
          </div>
        ))}
      </nav>
      <MemoriesCard initial={memories} />
      <section className="mt-auto rounded-xl bg-muted/50 p-3 text-xs" aria-label="Usage today">
        <p className="font-semibold text-foreground">Today</p>
        <p className="mt-1 text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">${usage.costUsd.toFixed(2)}</span>
          {usage.dailyCapUsd !== null ? ` of $${usage.dailyCapUsd.toFixed(2)} daily cap` : " spent"} · {usage.runs} model call{usage.runs === 1 ? "" : "s"}
        </p>
        {usage.dailyCapUsd !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-brand-orange" style={{ width: `${Math.min(100, (usage.costUsd / Math.max(usage.dailyCapUsd, 0.01)) * 100)}%` }} />
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 md:h-[calc(100svh-4.5rem)]">
      <aside className="hidden w-72 shrink-0 border-r lg:block">{side}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Past conversations, memories and today&apos;s usage.</SheetDescription>
          {side}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2 md:px-4">
          <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Conversations" onClick={() => setDrawer(true)}>
            <PanelLeft />
          </Button>
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange">
            <Sparkles className="size-4" />
          </span>
          <h1 className="min-w-0 truncate font-display text-base font-semibold">{current?.title ?? (chat.threadId ? "Conversation" : "Command")}</h1>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Every change waits for your Confirm</span>
        </header>
        {briefing && showBriefing && chat.messages.length === 0 && (
          <section className="mx-4 mt-4 rounded-xl bg-card p-4 ring-1 ring-foreground/[0.08]" aria-label="Morning summary">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Morning summary{briefing.day ? ` · ${briefing.day}` : ""}</p>
                <p className="text-sm font-semibold">{briefing.headline}</p>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setShowBriefing(false)}>
                Hide
              </Button>
            </div>
            {briefing.bullets.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-foreground/90">
                {briefing.bullets.slice(0, 8).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {briefing.risks.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-warning-foreground dark:text-warning">At risk</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground/90">
                  {briefing.risks.slice(0, 5).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
        <ChatView chat={chat} kind="command" canRecord={canRecord} suggestions={COMMAND_SUGGESTIONS} />
      </div>
    </div>
  );
}
