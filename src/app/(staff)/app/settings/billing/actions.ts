"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";

/** Tax rates (settings.manage). Rows are seeded per organisation; only these fields change, through row level security. */

const rateSchema = z.object({
  id: z.uuid(),
  is_active: z.boolean(),
  rate: z.coerce.number().min(0, "0 or more.").lt(100, "Under 100%."),
  inclusive: z.boolean(),
});

export async function saveTaxRates(input: z.input<typeof rateSchema>[]): Promise<ActionResult> {
  try {
    await requireViewer({ kind: "staff", permission: "settings.manage" });
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
  const parsed = z.array(rateSchema).max(20).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the rates.", zodFieldErrors(parsed.error.issues));
  const supabase = await createClient();
  for (const t of parsed.data) {
    const { data, error } = await supabase
      .from("tax_rates")
      .update({ is_active: t.is_active, rate: Math.round(t.rate * 1000) / 1000, inclusive: t.inclusive })
      .eq("id", t.id)
      .select("id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You can't change tax rates.");
  }
  refresh();
  return { ok: true };
}
