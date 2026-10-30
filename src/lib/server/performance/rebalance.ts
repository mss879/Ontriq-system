import "server-only";
import { createRequestClient } from "@/lib/supabase/server";
import { getAssignmentRules, staffLoad } from "@/lib/server/admin/settings";
import { overloaded, proposeRebalance, type Move, type OpenCheck } from "@/domain/performance/rebalance-core";
import type { StaffLoad } from "@/domain/assignment/assignment-core";

const MOVABLE = ["not_started", "pending_info", "returned"] as const;
export const REBALANCE_OVERDUE_THRESHOLD = 3;

/** Proposed moves for the Rebalance dialog (cases.assign). Reads as the person asking. */
export async function rebalanceProposal(orgId: string): Promise<{ moves: Move[]; overloaded: { name: string; openChecks: number; maxOpenChecks: number; overdue: number }[] }> {
  const [rows, rules] = await Promise.all([staffLoad(), getAssignmentRules(orgId)]);
  const staff: StaffLoad[] = rows.map((s) => ({
    userId: s.userId,
    name: s.name,
    permissions: s.permissions,
    autoAssign: s.autoAssign,
    onLeave: s.onLeave,
    skills: rules.considerSkills ? s.skills : [],
    regions: rules.considerRegions ? s.regions : [],
    maxOpenCases: s.maxOpenCases,
    maxOpenChecks: s.maxOpenChecks,
    openCases: s.openCases,
    openChecks: s.openChecks,
    weightedLoad: s.weightedLoad,
    overdue: s.overdue,
    completedLast7Days: s.completed7d,
    lastAssignedAt: s.lastAssignedAt,
    isNew: s.isNew,
  }));
  const givers = staff.filter((s) => overloaded(s, REBALANCE_OVERDUE_THRESHOLD));
  if (!givers.length) return { moves: [], overloaded: [] };

  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("case_checks")
    .select("id, case_id, label, check_type_id, state, due_at, assigned_to, values, version:check_type_versions(schema), case:cases(reference, stage, candidate:candidates(district))")
    .in("assigned_to", givers.map((g) => g.userId))
    .in("state", [...MOVABLE])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);
  const checks: OpenCheck[] = [];
  for (const k of data ?? []) {
    const c = k.case as unknown as { reference: string; stage: string; candidate: { district: string | null } | null } | null;
    if (!c || c.stage === "released" || c.stage === "cancelled" || !k.assigned_to) continue;
    const schema = (k.version as unknown as { schema?: { location_bound?: boolean } } | null)?.schema;
    checks.push({
      checkId: k.id,
      caseId: k.case_id,
      reference: c.reference,
      label: k.label,
      checkTypeId: k.check_type_id,
      locationBound: Boolean(schema?.location_bound),
      district: ((k.values ?? {}) as { district?: string }).district ?? c.candidate?.district ?? null,
      state: k.state,
      dueAt: k.due_at,
      assignedTo: k.assigned_to,
    });
  }
  return {
    moves: proposeRebalance(staff, checks, { overdueThreshold: REBALANCE_OVERDUE_THRESHOLD, strategy: rules.strategy, weights: rules.weights }),
    overloaded: givers.map((g) => ({ name: g.name, openChecks: g.openChecks, maxOpenChecks: g.maxOpenChecks, overdue: g.overdue })),
  };
}
