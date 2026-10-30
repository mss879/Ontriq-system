"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, MessageSquarePlus, Sparkles, SquareTerminal, X } from "lucide-react";
import type { ThreadSummary } from "@/lib/ai/assistant/types";
import { ASSISTANT_OPEN_EVENT } from "./assistant-trigger";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useChat } from "./use-chat";
import { ChatView, STAFF_SUGGESTIONS } from "./chat-view";
import { ThreadMenu } from "./thread-menu";

const LAST_THREAD = "ontriq.assistant.thread";

function remembered(): string | null {
  try {
    return sessionStorage.getItem(LAST_THREAD);
  } catch {
    return null;
  }
}
function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(LAST_THREAD, id);
    else sessionStorage.removeItem(LAST_THREAD);
  } catch {
    // Private mode: the panel just starts fresh next time.
  }
}

/**
 * Ask Ontriq, on every staff screen (plan §8 capability 9): the top-bar button
 * and ⌘J open a side sheet with the conversation. Hidden on the Command page,
 * which is the same assistant at full size for the Super Admin.
 */
export function AssistantPanel({ isSuperAdmin, canRecord }: { isSuperAdmin: boolean; canRecord: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const restored = useRef(false);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/threads?kind=staff", { cache: "no-store" });
      if (res.ok) setThreads(((await res.json()) as { threads: ThreadSummary[] }).threads);
    } catch {
      // The list is a convenience; the conversation still works.
    }
  }, []);

  const chat = useChat({
    kind: "staff",
    onThread: (id, title) => {
      remember(id);
      setThreads((prev) => (prev.some((t) => t.id === id) ? prev : [{ id, title, updated_at: new Date().toISOString() }, ...prev]));
    },
    onDone: () => void loadThreads(),
  });
  const { open: openThread } = chat;

  const isOpen = useRef(false);
  const show = useCallback(
    (v: boolean) => {
      isOpen.current = v;
      setOpen(v);
      if (!v) return;
      void loadThreads();
      if (!restored.current) {
        restored.current = true;
        const last = remembered();
        if (last) void openThread(last).then((ok) => !ok && remember(null));
      }
    },
    [loadThreads, openThread],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        show(!isOpen.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  useEffect(() => {
    const onOpen = () => show(true);
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [show]);

  if (pathname?.startsWith("/app/command")) return null;
  const current = threads.find((t) => t.id === chat.threadId);

  return (
    <>
      <Sheet open={open} onOpenChange={show}>
        <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <header className="flex items-center gap-1 border-b px-3 py-2">
            <SheetTitle className="sr-only">Ask Ontriq</SheetTitle>
            <SheetDescription className="sr-only">Ask about the cases, clients and work you can see.</SheetDescription>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange">
              <Sparkles className="size-4" />
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="min-w-0 max-w-[60%] justify-start gap-1 font-semibold">
                  <span className="truncate">{current?.title ?? (chat.threadId ? "Conversation" : "Ask Ontriq")}</span>
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem
                  onSelect={() => {
                    remember(null);
                    void chat.open(null);
                  }}
                >
                  <MessageSquarePlus /> New conversation
                </DropdownMenuItem>
                {threads.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Recent</DropdownMenuLabel>
                    {threads.slice(0, 12).map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={() => {
                          remember(t.id);
                          void chat.open(t.id);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.id === chat.threadId && <Check className="text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex items-center gap-0.5">
              {chat.threadId && current && (
                <ThreadMenu
                  id={chat.threadId}
                  title={current.title}
                  onRenamed={(title) => setThreads((prev) => prev.map((t) => (t.id === chat.threadId ? { ...t, title } : t)))}
                  onArchived={() => {
                    setThreads((prev) => prev.filter((t) => t.id !== chat.threadId));
                    remember(null);
                    void chat.open(null);
                  }}
                />
              )}
              <Button size="icon-sm" variant="ghost" aria-label="New conversation" onClick={() => {
                  remember(null);
                  void chat.open(null);
                }}
              >
                <MessageSquarePlus />
              </Button>
              {isSuperAdmin && (
                <Button size="icon-sm" variant="ghost" asChild aria-label="Open the command assistant">
                  <Link href="/app/command" onClick={() => show(false)}>
                    <SquareTerminal />
                  </Link>
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => show(false)}>
                <X />
              </Button>
            </div>
          </header>
          <ChatView chat={chat} kind="staff" canRecord={canRecord} suggestions={STAFF_SUGGESTIONS} compact />
        </SheetContent>
      </Sheet>
    </>
  );
}
