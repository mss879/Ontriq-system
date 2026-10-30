"use client";

import { useState } from "react";
import { Boxes, ClipboardCheck, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { formatAmount, lineTotal } from "@/domain/pricing/money";
import type { CatalogItem, QuoteLine, QuoteTier } from "./types";

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

/** The price to offer: the client's contracted price, else Ontriq's list price. */
export const offerPrice = (item: CatalogItem) => item.contracted_price ?? item.list_price;

export function lineFromCatalog(item: CatalogItem): QuoteLine {
  return {
    key: newKey(),
    kind: item.kind,
    package_id: item.kind === "package" ? item.id : null,
    check_type_id: item.kind === "check" ? item.id : null,
    description: item.kind === "package" ? `${item.name} package, per candidate` : item.name,
    quantity: 1,
    unit_price: offerPrice(item),
    discount_pct: 0,
  };
}

const numberValue = (v: string, fallback = 0) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

export function QuoteLinesEditor({ lines, catalog, currency, onChange, disabled }: { lines: QuoteLine[]; catalog: CatalogItem[]; currency: string; onChange: (lines: QuoteLine[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const set = (key: string, patch: Partial<QuoteLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (line: QuoteLine) => {
    onChange([...lines, line]);
    setOpen(false);
  };
  const packages = catalog.filter((c) => c.kind === "package");
  const checks = catalog.filter((c) => c.kind === "check");

  return (
    <div className="space-y-3">
      {lines.length ? (
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.key} className="rounded-xl bg-muted/35 p-3 ring-1 ring-foreground/[0.06]">
              <div className="flex items-start gap-2">
                <span className="mt-2 text-muted-foreground" title={l.kind === "package" ? "Package" : l.kind === "check" ? "Check" : "Custom line"}>
                  {l.kind === "package" ? <Boxes className="size-4" /> : l.kind === "check" ? <ClipboardCheck className="size-4" /> : <PencilLine className="size-4" />}
                </span>
                <Input
                  value={l.description}
                  onChange={(e) => set(l.key, { description: e.target.value })}
                  aria-label="Line description"
                  className="h-9 flex-1"
                  disabled={disabled}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} disabled={disabled}>
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 pl-6 sm:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Quantity</span>
                  <Input type="number" inputMode="decimal" min={0} step="1" value={l.quantity} onChange={(e) => set(l.key, { quantity: numberValue(e.target.value, 1) })} className="h-8 tabular-nums" disabled={disabled} />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Unit price ({currency})</span>
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={l.unit_price} onChange={(e) => set(l.key, { unit_price: numberValue(e.target.value) })} className="h-8 tabular-nums" disabled={disabled} />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Discount %</span>
                  <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={l.discount_pct} onChange={(e) => set(l.key, { discount_pct: Math.min(100, Math.max(0, numberValue(e.target.value))) })} className="h-8 tabular-nums" disabled={disabled} />
                </label>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Amount</span>
                  <p className="flex h-8 items-center justify-end rounded-md bg-background px-2 text-sm font-semibold tabular-nums ring-1 ring-border">{formatAmount(lineTotal(l))}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Add a package, a check or a custom line.</p>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled}>
            <Plus /> Add line
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
          <Command>
            <CommandInput placeholder="Search packages and checks…" />
            <CommandList className="max-h-80">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              <CommandGroup heading="Custom">
                <CommandItem value="custom line" onSelect={() => add({ key: newKey(), kind: "custom", package_id: null, check_type_id: null, description: "", quantity: 1, unit_price: 0, discount_pct: 0 })}>
                  <PencilLine /> Custom line
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              {packages.length ? (
                <CommandGroup heading="Packages">
                  {packages.map((p) => (
                    <CatalogRow key={p.id} item={p} currency={currency} onPick={() => add(lineFromCatalog(p))} />
                  ))}
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Checks">
                {checks.map((c) => (
                  <CatalogRow key={c.id} item={c} currency={currency} onPick={() => add(lineFromCatalog(c))} />
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CatalogRow({ item, currency, onPick }: { item: CatalogItem; currency: string; onPick: () => void }) {
  return (
    <CommandItem value={`${item.kind} ${item.name}`} onSelect={onPick} className="items-start">
      {item.kind === "package" ? <Boxes className="mt-0.5" /> : <ClipboardCheck className="mt-0.5" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.name}</span>
        {item.checks.length ? <span className="block truncate text-xs text-muted-foreground">{item.checks.join(", ")}</span> : null}
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums">
        {currency} {formatAmount(offerPrice(item))}
        {item.contracted_price !== null ? <span className="block text-[10px] font-medium text-success">Contracted</span> : null}
      </span>
    </CommandItem>
  );
}

export function QuoteTiersEditor({ tiers, onChange, disabled }: { tiers: QuoteTier[]; onChange: (tiers: QuoteTier[]) => void; disabled?: boolean }) {
  const set = (key: string, patch: Partial<QuoteTier>) => onChange(tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2">
      {tiers.map((t) => (
        <div key={t.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 sm:grid-cols-[6rem_6rem_6rem_1fr_auto]">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">From (cases/month)</span>
            <Input type="number" min={0} value={t.min_volume} onChange={(e) => set(t.key, { min_volume: Math.max(0, Math.round(numberValue(e.target.value))) })} className="h-8 tabular-nums" disabled={disabled} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">To (blank: up)</span>
            <Input
              type="number"
              min={0}
              value={t.max_volume ?? ""}
              onChange={(e) => set(t.key, { max_volume: e.target.value === "" ? null : Math.max(0, Math.round(numberValue(e.target.value))) })}
              className="h-8 tabular-nums"
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Discount %</span>
            <Input type="number" min={0} max={100} step="0.5" value={t.discount_pct} onChange={(e) => set(t.key, { discount_pct: Math.min(100, Math.max(0, numberValue(e.target.value))) })} className="h-8 tabular-nums" disabled={disabled} />
          </label>
          <label className="col-span-3 space-y-1 sm:col-span-1">
            <span className="text-[11px] text-muted-foreground">Note</span>
            <Input value={t.note} onChange={(e) => set(t.key, { note: e.target.value })} placeholder="e.g. applied monthly" className="h-8" disabled={disabled} />
          </label>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove tier" onClick={() => onChange(tiers.filter((x) => x.key !== t.key))} disabled={disabled}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || tiers.length >= 10}
        onClick={() => {
          const last = tiers[tiers.length - 1];
          const from = last ? (last.max_volume ?? last.min_volume) + 1 : 51;
          onChange([...tiers, { key: newKey(), min_volume: from, max_volume: null, discount_pct: last ? Math.min(100, last.discount_pct + 5) : 5, note: "" }]);
        }}
      >
        <Plus /> Add volume tier
      </Button>
    </div>
  );
}
