/**
 * What Ontriq can change about the workflow without a developer (spec 6.2, 10).
 * Stored in orgs.settings.workflow. Stages stay fixed: they carry the rules
 * that keep a report honest. Pure module (tests/unit/workflow.test.ts).
 */

export type QcChecklists = { pre: string[]; post: string[] };
export type WorkflowSettings = { qcChecklists: QcChecklists; enforceCheckOrder: boolean };

export const DEFAULT_QC_CHECKLISTS: QcChecklists = {
  pre: ["Every required document is in", "Documents are readable and complete", "Names, NIC and dates match across documents", "Copy or original requirements are met"],
  post: ["Each finding matches its evidence", "Discrepancies are explained with reasons", "Supporting evidence is uploaded for each check", "Nothing is still pending"],
};

/** The flowchart's steps 2 to 8, also public.flowchart_check_order in 0049. */
export const FLOWCHART_ORDER = ["education", "employment", "nic", "sanction", "reference", "address", "police"] as const;

const items = (raw: unknown, fallback: string[]) => {
  const list = Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
  return list.length ? list : fallback;
};

export function parseWorkflowSettings(settings: unknown): WorkflowSettings {
  const w = ((settings ?? {}) as { workflow?: Record<string, unknown> }).workflow ?? {};
  const qc = (w.qc_checklists ?? {}) as { pre?: unknown; post?: unknown };
  return {
    qcChecklists: { pre: items(qc.pre, DEFAULT_QC_CHECKLISTS.pre), post: items(qc.post, DEFAULT_QC_CHECKLISTS.post) },
    enforceCheckOrder: w.enforce_check_order === true,
  };
}
