"use client";

import { Check, CheckCheck, Sparkles, Undo2, X } from "lucide-react";
import type { FieldDef } from "@/domain/check-types/schema";
import { formatFieldValue } from "@/domain/reports/compile-core";
import { confidenceLabel, HIGH_CONFIDENCE, sameValue } from "@/domain/ai/suggestions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type FieldSuggestion = { id: string; fieldKey: string; value: unknown; confidence: number | null; rationale: string | null };

/**
 * Values the AI read from the documents, beside what the form holds now.
 * Accepting puts the value in the form (the person still saves); rejecting
 * records the decision at once. Values that already match aren't shown.
 */
export function FieldSuggestions({
  fields,
  suggestions,
  values,
  applied,
  editable,
  canDecide,
  busy,
  onAccept,
  onUndo,
  onReject,
}: {
  fields: FieldDef[];
  suggestions: FieldSuggestion[];
  values: Record<string, unknown>;
  /** Suggestion ids put into the form, not yet saved. */
  applied: Set<string>;
  editable: boolean;
  canDecide: boolean;
  busy: boolean;
  onAccept: (s: FieldSuggestion[]) => void;
  onUndo: (s: FieldSuggestion) => void;
  onReject: (s: FieldSuggestion) => void;
}) {
  const field = (k: string) => fields.find((f) => f.key === k);
  const shown = suggestions.filter((s) => field(s.fieldKey) && (applied.has(s.id) || !sameValue(values[s.fieldKey], s.value)));
  if (!shown.length) return null;
  const open = shown.filter((s) => !applied.has(s.id));
  const high = open.filter((s) => (s.confidence ?? 0) >= HIGH_CONFIDENCE);
  const actionable = editable && canDecide;

  return (
    <section aria-label="Values found by AI" className="rounded-xl border border-brand-blue/20 bg-brand-blue/[0.03] p-4 dark:border-brand-sky/20 dark:bg-brand-sky/[0.04]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-brand-blue dark:text-brand-sky" aria-hidden />
        <h3 className="text-sm font-semibold">Found in the documents</h3>
        <span className="text-xs text-muted-foreground">AI suggested · check each against the file</span>
        {actionable && high.length > 1 ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => onAccept(high)} disabled={busy}>
            <CheckCheck /> Accept {high.length} high-confidence
          </Button>
        ) : null}
      </div>
      <ul className="divide-y">
        {shown.map((s) => {
          const f = field(s.fieldKey)!;
          const isApplied = applied.has(s.id);
          const conf = confidenceLabel(s.confidence);
          const current = values[s.fieldKey];
          return (
            <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className={cn("text-sm font-medium", isApplied && "text-success")}>{formatFieldValue(f, s.value)}</p>
                <p className="text-xs text-muted-foreground">
                  {conf ? <span className={cn((s.confidence ?? 0) < 0.6 && "text-warning-foreground dark:text-warning")}>{conf}</span> : null}
                  {conf && s.rationale ? " · " : null}
                  {s.rationale}
                  {!isApplied && current !== undefined && current !== null && current !== "" ? ` · now ${formatFieldValue(f, current)}` : null}
                </p>
              </div>
              {actionable ? (
                isApplied ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-success">In the form · save to keep</span>
                    <Button size="xs" variant="ghost" onClick={() => onUndo(s)} disabled={busy}>
                      <Undo2 /> Undo
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => onAccept([s])} disabled={busy} aria-label={`Accept ${f.label}`}>
                      <Check /> Accept
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => onReject(s)} disabled={busy} aria-label={`Reject ${f.label}`}>
                      <X /> Reject
                    </Button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {!actionable ? <p className="mt-2 text-xs text-muted-foreground">{editable ? "Accepting suggestions needs data entry or verification access." : "The details are locked, so suggestions can't be applied."}</p> : null}
    </section>
  );
}
