"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { currentSnapshot } from "@/jobs/report/load";

/**
 * The final report on a case (0012): draft, send for approval, approve with
 * the final result, return, release to the client, revise. The database
 * functions check permission, stage and the four-eyes rule; these actions
 * validate input, wake the worker after a render is queued, and refresh.
 */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const staff = () => requireViewer({ kind: "staff" });
const uuid = z.uuid();

export async function generateReportDraft(caseId: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("request_report_draft", { p_case: caseId });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker();
    refresh();
    return { ok: true };
  });
}

export async function sendReportForApproval(caseId: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("submit_report", { p_case: caseId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const approveSchema = z.object({ caseId: uuid, draftId: uuid, finalResult: z.enum(["green", "amber", "red"]) });

/**
 * Approve the checked draft. The case is compiled again now and its hash sent
 * with the approval; the database refuses if anything changed since the draft.
 */
export async function approveReport(input: z.input<typeof approveSchema>): Promise<ActionResult<{ stale?: boolean }>> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "reports.approve" });
    const parsed = approveSchema.safeParse(input);
    if (!parsed.success) return fail("Choose the final result.");
    const v = parsed.data;
    // Only after the caller passed the permission check: the snapshot reads the whole case.
    const { hash } = await currentSnapshot(createAdminClient(), v.caseId);
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_report", { p_case: v.caseId, p_draft: v.draftId, p_final_result: v.finalResult, p_current_hash: hash });
    if (error) {
      const stale = /changed after this draft/i.test(error.message ?? "");
      return stale ? { ok: false, error: "The case changed after this draft was made. Generate a new draft, check it, then approve that one." } : fail(rpcErrorMessage(error));
    }
    kickWorker();
    refresh();
    return { ok: true };
  });
}

export async function returnReport(caseId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    if (!reason.trim()) return fail("Say what needs changing.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("return_report", { p_case: caseId, p_reason: reason.trim().slice(0, 2000) });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const releaseSchema = z.object({ caseId: uuid, recipients: z.array(uuid).max(200) });

export async function releaseReport(input: z.input<typeof releaseSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const parsed = releaseSchema.safeParse(input);
    if (!parsed.success) return fail("Check the recipients.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("release_report", { p_case: parsed.data.caseId, p_recipients: parsed.data.recipients });
    if (error) return fail(rpcErrorMessage(error));
    // Per-case billing queues an invoice draft on release.
    kickWorker();
    refresh();
    return { ok: true };
  });
}

export async function reviseReport(caseId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    if (!reason.trim()) return fail("Say why the report is being revised.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("revise_report", { p_case: caseId, p_reason: reason.trim().slice(0, 2000) });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
