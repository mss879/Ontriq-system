"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "defaultValue"> & {
  value?: string;
  defaultValue?: string;
  wrapperClassName?: string;
};

/** "2024-03-12" to "12/03/2024". */
const display = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** Digits become DD/MM/YYYY as they are typed. */
export const maskDate = (raw: string) => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
};

/** "12/03/2024", or "12/03/24" once the person has finished, to "2024-03-12". Null if it isn't a real date. */
export function parseDate(text: string, finished: boolean): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(text);
  if (!m || (m[3].length === 2 && !finished)) return null;
  const thisYear = new Date().getFullYear();
  const yy = Number(m[3]);
  const year = m[3].length === 4 ? yy : 2000 + yy <= thisYear + 10 ? 2000 + yy : 1900 + yy;
  const iso = `${year}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * A date typed as DD/MM/YYYY (spec 4.2), whatever the browser's language, with
 * the phone or desktop calendar one tap away. The value going in and out stays
 * YYYY-MM-DD. `onChange` receives an object shaped like an input's change event.
 */
export function DateField({ className, wrapperClassName, value, defaultValue, onChange, name, min, max, disabled, required, ...props }: Props) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const iso = value ?? own;
  const invalid = draft !== null && draft.length > 0 && !parseDate(draft, true);

  const emit = (next: string) => {
    setOwn(next);
    onChange?.({ target: { value: next, name: name ?? "" } } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <span className={cn("relative block", wrapperClassName)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open the calendar"
        disabled={disabled}
        onClick={() => picker.current?.showPicker?.()}
        className="absolute top-1/2 left-1.5 z-[1] flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none"
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        className={cn("pl-8 tabular-nums", className)}
        value={draft ?? display(iso)}
        onChange={(e) => {
          const text = maskDate(e.target.value);
          setDraft(text);
          if (!text) emit("");
          else {
            const parsed = parseDate(text, false);
            if (parsed) emit(parsed);
          }
        }}
        onBlur={(e) => {
          const parsed = draft ? parseDate(draft, true) : null;
          if (parsed) emit(parsed);
          if (parsed || !draft) setDraft(null);
          props.onBlur?.(e);
        }}
      />
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={typeof min === "string" ? min : undefined}
        max={typeof max === "string" ? max : undefined}
        value={iso}
        onChange={(e) => {
          setDraft(null);
          emit(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
      />
      {name ? <input type="hidden" name={name} value={iso} /> : null}
    </span>
  );
}
