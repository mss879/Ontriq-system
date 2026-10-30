"use client";

import { useState, useTransition } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, fmt, type CandidateLang } from "@/domain/candidate/i18n";
import type { CandidateRow, CandidateRowField, CandidateRowForm } from "@/domain/candidate/view";
import { answerRows } from "@/app/(candidate)/c/session/actions";
import { DateField } from "@/components/forms/date-field";
import { errorText } from "./errors";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type Range = { from?: string; to?: string; present?: boolean };

const filled = (f: CandidateRowField, v: CandidateRow[string] | undefined) => {
  if (f.type === "date_range") {
    const r = (v ?? {}) as Range;
    return Boolean(r.from && (r.to || r.present));
  }
  return typeof v === "string" && v.trim() !== "";
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
          <legend className="px-1 text-xs font-semibold text-muted-foreground">
            {form.item_label} {i + 1}
          </legend>
          {form.fields.map((f) => {
            const id = `row-${requestId}-${i}-${f.key}`;
            const label = `${f.label}${f.required ? " *" : ""}`;
            return (
              <div key={f.key} className="space-y-1">
                <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                  {label}
                </label>
                <RowField id={id} lang={lang} field={f} value={row[f.key]} onChange={(v) => set(i, f.key, v)} />
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

function RowField({ id, lang, field, value, onChange }: { id: string; lang: CandidateLang; field: CandidateRowField; value: CandidateRow[string] | undefined; onChange: (v: CandidateRow[string]) => void }) {
  const t = candidateDict(lang);
  const text = typeof value === "string" ? value : "";
  switch (field.type) {
    case "date_range": {
      const r = (value ?? {}) as Range;
      return (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <DateField id={id} value={r.from ?? ""} onChange={(e) => onChange({ ...r, from: e.target.value })} className="h-11 text-[15px]" aria-label={t.requests.from} />
            <DateField value={r.present ? "" : (r.to ?? "")} disabled={r.present === true} onChange={(e) => onChange({ ...r, to: e.target.value })} className="h-11 text-[15px]" aria-label={t.requests.to} />
          </div>
          <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.present === true} onChange={(e) => onChange({ ...r, present: e.target.checked, to: e.target.checked ? undefined : r.to })} />
            {t.requests.stillHere}
          </label>
        </div>
      );
    }
    case "date":
      return <DateField id={id} value={text} onChange={(e) => onChange(e.target.value)} className="h-11 text-[15px]" />;
    case "select":
      return (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          <option value="">{t.requests.choose}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "email":
      return <Input id={id} type="email" inputMode="email" value={text} onChange={(e) => onChange(e.target.value)} className="h-11 text-[15px]" />;
    case "phone":
      return <Input id={id} type="tel" inputMode="tel" value={text} onChange={(e) => onChange(e.target.value)} className="h-11 text-[15px]" />;
    default:
      return <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} className="h-11 text-[15px]" />;
  }
}
