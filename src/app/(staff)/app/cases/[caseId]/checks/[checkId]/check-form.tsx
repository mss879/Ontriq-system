"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Lock, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { saveCheckValues, setCheckState } from "../../../actions";
import { decideSuggestion, settleFieldSuggestions } from "../../ai-actions";
import { FieldSuggestions, type FieldSuggestion } from "@/components/ai/field-suggestions";
import { applyFieldSuggestions, sameValue } from "@/domain/ai/suggestions";
import { DynamicForm, type FormValues } from "@/components/cases/dynamic-form";
import { validateCheckValues } from "@/domain/check-types/validate";
import type { FieldDef } from "@/domain/check-types/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** "employers.1.company" → "Company (Employer 2)". */
function labelFor(fields: FieldDef[], path: string): string {
  const [key, index, sub] = path.split(".");
  const f = fields.find((x) => x.key === key);
  if (!f) return path;
  if (index === undefined) return f.label;
  const child = f.fields?.find((x) => x.key === sub);
  return `${child?.label ?? sub} (${f.group?.item_label ?? "Item"} ${Number(index) + 1})`;
}

export function CheckForm({
  checkId,
  fields,
  initialValues,
  editable,
  lockedReason,
  canReopen,
  suggestions = [],
  canDecideAi = false,
}: {
  checkId: string;
  fields: FieldDef[];
  initialValues: FormValues;
  editable: boolean;
  lockedReason?: string;
  canReopen: boolean;
  /** Pending values the AI read from the documents. */
  suggestions?: FieldSuggestion[];
  canDecideAi?: boolean;
}) {
  const [values, setValues] = useState<FormValues>(initialValues);
  // Suggestions put into the form, with the value each replaced (for Undo).
  const [applied, setApplied] = useState<Map<string, { fieldKey: string; previous: unknown }>>(new Map());
  const [aiBusy, startAi] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submitCheck = useMemo(() => validateCheckValues(fields, values, "submit"), [fields, values]);
  const draftCheck = useMemo(() => validateCheckValues(fields, values, "draft"), [fields, values]);
  const errors = showErrors ? { ...submitCheck.errors, ...draftCheck.errors, ...serverErrors } : { ...draftCheck.errors, ...serverErrors };
  const missing = Object.keys(submitCheck.errors);

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
      toast.success(r.valid ? "Saved. Ready for verification." : "Saved as a draft");
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
            <p className="font-medium">Ready for verification{dirty ? " once saved" : ""}</p>
          ) : (
            <>
              <p className="font-medium">
                Still needed{missing.length > 1 ? ` (${missing.length})` : ""}
              </p>
              <p className="text-muted-foreground">{missing.slice(0, 6).map((p) => labelFor(fields, p)).join(", ")}{missing.length > 6 ? "…" : ""}</p>
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
        <DynamicForm
          fields={fields}
          values={values}
          onChange={(next) => {
            setValues(next);
            setDirty(true);
            // Live validation takes over once the person edits again.
            if (Object.keys(serverErrors).length) setServerErrors({});
          }}
          errors={errors}
          readOnly={!editable}
          idPrefix={`check-${checkId.slice(0, 8)}`}
        />
        {editable ? (
          <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center justify-between gap-3 border-t bg-card/95 px-5 py-3 backdrop-blur md:-mx-6 md:px-6">
            <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"} · ⌘S saves</p>
            <Button type="submit" disabled={pending || (!dirty && Object.keys(serverErrors).length === 0)}>
              {pending ? <Spinner /> : <Save />} Save
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
