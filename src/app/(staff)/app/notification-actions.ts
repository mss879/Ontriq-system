"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";

/** Mark the signed-in person's notifications read: all of them, or the ids given. */
export async function markNotificationsRead(ids?: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    await requireViewer();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_notifications_read", ids?.length ? { p_ids: ids } : {});
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, count: (data as number) ?? 0 };
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}
