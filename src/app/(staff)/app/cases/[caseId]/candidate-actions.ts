"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { activeLinkUrl, emailCandidateUpdate, issueCandidateLink, resendCandidateLink, type Channel } from "@/lib/server/candidate/links";
import { parseCheckTypeSchema } from "@/domain/check-types/schema";
import { validateCheckValues } from "@/domain/check-types/validate";

/**
 * The candidate side of a case, for staff: the link, requests, messages and
 * consent. The database functions in 0008 check permission on the case and
 * keep the candidate's view safe; these actions validate input, call them,
 * and tell the candidate by email when something new is waiting for them.
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
const channelsSchema = z.array(z.enum(["email", "sms"])).min(1, "Choose how to send the link.");

const CHANNEL_NAME: Record<Channel, string> = { email: "email", sms: "SMS" };
const listChannels = (list: Channel[]) => list.map((c) => CHANNEL_NAME[c]).join(" and ");

// ---------------------------------------------------------------- link

const linkSchema = z.object({
  channels: z.array(z.enum(["email", "sms"])),
  language: z.enum(["en", "si", "ta"]),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
});

export async function createCandidateLink(caseId: string, input: z.input<typeof linkSchema>): Promise<ActionResult<{ url: string; sent: Channel[]; missing: Channel[] }>> {
  return guarded(async () => {
    const viewer = await staff();
    const parsed = linkSchema.safeParse(input);
    if (!uuid.safeParse(caseId).success || !parsed.success) return fail("Check the link settings.");
    const r = await issueCandidateLink({ caseId, actorId: viewer.userId, ...parsed.data });
    if (!r.ok) return r;
    refresh();
    return { ok: true, url: r.url, sent: r.sent, missing: r.missing };
  });
}

export async function copyCandidateLink(linkId: string): Promise<ActionResult<{ url: string }>> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(linkId).success) return fail("Unknown link.");
    const r = await activeLinkUrl(linkId);
    return r.ok ? { ok: true, url: r.url } : r;
  });
}

export async function resendLink(linkId: string, channels: Channel[]): Promise<ActionResult<{ sent: Channel[]; missing: Channel[] }>> {
  return guarded(async () => {
    const viewer = await staff();
    const parsed = channelsSchema.safeParse(channels);
    if (!uuid.safeParse(linkId).success) return fail("Unknown link.");
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Choose how to send the link.");
    const r = await resendCandidateLink({ linkId, actorId: viewer.userId, channels: parsed.data });
    if (!r.ok) return r;
    if (!r.sent.length) return fail(`Nothing was sent: the candidate has no ${listChannels(r.missing)} on file.`);
    refresh();
    return r;
  });
}

export async function revokeLink(linkId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(linkId).success) return fail("Unknown link.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_candidate_link", { p_link: linkId, p_reason: reason.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- requests

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const askSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    category: z.string().min(1, "Choose the document."),
    checkId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    title: optionalText(200),
    note: optionalText(1000),
    dueAt: optionalText(40),
  }),
  z.object({
    kind: z.literal("field"),
    checkId: z.uuid("Choose the check."),
    fieldKey: z.string().min(1, "Choose the detail."),
    title: optionalText(200),
    help: optionalText(1000),
    dueAt: optionalText(40),
  }),
  z.object({
    kind: z.literal("question"),
    title: z.string().trim().min(3, "Write the question.").max(200),
    help: optionalText(1000),
    checkId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    dueAt: optionalText(40),
  }),
]);

export type AskInput = z.input<typeof askSchema>;

/** Due dates come from a date input (YYYY-MM-DD): close of business in Colombo. */
const dueIso = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T17:30:00+05:30` : null);

export async function askCandidate(caseId: string, input: AskInput): Promise<ActionResult<{ emailed: boolean }>> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const parsed = askSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const p =
      v.kind === "document"
        ? { kind: "document", category: v.category, check_id: v.checkId ?? null, title: v.title ?? null, note: v.note ?? null, due_at: dueIso(v.dueAt) }
        : v.kind === "field"
          ? { kind: "field", check_id: v.checkId, field_key: v.fieldKey, title: v.title ?? null, help: v.help ?? null, due_at: dueIso(v.dueAt) }
          : { kind: "question", check_id: v.checkId ?? null, title: v.title, help: v.help ?? null, due_at: dueIso(v.dueAt) };
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_candidate_request", { p_case: caseId, p });
    if (error) return fail(rpcErrorMessage(error));
    const emailed = await emailCandidateUpdate(caseId, viewer.userId).catch(() => false);
    refresh();
    return { ok: true, emailed };
  });
}

/**
 * Accept an answer (a detail is copied into its check first, validated against
 * the check's schema), ask again with a note, or withdraw the request.
 */
export async function reviewRequest(requestId: string, decision: "accept" | "reopen" | "cancel", note?: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(requestId).success || !["accept", "reopen", "cancel"].includes(decision)) return fail("Unknown request.");
    const supabase = await createClient();
    const { data: q } = await supabase.from("candidate_requests").select("id, case_id, kind, status, field_key, case_check_id, answer").eq("id", requestId).maybeSingle();
    if (!q) return fail("That request no longer exists, or you don't have access to it.");

    if (decision === "accept" && q.kind === "field" && q.case_check_id && q.field_key) {
      const answer = (q.answer as { value?: unknown } | null)?.value;
      if (answer === undefined || answer === null || String(answer).trim() === "") return fail("There is no answer to use yet.");
      const { data: check } = await supabase.from("case_checks").select("id, values, version:check_type_versions(schema)").eq("id", q.case_check_id).maybeSingle();
      if (!check) return fail("That check no longer exists, or you don't have access to it.");
      const schema = parseCheckTypeSchema((check.version as { schema: unknown } | null)?.schema);
      const merged = { ...((check.values ?? {}) as Record<string, unknown>), [q.field_key]: answer };
      const draft = validateCheckValues(schema.fields, merged, "draft");
      if (!draft.ok) {
        const message = draft.errors[q.field_key] ?? Object.values(draft.errors)[0];
        return fail(`The answer can't be used as it is: ${message ?? "it doesn't fit this detail."} Ask again, or enter it on the check yourself.`);
      }
      const submit = validateCheckValues(schema.fields, draft.values, "submit");
      const { error: saveError } = await supabase.rpc("save_check_values", { p_check: check.id, p_values: draft.values as never, p_valid: submit.ok });
      if (saveError) return fail(rpcErrorMessage(saveError));
    }

    const { error } = await supabase.rpc("review_candidate_request", { p_request: requestId, p_decision: decision, p_note: note?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    if (decision === "reopen") await emailCandidateUpdate(q.case_id, viewer.userId).catch(() => false);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- messages

export async function replyToCandidate(caseId: string, body: string): Promise<ActionResult<{ emailed: boolean }>> {
  return guarded(async () => {
    const viewer = await staff();
    const text = body.trim();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    if (!text) return fail("Write a message first.");
    if (text.length > 4000) return fail("Keep messages under 4,000 characters.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("post_candidate_message", { p_case: caseId, p_body: text });
    if (error) return fail(rpcErrorMessage(error));
    const emailed = await emailCandidateUpdate(caseId, viewer.userId).catch(() => false);
    refresh();
    return { ok: true, emailed };
  });
}

export async function markCandidateMessagesRead(caseId: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_candidate_messages_read", { p_case: caseId });
    if (error) return fail(rpcErrorMessage(error));
    if (data) refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- consent

export async function reviewConsent(caseId: string, accept: boolean, note?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("review_consent", { p_case: caseId, p_accept: accept, p_note: note?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** A paper consent form the candidate signed and someone uploaded to the case. */
export async function recordPaperConsent(caseId: string, documentId: string, note?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success || !uuid.safeParse(documentId).success) return fail("Choose the signed form.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("review_consent", { p_case: caseId, p_accept: true, p_note: note?.trim() || undefined, p_document: documentId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
