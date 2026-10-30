"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { DISTRICTS } from "@/domain/districts";

/** Auto-assignment settings (assignment.configure). Writes go through row level security. */

async function guarded<T extends object>(run: (viewer: Awaited<ReturnType<typeof requireViewer>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const viewer = await requireViewer({ kind: "staff", permission: "assignment.configure" });
    return await run(viewer);
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const weight = z.coerce.number().min(0, "0 or more.").max(1, "1 or less.");
const rulesSchema = z.object({
  strategy: z.enum(["least_loaded", "round_robin", "manual"]),
  weights: z.object({ load: weight, overdue: weight, recent: weight, newcomer: weight }),
  considerSkills: z.boolean(),
  considerRegions: z.boolean(),
  assignChecks: z.boolean(),
});

export async function saveRules(input: z.input<typeof rulesSchema>): Promise<ActionResult> {
  return guarded(async (viewer) => {
    const parsed = rulesSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("assignment_rules")
      .update({ strategy: v.strategy, weights: v.weights, consider_skills: v.considerSkills, consider_regions: v.considerRegions, assign_checks: v.assignChecks })
      .eq("org_id", viewer.orgId)
      .select("org_id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("Assignment rules are missing for this organisation.");
    refresh();
    return { ok: true };
  });
}

const staffSchema = z.object({
  autoAssign: z.boolean(),
  maxOpenCases: z.coerce.number().int().min(0).max(1000),
  maxOpenChecks: z.coerce.number().int().min(0).max(5000),
  regions: z.array(z.enum(DISTRICTS)).max(25),
  skills: z.array(z.uuid()).max(200),
});

export async function saveStaffSettings(userId: string, input: z.input<typeof staffSchema>): Promise<ActionResult> {
  return guarded(async (viewer) => {
    if (!z.uuid().safeParse(userId).success) return fail("Unknown person.");
    const parsed = staffSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const cap = await supabase
      .from("staff_capacity")
      .upsert(
        { user_id: userId, org_id: viewer.orgId, auto_assign: v.autoAssign, max_open_cases: v.maxOpenCases, max_open_checks: v.maxOpenChecks, regions: v.regions },
        { onConflict: "user_id" },
      );
    if (cap.error) return fail(rpcErrorMessage(cap.error));

    const { data: existing, error: readError } = await supabase.from("staff_skills").select("check_type_id").eq("user_id", userId);
    if (readError) return fail(rpcErrorMessage(readError));
    const have = new Set((existing ?? []).map((r) => r.check_type_id));
    const want = new Set(v.skills);
    const remove = [...have].filter((id) => !want.has(id));
    const add = [...want].filter((id) => !have.has(id));
    if (remove.length) {
      const { error } = await supabase.from("staff_skills").delete().eq("user_id", userId).in("check_type_id", remove);
      if (error) return fail(rpcErrorMessage(error));
    }
    if (add.length) {
      const { error } = await supabase.from("staff_skills").insert(add.map((check_type_id) => ({ user_id: userId, check_type_id, org_id: viewer.orgId })));
      if (error) return fail(rpcErrorMessage(error));
    }
    refresh();
    return { ok: true };
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const leaveSchema = z
  .object({
    startsOn: z.string().regex(DATE, "Choose a start date."),
    endsOn: z.string().regex(DATE, "Choose an end date."),
    kind: z.enum(["leave", "training", "other"]),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, { path: ["endsOn"], message: "The end date is before the start date." });

export async function addLeave(userId: string, input: z.input<typeof leaveSchema>): Promise<ActionResult> {
  return guarded(async (viewer) => {
    const parsed = leaveSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the dates.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase
      .from("staff_availability")
      .insert({ user_id: userId, org_id: viewer.orgId, starts_on: v.startsOn, ends_on: v.endsOn, kind: v.kind, note: v.note || null, created_by: viewer.userId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function removeLeave(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("staff_availability").delete().eq("id", id);
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
