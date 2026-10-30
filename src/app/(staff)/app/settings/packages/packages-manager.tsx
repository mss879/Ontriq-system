"use client";

import { useState, useTransition } from "react";
import { Package, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { savePackage } from "./actions";
import type { CatalogPackage } from "@/lib/server/cases/queries";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/lib/format";
import { PROCESS_TYPE_LABELS, PROCESS_TYPE_SHORT, type ProcessType } from "@/domain/workflow/stages";
import { cn } from "@/lib/utils";

type Pkg = CatalogPackage & { clientIds: string[] };
type CheckOption = { id: string; name: string; slaDays: number };
type ClientOption = { id: string; name: string };

type Draft = {
  id?: string;
  name: string;
  code: string;
  description: string;
  pricingMode: "sum" | "fixed";
  fixedPrice: string;
  tatDays: string;
  defaultProcessType: ProcessType;
  visibility: "all" | "selected";
  isActive: boolean;
  items: Record<string, string>;
  clientIds: string[];
};

const toDraft = (p?: Pkg): Draft => ({
  id: p?.id,
  name: p?.name ?? "",
  code: p?.code ?? "",
  description: p?.description ?? "",
  pricingMode: p?.pricingMode ?? "sum",
  fixedPrice: p?.fixedPrice === null || p?.fixedPrice === undefined ? "" : String(p.fixedPrice),
  tatDays: String(p?.tatDays ?? 7),
  defaultProcessType: p?.defaultProcessType ?? "client_supplied",
  visibility: p?.visibility ?? "all",
  isActive: p?.isActive ?? true,
  items: Object.fromEntries((p?.items ?? []).map((i) => [i.checkTypeId, String(i.unitPrice)])),
  clientIds: p?.clientIds ?? [],
});

export function PackagesManager({ packages, checkTypes, clients, canEdit }: { packages: Pkg[]; checkTypes: CheckOption[]; clients: ClientOption[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const typeName = new Map(checkTypes.map((t) => [t.id, t.name]));

  return (
    <Surface>
      <SurfaceHeader
        title="Packages"
        description="Prices are in LKR. Clients see these prices when they build their own packages; they never set prices."
        aside={
          canEdit ? (
            <Button size="sm" onClick={() => setEditing(toDraft())}>
              <Plus /> New package
            </Button>
          ) : null
        }
      />
      {packages.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No packages yet.</p>
      ) : (
        <ul className="grid sm:grid-cols-2">
          {packages.map((p) => (
            <li
              key={p.id}
              className={cn(
                "flex flex-col gap-3 border-t p-5 first:border-t-0 sm:odd:border-r sm:[&:nth-child(2)]:border-t-0",
                !p.isActive && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange-ink ring-1 ring-brand-orange/20">
                    <Package className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{p.code}</span> · {p.tatDays} working days · {PROCESS_TYPE_SHORT[p.defaultProcessType]}
                    </p>
                  </div>
                </div>
                {canEdit ? (
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}`} onClick={() => setEditing(toDraft(p))}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
              {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
              <div className="flex flex-wrap gap-1">
                {p.items.map((i) => (
                  <span key={i.checkTypeId} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {typeName.get(i.checkTypeId) ?? "Check"}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-lg font-semibold tabular-nums">{p.price > 0 ? formatMoney(p.price, p.currency) : <span className="text-sm font-medium text-warning-foreground dark:text-warning">Price not set</span>}</span>
                <div className="flex flex-wrap gap-1.5">
                  {p.pricingMode === "fixed" ? <ToneChip tone="info" dot={false} className="h-5 px-2 text-[11px]">Fixed price</ToneChip> : null}
                  {p.visibility === "selected" ? (
                    <ToneChip tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                      {p.clientIds.length} {p.clientIds.length === 1 ? "client" : "clients"}
                    </ToneChip>
                  ) : null}
                  {!p.isActive ? <ToneChip tone="neutral" className="h-5 px-2 text-[11px]">Inactive</ToneChip> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing ? <PackageForm key={editing.id ?? "new"} draft={editing} checkTypes={checkTypes} clients={clients} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Surface>
  );
}

function PackageForm({ draft, checkTypes, clients, onDone }: { draft: Draft; checkTypes: CheckOption[]; clients: ClientOption[]; onDone: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const chosen = checkTypes.filter((t) => t.id in d.items);
  const sum = chosen.reduce((a, t) => a + (Number(d.items[t.id]) || 0), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await savePackage({
        id: d.id,
        name: d.name,
        code: d.code,
        description: d.description,
        pricingMode: d.pricingMode,
        fixedPrice: d.pricingMode === "fixed" && d.fixedPrice !== "" ? Number(d.fixedPrice) : null,
        tatDays: Number(d.tatDays),
        defaultProcessType: d.defaultProcessType,
        visibility: d.visibility,
        isActive: d.isActive,
        items: checkTypes.filter((t) => t.id in d.items).map((t) => ({ checkTypeId: t.id, unitPrice: Number(d.items[t.id]) || 0 })),
        clientIds: d.clientIds,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.fieldErrors ? (r.fieldErrors.items?.[0] ?? null) : r.error);
        return;
      }
      toast.success(d.id ? "Package saved" : `${d.name} created`);
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader className="mb-5">
        <DialogTitle>{d.id ? `Edit ${draft.name}` : "New package"}</DialogTitle>
        <DialogDescription>Cases keep a snapshot of the package as it was when they were created, so changes never alter past cases or invoices.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {error ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <TextField name="name" label="Name" autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} />
          <TextField name="code" label="Code" inputClassName="font-mono" value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} errors={errors.code} />
          <TextField name="description" label="Description" className="sm:col-span-2" value={d.description} onChange={(e) => set("description", e.target.value)} errors={errors.description} />

          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">Checks and unit prices (LKR)</p>
            <ul className="divide-y rounded-xl ring-1 ring-foreground/[0.08]">
              {checkTypes.map((t) => {
                const on = t.id in d.items;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(c) => {
                          const items = { ...d.items };
                          if (c === true) items[t.id] = items[t.id] ?? "0";
                          else delete items[t.id];
                          set("items", items);
                        }}
                      />
                      <span className="truncate">{t.name}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">· {t.slaDays}-day SLA</span>
                    </label>
                    <Input
                      aria-label={`${t.name} unit price`}
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!on}
                      className="h-8 w-32 text-right tabular-nums"
                      value={on ? d.items[t.id] : ""}
                      onChange={(e) => set("items", { ...d.items, [t.id]: e.target.value })}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="text-right text-xs text-muted-foreground">
              Sum of checks: <span className="font-medium text-foreground tabular-nums">{formatMoney(sum)}</span>
            </p>
          </div>

          <Field>
            <FieldLabel>Pricing</FieldLabel>
            <Select value={d.pricingMode} onValueChange={(v) => set("pricingMode", v as Draft["pricingMode"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sum">Sum of the checks</SelectItem>
                <SelectItem value="fixed">One fixed package price</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {d.pricingMode === "fixed" ? (
            <TextField name="fixedPrice" label="Package price (LKR)" type="number" min={0} value={d.fixedPrice} onChange={(e) => set("fixedPrice", e.target.value)} errors={errors.fixedPrice} />
          ) : (
            <div />
          )}
          <TextField name="tatDays" label="Turnaround (working days)" type="number" min={1} max={90} value={d.tatDays} onChange={(e) => set("tatDays", e.target.value)} errors={errors.tatDays} />
          <Field>
            <FieldLabel>Usual process</FieldLabel>
            <Select value={d.defaultProcessType} onValueChange={(v) => set("defaultProcessType", v as ProcessType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["client_supplied", "candidate_collected"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROCESS_TYPE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="sm:col-span-2" data-invalid={Boolean(errors.clientIds) || undefined}>
            <FieldLabel>Offered to</FieldLabel>
            <Select value={d.visibility} onValueChange={(v) => set("visibility", v as Draft["visibility"])}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every client</SelectItem>
                <SelectItem value="selected">Only the clients I choose</SelectItem>
              </SelectContent>
            </Select>
            {d.visibility === "selected" ? (
              <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-xl p-2 ring-1 ring-foreground/[0.08] sm:grid-cols-2">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <Checkbox
                      checked={d.clientIds.includes(c.id)}
                      onCheckedChange={(on) => set("clientIds", on === true ? [...d.clientIds, c.id] : d.clientIds.filter((x) => x !== c.id))}
                    />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
                {clients.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No active clients.</p> : null}
              </div>
            ) : null}
            <FieldError errors={errors.clientIds?.map((message) => ({ message }))} />
          </Field>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05] sm:col-span-2">
            <span>
              <span className="block font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">Inactive packages can’t be chosen for new cases.</span>
            </span>
            <Switch checked={d.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </label>
        </FieldGroup>
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Save package
        </Button>
      </DialogFooter>
    </form>
  );
}
