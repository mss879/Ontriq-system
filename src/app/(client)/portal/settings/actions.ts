"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { PORTAL_EVENTS } from "./events";

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const nameSchema = z.object({ fullName: z.string().trim().min(2, "Enter your full name.").max(120) });

export async function updateMyName(input: z.input<typeof nameSchema>): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "client" });
    const parsed = nameSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", viewer.userId);
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true };
  });
}

/**
 * Email copies of portal notifications. In-app notifications always arrive;
 * this only decides whether the notify.email job (0021) also sends an email.
 */
export async function saveEmailPreferences(email: Record<string, boolean>): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "client" });
    const supabase = await createClient();
    const { data: current } = await supabase.from("notification_prefs").select("matrix").eq("user_id", viewer.userId).maybeSingle();
    const matrix = { ...((current?.matrix ?? {}) as Record<string, Record<string, boolean>>) };
    for (const e of PORTAL_EVENTS) {
      if (typeof email[e.type] === "boolean") matrix[e.type] = { ...(matrix[e.type] ?? {}), in_app: true, email: email[e.type] };
    }
    const { error } = await supabase.from("notification_prefs").upsert({ user_id: viewer.userId, matrix: matrix as unknown as NonNullable<Json> }, { onConflict: "user_id" });
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true };
  });
}
