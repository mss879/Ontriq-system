"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { openItems, staffPerson, type OpenItem } from "@/lib/server/performance/queries";
import { rebalanceProposal } from "@/lib/server/performance/rebalance";
import { rateLimit } from "@/lib/server/request-meta";
import { isAiConfigured, runStructured } from "@/lib/ai/claude";
import { NUDGE_SYSTEM, NUDGE_VERSION, NudgeSchema, text } from "@/lib/ai/prompts";
import type { Move } from "@/domain/performance/rebalance-core";
import type { Permission } from "@/domain/permissions";

/** The Push button, acknowledging a push, and Rebalance. Every write re-checks permission in the database too. */

async function guarded<T extends object>(permission: Permission | null, run: (viewer: Viewer) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const viewer = await requireViewer(permission ? { kind: "staff", permission } : { kind: "staff" });
    return await run(viewer);
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const Id = z.uuid();
const Tone = z.enum(["friendly", "firm"]);
export type NudgeTone = z.infer<typeof Tone>;

const firstName = (name: string) => name.split(" ")[0] || name;
const itemList = (items: OpenItem[]) => items.slice(0, 3).map((i) => i.reference).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : "");

/** A friendly, specific message when AI isn't available. */
function templateMessage(name: string, items: OpenItem[], tone: NudgeTone): string {
  const n = items.filter((i) => i.overdue).length || items.length;
  const what = `${n} item${n === 1 ? "" : "s"}`;
  const list = items.length ? ` (${itemList(items)})` : "";
  return tone === "firm"
    ? `Hi ${firstName(name)}, ${what}${list} ${n === 1 ? "is" : "are"} past due. Please bring them up to date today, or tell me by the end of the day what is holding them up so we can sort it out together.`
    : `Hi ${firstName(name)}, I can see ${what}${list} running late. I know things get busy. Could you take a look today, and let me know if anything is blocking you or if you'd like a hand?`;
}

export async function draftNudge(userId: string, tone: NudgeTone): Promise<ActionResult<{ message: string; items: OpenItem[]; ai: boolean }>> {
  return guarded("staff.nudge", async (viewer) => {
    if (!Id.safeParse(userId).success || !Tone.safeParse(tone).success) return fail("Unknown person.");
    if (userId === viewer.userId) return fail("You can't push yourself.");
    const person = await staffPerson(userId);
    if (!person) return fail("That person isn't on the team.");
    const items = (await openItems(userId)).filter((i) => i.overdue || i.at_risk).sort((a, b) => Number(b.overdue) - Number(a.overdue));
    let message = templateMessage(person.name, items, tone);
    let ai = false;
    if (isAiConfigured() && (await rateLimit(`ai-nudge:${viewer.userId}`, 600, 20))) {
      const r = await runStructured(
        createAdminClient(),
        "team.nudge",
        { orgId: viewer.orgId, userId: viewer.userId, source: "team/push", promptVersion: NUDGE_VERSION },
        {
          system: NUDGE_SYSTEM,
          content: [
            text(
              `Team member: ${person.name} (${person.roleName})\nFrom: ${viewer.fullName}\nTone: ${tone === "firm" ? "firm but respectful" : "warm and encouraging"}\nOverdue and at-risk items:\n${
                items.length ? items.map((i) => `- ${i.reference}: ${i.label}${i.overdue ? " (overdue" : " (due soon"}${i.due_at ? `, due ${i.due_at.slice(0, 10)})` : ")"}`).join("\n") : "- none listed"
              }`,
            ),
          ],
          schema: NudgeSchema,
        },
      );
      if (r.ok && r.data.message.trim()) {
        message = r.data.message.trim().slice(0, 2000);
        ai = true;
      }
    }
    return { ok: true, message, items, ai };
  });
}

const sendSchema = z.object({
  userId: z.uuid(),
  message: z.string().trim().min(1, "Write a message.").max(2000, "Keep it under 2,000 characters."),
  channels: z.array(z.enum(["in_app", "email"])).max(2),
});

export async function sendNudge(input: z.input<typeof sendSchema>): Promise<ActionResult> {
  return guarded("staff.nudge", async () => {
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the message.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("send_nudge", { p_to: parsed.data.userId, p_message: parsed.data.message, p_channels: ["in_app", ...parsed.data.channels] });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const ackSchema = z.object({ id: z.uuid(), reply: z.string().trim().max(500, "Keep the reply under 500 characters.").optional() });

export async function acknowledgeNudge(input: z.input<typeof ackSchema>): Promise<ActionResult> {
  return guarded(null, async () => {
    const parsed = ackSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the reply.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("acknowledge_nudge", { p_nudge: parsed.data.id, p_reply: parsed.data.reply || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function proposeRebalance(): Promise<ActionResult<{ moves: Move[]; overloaded: { name: string; openChecks: number; maxOpenChecks: number; overdue: number }[] }>> {
  return guarded("cases.assign", async (viewer) => {
    const out = await rebalanceProposal(viewer.orgId);
    return { ok: true, ...out };
  });
}

const applySchema = z.array(z.object({ checkId: z.uuid(), toUserId: z.uuid(), reason: z.string().trim().max(300) })).min(1, "Choose at least one move.").max(30);

export async function applyRebalance(moves: z.input<typeof applySchema>): Promise<ActionResult<{ moved: number; failed: { checkId: string; error: string }[] }>> {
  return guarded("cases.assign", async () => {
    const parsed = applySchema.safeParse(moves);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Choose the moves again.");
    const supabase = await createClient();
    let moved = 0;
    const failed: { checkId: string; error: string }[] = [];
    for (const m of parsed.data) {
      const { error } = await supabase.rpc("assign_check", { p_check: m.checkId, p_user: m.toUserId, p_reason: `Rebalanced: ${m.reason}`.slice(0, 300) });
      if (error) failed.push({ checkId: m.checkId, error: rpcErrorMessage(error) });
      else moved++;
    }
    if (moved) refresh();
    return { ok: true, moved, failed };
  });
}
