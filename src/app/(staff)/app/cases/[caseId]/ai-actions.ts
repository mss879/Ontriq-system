"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { enqueueJob } from "@/lib/server/jobs/enqueue";
import { rateLimit } from "@/lib/server/request-meta";
import { isAiConfigured } from "@/lib/ai/claude";
import { can, type Permission } from "@/domain/permissions";
import { canDecide, canRerun, RERUN, sameValue, type RerunCapability } from "@/domain/ai/suggestions";
import type { Json } from "@/lib/supabase/database.types";
import type { Stage } from "@/domain/workflow/stages";

/**
 * Decisions on AI suggestions and requests for new ones (plan §8). The AI
 * never changes a case: accepting a field value or remarks writes them with
 * the person's own permissions through the normal functions, and every
 * decision is recorded (decide_ai_suggestion, 0029). Requests for a new
 * draft are queued as jobs after the person's access to the case is checked
 * with their own client.
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
/** On-demand AI runs cost money: 20 a person per 10 minutes across outreach, replies and re-runs. */
const aiQuota = (viewer: Viewer) => rateLimit(`ai-request:${viewer.userId}`, 600, 20);
const TOO_MANY = "That's a lot of AI requests at once. Wait a few minutes and try again.";
const uuid = z.uuid();
const allowed = (viewer: Viewer) => (p: string) => can(viewer, p as Permission);
const CLOSED: Stage[] = ["released", "cancelled"];
const NOT_SET_UP = "AI isn't set up yet, so new suggestions can't be made. Ask an administrator to add the API key.";

type SuggestionRow = { id: string; capability: string; entity_type: string; entity_id: string; field_key: string | null; value: Json; decision: string };

async function readSuggestion(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<SuggestionRow | null> {
  const { data } = await supabase.from("ai_suggestions").select("id, capability, entity_type, entity_id, field_key, value, decision").eq("id", id).maybeSingle();
  return (data as SuggestionRow | null) ?? null;
}

/** Accept, edit-and-accept or reject one suggestion. Applying its value is the caller's job. */
export async function decideSuggestion(id: string, decision: "accepted" | "edited" | "rejected", value?: unknown): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(id).success || !["accepted", "edited", "rejected"].includes(decision)) return fail("That suggestion is no longer available.");
    const supabase = await createClient();
    const s = await readSuggestion(supabase, id);
    if (!s) return fail("That suggestion is no longer available.");
    if (!canDecide(s.capability, allowed(viewer))) return fail("You don't have permission to decide this suggestion.");
    const { error } = await supabase.rpc("decide_ai_suggestion", { p_suggestion: id, p_decision: decision, p_value: decision === "edited" ? ((value ?? null) as Json) : undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const settleSchema = z
  .array(z.object({ id: z.uuid(), decision: z.enum(["accepted", "edited", "rejected"]), value: z.unknown().optional() }))
  .min(1)
  .max(60);

/**
 * Record what happened to a check's extracted values once the person saved
 * the form (accepted as is, edited, or rejected). Only this check's pending
 * extraction suggestions are touched.
 */
export async function settleFieldSuggestions(checkId: string, items: { id: string; decision: "accepted" | "edited" | "rejected"; value?: unknown }[]): Promise<ActionResult<{ settled: number }>> {
  return guarded(async () => {
    const viewer = await staff();
    const parsed = settleSchema.safeParse(items);
    if (!uuid.safeParse(checkId).success || !parsed.success) return fail("Nothing to record.");
    if (!canDecide("document.extract", allowed(viewer))) return fail("You don't have permission to decide these suggestions.");
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("ai_suggestions")
      .select("id")
      .eq("entity_type", "case_check")
      .eq("entity_id", checkId)
      .eq("capability", "document.extract")
      .eq("decision", "pending")
      .in(
        "id",
        parsed.data.map((i) => i.id),
      );
    const mine = new Set((rows ?? []).map((r) => r.id));
    let settled = 0;
    for (const item of parsed.data) {
      if (!mine.has(item.id)) continue;
      const { error } = await supabase.rpc("decide_ai_suggestion", {
        p_suggestion: item.id,
        p_decision: item.decision,
        p_value: item.decision === "edited" ? ((item.value ?? null) as Json) : undefined,
      });
      if (!error) settled++;
    }
    refresh();
    return { ok: true, settled };
  });
}

const remarksSchema = z.string().trim().min(1, "Write the remarks first.").max(2000, "Keep remarks under 2,000 characters.");

/** Put AI-drafted remarks (as written or edited) on the check, then record the decision. */
export async function acceptRemarks(suggestionId: string, text: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    const remarks = remarksSchema.safeParse(text);
    if (!uuid.safeParse(suggestionId).success) return fail("That suggestion is no longer available.");
    if (!remarks.success) return fail(remarks.error.issues[0].message);
    const supabase = await createClient();
    const s = await readSuggestion(supabase, suggestionId);
    if (!s || s.capability !== "report.narrative" || s.entity_type !== "case_check" || s.field_key !== "remarks") return fail("That suggestion is no longer available.");
    if (s.decision !== "pending") return fail("This suggestion was already decided.");
    if (!canDecide(s.capability, allowed(viewer))) return fail("You don't have permission to change the report remarks.");
    const { error } = await supabase.rpc("set_check_remarks", { p_check: s.entity_id, p_remarks: remarks.data });
    if (error) return fail(rpcErrorMessage(error));
    const original = (s.value as { text?: string } | null)?.text ?? "";
    const edited = !sameValue(original.trim(), remarks.data);
    await supabase.rpc("decide_ai_suggestion", { p_suggestion: s.id, p_decision: edited ? "edited" : "accepted", p_value: edited ? { text: remarks.data } : undefined });
    refresh();
    return { ok: true };
  });
}

/** Mark an outreach draft as used, optionally moving the check to "awaiting reply". */
export async function markOutreachUsed(suggestionId: string, awaitingReply: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(suggestionId).success) return fail("That draft is no longer available.");
    if (!can(viewer, "checks.verify")) return fail("Outreach needs verification access.");
    const supabase = await createClient();
    const s = await readSuggestion(supabase, suggestionId);
    if (!s || s.capability !== "check.outreach") return fail("That draft is no longer available.");
    if (awaitingReply) {
      const { error } = await supabase.rpc("set_check_state", { p_check: s.entity_id, p_state: "awaiting_response", p_note: "Verification request sent" });
      if (error) return fail(rpcErrorMessage(error));
    }
    if (s.decision === "pending") await supabase.rpc("decide_ai_suggestion", { p_suggestion: s.id, p_decision: "accepted" });
    refresh();
    return { ok: true };
  });
}

/** The check, read as the person: proves they can see it, and gives the case for job ownership. */
async function visibleCheck(checkId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("case_checks").select("id, state, case:cases(id, stage, on_hold)").eq("id", checkId).maybeSingle();
  if (!data) return null;
  const c = data.case as unknown as { id: string; stage: Stage; on_hold: boolean } | null;
  return c ? { id: data.id, state: data.state as string, caseId: c.id, stage: c.stage, onHold: c.on_hold } : null;
}

const targetSchema = z.string().trim().max(200).optional();

/** Ask for a new outreach draft (email and call script) for a check, optionally aimed at a named contact. */
export async function requestOutreachDraft(checkId: string, target?: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(checkId).success) return fail("Unknown check.");
    if (!can(viewer, "checks.verify")) return fail("Outreach needs verification access.");
    const t = targetSchema.safeParse(target);
    if (!t.success) return fail("Keep who to contact under 200 characters.");
    if (!isAiConfigured()) return fail(NOT_SET_UP);
    if (!(await aiQuota(viewer))) return fail(TOO_MANY);
    const k = await visibleCheck(checkId);
    if (!k) return fail("That check no longer exists, or you don't have access to it.");
    if (CLOSED.includes(k.stage)) return fail("This case is closed.");
    await enqueueJob({
      kind: "ai.outreach_draft",
      payload: { check_id: checkId, target: t.data || null },
      idempotencyKey: `ai.outreach_draft:${checkId}:${randomUUID()}`,
      entityType: "case_check",
      entityId: checkId,
      orgId: viewer.orgId,
      createdBy: viewer.userId,
    });
    refresh();
    return { ok: true };
  });
}

const replySchema = z.string().trim().min(20, "Paste the reply or your call notes (at least a sentence).").max(8000, "That's too long. Paste the relevant part (up to 8,000 characters).");

/** Turn a verifier's reply into a proposed result for the officer to confirm. */
export async function captureReply(checkId: string, reply: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(checkId).success) return fail("Unknown check.");
    if (!can(viewer, "checks.verify")) return fail("Capturing a reply needs verification access.");
    const r = replySchema.safeParse(reply);
    if (!r.success) return fail(r.error.issues[0].message);
    if (!isAiConfigured()) return fail(NOT_SET_UP);
    if (!(await aiQuota(viewer))) return fail(TOO_MANY);
    const k = await visibleCheck(checkId);
    if (!k) return fail("That check no longer exists, or you don't have access to it.");
    if (CLOSED.includes(k.stage)) return fail("This case is closed.");
    await enqueueJob({
      kind: "ai.response_capture",
      payload: { check_id: checkId, reply: r.data },
      idempotencyKey: `ai.response_capture:${checkId}:${randomUUID()}`,
      entityType: "case_check",
      entityId: checkId,
      orgId: viewer.orgId,
      createdBy: viewer.userId,
    });
    refresh();
    return { ok: true };
  });
}

const rerunSchema = z.enum(["consistency", "preqc", "postqc", "narrative"]);

/** Run one of the case-level reviews again (stage and permission as in RERUN). */
export async function rerunCaseAi(caseId: string, capability: RerunCapability): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    const cap = rerunSchema.safeParse(capability);
    if (!uuid.safeParse(caseId).success || !cap.success) return fail("Unknown request.");
    const supabase = await createClient();
    const { data: c } = await supabase.from("cases").select("id, stage, on_hold").eq("id", caseId).maybeSingle();
    if (!c) return fail("That case no longer exists, or you don't have access to it.");
    const r = RERUN[cap.data];
    if (!canRerun(cap.data, c.stage as Stage, c.on_hold, allowed(viewer))) {
      return fail(can(viewer, r.permission as Permission) ? `The ${r.label.toLowerCase()} can't run at this stage.` : `You don't have permission to run the ${r.label.toLowerCase()}.`);
    }
    if (!isAiConfigured()) return fail(NOT_SET_UP);
    if (!(await aiQuota(viewer))) return fail(TOO_MANY);
    await enqueueJob({
      kind: r.job,
      payload: { case_id: caseId },
      idempotencyKey: `${r.job}:${caseId}:manual:${randomUUID()}`,
      entityType: "case",
      entityId: caseId,
      orgId: viewer.orgId,
      createdBy: viewer.userId,
    });
    refresh();
    return { ok: true };
  });
}
