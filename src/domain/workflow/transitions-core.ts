/**
 * Which moves a case can make and why a move is blocked. The database is the
 * authority (public.case_transition and public.record_qc_review in
 * 0006/0011); this pure mirror decides which buttons to show and explains a
 * disabled one in plain words. tests/unit/workflow.test.ts covers it.
 */
import type { CheckState, Stage } from "./stages";
import { isTerminalCheck } from "./stages";

export const TRANSITIONS = {
  accept_request: { from: ["intake"], to: "documents" },
  submit_pre_qc: { from: ["documents"], to: "pre_qc" },
  pre_qc_approve: { from: ["pre_qc"], to: "data_entry" },
  pre_qc_return: { from: ["pre_qc"], to: "documents" },
  start_verification: { from: ["data_entry"], to: "verification" },
  submit_post_qc: { from: ["verification"], to: "post_qc" },
  post_qc_approve: { from: ["post_qc"], to: "report" },
  post_qc_return: { from: ["post_qc"], to: "verification" },
  return_to_documents: { from: ["data_entry", "verification"], to: "documents" },
} as const satisfies Record<string, { from: readonly Stage[]; to: Stage }>;

export type TransitionEvent = keyof typeof TRANSITIONS;

export function nextStage(stage: Stage, event: TransitionEvent): Stage | null {
  const t = TRANSITIONS[event];
  return (t.from as readonly Stage[]).includes(stage) ? t.to : null;
}

export type CaseFacts = {
  stage: Stage;
  onHold: boolean;
  /** Required documents for the documents stage not yet received or waived. */
  documentsOutstanding: number;
  /** Required documents due by the end of verification not yet received or waived. */
  verificationDocumentsOutstanding: number;
  /** entryReady: everything Data Entry owes is in. Results wait for verification. */
  checks: { state: CheckState; entryReady: boolean }[];
  /** Completed checks whose fixed annexure has no file (public.case_missing_annexures, 0040). */
  annexuresMissing?: string[];
  /** The viewer owns the case. */
  isOwner: boolean;
  /** A candidate link was issued and the candidate has not signed consent yet (0008: needed before Pre-QC). */
  consentMissing?: boolean;
};

export type CaseAction =
  | "accept_request"
  | "submit_pre_qc"
  | "pre_qc_review"
  | "start_verification"
  | "submit_post_qc"
  | "submit_post_qc_pending"
  | "post_qc_review"
  | "return_to_documents"
  | "hold"
  | "resume"
  | "cancel";

export type ActionAvailability = { action: CaseAction; label: string; allowed: boolean; reason?: string; emphasis: "primary" | "secondary" | "danger" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function availableActions(facts: CaseFacts, can: (permission: string) => boolean): ActionAvailability[] {
  const out: ActionAvailability[] = [];
  if (facts.stage === "cancelled" || facts.stage === "released") return out;

  const mover = can("cases.stage.change") || (facts.isOwner && can("cases.update"));

  if (facts.onHold) {
    if (can("cases.hold")) out.push({ action: "resume", label: "Resume case", allowed: true, emphasis: "primary" });
    if (can("cases.cancel")) out.push({ action: "cancel", label: "Cancel case", allowed: true, emphasis: "danger" });
    return out;
  }

  const counted = facts.checks.filter((c) => c.state !== "waived");

  switch (facts.stage) {
    case "intake":
      if (can("cases.update")) out.push({ action: "accept_request", label: "Accept request", allowed: true, emphasis: "primary" });
      break;
    case "documents": {
      if (mover) {
        const missing = facts.documentsOutstanding;
        out.push({
          action: "submit_pre_qc",
          label: "Send to Pre-QC",
          allowed: missing === 0 && !facts.consentMissing,
          reason: missing
            ? `${plural(missing, "required document")} still missing. Upload or waive ${missing === 1 ? "it" : "them"} first.`
            : facts.consentMissing
              ? "The candidate hasn't signed the consent form yet. Accept a paper form on the Candidate tab if they signed one."
              : undefined,
          emphasis: "primary",
        });
      }
      break;
    }
    case "pre_qc":
      if (can("qc.pre")) out.push({ action: "pre_qc_review", label: "Record Pre-QC decision", allowed: true, emphasis: "primary" });
      break;
    case "data_entry": {
      if (can("checks.data_entry") || can("cases.stage.change")) {
        const invalid = counted.filter((c) => !c.entryReady).length;
        out.push({
          action: "start_verification",
          label: "Start verification",
          allowed: invalid === 0,
          reason: invalid ? `${plural(invalid, "check")} still ${invalid === 1 ? "has" : "have"} missing or invalid details.` : undefined,
          emphasis: "primary",
        });
      }
      break;
    }
    case "verification": {
      if (mover) {
        const open = counted.filter((c) => !isTerminalCheck(c.state)).length;
        const docs = facts.verificationDocumentsOutstanding;
        const annexures = facts.annexuresMissing ?? [];
        out.push({
          action: "submit_post_qc",
          label: "Send to Post-QC",
          allowed: open === 0 && docs === 0 && annexures.length === 0,
          reason: open
            ? `${plural(open, "check")} still open.`
            : docs
              ? `${plural(docs, "required document")} still missing.`
              : annexures.length
                ? `${annexures.join(", ")} has no report attached. Upload it first: it goes in the final report.`
                : undefined,
          emphasis: "primary",
        });
      }
      // Spec 9: amber covers checks still pending. A manager decides, with a reason.
      if (can("cases.stage.change") && counted.some((c) => !isTerminalCheck(c.state))) {
        out.push({ action: "submit_post_qc_pending", label: "Send with pending checks", allowed: true, emphasis: "secondary" });
      }
      break;
    }
    case "post_qc":
      if (can("qc.post")) out.push({ action: "post_qc_review", label: "Record Post-QC decision", allowed: true, emphasis: "primary" });
      break;
    case "report":
    case "approval":
      break;
  }

  if ((facts.stage === "data_entry" || facts.stage === "verification") && can("cases.stage.change")) {
    out.push({ action: "return_to_documents", label: "Back to documents", allowed: true, emphasis: "secondary" });
  }
  if (can("cases.hold")) out.push({ action: "hold", label: "Put on hold", allowed: true, emphasis: "secondary" });
  if (can("cases.cancel")) out.push({ action: "cancel", label: "Cancel case", allowed: true, emphasis: "danger" });
  return out;
}
