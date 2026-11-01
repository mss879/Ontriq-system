/**
 * Which moves a case can make and why a move is blocked. The database is the
 * authority (public.case_transition and public.record_qc_review, last
 * defined in 0048); this pure mirror decides which buttons to show and explains a
 * disabled one in plain words. tests/unit/workflow.test.ts covers it.
 */
import type { CheckState, Stage } from "./stages";
import { isTerminalCheck } from "./stages";

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
  /** Consent the case can't go on without is missing or was sent back (public.case_consent_missing). Nobody is contacted until it's in. */
  consentRefused?: boolean;
  /** Type 2 only: what is still owed from the flowchart's "Contact the Candidate" (public.candidate_contact_gap). */
  contactGap?: string | null;
  /** The NIC matched someone with a different name, and nobody has looked yet. */
  candidateMatchOpen?: boolean;
  /** A released report is being revised, so stopping leaves it standing. */
  revising?: boolean;
  /** A revision went back behind the report stage. It finishes with a new version: the checks may have changed. */
  reworking?: boolean;
  /** Part of the candidate's BGV form is still unanswered. */
  formOpen?: boolean;
  /** The viewer is the officer on one of the case's checks. */
  ownsCheck?: boolean;
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
    if (can("cases.cancel") && !facts.reworking) out.push({ action: "cancel", label: facts.revising ? "Stop the revision" : "Cancel case", allowed: true, emphasis: "danger" });
    return out;
  }

  const counted = facts.checks.filter((c) => c.state !== "waived");

  switch (facts.stage) {
    case "intake":
      if (can("cases.update")) {
        out.push({
          action: "accept_request",
          label: "Accept request",
          allowed: !facts.candidateMatchOpen,
          reason: facts.candidateMatchOpen ? "The NIC matches a candidate with a different name. Check that first." : undefined,
          emphasis: "primary",
        });
      }
      break;
    case "documents": {
      if (mover) {
        const missing = facts.documentsOutstanding;
        out.push({
          action: "submit_pre_qc",
          label: "Send to Pre-QC",
          allowed: missing === 0 && !facts.consentMissing && !facts.contactGap && !facts.formOpen,
          reason: missing
            ? `${plural(missing, "required document")} still missing. Upload or waive ${missing === 1 ? "it" : "them"} first.`
            : facts.consentMissing
              ? "The candidate hasn't signed the consent form yet. Accept a paper form in the Candidate section if they signed one."
              : facts.contactGap
                ? `${facts.contactGap.charAt(0).toUpperCase()}${facts.contactGap.slice(1)}.`
                : facts.formOpen
                  ? "The candidate hasn't finished their BGV form. Wait for it, or withdraw what isn't needed."
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
          allowed: invalid === 0 && !facts.consentRefused,
          reason: invalid
            ? `${plural(invalid, "check")} still ${invalid === 1 ? "has" : "have"} missing or invalid details.`
            : facts.consentRefused
              ? "The candidate's consent is missing or was sent back. Get it signed before contacting anyone."
              : undefined,
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
          allowed: open === 0 && docs === 0 && annexures.length === 0 && !facts.consentRefused,
          reason: open
            ? `${plural(open, "check")} still open.`
            : docs
              ? `${plural(docs, "required document")} still missing.`
              : annexures.length
                ? `${annexures.join(", ")} has no report attached. Upload it first: it goes in the final report.`
                : facts.consentRefused
                  ? "The candidate's consent is missing or was sent back. Get it signed before this goes further."
                  : undefined,
          emphasis: "primary",
        });
      }
      // Spec 9: amber covers checks still pending. A manager decides, with a reason.
      if (can("cases.stage.change") && counted.some((c) => !isTerminalCheck(c.state)) && !facts.consentRefused) {
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

  // Spec 3: whoever finds the gap sends the case back, not only a manager.
  const findsGap = mover || (facts.stage === "data_entry" && can("checks.data_entry")) || (facts.stage === "verification" && can("checks.verify") && facts.ownsCheck);
  if ((facts.stage === "data_entry" || facts.stage === "verification") && findsGap) {
    out.push({ action: "return_to_documents", label: "Back to documents", allowed: true, emphasis: "secondary" });
  }
  if (can("cases.hold")) out.push({ action: "hold", label: "Put on hold", allowed: true, emphasis: "secondary" });
  if (can("cases.cancel") && !facts.reworking) out.push({ action: "cancel", label: facts.revising ? "Stop the revision" : "Cancel case", allowed: true, emphasis: "danger" });
  return out;
}
