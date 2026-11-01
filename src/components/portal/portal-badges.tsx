import { ToneChip } from "@/components/cases/badges";
import { Stepper, type Step } from "@/components/layout/stepper";
import { PORTAL_STEPS, PORTAL_STEP_LABELS, portalStep } from "@/domain/candidate/steps";
import type { Tone } from "@/domain/workflow/stages";
import type { PortalCaseRow, PortalCheck, PortalReportStatus } from "@/domain/portal/types";

type ActionRow = Pick<PortalCaseRow, "stage" | "needs_documents">;

/**
 * Does this case wait on the client? The database counts documents they supply
 * and questions from Ontriq, at any stage. When Ontriq collects from the
 * candidate, open document slots are the candidate's and aren't counted.
 */
export const waitsOnClient = (row: ActionRow) => row.needs_documents > 0 && row.stage !== "released" && row.stage !== "cancelled";

/**
 * The client-facing status of a case: Ontriq's client label, coloured by where
 * it stands. When the client owes something, that comes first and the status
 * stays beside it (spec 6.1: the current status is always shown).
 */
export function PortalStatusChip({ row, className }: { row: ActionRow & Pick<PortalCaseRow, "on_hold" | "status_label">; className?: string }) {
  if (row.on_hold) return <ToneChip tone="warning" className={className}>{row.status_label}</ToneChip>;
  const action = waitsOnClient(row);
  const tone: Tone = row.stage === "released" ? "success" : row.stage === "cancelled" ? "neutral" : action ? "warning" : row.stage === "intake" ? "info" : "progress";
  return (
    <>
      {action ? (
        <ToneChip tone="warning" className={className}>
          Action needed
        </ToneChip>
      ) : null}
      <ToneChip tone={action ? "neutral" : tone} dot={!action} className={className}>
        {row.status_label}
      </ToneChip>
    </>
  );
}

export const PORTAL_REPORT_LABELS: Record<PortalReportStatus, string> = {
  not_ready: "Not ready yet",
  preparing: "Being prepared",
  awaiting_approval: "Awaiting approval",
  completed: "Completed, waiting for release",
  revising: "Being revised",
  released: "Released",
  cancelled: "Cancelled",
};

const CHECK_STATE: Record<PortalCheck["state"], { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "progress" },
  needs_information: { label: "Information needed", tone: "warning" },
  waiting_for_candidate: { label: "Waiting for the candidate", tone: "progress" },
  done: { label: "Completed", tone: "success" },
  not_required: { label: "Not required", tone: "neutral" },
};

export const PORTAL_CHECK_LABELS = Object.fromEntries(Object.entries(CHECK_STATE).map(([k, v]) => [k, v.label])) as Record<PortalCheck["state"], string>;

export function PortalCheckState({ state, quiet, className }: { state: PortalCheck["state"]; quiet?: boolean; className?: string }) {
  const s = CHECK_STATE[state];
  return (
    <ToneChip tone={quiet ? "neutral" : s.tone} className={className}>
      {s.label}
    </ToneChip>
  );
}

/** Received → Documents → Verification → Report → Released, with the current step marked. */
export function PortalProgressRail({ stage, onHold }: { stage: PortalCaseRow["stage"]; onHold: boolean }) {
  const cancelled = stage === "cancelled";
  const current = cancelled ? -1 : PORTAL_STEPS.indexOf(portalStep(stage));
  const steps: Step[] = PORTAL_STEPS.map((step, i) => ({
    key: step,
    label: PORTAL_STEP_LABELS[step],
    state: i < current || stage === "released" ? "done" : i > current ? "upcoming" : onHold ? "on_hold" : "current",
  }));
  return <Stepper steps={steps} label="Progress" cancelled={cancelled} />;
}
