"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Lock, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { saveCheckValues, setCheckState } from "../../../actions";
import { decideSuggestion, settleFieldSuggestions } from "../../ai-actions";
import { FieldSuggestions, type FieldSuggestion } from "@/components/ai/field-suggestions";
import { autofillSuggestions, fieldPathLabel } from "@/domain/ai/extraction";
import { applyFieldSuggestions, sameValue } from "@/domain/ai/suggestions";
import { DynamicForm, type FormValues } from "@/components/cases/dynamic-form";
import { modeAt, validateCheckValues } from "@/domain/check-types/validate";
import type { FieldDef } from "@/domain/check-types/schema";
import type { Stage } from "@/domain/workflow/stages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function CheckForm({
  checkId,
  fields,
  stage,
  initialValues,
  editable,
  lockedReason,
  canReopen,
  suggestions = [],
  canDecideAi = false,
}: {
  checkId: string;
  fields: FieldDef[];
  stage: Stage;
  initialValues: FormValues;
  editable: boolean;
  lockedReason?: string;
  canReopen: boolean;
  /** Pending values the AI read from the documents. */
  suggestions?: FieldSuggestion[];
  canDecideAi?: boolean;
}) {
  // What the AI read goes straight into empty fields. Nothing is kept until the person checks it and saves.
  const [autofilled] = useState(() => (editable && canDecideAi ? autofillSuggestions(suggestions, initialValues) : []));
  const [values, setValues] = useState<FormValues>(() => applyFieldSuggestions(initialValues, autofilled) as FormValues);
  // Suggestions put into the form, with the value each replaced (for Undo).
  const [applied, setApplied] = useState<Map<string, { fieldKey: string; previous: unknown }>>(() => new Map(autofilled.map((s) => [s.id, { fieldKey: s.fieldKey, previous: initialValues[s.fieldKey] }])));
  const [aiBusy, startAi] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  // Before verification only Data Entry's details count. Results are recorded once verification starts.
  const mode = modeAt(stage);
  const verifying = mode === "submit";
  const entryFields = useMemo(() => fields.filter((f) => f.stage !== "verification"), [fields]);
  const findingFields = useMemo(() => fields.filter((f) => f.stage === "verification"), [fields]);
  const dueCheck = useMemo(() => validateCheckValues(fields, values, mode), [fields, values, mode]);
  const draftCheck = useMemo(() => validateCheckValues(fields, values, "draft"), [fields, values]);
  const errors = showErrors ? { ...dueCheck.errors, ...draftCheck.errors, ...serverErrors } : { ...draftCheck.errors, ...serverErrors };
  const missing = Object.keys(dueCheck.errors);
  const unsaved = dirty || applied.size > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    start(async () => {
      setShowErrors(true);
      const r = await saveCheckValues(checkId, values);
      if (!r.ok) {
        setServerErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
        toast.error(r.error);
        return;
      }
      setServerErrors({});
      setDirty(false);
      toast.success(dueCheck.ok ? (verifying ? "Saved. Ready to record the outcome." : "Saved. Ready for verification.") : "Saved as a draft");
      if (applied.size) {
        // Record how each accepted suggestion ended up: as suggested, or edited before saving.
        const items = [...applied.entries()].map(([id, a]) => {
          const s = suggestions.find((x) => x.id === id);
          const kept = s && sameValue(values[a.fieldKey], s.value);
          return kept ? { id, decision: "accepted" as const } : { id, decision: "edited" as const, value: values[a.fieldKey] ?? null };
        });
        setApplied(new Map());
        await settleFieldSuggestions(checkId, items);
      }
    });

  const acceptSuggestions = (list: FieldSuggestion[]) => {
    setApplied((prev) => {
      const next = new Map(prev);
      for (const s of list) next.set(s.id, { fieldKey: s.fieldKey, previous: values[s.fieldKey] });
      return next;
    });
    setValues((v) => applyFieldSuggestions(v, list) as FormValues);
    setDirty(true);
    if (Object.keys(serverErrors).length) setServerErrors({});
  };
  const undoSuggestion = (s: FieldSuggestion) => {
    const a = applied.get(s.id);
    if (!a) return;
    setValues((v) => ({ ...v, [a.fieldKey]: a.previous }) as FormValues);
    setApplied((prev) => {
      const next = new Map(prev);
      next.delete(s.id);
      return next;
    });
  };
  const rejectSuggestion = (s: FieldSuggestion) =>
    startAi(async () => {
      const r = await decideSuggestion(s.id, "rejected");
      if (!r.ok) toast.error(r.error);
    });

  const reopen = () =>
    start(async () => {
      const r = await setCheckState(checkId, { state: "in_progress", note: "Reopened to edit details" });
      if (r.ok) toast.success("Check reopened");
      else toast.error(r.error);
    });

  const formProps = {
    values,
    onChange: (next: FormValues) => {
      setValues(next);
      setDirty(true);
      // Live validation takes over once the person edits again.
      if (Object.keys(serverErrors).length) setServerErrors({});
    },
    errors,
    readOnly: !editable,
    idPrefix: `check-${checkId.slice(0, 8)}`,
  };

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "flex flex-wrap items-start gap-3 rounded-xl px-4 py-3 text-sm",
          !editable ? "bg-muted/60" : missing.length === 0 ? "bg-success/10" : "bg-warning/10",
        )}
        role="status"
      >
        {!editable ? (
          <Lock className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        ) : missing.length === 0 ? (
          <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 size-4 text-warning-foreground dark:text-warning" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {!editable ? (
            <p>{lockedReason ?? "These details are locked."}</p>
          ) : missing.length === 0 ? (
            <p className="font-medium">
              {verifying ? `Ready to record the outcome${unsaved ? " once saved" : ""}` : entryFields.length ? `Ready for verification${unsaved ? " once saved" : ""}` : "Nothing to enter yet. This check is filled in during verification."}
            </p>
          ) : (
            <>
              <p className="font-medium">
                Still needed{missing.length > 1 ? ` (${missing.length})` : ""}
              </p>
              <p className="text-muted-foreground">{missing.slice(0, 6).map((p) => fieldPathLabel(fields, p)).join(", ")}{missing.length > 6 ? "…" : ""}</p>
            </>
          )}
        </div>
        {!editable && canReopen ? (
          <Button variant="outline" size="sm" onClick={reopen} disabled={pending}>
            {pending ? <Spinner /> : <RotateCcw />} Reopen
          </Button>
        ) : null}
      </div>

      <FieldSuggestions
        fields={fields}
        suggestions={suggestions}
        values={values}
        applied={new Set(applied.keys())}
        editable={editable}
        canDecide={canDecideAi}
        busy={pending || aiBusy}
        onAccept={acceptSuggestions}
        onUndo={undoSuggestion}
        onReject={rejectSuggestion}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (editable) save();
        }}
        onKeyDown={(e) => {
          if (editable && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save();
          }
        }}
      >
        {entryFields.length ? <DynamicForm {...formProps} fields={entryFields} /> : null}
        {findingFields.length ? (
          verifying ? (
            <div className={cn(entryFields.length > 0 && "mt-6 border-t pt-5")}>
              <h3 className="text-sm font-semibold">Verification findings</h3>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">What the source confirmed, and who confirmed it.</p>
              <DynamicForm {...formProps} fields={findingFields} />
            </div>
          ) : (
            <details open={entryFields.length === 0} className={cn("group rounded-xl border bg-muted/20", entryFields.length > 0 && "mt-6")}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="font-medium">Recorded during verification</span>
                  <span className="block text-xs text-muted-foreground">Not needed yet. Leave these empty until the source has confirmed them.</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t px-4 py-4">
                <DynamicForm {...formProps} fields={findingFields} />
              </div>
            </details>
          )
        ) : null}
        {editable ? (
          <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center justify-between gap-3 border-t bg-card/95 px-5 py-3 backdrop-blur md:-mx-6 md:px-6">
            <p className="text-xs text-muted-foreground">{unsaved ? "Unsaved changes" : "All changes saved"} · ⌘S saves</p>
            <Button type="submit" disabled={pending || (!unsaved && Object.keys(serverErrors).length === 0)}>
              {pending ? <Spinner /> : <Save />} Save
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
