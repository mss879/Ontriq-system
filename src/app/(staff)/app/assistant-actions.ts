"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { can } from "@/domain/permissions";
import type { Json } from "@/lib/supabase/database.types";
import { toolByName, type ToolContext } from "@/lib/ai/assistant/tools";

/**
 * What the person decides on the assistant's confirm cards. Confirming
 * re-checks that they still hold the tool's permission (and the Super Admin
 * role for command-only tools), then performs it as them. Reversible
 * actions can be undone for ten minutes.
 */

const UNDO_MINUTES = 10;

async function context(): Promise<{ viewer: Viewer; ctx: (threadId: string) => ToolContext } | { ok: false; error: string }> {
  try {
    const viewer = await requireViewer({ kind: "staff" });
    const supabase = await createClient();
    const admin = createAdminClient();
    return { viewer, ctx: (threadId) => ({ supabase, admin, viewer, threadId }) };
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const Id = z.uuid();

async function ownAction(viewer: Viewer, id: string) {
  const { data } = await createAdminClient()
    .from("assistant_actions")
    .select("id, thread_id, user_id, tool, input, status, undo, undo_until, thread:assistant_threads(kind)")
    .eq("id", id)
    .maybeSingle();
  return data && data.user_id === viewer.userId ? data : null;
}

export async function confirmAssistantAction(id: string): Promise<ActionResult<{ summary: string; undoable: boolean }>> {
  const c = await context();
  if (!("viewer" in c)) return c;
  if (!Id.safeParse(id).success) return fail("That card is no longer available.");
  const admin = createAdminClient();
  const row = await ownAction(c.viewer, id);
  if (!row) return fail("That card is no longer available.");
  if (row.status !== "proposed") return fail(row.status === "cancelled" ? "That card was cancelled." : "That card was already handled.");
  const tool = toolByName(row.tool);
  if (!tool || tool.kind !== "action") return fail("That action is no longer supported.");
  const kind = (row.thread as unknown as { kind: string } | null)?.kind ?? "staff";
  if (tool.commandOnly && (kind !== "command" || !c.viewer.permissions.includes("*"))) return fail("Only the Super Admin can do that.");
  if (tool.permissions && !tool.permissions.some((p) => can(c.viewer, p as never))) return fail("You no longer have permission to do that.");

  // Claim it first, so a double click can't run it twice.
  const { data: claimed } = await admin.from("assistant_actions").update({ status: "confirmed", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "proposed").select("id");
  if (!claimed?.length) return fail("That card was already handled.");
  try {
    const out = await tool.execute(c.ctx(row.thread_id), (row.input ?? {}) as Record<string, unknown>);
    const undoable = Boolean(out.undo && tool.undo);
    await admin
      .from("assistant_actions")
      .update({
        status: "done",
        result: { summary: out.summary } as Json,
        undo: undoable ? (out.undo as Json) : null,
        undo_until: undoable ? new Date(Date.now() + UNDO_MINUTES * 60_000).toISOString() : null,
      })
      .eq("id", id);
    refresh();
    return { ok: true, summary: out.summary, undoable };
  } catch (error) {
    const message = error instanceof Error ? error.message : "It didn't work.";
    await admin.from("assistant_actions").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", id);
    return fail(message);
  }
}

export async function cancelAssistantAction(id: string): Promise<ActionResult> {
  const c = await context();
  if (!("viewer" in c)) return c;
  if (!Id.safeParse(id).success) return fail("That card is no longer available.");
  const row = await ownAction(c.viewer, id);
  if (!row) return fail("That card is no longer available.");
  const { data } = await createAdminClient()
    .from("assistant_actions")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "proposed")
    .select("id");
  if (!data?.length) return fail("That card was already handled.");
  return { ok: true };
}

export async function undoAssistantAction(id: string): Promise<ActionResult<{ summary: string }>> {
  const c = await context();
  if (!("viewer" in c)) return c;
  if (!Id.safeParse(id).success) return fail("That card is no longer available.");
  const row = await ownAction(c.viewer, id);
  if (!row || row.status !== "done" || !row.undo || !row.undo_until) return fail("This can't be undone.");
  if (Date.parse(row.undo_until) < Date.now()) return fail(`The ${UNDO_MINUTES}-minute undo window has passed.`);
  const tool = toolByName(row.tool);
  if (!tool || tool.kind !== "action" || !tool.undo) return fail("This can't be undone.");
  if (tool.permissions && !tool.permissions.some((p) => can(c.viewer, p as never))) return fail("You no longer have permission to do that.");
  const admin = createAdminClient();
  const { data: claimed } = await admin.from("assistant_actions").update({ status: "undone", undo_until: null }).eq("id", id).eq("status", "done").select("id");
  if (!claimed?.length) return fail("This can't be undone.");
  try {
    const summary = await tool.undo(c.ctx(row.thread_id), row.undo as Record<string, unknown>);
    refresh();
    return { ok: true, summary };
  } catch (error) {
    await admin.from("assistant_actions").update({ status: "done", error: error instanceof Error ? error.message.slice(0, 1000) : null }).eq("id", id);
    return fail(error instanceof Error ? error.message : "Undo failed.");
  }
}

const Title = z.string().trim().min(1, "Give it a name.").max(80);

export async function renameAssistantThread(id: string, title: string): Promise<ActionResult> {
  const c = await context();
  if (!("viewer" in c)) return c;
  const t = Title.safeParse(title);
  if (!Id.safeParse(id).success || !t.success) return fail(t.success ? "That conversation isn't available." : t.error.issues[0].message);
  const { data } = await (await createClient()).from("assistant_threads").update({ title: t.data }).eq("id", id).select("id");
  if (!data?.length) return fail("That conversation isn't available.");
  refresh();
  return { ok: true };
}

export async function archiveAssistantThread(id: string): Promise<ActionResult> {
  const c = await context();
  if (!("viewer" in c)) return c;
  if (!Id.safeParse(id).success) return fail("That conversation isn't available.");
  const { data } = await (await createClient()).from("assistant_threads").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id");
  if (!data?.length) return fail("That conversation isn't available.");
  refresh();
  return { ok: true };
}

export async function decideAssistantMemory(id: string, decision: "approved" | "rejected"): Promise<ActionResult> {
  const c = await context();
  if (!("viewer" in c)) return c;
  if (!Id.safeParse(id).success || !["approved", "rejected"].includes(decision)) return fail("That memory isn't available.");
  const { data } = await (await createClient()).from("assistant_memories").update({ status: decision }).eq("id", id).select("id");
  if (!data?.length) return fail("That memory isn't available.");
  refresh();
  return { ok: true };
}
