import { ToneChip } from "@/components/cases/badges";
import { Stepper, type Step } from "@/components/layout/stepper";
import { PORTAL_STEPS, PORTAL_STEP_LABELS, portalStep } from "@/domain/candidate/steps";
import type { Tone } from "@/domain/workflow/stages";
import type { PortalCaseRow, PortalCheck } from "@/domain/portal/types";

type ActionRow = Pick<PortalCaseRow, "stage" | "needs_documents" | "process_type">;

/**
 * Does this case wait on documents from the client? Only when the client
 * supplies them: when Ontriq collects from the candidate, open slots are the
 * candidate's to fill.
 */
export const waitsOnClient = (row: ActionRow) => row.process_type === "client_supplied" && row.needs_documents > 0 && (row.stage === "intake" || row.stage === "documents");

/** The client-facing status of a case: Ontriq's client label, coloured by where it stands. */
export function PortalStatusChip({ row, className }: { row: ActionRow & Pick<PortalCaseRow, "on_hold" | "status_label">; className?: string }) {
  if (row.on_hold) return <ToneChip tone="warning" className={className}>On hold</ToneChip>;
  const action = waitsOnClient(row);
  const tone: Tone = row.stage === "released" ? "success" : row.stage === "cancelled" ? "neutral" : action ? "warning" : row.stage === "intake" ? "info" : "progress";
  return (
    <ToneChip tone={tone} className={className}>
      {action ? "Documents needed" : row.status_label}
    </ToneChip>
  );
}

const CHECK_STATE: Record<PortalCheck["state"], { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "progress" },
  needs_information: { label: "Information needed", tone: "warning" },
  done: { label: "Completed", tone: "success" },
  not_required: { label: "Not required", tone: "neutral" },
};

export function PortalCheckState({ state, className }: { state: PortalCheck["state"]; className?: string }) {
  const s = CHECK_STATE[state];
  return (
    <ToneChip tone={s.tone} className={className}>
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
