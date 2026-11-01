"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/forms/date-field";
import { DISTRICT_CHOICES } from "@/domain/districts";
import { candidateDict, optionLabel, type CandidateLang } from "@/domain/candidate/i18n";

type Range = { from?: string; to?: string; present?: boolean };
export type AnswerDraft = string | string[] | Range;
type Option = { value: string; label: string };

/** What a check's validation allows, so the box stops where the check would refuse. */
export const answerLimit = (type: string) => (type === "textarea" || type === "address" ? 4000 : 200);

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const boxClass = "h-11 text-[15px]";

/** One answer, in the control its field type calls for, whether it stands alone or sits in a row. */
export function AnswerField({
  id,
  lang,
  type,
  options,
  value,
  onChange,
  question = false,
}: {
  id: string;
  lang: CandidateLang;
  type: string;
  options: Option[];
  value: AnswerDraft | undefined;
  onChange: (value: AnswerDraft) => void;
  /** A free question from Ontriq rather than a field: room to write. */
  question?: boolean;
}) {
  const t = candidateDict(lang);
  const text = typeof value === "string" ? value : "";
  const named = (o: Option) => optionLabel(t, o.value, o.label);
  switch (type) {
    case "date_range": {
      const r = (typeof value === "object" && !Array.isArray(value) ? value : {}) as Range;
      return (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <DateField id={id} value={r.from ?? ""} onChange={(e) => onChange({ ...r, from: e.target.value })} className={boxClass} aria-label={t.requests.from} />
            <DateField value={r.present ? "" : (r.to ?? "")} disabled={r.present === true} onChange={(e) => onChange({ ...r, to: e.target.value })} className={boxClass} aria-label={t.requests.to} />
          </div>
          <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={r.present === true} onChange={(e) => onChange({ ...r, present: e.target.checked, to: e.target.checked ? undefined : r.to })} />
            {t.requests.stillHere}
          </label>
        </div>
      );
    }
    case "date":
      return <DateField id={id} value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />;
    case "boolean":
    case "select":
    case "district": {
      const list: Option[] = type === "district" ? DISTRICT_CHOICES.map((d) => ({ value: d, label: d })) : type === "boolean" && !options.length ? [{ value: "yes", label: t.requests.yes }, { value: "no", label: t.requests.no }] : options;
      return (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          <option value="">{t.requests.choose}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {named(o)}
            </option>
          ))}
        </select>
      );
    }
    case "multi_select": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", picked.includes(o.value) && "border-primary bg-primary/5")}>
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={picked.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((v) => v !== o.value))}
              />
              {named(o)}
            </label>
          ))}
        </div>
      );
    }
    case "number":
      return <Input id={id} type="number" inputMode="numeric" value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />;
    case "email":
      return <Input id={id} type="email" inputMode="email" maxLength={200} value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />;
    case "phone":
      return <Input id={id} type="tel" inputMode="tel" maxLength={40} value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />;
    case "nic":
      return <Input id={id} maxLength={14} placeholder="853400937V" value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />;
    case "textarea":
    case "address":
      return <Textarea id={id} maxLength={4000} value={text} onChange={(e) => onChange(e.target.value)} rows={3} className="text-[15px]" />;
    default:
      return question ? (
        <Textarea id={id} maxLength={4000} value={text} onChange={(e) => onChange(e.target.value)} rows={3} className="text-[15px]" />
      ) : (
        <Input id={id} maxLength={answerLimit(type)} value={text} onChange={(e) => onChange(e.target.value)} className={boxClass} />
      );
  }
}
