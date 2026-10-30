"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { Check, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/forms/text-field";
import { DocumentPreview } from "@/components/documents/document-preview";
import { invoiceModel, quoteModel, TEMPLATE_KEYS, TEMPLATE_LABELS, type Issuer, type TemplateKey } from "@/domain/documents/model";
import { saveBankDetails, saveNumberingSeries, setDefaultTemplate } from "./actions";

type Bank = { bank: string; branch?: string; account_name: string; account_no: string; swift?: string } | null;

export function BankDetailsForm({ bank, canEdit }: { bank: Bank; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveBankDetails, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) toast.success("Bank details saved");
    else if (state && !state.fieldErrors) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} noValidate>
      <fieldset disabled={!canEdit || pending} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="bank" label="Bank" defaultValue={bank?.bank ?? ""} placeholder="e.g. Commercial Bank of Ceylon" errors={fe?.bank} />
          <TextField name="branch" label="Branch" defaultValue={bank?.branch ?? ""} errors={fe?.branch} />
          <TextField name="account_name" label="Account name" defaultValue={bank?.account_name ?? ""} errors={fe?.account_name} />
          <TextField name="account_no" label="Account number" defaultValue={bank?.account_no ?? ""} errors={fe?.account_no} inputMode="numeric" />
          <TextField name="swift" label="SWIFT code (optional)" defaultValue={bank?.swift ?? ""} errors={fe?.swift} />
        </div>
        <p className="text-xs text-muted-foreground">Printed under “How to pay” on invoices and statements. Leave the account number empty to hide bank details.</p>
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <Save />} Save bank details
          </Button>
        ) : null}
      </fieldset>
    </form>
  );
}

/** The three designs with a full preview of the selected one; one is the default for new documents. */
export function TemplatePicker({ issuer, defaultKey, canEdit }: { issuer: Issuer; defaultKey: TemplateKey; canEdit: boolean }) {
  const [shown, setShown] = useState<TemplateKey>(defaultKey);
  const [kind, setKind] = useState<"quote" | "invoice">("quote");
  const [pending, start] = useTransition();
  const model = useMemo(() => sampleModel(issuer, kind), [issuer, kind]);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {TEMPLATE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setShown(k)}
            aria-pressed={shown === k}
            className={cn("rounded-xl px-4 py-3 text-left ring-1 transition-colors", shown === k ? "bg-primary/8 ring-primary/40" : "ring-border hover:bg-muted/50")}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{TEMPLATE_LABELS[k].name}</span>
              {k === defaultKey ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Check className="size-3" /> Default
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{TEMPLATE_LABELS[k].description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="tablist" aria-label="Sample document">
          {(["quote", "invoice"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn("rounded-md px-3 py-1", kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
              {k === "quote" ? "Quotation" : "Invoice"}
            </button>
          ))}
        </div>
        {canEdit && shown !== defaultKey ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setDefaultTemplate(shown);
                if (!r.ok) toast.error(r.error);
                else toast.success(`${TEMPLATE_LABELS[shown].name} is now the default design`);
              })
            }
          >
            {pending ? <Spinner /> : <Check />} Make {TEMPLATE_LABELS[shown].name} the default
          </Button>
        ) : null}
      </div>
      <div className="rounded-2xl bg-muted/30 p-3 ring-1 ring-foreground/[0.05] sm:p-6">
        <DocumentPreview model={model} template={shown} />
      </div>
      <p className="text-xs text-muted-foreground">The default applies to new clients&apos; documents. Each client and each quotation can use another design.</p>
    </div>
  );
}

export type SeriesRow = { kind: string; label: string; prefix: string; padding: number; yearly_reset: boolean };

export function NumberingSeries({ rows, canEdit, year }: { rows: SeriesRow[]; canEdit: boolean; year: number }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <SeriesEditor key={r.kind} row={r} canEdit={canEdit} year={year} />
      ))}
    </ul>
  );
}

function SeriesEditor({ row, canEdit, year }: { row: SeriesRow; canEdit: boolean; year: number }) {
  const [prefix, setPrefix] = useState(row.prefix);
  const [padding, setPadding] = useState(row.padding);
  const [yearly, setYearly] = useState(row.yearly_reset);
  const [pending, start] = useTransition();
  const changed = prefix !== row.prefix || padding !== row.padding || yearly !== row.yearly_reset;
  const example = `${prefix || "?"}-${yearly ? `${year}-` : ""}${"1".padStart(Math.min(8, Math.max(3, padding)), "0")}`;
  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[10rem_7rem_6rem_1fr_auto] sm:items-end">
      <div>
        <p className="text-sm font-medium">{row.label}</p>
        <p className="font-mono text-xs text-muted-foreground">Next looks like {example}</p>
      </div>
      <label className="space-y-1">
        <span className="text-[11px] text-muted-foreground">Prefix</span>
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} className="h-8 font-mono" disabled={!canEdit || pending} />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] text-muted-foreground">Digits</span>
        <Input type="number" min={3} max={8} value={padding} onChange={(e) => setPadding(Math.round(Number(e.target.value) || 3))} className="h-8" disabled={!canEdit || pending} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={yearly} onCheckedChange={setYearly} disabled={!canEdit || pending} />
        Restart every year
      </label>
      {canEdit ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!changed || pending}
          onClick={() =>
            start(async () => {
              const r = await saveNumberingSeries({ kind: row.kind, prefix, padding, yearly_reset: yearly });
              if (!r.ok) toast.error(r.error);
              else toast.success(`${row.label} numbering saved`);
            })
          }
        >
          {pending ? <Spinner /> : <Save />} Save
        </Button>
      ) : null}
    </li>
  );
}

function sampleModel(issuer: Issuer, kind: "quote" | "invoice") {
  const client = { name: "Sample Holdings (Pvt) Ltd", address: { line1: "12 Galle Road", city: "Colombo 03", country: "Sri Lanka" }, email: "hr@sample.lk", phone: null };
  const items = [
    { description: "Comprehensive package (7 checks), per candidate", quantity: 1, unit_price: 18500, discount_pct: 10, total: 16650 },
    { description: "Additional referee", quantity: 2, unit_price: 2500, discount_pct: 0, total: 5000 },
  ];
  if (kind === "invoice") {
    return invoiceModel({
      issuer,
      client,
      contact: null,
      invoice: { number: "INV-2026-0001", status: "sent", currency: "LKR", issue_date: "2026-11-01", due_date: "2026-12-01", period_from: null, period_to: null, message: "Thank you for your business.", subtotal: 23500, discount_total: 1850, net_total: 21650, tax_lines: [], total: 21650, amount_paid: 0, amount_credited: 0, balance: 21650 },
      items,
    });
  }
  return quoteModel({
    issuer,
    client,
    contact: { name: "Nadeesha Perera", title: "Head of Talent" },
    quote: {
      number: "QT-2026-0001", version: 1, status: "sent", title: "Background verification services", currency: "LKR", issue_date: "2026-11-01", valid_until: "2026-12-01", payment_terms_days: 30,
      intro: "Thank you for the opportunity to support your hiring with pre-employment screening.", scope: "Identity, education, employment, address and police checks with a consolidated report.",
      assumptions: "", tat_text: "Seven working days from receipt of all documents.", closing: "We look forward to working with you.", subtotal: 23500, discount_total: 1850, total: 21650,
    },
    items,
    tiers: [],
  });
}
