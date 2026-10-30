"use client";

import { Eye, FileText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DISTRICTS } from "@/domain/districts";
import { parseNic } from "@/domain/nic-core";
import { formatPlainDate } from "@/lib/format";
import type { FieldDef } from "@/domain/check-types/schema";
import { DateField } from "@/components/forms/date-field";

export type FormValues = Record<string, unknown>;

type BaseField = Omit<FieldDef, "fields" | "group">;

const NONE = "__none__";

/**
 * Renders a check type's fields (src/domain/check-types/schema.ts) as a
 * controlled form. Errors are keyed by path, e.g. "employers.0.company", as
 * returned by validateCheckValues() and the saveCheckValues action.
 */
export function DynamicForm({
  fields,
  values,
  onChange,
  errors = {},
  readOnly = false,
  idPrefix = "f",
}: {
  fields: FieldDef[];
  values: FormValues;
  onChange: (values: FormValues) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
  idPrefix?: string;
}) {
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  return (
    <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
      {fields.map((f) =>
        f.type === "repeatable_group" ? (
          <GroupField
            key={f.key}
            field={f}
            items={Array.isArray(values[f.key]) ? (values[f.key] as FormValues[]) : []}
            onChange={(items) => set(f.key, items)}
            errors={errors}
            readOnly={readOnly}
            idPrefix={idPrefix}
          />
        ) : (
          <ScalarField
            key={f.key}
            field={f}
            path={f.key}
            value={values[f.key]}
            onChange={(v) => set(f.key, v)}
            error={errors[f.key]}
            readOnly={readOnly}
            idPrefix={idPrefix}
          />
        ),
      )}
    </div>
  );
}

function GroupField({
  field,
  items,
  onChange,
  errors,
  readOnly,
  idPrefix,
}: {
  field: FieldDef;
  items: FormValues[];
  onChange: (items: FormValues[]) => void;
  errors: Record<string, string>;
  readOnly: boolean;
  idPrefix: string;
}) {
  const min = field.group?.min ?? 0;
  const max = field.group?.max ?? 10;
  const itemLabel = field.group?.item_label ?? "Item";
  // Show at least the minimum number of item slots so people see what's expected.
  const shown: FormValues[] = items.length >= Math.max(min, 1) ? items : [...items, ...Array.from({ length: Math.max(min, 1) - items.length }, (): FormValues => ({}))];
  const update = (i: number, next: FormValues) => onChange(shown.map((it, j) => (j === i ? next : it)));
  const remove = (i: number) => onChange(shown.filter((_, j) => j !== i));
  const groupError = errors[field.key];

  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{field.label}</span>
        {field.required || min > 0 ? <span className="text-xs text-muted-foreground">{min === max ? `exactly ${min}` : min > 0 ? `at least ${min}` : ""}</span> : null}
        <VisibilityMarks field={field} />
      </legend>
      {field.help ? <p className="-mt-1 text-xs text-muted-foreground">{field.help}</p> : null}
      {shown.map((item, i) => (
        <div key={i} className="rounded-xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {itemLabel} {i + 1}
            </p>
            {!readOnly ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} disabled={shown.length <= min} aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {(field.fields ?? []).map((sub) => (
              <ScalarField
                key={sub.key}
                field={sub}
                path={`${field.key}.${i}.${sub.key}`}
                value={item?.[sub.key]}
                onChange={(v) => update(i, { ...(item ?? {}), [sub.key]: v })}
                error={errors[`${field.key}.${i}.${sub.key}`]}
                readOnly={readOnly}
                idPrefix={idPrefix}
              />
            ))}
          </div>
        </div>
      ))}
      {groupError ? (
        <p role="alert" className="text-sm text-destructive">
          {groupError}
        </p>
      ) : null}
      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...shown, {}])} disabled={shown.length >= max}>
          <Plus /> Add {itemLabel.toLowerCase()}
        </Button>
      ) : null}
    </fieldset>
  );
}

function VisibilityMarks({ field }: { field: BaseField }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground/70">
      {field.visibility?.client ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={0} aria-label="The client sees this">
              <Eye className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>The client sees this</TooltipContent>
        </Tooltip>
      ) : null}
      {field.visibility?.report ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={0} aria-label="Printed in the report">
              <FileText className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Printed in the report</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

function ScalarField({
  field,
  path,
  value,
  onChange,
  error,
  readOnly,
  idPrefix,
}: {
  field: BaseField;
  path: string;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  readOnly: boolean;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${path.replace(/\./g, "-")}`;
  const invalid = Boolean(error);
  const full = field.width === "full" || field.type === "textarea" || field.type === "address" || field.type === "multi_select";
  const str = value === undefined || value === null ? "" : String(value);

  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
    case "address":
      control = (
        <Textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} disabled={readOnly} aria-invalid={invalid || undefined} placeholder={field.placeholder} rows={field.type === "address" ? 2 : 3} />
      );
      break;
    case "number":
      control = (
        <Input id={id} type="number" inputMode="numeric" value={str} onChange={(e) => onChange(e.target.value)} disabled={readOnly} aria-invalid={invalid || undefined} placeholder={field.placeholder} min={field.validation?.min} max={field.validation?.max} />
      );
      break;
    case "date":
      control = <DateField id={id} value={str} onChange={(e) => onChange(e.target.value)} disabled={readOnly} aria-invalid={invalid || undefined} />;
      break;
    case "date_range": {
      const r = (value ?? {}) as { from?: string; to?: string };
      control = (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">From</span>
            <DateField id={id} value={r.from ?? ""} onChange={(e) => onChange({ ...r, from: e.target.value })} disabled={readOnly} aria-invalid={invalid || undefined} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">To</span>
            <DateField value={r.to ?? ""} onChange={(e) => onChange({ ...r, to: e.target.value })} disabled={readOnly} aria-invalid={invalid || undefined} aria-label={`${field.label}: to`} />
          </label>
        </div>
      );
      break;
    }
    case "select":
    case "district": {
      const options = field.type === "district" ? DISTRICTS.map((d) => ({ value: d, label: d })) : (field.options ?? []);
      control = (
        <Select value={str || NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)} disabled={readOnly}>
          <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
            <SelectValue placeholder={field.placeholder ?? "Choose…"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-muted-foreground">
              {field.type === "district" ? "No district" : "Not set"}
            </SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div id={id} role="group" aria-label={field.label} className={cn("grid gap-2 rounded-lg border p-3 sm:grid-cols-2", invalid && "border-destructive")}>
          {(field.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={(c) => onChange(c ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
                disabled={readOnly}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "boolean":
      control = (
        <div className="flex h-9 items-center gap-3">
          <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c)} disabled={readOnly} aria-invalid={invalid || undefined} />
          <span className="text-sm text-muted-foreground">{value === true ? "Yes" : value === false ? "No" : "Not answered"}</span>
        </div>
      );
      break;
    case "nic": {
      const parsed = str.trim() ? parseNic(str) : null;
      control = (
        <>
          <Input
            id={id}
            value={str}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            disabled={readOnly}
            aria-invalid={invalid || undefined}
            placeholder="853400937V or 198534000937"
            autoComplete="off"
            className="font-mono tracking-wide"
          />
          {parsed && !error ? (
            <p className={cn("text-xs", parsed.valid ? "text-muted-foreground" : "text-warning-foreground dark:text-warning")}>
              {parsed.valid ? `Born ${formatPlainDate(parsed.birthDate)} · ${parsed.gender} · ${parsed.format === "old" ? "old card" : "new card"}` : parsed.error}
            </p>
          ) : null}
        </>
      );
      break;
    }
    default:
      control = (
        <Input
          id={id}
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "phone" ? "tel" : undefined}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          aria-invalid={invalid || undefined}
          placeholder={field.placeholder ?? (field.type === "phone" ? "077 123 4567" : undefined)}
          autoComplete="off"
        />
      );
  }

  return (
    <div className={cn("min-w-0 space-y-1.5", full && "sm:col-span-2")} data-invalid={invalid || undefined}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm leading-snug font-medium">
          {field.label}
          {field.required ? (
            <span className="text-destructive" aria-hidden>
              {" "}
              *
            </span>
          ) : null}
        </label>
        <VisibilityMarks field={field} />
      </div>
      {control}
      {field.help && !error ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
