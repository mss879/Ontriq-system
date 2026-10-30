import { Stepper, type Step } from "@/components/layout/stepper";
import { formatShortDate } from "@/lib/format";
import { STAGE_FLOW, STAGE_SHORT, type Stage } from "@/domain/workflow/stages";

/** The nine-step flow from the BGV flowchart: where the case is, and when it reached each step. */
export function StageRail({ stage, returned, onHold, enteredAt }: { stage: Stage; returned: boolean; onHold: boolean; enteredAt?: Partial<Record<Stage, string>> }) {
  const current = STAGE_FLOW.indexOf(stage);
  const steps: Step[] = STAGE_FLOW.map((s, i) => {
    const reached = i <= current && enteredAt?.[s];
    return {
      key: s,
      label: STAGE_SHORT[s],
      note: reached ? formatShortDate(reached) : undefined,
      state: i < current || stage === "released" ? "done" : i > current ? "upcoming" : onHold ? "on_hold" : returned ? "returned" : "current",
    };
  });
  return <Stepper steps={steps} label="Case progress" cancelled={stage === "cancelled"} />;
}
