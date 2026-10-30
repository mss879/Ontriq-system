/**
 * AI suggestions on a case, organised for the review screens (plan §8). Pure
 * and isomorphic. Rules: a person decides every suggestion; field values and
 * remarks are applied by the app with the person's permissions only after
 * they click; a newer suggestion for the same thing replaces an older one.
 */
import type { Stage } from "../workflow/stages";

export type SuggestionDecision = "pending" | "accepted" | "edited" | "rejected" | "superseded";

export type Suggestion = {
  id: string;
  capability: string;
  entityType: string;
  entityId: string;
  fieldKey: string | null;
  value: unknown;
  confidence: number | null;
  rationale: string | null;
  sourceRefs: string[];
  decision: SuggestionDecision;
  createdAt: string;
};

/** At or above this, "Accept all high-confidence" applies a field value. */
export const HIGH_CONFIDENCE = 0.85;

export function confidenceLabel(c: number | null | undefined): string | null {
  if (c === null || c === undefined || Number.isNaN(c)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  return `${c >= HIGH_CONFIDENCE ? "High" : c >= 0.6 ? "Medium" : "Low"} · ${pct}%`;
}

const newestFirst = (a: Suggestion, b: Suggestion) => b.createdAt.localeCompare(a.createdAt);

/** The newest suggestion matching `pred` that has not been replaced. */
export function newest(list: Suggestion[], pred: (s: Suggestion) => boolean, opts: { pendingOnly?: boolean } = {}): Suggestion | undefined {
  return list
    .filter((s) => s.decision !== "superseded" && (!opts.pendingOnly || s.decision === "pending") && pred(s))
    .sort(newestFirst)[0];
}

export type CheckAi = {
  /** Pending field values, newest per field. */
  extract: Suggestion[];
  remarks?: Suggestion;
  outreach?: Suggestion;
  response?: Suggestion;
};

export type CaseAi = {
  consistency?: Suggestion;
  preqc?: Suggestion;
  postqc?: Suggestion;
  summary?: Suggestion;
  checks: Record<string, CheckAi>;
  documents: Record<string, { quality?: Suggestion; tamper?: Suggestion }>;
  /** Anything a person still has to decide. */
  pendingCount: number;
};

export function organizeSuggestions(list: Suggestion[], caseId: string): CaseAi {
  const onCase = (cap: string, field?: string | null) => (s: Suggestion) =>
    s.entityType === "case" && s.entityId === caseId && s.capability === cap && (field === undefined || s.fieldKey === field);
  const out: CaseAi = {
    consistency: newest(list, onCase("case.consistency")),
    preqc: newest(list, onCase("case.preqc")),
    postqc: newest(list, onCase("case.postqc")),
    summary: newest(list, onCase("report.narrative", "executive_summary"), { pendingOnly: true }),
    checks: {},
    documents: {},
    pendingCount: list.filter((s) => s.decision === "pending").length,
  };

  const checkIds = new Set(list.filter((s) => s.entityType === "case_check").map((s) => s.entityId));
  for (const id of checkIds) {
    const here = list.filter((s) => s.entityType === "case_check" && s.entityId === id);
    const fields = new Set(here.filter((s) => s.capability === "document.extract" && s.fieldKey).map((s) => s.fieldKey as string));
    const extract = [...fields]
      .map((f) => newest(here, (s) => s.capability === "document.extract" && s.fieldKey === f, { pendingOnly: true }))
      .filter((s): s is Suggestion => Boolean(s));
    out.checks[id] = {
      extract,
      remarks: newest(here, (s) => s.capability === "report.narrative" && s.fieldKey === "remarks", { pendingOnly: true }),
      outreach: newest(here, (s) => s.capability === "check.outreach" && s.decision !== "rejected"),
      response: newest(here, (s) => s.capability === "check.response" && s.decision !== "rejected"),
    };
  }

  const docIds = new Set(list.filter((s) => s.entityType === "document").map((s) => s.entityId));
  for (const id of docIds) {
    const here = list.filter((s) => s.entityType === "document" && s.entityId === id);
    out.documents[id] = {
      quality: newest(here, (s) => s.capability === "document.classify", { pendingOnly: true }),
      tamper: newest(here, (s) => s.capability === "document.tamper", { pendingOnly: true }),
    };
  }
  return out;
}

/** Field values with the accepted suggestions applied (top-level fields only). */
export function applyFieldSuggestions(values: Record<string, unknown>, accepted: { fieldKey: string | null; value: unknown }[]): Record<string, unknown> {
  const next = { ...values };
  for (const s of accepted) if (s.fieldKey) next[s.fieldKey] = s.value;
  return next;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Which outcome a proposed result maps to in the "Record outcome" flow, or null when the reply doesn't settle it. */
export function outcomeForResult(option: { key: string; tone: "green" | "amber" | "red" } | undefined): "completed" | "discrepancy" | "unable_to_verify" | null {
  if (!option || option.key === "pending") return null;
  if (option.tone === "green") return "completed";
  if (option.tone === "red") return "discrepancy";
  return "unable_to_verify";
}

// ---------------------------------------------------------------- who may run and decide what

export type RerunCapability = "consistency" | "preqc" | "postqc" | "narrative";

export const RERUN: Record<RerunCapability, { label: string; job: string; capability: string; permission: string; stages: Stage[] }> = {
  consistency: { label: "Consistency check", job: "ai.consistency", capability: "case.consistency", permission: "qc.pre", stages: ["documents", "pre_qc", "data_entry", "verification"] },
  preqc: { label: "Pre-QC review", job: "ai.preqc_copilot", capability: "case.preqc", permission: "qc.pre", stages: ["documents", "pre_qc", "data_entry"] },
  postqc: { label: "Post-QC cross-check", job: "ai.postqc", capability: "case.postqc", permission: "qc.post", stages: ["verification", "post_qc", "report"] },
  narrative: { label: "Report remarks", job: "ai.narrative", capability: "report.narrative", permission: "qc.post", stages: ["post_qc", "report"] },
};

export function canRerun(cap: RerunCapability, stage: Stage, onHold: boolean, can: (permission: string) => boolean): boolean {
  const r = RERUN[cap];
  return !onHold && r.stages.includes(stage) && can(r.permission);
}

/** Permissions that may decide a suggestion of each capability (any one). */
export const DECIDE_PERMISSIONS: Record<string, string[]> = {
  "document.extract": ["checks.data_entry", "checks.verify"],
  "document.classify": ["cases.update", "qc.pre"],
  "document.tamper": ["qc.pre", "qc.post", "cases.update"],
  "case.consistency": ["qc.pre", "qc.post"],
  "case.preqc": ["qc.pre"],
  "case.postqc": ["qc.post"],
  // Report remarks: the officers and QC, not everyone who may read a report (Viewer holds reports.preview).
  "report.narrative": ["checks.verify", "qc.post", "cases.stage.change"],
  "check.outreach": ["checks.verify"],
  "check.response": ["checks.verify"],
};

export function canDecide(capability: string, can: (permission: string) => boolean): boolean {
  return (DECIDE_PERMISSIONS[capability] ?? []).some(can);
}
