"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { invoiceTotals } from "@/domain/pricing/invoice-core";
import { formatMoney } from "@/domain/pricing/money";
import { saveTaxRates } from "./actions";

type Rate = { id: string; code: string; name: string; rate: number; inclusive: boolean; is_active: boolean };

/** Which taxes go on new invoices, with a worked example. Confirmed invoices keep the taxes they were confirmed with. */
export function TaxRatesForm({ rates }: { rates: Rate[] }) {
  const [rows, setRows] = useState(rates.map((r) => ({ ...r, rateText: String(r.rate) })));
  const [sample, setSample] = useState("100000");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = rows.some((r, i) => r.is_active !== rates[i]?.is_active || r.inclusive !== rates[i]?.inclusive || Number(r.rateText) !== rates[i]?.rate);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const amount = Number(sample) || 0;
  const totals = invoiceTotals(
    [{ quantity: 1, unit_price: amount, discount_pct: 0 }],
    rows.filter((r) => r.is_active).map((r) => ({ code: r.code, name: r.name, rate: Number(r.rateText) || 0, inclusive: r.inclusive })),
  );

  return (
    <Surface>
      <SurfaceHeader title="Taxes" description="Active taxes are added when an invoice is confirmed. Invoices already confirmed keep their taxes." />
      <ul className="divide-y">
        {rows.map((r, i) => (
          <li key={r.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {r.name} <span className="text-xs text-muted-foreground">({r.code})</span>
              </p>
              <p className="text-xs text-muted-foreground">{r.is_active ? (r.inclusive ? "Included in prices" : "Added on top of the net amount") : "Not charged"}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Input inputMode="decimal" value={r.rateText} onChange={(e) => set(i, { rateText: e.target.value })} className="h-9 w-20 text-right tabular-nums" aria-label={`${r.name} rate`} />%
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={r.inclusive} onCheckedChange={(v) => set(i, { inclusive: v })} aria-label={`${r.name} included in prices`} /> Inclusive
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={r.is_active} onCheckedChange={(v) => set(i, { is_active: v })} aria-label={`Charge ${r.name}`} /> Charge
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t bg-muted/30 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Example net amount
            <Input inputMode="decimal" value={sample} onChange={(e) => setSample(e.target.value)} className="h-9 w-40 tabular-nums" />
          </label>
          <dl className="min-w-56 space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Net</dt>
              <dd className="tabular-nums">{formatMoney(totals.net_total, "LKR")}</dd>
            </div>
            {totals.tax_lines.map((t) => (
              <div key={t.code} className="flex justify-between gap-6">
                <dt className="text-muted-foreground">
                  {t.code} {t.rate}%{t.inclusive ? " (included)" : ""}
                </dt>
                <dd className="tabular-nums">{formatMoney(t.amount, "LKR")}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-6 border-t pt-1 font-semibold">
              <dt>Invoice total</dt>
              <dd className="tabular-nums">{formatMoney(totals.total, "LKR")}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={!changed || pending}
          onClick={() => {
            setRows(rates.map((r) => ({ ...r, rateText: String(r.rate) })));
            setError(null);
          }}
        >
          Undo
        </Button>
        <Button
          size="sm"
          disabled={!changed || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await saveTaxRates(rows.map((x) => ({ id: x.id, is_active: x.is_active, rate: x.rateText, inclusive: x.inclusive })));
              if (!r.ok) return setError(r.error);
              toast.success("Taxes saved");
            })
          }
        >
          {pending ? <Spinner /> : null} Save taxes
        </Button>
      </div>
    </Surface>
  );
}
