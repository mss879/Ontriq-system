/**
 * Case stages, check states and their labels (requirements §1.3–1.5, the BGV
 * flowchart). Stages are the machine's states; the database mirrors these in
 * the case_stage and check_state enums (0006_cases.sql). Pure module.
 */

export const STAGES = ["intake", "documents", "pre_qc", "data_entry", "verification", "post_qc", "report", "approval", "released", "cancelled"] as const;
export type Stage = (typeof STAGES)[number];

/** The working order shown as a progress rail. */
export const STAGE_FLOW: Stage[] = ["intake", "documents", "pre_qc", "data_entry", "verification", "post_qc", "report", "approval", "released"];

export const STAGE_LABELS: Record<Stage, string> = {
  intake: "Case received",
  documents: "Document collection",
  pre_qc: "Pre-QC",
  data_entry: "Data entry",
  verification: "Verification",
  post_qc: "Post-QC",
  report: "Final report",
  approval: "Final approval",
  released: "Report released",
  cancelled: "Cancelled",
};

/** Short labels for chips and board columns. */
export const STAGE_SHORT: Record<Stage, string> = {
  intake: "Received",
  documents: "Documents",
  pre_qc: "Pre-QC",
  data_entry: "Data entry",
  verification: "Verification",
  post_qc: "Post-QC",
  report: "Report",
  approval: "Approval",
  released: "Released",
  cancelled: "Cancelled",
};

/** Status keys and their default labels (requirements §1.4). Configurable in client_status_catalog. */
export const STATUS_LABELS: Record<string, string> = {
  case_received: "Case Received",
  documents_pending: "Documents Pending",
  document_review: "Document Review in Progress",
  pending_information: "Pending Information",
  pre_qc_in_progress: "Pre-QC in Progress",
  data_entry_in_progress: "Data Entry in Progress",
  verification_in_progress: "Verification in Progress",
  partially_completed: "Partially Completed",
  pending_post_qc: "Pending Post-QC",
  returned_for_correction: "Returned for Correction",
  final_report_in_progress: "Final Report in Progress",
  pending_final_approval: "Pending Final Approval",
  report_completed: "Report Completed",
  report_released: "Report Released",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

export const ACTIVE_STAGES: Stage[] = ["intake", "documents", "pre_qc", "data_entry", "verification", "post_qc", "report", "approval"];

export const CHECK_STATES = ["not_started", "in_progress", "awaiting_response", "pending_info", "returned", "completed", "discrepancy", "unable_to_verify", "waived"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const TERMINAL_CHECK_STATES: CheckState[] = ["completed", "discrepancy", "unable_to_verify", "waived"];

export const CHECK_STATE_LABELS: Record<CheckState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_response: "Awaiting response",
  pending_info: "Pending information",
  returned: "Returned by QC",
  completed: "Completed",
  discrepancy: "Discrepancy",
  unable_to_verify: "Unable to verify",
  waived: "Waived",
};

export type Tone = "neutral" | "info" | "progress" | "warning" | "success" | "danger";

export const CHECK_STATE_TONES: Record<CheckState, Tone> = {
  not_started: "neutral",
  in_progress: "progress",
  awaiting_response: "info",
  pending_info: "warning",
  returned: "warning",
  completed: "success",
  discrepancy: "danger",
  unable_to_verify: "warning",
  waived: "neutral",
};

export const STAGE_TONES: Record<Stage, Tone> = {
  intake: "neutral",
  documents: "info",
  pre_qc: "progress",
  data_entry: "progress",
  verification: "progress",
  post_qc: "progress",
  report: "info",
  approval: "warning",
  released: "success",
  cancelled: "neutral",
};

export const FINAL_RESULTS = ["green", "amber", "red"] as const;
export type FinalResult = (typeof FINAL_RESULTS)[number];
export const FINAL_RESULT_LABELS: Record<FinalResult, string> = { green: "Clear", amber: "Review", red: "Discrepancy" };

export const PROCESS_TYPES = ["client_supplied", "candidate_collected"] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];
export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  client_supplied: "Client supplies documents",
  candidate_collected: "Ontriq collects from the candidate",
};
export const PROCESS_TYPE_SHORT: Record<ProcessType, string> = { client_supplied: "Type 1 · client", candidate_collected: "Type 2 · candidate" };

export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { normal: "Normal", high: "High", urgent: "Urgent" };

export const isTerminalCheck = (state: CheckState) => TERMINAL_CHECK_STATES.includes(state);
