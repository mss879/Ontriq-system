/**
 * Case roll-ups from check states (requirements §1.5). Mirrors
 * public.recompute_case() in 0006_cases.sql. A potential finding is never
 * adverse by itself: red needs a check a person marked as a discrepancy.
 * Incomplete checks never count as verified. Pure module.
 */
import { isTerminalCheck, type CheckState, type FinalResult, type Stage } from "./stages";

export type CheckSummary = { state: CheckState; resultTone?: "green" | "amber" | "red" | null };

/** The result Ontriq would propose now. The approver still sets the final result. */
export function proposedResult(checks: CheckSummary[]): FinalResult {
  const counted = checks.filter((c) => c.state !== "waived");
  if (counted.length === 0) return "amber";
  if (counted.some((c) => c.state === "discrepancy" || c.resultTone === "red")) return "red";
  const allClear = counted.every((c) => c.state === "completed" && c.resultTone === "green");
  return allClear ? "green" : "amber";
}

/** The working status inside a stage: verification can be partially complete. */
export function statusFor(stage: Stage, checks: CheckSummary[], opts: { returned?: boolean; pendingInfo?: boolean } = {}): string {
  switch (stage) {
    case "intake":
      return "case_received";
    case "documents":
      return opts.returned ? "returned_for_correction" : opts.pendingInfo ? "pending_information" : "documents_pending";
    case "pre_qc":
      return "pre_qc_in_progress";
    case "data_entry":
      return "data_entry_in_progress";
    case "verification": {
      if (opts.returned) return "returned_for_correction";
      const counted = checks.filter((c) => c.state !== "waived");
      const done = counted.filter((c) => isTerminalCheck(c.state)).length;
      return done > 0 && done < counted.length ? "partially_completed" : "verification_in_progress";
    }
    case "post_qc":
      return "pending_post_qc";
    case "report":
      return "final_report_in_progress";
    case "approval":
      return "pending_final_approval";
    case "released":
      return "report_released";
    case "cancelled":
      return "cancelled";
  }
}

export function progress(checks: CheckSummary[]): { done: number; total: number; percent: number } {
  const counted = checks.filter((c) => c.state !== "waived");
  const done = counted.filter((c) => isTerminalCheck(c.state)).length;
  const total = counted.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
