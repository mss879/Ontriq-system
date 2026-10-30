"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";

/**
 * Payment slips from the portal (portal.payments.upload). portal_begin_slip and
 * portal_finalize_slip (0015) keep each slip to the client's own open invoices;
 * the file goes straight to the private documents bucket.
 */

async function guarded<T extends object>(run: (viewer: Awaited<ReturnType<typeof requireViewer>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const viewer = await requireViewer({ kind: "client", permission: "portal.payments.upload" });
    return await run(viewer);
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const slipSchema = z.object({
  invoiceId: z.uuid(),
  filename: z.string().trim().min(1).max(200),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png"], "Upload a PDF, JPEG or PNG."),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, "Slips must be under 10 MB."),
  note: z.string().trim().max(500).optional(),
});

/** Step 1: the slip row and a signed upload URL. */
export async function beginSlip(input: z.input<typeof slipSchema>): Promise<ActionResult<{ slipId: string; path: string; token: string }>> {
  return guarded(async () => {
    const parsed = slipSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the file.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("portal_begin_slip", {
      p_invoice: v.invoiceId,
      p_filename: v.filename,
      p_mime: v.mime,
      p_size: v.size,
      p_note: (v.note || null) as unknown as string,
    });
    if (error || !data) return fail(rpcErrorMessage(error));
    const d = data as { id: string; bucket: string; path: string };
    const signed = await createAdminClient().storage.from(d.bucket).createSignedUploadUrl(d.path);
    if (signed.error) return fail("We couldn't prepare the upload. Try again in a moment.");
    return { ok: true, slipId: d.id, path: d.path, token: signed.data.token };
  });
}

/** Step 2: confirm the file arrived, then hand the slip to finance (and AI, to pre-fill the match). */
export async function finalizeSlip(slipId: string, sha256?: string): Promise<ActionResult> {
  return guarded(async (viewer) => {
    if (!z.uuid().safeParse(slipId).success) return fail("That upload no longer exists.");
    // A slip still uploading isn't readable through the client's policies: check it as the service,
    // limited to this person's own slip for their company.
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("payment_slips")
      .select("id, storage_path")
      .eq("id", slipId)
      .eq("client_id", viewer.clientId ?? "")
      .eq("uploaded_by", viewer.userId)
      .maybeSingle();
    if (!row) return fail("That upload no longer exists.");
    const exists = await admin.storage.from("documents").exists(row.storage_path);
    if (!exists.data) return fail("The file didn't reach storage. Try uploading it again.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("portal_finalize_slip", { p_slip: slipId, p_sha256: sha256 ?? "" });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker(); // ai.slip_read
    refresh();
    return { ok: true };
  });
}

/** Called once the invoice is on screen (not when it is merely read or prefetched). */
export async function markInvoiceViewed(invoiceId: string): Promise<void> {
  if (!z.uuid().safeParse(invoiceId).success) return;
  try {
    await requireViewer({ kind: "client", permission: "portal.invoices.view" });
  } catch {
    return;
  }
  const { error } = await (await createClient()).rpc("portal_mark_invoice_viewed", { p_invoice: invoiceId });
  if (!error) refresh();
}
