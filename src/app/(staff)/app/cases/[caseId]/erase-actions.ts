"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { removeObjects } from "@/jobs/storage";

const Input = z.object({
  caseId: z.uuid(),
  reason: z.string().trim().min(5, "Say why the data is being erased.").max(500),
  confirmReference: z.string().trim(),
});

/**
 * Erase a finished case's personal data on request (0035). Super Admin with
 * two-step verification only (the database checks again), confirmed by
 * typing the case reference. Files are deleted from Storage afterwards.
 */
export async function eraseCaseData(input: z.input<typeof Input>): Promise<ActionResult<{ files: number }>> {
  try {
    const viewer = await requireViewer({ kind: "staff" });
    if (!viewer.permissions.includes("*")) return fail("Only the Super Admin can erase personal data.");
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
  const parsed = Input.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { data: c } = await supabase.from("cases").select("reference").eq("id", parsed.data.caseId).maybeSingle();
  if (!c) return fail("Case not found.");
  if (parsed.data.confirmReference.toUpperCase() !== c.reference.toUpperCase()) return fail(`Type ${c.reference} to confirm.`);
  const { data, error } = await supabase.rpc("erase_case", { p_case: parsed.data.caseId, p_reason: parsed.data.reason });
  if (error) return fail(rpcErrorMessage(error));
  const files = await removeObjects(createAdminClient(), ((data as { objects?: { bucket: string; path: string }[] } | null)?.objects ?? []));
  refresh();
  return { ok: true, files };
}
