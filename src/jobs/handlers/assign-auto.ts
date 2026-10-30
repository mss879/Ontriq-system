import { decide, eligibility, DEFAULT_WEIGHTS, type Need, type StaffLoad, type Strategy, type Weights } from "../../domain/assignment/assignment-core";
import { NonRetryableError, type JobHandler } from "../types";
import type { Json } from "../../lib/supabase/database.types";

type SnapshotRow = {
  user_id: string;
  name: string;
  permissions: string[];
  auto_assign: boolean;
  on_leave: boolean;
  skills: string[];
  regions: string[];
  max_open_cases: number;
  max_open_checks: number;
  open_cases: number;
  open_checks: number;
  weighted_load: number;
  overdue: number;
  completed_7d: number;
  last_assigned_at: string | null;
  is_new: boolean;
};

/**
 * assign.auto: pick a case owner and an officer for each check
 * (src/domain/assignment/assignment-core.ts), then store the decision with
 * apply_auto_assignment(), which never overrides a manual choice. A check
 * goes to the case owner when they are qualified, so one person sees the
 * case through; otherwise to the best other qualified person.
 */
export const assignAuto: JobHandler = async (job, { admin }) => {
  const caseId = (job.payload as { case_id?: string } | null)?.case_id;
  if (!caseId) throw new NonRetryableError("assign.auto job without case_id");

  const { data: c } = await admin.from("cases").select("id, org_id, stage, assigned_to, candidate:candidates(district)").eq("id", caseId).maybeSingle();
  if (!c) throw new NonRetryableError(`case ${caseId} not found`);
  if (c.stage === "released" || c.stage === "cancelled") return { skipped: "closed" };

  const { data: rules } = await admin.from("assignment_rules").select("*").eq("org_id", c.org_id).maybeSingle();
  const strategy = (rules?.strategy ?? "least_loaded") as Strategy;
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...((rules?.weights ?? {}) as Partial<Weights>) };
  const considerSkills = rules?.consider_skills ?? true;
  const considerRegions = rules?.consider_regions ?? true;

  const { data: snap, error } = await admin.rpc("staff_load_snapshot", { p_org: c.org_id });
  if (error) throw new Error(`staff_load_snapshot: ${error.message}`);
  const staff: StaffLoad[] = ((snap ?? []) as SnapshotRow[]).map((s) => ({
    userId: s.user_id,
    name: s.name,
    permissions: s.permissions ?? [],
    autoAssign: s.auto_assign,
    onLeave: s.on_leave,
    skills: considerSkills ? (s.skills ?? []) : [],
    regions: considerRegions ? (s.regions ?? []) : [],
    maxOpenCases: s.max_open_cases,
    maxOpenChecks: s.max_open_checks,
    openCases: s.open_cases,
    openChecks: s.open_checks,
    weightedLoad: Number(s.weighted_load),
    overdue: s.overdue,
    completedLast7Days: s.completed_7d,
    lastAssignedAt: s.last_assigned_at,
    isNew: s.is_new,
  }));

  let owner: { user_id: string; explanation: string; breakdown: Record<string, number> } | null = null;
  let reason: string | undefined;
  let ownerLoad: StaffLoad | undefined;
  if (c.assigned_to) {
    ownerLoad = staff.find((s) => s.userId === c.assigned_to);
  } else {
    const d = decide(staff, { kind: "case" }, { strategy, weights });
    if (d.chosen) {
      owner = { user_id: d.chosen.userId, explanation: d.chosen.explanation, breakdown: d.chosen.breakdown };
      ownerLoad = staff.find((s) => s.userId === d.chosen!.userId);
      if (ownerLoad) ownerLoad.openCases += 1;
    } else {
      reason = d.reason;
    }
  }

  const checks: { check_id: string; user_id: string; explanation: string; breakdown: Record<string, number> }[] = [];
  if (rules?.assign_checks ?? true) {
    const { data: rows } = await admin
      .from("case_checks")
      .select("id, label, check_type_id, assigned_to, state, values, version:check_type_versions(schema)")
      .eq("case_id", caseId)
      .is("assigned_to", null)
      .order("sort");
    const district = (c.candidate as { district: string | null } | null)?.district ?? null;
    for (const k of rows ?? []) {
      if (["completed", "discrepancy", "unable_to_verify", "waived"].includes(k.state)) continue;
      const schema = (k.version as { schema?: { location_bound?: boolean } } | null)?.schema;
      const checkDistrict = ((k.values ?? {}) as { district?: string }).district ?? district;
      const need: Need = { kind: "check", checkTypeId: k.check_type_id, checkTypeName: k.label, locationBound: Boolean(schema?.location_bound), district: checkDistrict };
      let pick: { userId: string; explanation: string; breakdown: Record<string, number> } | null = null;
      if (ownerLoad && eligibility(ownerLoad, need).ok) {
        const first = ownerLoad.name.split(" ")[0] || ownerLoad.name;
        pick = { userId: ownerLoad.userId, explanation: `${first} owns the case and is qualified for ${k.label}.`, breakdown: {} };
      } else {
        const d = decide(staff, need, { strategy, weights });
        if (d.chosen) pick = { userId: d.chosen.userId, explanation: d.chosen.explanation, breakdown: d.chosen.breakdown };
      }
      if (!pick) continue;
      checks.push({ check_id: k.id, user_id: pick.userId, explanation: pick.explanation, breakdown: pick.breakdown });
      const load = staff.find((s) => s.userId === pick!.userId);
      if (load) {
        load.openChecks += 1;
        load.weightedLoad += 0.3;
        load.lastAssignedAt = new Date().toISOString();
      }
    }
  }

  const plan = { strategy, owner, reason, checks };
  const { data, error: applyError } = await admin.rpc("apply_auto_assignment", { p_case: caseId, p_plan: plan as unknown as Json });
  if (applyError) throw new Error(`apply_auto_assignment: ${applyError.message}`);
  return data as Json;
};
