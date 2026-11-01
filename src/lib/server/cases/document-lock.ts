/** The client and the candidate can send files until verification ends (public.require_uploads_open), so requests stop there too. */
export const uploadsOpen = (stage: string) => !["post_qc", "report", "approval"].includes(stage);

/** Why a check's remarks can't change right now, in words for the AI drafts. Mirrors public.set_check_remarks (0049). */
export function remarksLocked(c: { onHold: boolean; stage: string }, mayChangeAfterVerification: boolean): string | null {
  if (c.onHold) return "The case is on hold. Resume it to use these remarks.";
  if (["approval", "released", "cancelled"].includes(c.stage)) return "Remarks are locked once the report is with the approver.";
  if ((c.stage === "post_qc" || c.stage === "report") && !mayChangeAfterVerification) return "Findings are locked after verification. A QC reviewer or manager can reword them.";
  return null;
}

/** Why a case's documents can't change right now, in words for the documents panel. Mirrors public.require_case_open and require_evidence_unlocked (0049). */
export function documentsLocked(c: { onHold: boolean; stage: string }, mayChangeAfterVerification: boolean): string | null {
  if (c.onHold) return "This case is on hold. Resume it to work on its documents. The client and candidate can still send in what was asked for.";
  if (c.stage === "approval") return "The report is with the approver. Send it back to change the evidence.";
  if ((c.stage === "post_qc" || c.stage === "report") && !mayChangeAfterVerification) return "Evidence is locked after verification. A QC reviewer or manager can change it.";
  return null;
}
