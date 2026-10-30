import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionState, ActionStatus, AssistantKind, Block, ChatMessage, ThreadDetail, ThreadSummary } from "./types";

/** Reads for the assistant screens. All run as the person: threads, messages and memories are private to them. */

type Client = SupabaseClient<Database>;

export async function listThreads(supabase: Client, kind: AssistantKind, limit = 30): Promise<ThreadSummary[]> {
  const { data } = await supabase
    .from("assistant_threads")
    .select("id, title, updated_at")
    .eq("kind", kind)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function threadDetail(supabase: Client, threadId: string): Promise<ThreadDetail | null> {
  const { data: thread } = await supabase.from("assistant_threads").select("id, title, updated_at, kind").eq("id", threadId).maybeSingle();
  if (!thread) return null;
  const [{ data: rows }, { data: acts }] = await Promise.all([
    supabase.from("assistant_messages").select("id, role, content, created_at").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(80),
    supabase.from("assistant_actions").select("id, status, result, error, undo_until").eq("thread_id", threadId),
  ]);
  const messages: ChatMessage[] = [...(rows ?? [])].reverse().map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    blocks: (Array.isArray(m.content) ? m.content : []) as unknown as Block[],
    created_at: m.created_at,
  }));
  const actions: Record<string, ActionState> = {};
  for (const a of acts ?? []) {
    actions[a.id] = {
      status: a.status as ActionStatus,
      summary: ((a.result ?? null) as { summary?: string } | null)?.summary ?? null,
      error: a.error,
      undoUntil: a.undo_until,
    };
  }
  return { thread: { id: thread.id, title: thread.title, updated_at: thread.updated_at, kind: thread.kind as AssistantKind }, messages, actions };
}

export type Memory = { id: string; content: string; status: "pending" | "approved"; created_at: string };

export async function listMemories(supabase: Client): Promise<Memory[]> {
  const { data } = await supabase.from("assistant_memories").select("id, content, status, created_at").in("status", ["pending", "approved"]).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as Memory[];
}

/** What the command assistant has cost today (Sri Lanka day), from the ledger. */
export async function commandUsageToday(supabase: Client): Promise<{ runs: number; costUsd: number }> {
  const now = new Date();
  const colombo = new Date(now.getTime() + 330 * 60_000);
  const from = new Date(Date.UTC(colombo.getUTCFullYear(), colombo.getUTCMonth(), colombo.getUTCDate()) - 330 * 60_000);
  const { data } = await supabase.rpc("ai_cost_summary", { p_from: from.toISOString(), p_to: new Date(now.getTime() + 60_000).toISOString(), p_group: "capability" });
  const row = ((data ?? []) as unknown as { group_key: string; runs: number; cost_usd: number }[]).find((r) => r.group_key === "assistant.command");
  return { runs: Number(row?.runs ?? 0), costUsd: Number(row?.cost_usd ?? 0) };
}

export type Briefing = { headline: string; bullets: string[]; risks: string[]; day: string | null; created_at: string };

export async function latestBriefing(supabase: Client): Promise<Briefing | null> {
  const { data } = await supabase
    .from("ai_suggestions")
    .select("value, created_at")
    .eq("capability", "briefing.daily")
    .eq("entity_type", "org")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const v = (data.value ?? {}) as { headline?: string; bullets?: string[]; risks?: string[]; day?: string };
  if (!v.headline) return null;
  return { headline: v.headline, bullets: v.bullets ?? [], risks: v.risks ?? [], day: v.day ?? null, created_at: data.created_at };
}
