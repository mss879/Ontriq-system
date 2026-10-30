"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ActionState, ActionStatus, AssistantEvent, AssistantKind, Block, ChatMessage, ThreadDetail } from "@/lib/ai/assistant/types";
import { streamChat } from "./sse";

/**
 * One assistant conversation in the browser: its messages, the live state of
 * its confirm cards, and sending (streamed). A new send, switching thread or
 * unmounting aborts the stream in flight. Confirm cards follow
 * assistant_actions over Realtime where it is available.
 */

let seq = 0;
const localId = (p: string) => `${p}-${Date.now()}-${++seq}`;

export function useChat(opts: { kind: AssistantKind; initial?: ThreadDetail | null; onThread?: (id: string, title: string) => void; onDone?: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(opts.initial?.thread.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(opts.initial?.messages ?? []);
  const [actions, setActions] = useState<Record<string, ActionState>>(opts.initial?.actions ?? {});
  const [streaming, setStreaming] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const callbacks = useRef(opts);
  useEffect(() => {
    callbacks.current = opts;
  });

  useEffect(() => () => abort.current?.abort(), []);

  const updateLast = useCallback((fn: (blocks: Block[]) => Block[]) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, blocks: fn(last.blocks) }];
    });
  }, []);

  const onEvent = useCallback(
    (e: AssistantEvent) => {
      switch (e.type) {
        case "thread":
          setThreadId(e.id);
          callbacks.current.onThread?.(e.id, e.title);
          break;
        case "text":
          setToolLabel(null);
          updateLast((blocks) => {
            const last = blocks[blocks.length - 1];
            return last && last.type === "text" ? [...blocks.slice(0, -1), { type: "text", text: last.text + e.delta }] : [...blocks, { type: "text", text: e.delta }];
          });
          break;
        case "tool":
          setToolLabel(e.label);
          break;
        case "artifact":
          setToolLabel(null);
          updateLast((blocks) => [...blocks, e.artifact]);
          if (e.artifact.type === "action") {
            const id = e.artifact.action_id;
            setActions((prev) => ({ ...prev, [id]: prev[id] ?? { status: "proposed" } }));
          }
          break;
        case "error":
          setToolLabel(null);
          updateLast((blocks) => [...blocks, { type: "error", text: e.message }]);
          break;
        case "done":
          setToolLabel(null);
          setStreaming(false);
          if (e.message_id) {
            const id = e.message_id;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              return last && last.role === "assistant" ? [...prev.slice(0, -1), { ...last, id }] : prev;
            });
          }
          callbacks.current.onDone?.();
          break;
      }
    },
    [updateLast],
  );

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: localId("user"), role: "user", blocks: [{ type: "text", text: clean }], created_at: now },
        { id: localId("pending"), role: "assistant", blocks: [], created_at: now },
      ]);
      setStreaming(true);
      setToolLabel("Thinking");
      try {
        await streamChat({ thread_id: threadId ?? undefined, kind: opts.kind, text: clean }, onEvent, controller.signal);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) onEvent({ type: "error", message: "The connection dropped. Try again." });
      } finally {
        if (abort.current === controller) {
          setStreaming(false);
          setToolLabel(null);
        }
      }
    },
    [onEvent, opts.kind, threadId],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setStreaming(false);
    setToolLabel(null);
  }, []);

  /** Open another conversation (or a fresh one with null). */
  const open = useCallback(async (id: string | null) => {
    abort.current?.abort();
    setStreaming(false);
    setToolLabel(null);
    const mine = ++loadSeq.current;
    if (!id) {
      setThreadId(null);
      setMessages([]);
      setActions({});
      return true;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/assistant/threads/${id}`, { cache: "no-store" });
      if (!res.ok) return false;
      const detail = (await res.json()) as ThreadDetail;
      if (mine !== loadSeq.current) return false;
      setThreadId(detail.thread.id);
      setMessages(detail.messages);
      setActions(detail.actions);
      return true;
    } catch {
      return false;
    } finally {
      if (mine === loadSeq.current) setLoading(false);
    }
  }, []);

  const setAction = useCallback((id: string, state: ActionState) => setActions((prev) => ({ ...prev, [id]: state })), []);

  // Live card states (another tab, the undo window, a failure) where Realtime runs.
  useEffect(() => {
    if (!threadId || process.env.NEXT_PUBLIC_REALTIME === "off") return;
    const supabase = createClient();
    const channel = supabase
      .channel(`assistant-actions:${threadId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "assistant_actions", filter: `thread_id=eq.${threadId}` }, (payload) => {
        const row = payload.new as { id: string; status: ActionStatus; result: { summary?: string } | null; error: string | null; undo_until: string | null };
        setActions((prev) => ({ ...prev, [row.id]: { status: row.status, summary: row.result?.summary ?? prev[row.id]?.summary ?? null, error: row.error, undoUntil: row.undo_until } }));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId]);

  return { threadId, messages, actions, streaming, toolLabel, loading, send, stop, open, setAction };
}
