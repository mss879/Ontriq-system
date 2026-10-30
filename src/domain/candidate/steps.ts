/**
 * The five steps a candidate sees on their page, and the client's progress
 * rail. Candidates and clients never see the internal stages (Pre-QC, data
 * entry, Post-QC…); they see where their verification is in plain words.
 * Pure module.
 */
import type { Stage } from "../workflow/stages";

export const CANDIDATE_STEPS = ["received", "documents", "review", "verification", "report"] as const;
export type CandidateStep = (typeof CANDIDATE_STEPS)[number];

export function candidateStep(stage: Stage): CandidateStep {
  switch (stage) {
    case "intake":
      return "received";
    case "documents":
      return "documents";
    case "pre_qc":
    case "data_entry":
      return "review";
    case "verification":
    case "post_qc":
      return "verification";
    default:
      return "report";
  }
}

/** Index of the current step, for "step 2 of 5" and the progress line. */
export const candidateStepIndex = (stage: Stage) => CANDIDATE_STEPS.indexOf(candidateStep(stage));

export const PORTAL_STEPS = ["received", "documents", "in_progress", "report", "released"] as const;
export type PortalStep = (typeof PORTAL_STEPS)[number];

export const PORTAL_STEP_LABELS: Record<PortalStep, string> = {
  received: "Received",
  documents: "Documents",
  in_progress: "Verification",
  report: "Report",
  released: "Released",
};

export function portalStep(stage: Stage): PortalStep {
  switch (stage) {
    case "intake":
      return "received";
    case "documents":
      return "documents";
    case "pre_qc":
    case "data_entry":
    case "verification":
    case "post_qc":
      return "in_progress";
    case "report":
    case "approval":
      return "report";
    default:
      return "released";
  }
}

/** What the candidate still owes: drives the progress bar and "what's left". */
export type CandidateOutstanding = { documents: number; requests: number; consent: boolean };

export function candidateOutstanding(view: {
  requirements: { status: string; min_count: number; received_count: number }[];
  requests: { status: string }[];
  consent: { status: string } | null;
}): CandidateOutstanding {
  return {
    documents: view.requirements.filter((r) => r.status === "pending" && r.min_count > r.received_count).length,
    requests: view.requests.filter((r) => r.status === "open").length,
    consent: !view.consent || view.consent.status === "pending" || view.consent.status === "rejected",
  };
}

/** Share of the candidate's items that are done, 0–100. */
export function candidateProgress(view: Parameters<typeof candidateOutstanding>[0]): number {
  const docs = view.requirements.filter((r) => r.status !== "optional" && r.min_count > 0);
  const total = docs.length + view.requests.filter((r) => r.status !== "cancelled").length + 1;
  const left = candidateOutstanding(view);
  const done = total - left.documents - left.requests - (left.consent ? 1 : 0);
  return Math.round((Math.max(0, done) / total) * 100);
}
