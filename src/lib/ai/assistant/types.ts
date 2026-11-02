/**
 * What the assistant sends to the browser and stores in assistant_messages.
 * Isomorphic (no server-only): the chat UI and the server share it.
 */

export type Artifact =
  | { type: "table"; title: string; columns: string[]; rows: (string | number)[][]; href?: string }
  | { type: "cards"; title: string; items: { title: string; subtitle?: string; meta?: string; href?: string }[] }
  | { type: "metrics"; title: string; items: { label: string; value: string }[] }
  | { type: "file"; title: string; subtitle: string; document_id: string }
  | { type: "action"; action_id: string; title: string; lines: string[]; status: "proposed" };

export type Block = { type: "text"; text: string } | Artifact | { type: "error"; text: string };

export type AssistantEvent =
  | { type: "thread"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string }
  | { type: "artifact"; artifact: Artifact }
  | { type: "done"; message_id: string | null }
  | { type: "error"; message: string };

export type AssistantKind = "staff" | "command";

export type ActionStatus = "proposed" | "confirmed" | "done" | "failed" | "cancelled" | "undone";

/** A confirm card's live state (assistant_actions). */
export type ActionState = { status: ActionStatus; summary?: string | null; error?: string | null; undoUntil?: string | null };

export type ThreadSummary = { id: string; title: string; updated_at: string };

export type ChatMessage = { id: string; role: "user" | "assistant"; blocks: Block[]; created_at: string };

export type ThreadDetail = { thread: ThreadSummary & { kind: AssistantKind }; messages: ChatMessage[]; actions: Record<string, ActionState> };
