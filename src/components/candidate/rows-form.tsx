"use client";

import { useState, useTransition } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, fieldLabel, fmt, optionLabel, type CandidateLang } from "@/domain/candidate/i18n";
import type { CandidateRow, CandidateRowField, CandidateRowForm } from "@/domain/candidate/view";
import { answerRows } from "@/app/(candidate)/c/session/actions";
import { AnswerField } from "./answer-field";
import { errorText } from "./errors";

type Range = { from?: string; to?: string; present?: boolean };

const filled = (f: CandidateRowField, v: CandidateRow[string] | undefined) => {
  if (f.type === "date_range") {
    const r = (v ?? {}) as Range;
    return Boolean(r.from && (r.to || r.present));
  }
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";
};

/** Rows the candidate fills in themselves: their referees or employers (spec 2.2). */
export function RowsForm({ lang, requestId, form, initial, answered }: { lang: CandidateLang; requestId: string; form: CandidateRowForm; initial: CandidateRow[]; answered: boolean }) {
  const t = candidateDict(lang);
  const start_rows = initial.length ? initial : Array.from({ length: Math.max(form.min, 1) }, (): CandidateRow => ({}));
  const [rows, setRows] = useState<CandidateRow[]>(start_rows);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, key: string, value: CandidateRow[string]) => setRows((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const complete = rows.filter((r) => form.fields.every((f) => !f.required || filled(f, r[f.key])));
    if (complete.length < Math.max(form.min, 1) || complete.length < rows.length) return setError(fmt(t.requests.rowsNeeded, { n: String(Math.max(form.min, 1)) }));
    setError(null);
    start(async () => {
      const r = await answerRows({ requestId, rows });
      if (!r.ok) return setError(errorText(t, r.error));
      toast.success(t.requests.sent);
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      {rows.map((row, i) => (
        <fieldset key={i} className="space-y-3 rounded-xl border p-3.5">
          {form.max > 1 ? (
            <legend className="px-1 text-xs font-semibold text-muted-foreground">
              {optionLabel(t, form.item_label, form.item_label)} {i + 1}
            </legend>
          ) : null}
          {form.fields.map((f) => {
            const id = `row-${requestId}-${i}-${f.key}`;
            const label = `${fieldLabel(t, f.key, f.label)}${f.required ? " *" : ""}`;
            return (
              <div key={f.key} className="space-y-1">
                <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                  {label}
                </label>
                <AnswerField id={id} lang={lang} type={f.type} options={f.options} value={row[f.key]} onChange={(v) => set(i, f.key, v)} />
                {f.help ? <p className="text-xs leading-relaxed text-muted-foreground">{f.help}</p> : null}
              </div>
            );
          })}
          {rows.length > Math.max(form.min, 1) ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>
              <Trash2 /> {t.requests.removeRow}
            </Button>
          ) : null}
        </fieldset>
      ))}
      {rows.length < form.max ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((list) => [...list, {}])}>
          <Plus /> {t.requests.addRow}
        </Button>
      ) : null}
      {error ? <p className="text-xs leading-relaxed text-destructive">{error}</p> : null}
      <Button type="submit" className="h-11 w-full text-[14px] sm:w-auto" disabled={pending}>
        {pending ? <Spinner /> : <Send />} {answered ? t.requests.update : t.requests.send}
      </Button>
    </form>
  );
}
