"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { MODELS } from "@/domain/ai/cost-model";

/** AI capability and budget settings (ai.configure). Writes go through row level security (0018). */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    await requireViewer({ kind: "staff", permission: "ai.configure" });
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const CLAUDE_MODELS = Object.values(MODELS).map((m) => m.id) as [string, ...string[]];

const capabilitySchema = z.object({
  model: z.enum(CLAUDE_MODELS).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  max_tokens: z.coerce.number().int("A whole number.").min(100, "At least 100.").max(64000, "At most 64,000."),
  enabled: z.boolean(),
});

export async function saveCapability(key: string, input: z.input<typeof capabilitySchema>): Promise<ActionResult> {
  return guarded(async () => {
    const parsed = capabilitySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the settings.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data: current } = await supabase.from("ai_capabilities").select("model").eq("key", key).maybeSingle();
    if (!current) return fail("Unknown capability.");
    const v = parsed.data;
    // Speech-to-text runs on its own provider; only Claude capabilities can change model.
    const model = current.model.startsWith("claude-") && v.model ? v.model : current.model;
    const { data, error } = await supabase
      .from("ai_capabilities")
      .update({ model, effort: v.effort, max_tokens: current.model.startsWith("claude-") ? v.max_tokens : 0, enabled: v.enabled })
      .eq("key", key)
      .select("key");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You can't change AI settings.");
    refresh();
    return { ok: true };
  });
}

const money = z.union([z.literal("").transform(() => null), z.coerce.number().min(0, "0 or more.").max(100000, "Too large.")]).nullable();
const budgetSchema = z.object({ daily_usd: money, monthly_usd: money, action: z.enum(["alert", "pause"]) });

export async function saveBudget(id: string, input: z.input<typeof budgetSchema>): Promise<ActionResult> {
  return guarded(async () => {
    if (!z.uuid().safeParse(id).success) return fail("Unknown budget.");
    const parsed = budgetSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the budget.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data, error } = await supabase.from("ai_budgets").update(parsed.data).eq("id", id).select("id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You can't change AI budgets.");
    refresh();
    return { ok: true };
  });
}
