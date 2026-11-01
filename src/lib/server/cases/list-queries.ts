import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { can } from "@/domain/permissions";
import { ACTIVE_STAGES, TERMINAL_CHECK_STATES, type CheckState, type FinalResult, type Priority, type Stage } from "@/domain/workflow/stages";
import type { Viewer } from "@/lib/server/viewer";
import { peopleById, withClientNames, type CaseListItem } from "./queries";
import { statusLabeller } from "./status-catalog";

/**
 * Reads for the queues ("My work"), the dashboard tiles and saved views.
 * Row level security decides what each person sees; these only add the filters.
 */

const CASE_COLUMNS =
  "id, reference, candidate_name, client_id, stage, status_key, priority, on_hold, proposed_result, checks_total, checks_done, assigned_to, due_at, received_at, process_type, package_snapshot, client:clients(name)";

type CaseRow = {
  id: string;
  reference: string;
  candidate_name: string;
  client_id: string;
  stage: Stage;
  status_key: string;
  priority: string;
  on_hold: boolean;
  proposed_result: string | null;
  checks_total: number;
  checks_done: number;
  assigned_to: string | null;
  due_at: string | null;
  received_at: string;
  process_type: CaseListItem["processType"];
  package_snapshot: unknown;
  client: unknown;
};

async function toItems(rows: CaseRow[]): Promise<CaseListItem[]> {
  const [people, statusLabel] = await Promise.all([peopleById(), statusLabeller()]);
  const items: CaseListItem[] = rows.map((c) => ({
    id: c.id,
    reference: c.reference,
    candidateName: c.candidate_name,
    clientId: c.client_id,
    clientName: (c.client as { name: string } | null)?.name ?? "",
    stage: c.stage,
    statusKey: c.status_key,
    statusLabel: statusLabel(c.status_key),
    priority: c.priority as Priority,
    onHold: c.on_hold,
    proposedResult: c.proposed_result as FinalResult | null,
    checksTotal: c.checks_total,
    checksDone: c.checks_done,
    assignee: c.assigned_to ? (people.get(c.assigned_to) ?? { id: c.assigned_to, name: "Team member", email: "" }) : null,
    dueAt: c.due_at,
    receivedAt: c.received_at,
    processType: c.process_type,
    packageName: ((c.package_snapshot as { name?: string } | null)?.name ?? "") || "Custom",
  }));
  return withClientNames(items);
}

export const QUEUE_TABS = ["mine", "unassigned", "pre_qc", "data_entry", "post_qc", "returned", "overdue"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export const QUEUE_LABELS: Record<QueueTab, { title: string; description: string; empty: string }> = {
  mine: { title: "Mine", description: "Cases you own and checks assigned to you.", empty: "Nothing is assigned to you right now." },
  unassigned: { title: "Manager queue", description: "Active cases nobody owns yet. Assign them or try auto-assignment again.", empty: "Every active case has an owner." },
  pre_qc: { title: "Pre-QC", description: "Cases waiting for a completeness and readability review.", empty: "No cases are waiting for Pre-QC." },
  data_entry: { title: "Data entry", description: "Cases whose check details need completing before verification.", empty: "No cases are waiting for data entry." },
  post_qc: { title: "Post-QC", description: "Verified cases waiting for the final quality review.", empty: "No cases are waiting for Post-QC." },
  returned: { title: "Returned", description: "Cases a QC review sent back for correction.", empty: "Nothing has been returned." },
  overdue: { title: "Overdue", description: "Active cases past their due date.", empty: "Nothing is overdue." },
};

/** Which queue tabs a person can use. */
export function queueTabsFor(viewer: Pick<Viewer, "permissions">): QueueTab[] {
  const tabs: QueueTab[] = ["mine"];
  if (can(viewer, "cases.assign")) tabs.push("unassigned");
  if (can(viewer, "qc.pre")) tabs.push("pre_qc");
  if (can(viewer, "checks.data_entry")) tabs.push("data_entry");
  if (can(viewer, "qc.post")) tabs.push("post_qc");
  if (can(viewer, "cases.read") || can(viewer, "cases.read_assigned")) tabs.push("returned", "overdue");
  return tabs;
}

/** The filter methods used here; the Supabase builder returns itself from each. */
type Filters = {
  eq(column: string, value: unknown): Filters;
  in(column: string, values: readonly unknown[]): Filters;
  is(column: string, value: null): Filters;
  not(column: string, operator: string, value: unknown): Filters;
  lt(column: string, value: string): Filters;
};

function applyTab<T>(builder: T, tab: QueueTab, viewerId: string, nowIso: string): T {
  const q = builder as unknown as Filters;
  const out = (() => {
    switch (tab) {
      case "mine":
        return q.eq("assigned_to", viewerId).in("stage", ACTIVE_STAGES);
      case "unassigned":
        return q.is("assigned_to", null).in("stage", ACTIVE_STAGES);
      case "pre_qc":
      case "data_entry":
      case "post_qc":
        return q.eq("stage", tab);
      case "returned":
        return q.not("returned_at", "is", null).in("stage", ACTIVE_STAGES);
      case "overdue":
        return q.lt("due_at", nowIso).in("stage", ACTIVE_STAGES);
    }
  })();
  return out as unknown as T;
}

export async function queueCounts(viewer: Viewer, tabs: QueueTab[]): Promise<Record<QueueTab, number>> {
  const supabase = await createRequestClient();
  const nowIso = new Date().toISOString();
  const entries = await Promise.all(
    tabs.map(async (tab) => {
      const base = supabase.from("cases").select("id", { count: "exact", head: true });
      const { count } = await applyTab(base, tab, viewer.userId, nowIso);
      let total = count ?? 0;
      if (tab === "mine") total += (await myOpenChecks(viewer.userId)).filter((k) => k.caseAssignee !== viewer.userId).length;
      return [tab, total] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<QueueTab, number>;
}

export async function queueCases(viewer: Viewer, tab: QueueTab, limit = 100): Promise<CaseListItem[]> {
  const supabase = await createRequestClient();
  const nowIso = new Date().toISOString();
  const base = supabase.from("cases").select(CASE_COLUMNS);
  const { data } = await applyTab(base, tab, viewer.userId, nowIso)
    .order(tab === "overdue" ? "due_at" : "received_at", { ascending: tab === "overdue" || tab === "pre_qc" || tab === "post_qc" || tab === "data_entry" })
    .limit(limit);
  return toItems((data ?? []) as unknown as CaseRow[]);
}

export type MyCheck = {
  id: string;
  label: string;
  state: CheckState;
  dueAt: string | null;
  caseId: string;
  caseReference: string;
  candidateName: string;
  caseStage: Stage;
  caseAssignee: string | null;
  receivedAt: string;
};

/** Checks assigned to this person that are still open, on active cases. */
export const myOpenChecks = cache(async (viewerId: string): Promise<MyCheck[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("case_checks")
    .select("id, label, state, due_at, case:cases!inner(id, reference, candidate_name, stage, assigned_to, received_at)")
    .eq("assigned_to", viewerId)
    .not("state", "in", `(${TERMINAL_CHECK_STATES.join(",")})`)
    .in("case.stage", ACTIVE_STAGES)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  return (data ?? []).map((k) => {
    const c = k.case as unknown as { id: string; reference: string; candidate_name: string; stage: Stage; assigned_to: string | null; received_at: string };
    return {
      id: k.id,
      label: k.label,
      state: k.state,
      dueAt: k.due_at,
      caseId: c.id,
      caseReference: c.reference,
      candidateName: c.candidate_name,
      caseStage: c.stage,
      caseAssignee: c.assigned_to,
      receivedAt: c.received_at,
    };
  });
});

export type WorkSummary = { openCases: number; openChecks: number; dueToday: number; overdue: number };

/** Tiles for the dashboard: what this person holds and what is due. */
export async function myWorkSummary(viewerId: string): Promise<WorkSummary> {
  const supabase = await createRequestClient();
  const now = new Date();
  const endOfToday = endOfColomboDay(now).toISOString();
  const [{ data: cases }, checks] = await Promise.all([
    supabase.from("cases").select("id, due_at").eq("assigned_to", viewerId).in("stage", ACTIVE_STAGES),
    myOpenChecks(viewerId),
  ]);
  const dueItems = [...(cases ?? []).map((c) => c.due_at), ...checks.map((k) => k.dueAt)].filter((d): d is string => Boolean(d));
  return {
    openCases: cases?.length ?? 0,
    openChecks: checks.length,
    dueToday: dueItems.filter((d) => d >= now.toISOString() && d <= endOfToday).length,
    overdue: dueItems.filter((d) => d < now.toISOString()).length,
  };
}

function endOfColomboDay(now: Date): Date {
  // Colombo is UTC+05:30 all year (no daylight saving).
  const offset = 330 * 60_000;
  const local = new Date(now.getTime() + offset);
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() - offset);
}

export type Attention = { unassigned: number; returned: number; overdue: number; onHold: number };

export async function needsAttention(): Promise<Attention> {
  const supabase = await createRequestClient();
  const nowIso = new Date().toISOString();
  const head = () => supabase.from("cases").select("id", { count: "exact", head: true });
  const [unassigned, returned, overdue, onHold] = await Promise.all([
    head().is("assigned_to", null).in("stage", ACTIVE_STAGES),
    head().not("returned_at", "is", null).in("stage", ACTIVE_STAGES),
    head().lt("due_at", nowIso).in("stage", ACTIVE_STAGES),
    head().eq("on_hold", true).in("stage", ACTIVE_STAGES),
  ]);
  return { unassigned: unassigned.count ?? 0, returned: returned.count ?? 0, overdue: overdue.count ?? 0, onHold: onHold.count ?? 0 };
}

export type SavedView = { id: string; name: string; query: string; shared: boolean; mine: boolean };

export async function savedViews(viewerId: string): Promise<SavedView[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("saved_views").select("id, name, query, shared, owner_id").eq("entity", "cases").order("sort").order("created_at");
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, query: v.query, shared: v.shared, mine: v.owner_id === viewerId }));
}
