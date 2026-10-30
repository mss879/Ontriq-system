"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";

/** Matching clients' payment slips (payments.record). record_payment and reject_payment_slip (0015) enforce the rules. */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    await requireViewer({ kind: "staff", permission: "payments.record" });
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const matchSchema = z.object({
  invoiceId: z.uuid("Choose the invoice this pays."),
  amount: z.coerce.number().positive("Enter the amount received."),
  method: z.enum(["bank_transfer", "cheque", "cash", "card", "online", "other"]),
  reference: z.string().trim().max(120).optional(),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the payment date."),
});

/** Record the payment the slip shows, against the chosen invoice; the slip becomes matched. */
export async function matchSlip(slipId: string, input: z.input<typeof matchSchema>): Promise<ActionResult> {
  return guarded(async () => {
    if (!z.uuid().safeParse(slipId).success) return fail("Unknown slip.");
    const parsed = matchSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the payment.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_payment", {
      p_invoice: v.invoiceId,
      p_amount: v.amount,
      p_method: v.method,
      p_reference: (v.reference || null) as unknown as string,
      p_paid_on: v.paid_on,
      p_slip: slipId,
      p_notes: "Matched from the client's payment slip",
    });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker(); // the receipt PDF
    refresh();
    return { ok: true };
  });
}

export async function rejectSlip(slipId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    if (!z.uuid().safeParse(slipId).success) return fail("Unknown slip.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("reject_payment_slip", { p_slip: slipId, p_reason: reason.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
