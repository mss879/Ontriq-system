"use client";

import { useState, useTransition } from "react";
import { Archive, Check, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PortalPriceItem } from "@/domain/portal/types";
import { saveClientPackage, setClientPackageActive } from "./actions";

export type EditablePackage = { id: string; name: string; description: string; checkTypeIds: string[] };

/** "Build a package" and "Edit" open the same dialog: name it, pick checks, see Ontriq's price live. */
export function PackageBuilderButton({ priceList, editing, needsApproval }: { priceList: PortalPriceItem[]; editing?: EditablePackage; needsApproval: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {editing ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil /> Edit
        </Button>
      ) : (
        <Button size="lg" className="h-9 px-3.5" onClick={() => setOpen(true)}>
          <Plus /> Build a package
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">{open ? <Builder priceList={priceList} editing={editing} needsApproval={needsApproval} onDone={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function Builder({ priceList, editing, needsApproval, onDone }: { priceList: PortalPriceItem[]; editing?: EditablePackage; needsApproval: boolean; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [picked, setPicked] = useState<string[]>(editing?.checkTypeIds ?? []);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const total = priceList.filter((p) => picked.includes(p.check_type_id)).reduce((a, p) => a + p.unit_price, 0);
  const currency = priceList[0]?.currency ?? "LKR";

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function save() {
    // Keep Ontriq's catalogue order.
    const ordered = priceList.map((p) => p.check_type_id).filter((id) => picked.includes(id));
    start(async () => {
      const r = await saveClientPackage({ id: editing?.id, name, description, checkTypeIds: ordered });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Package updated" : "Package created", {
        description: r.pendingApproval ? "Ontriq will approve it before it can be used." : "It's ready to use on new requests.",
      });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit package" : "Build a package"}</DialogTitle>
        <DialogDescription>Name it after the role you hire for and pick the checks. Prices are Ontriq&apos;s current prices for your company.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="pkg-name">Name</FieldLabel>
          <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Driver onboarding" maxLength={80} />
          <FieldError errors={errors.name?.map((message) => ({ message }))} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pkg-desc">Description</FieldLabel>
          <Textarea id="pkg-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it's for (optional)" maxLength={400} />
        </Field>
        <Field data-invalid={errors.checkTypeIds ? true : undefined}>
          <FieldLabel>Checks</FieldLabel>
          <ul className="-m-1 max-h-72 space-y-1.5 overflow-y-auto p-1">
            {priceList.map((p) => {
              const on = picked.includes(p.check_type_id);
              return (
                <li key={p.check_type_id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p.check_type_id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-foreground/[0.08] transition hover:ring-brand-orange/40",
                      on && "bg-brand-orange/[0.05] ring-brand-orange/50",
                    )}
                  >
                    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md ring-1 ring-border", on && "bg-brand-orange text-white ring-brand-orange")}>
                      {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{p.name}</span>
                      {p.description ? <span className="block truncate text-xs text-muted-foreground">{p.description}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{p.unit_price > 0 ? formatMoney(p.unit_price, p.currency) : "On quote"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <FieldError errors={errors.checkTypeIds?.map((message) => ({ message }))} />
          {needsApproval && !editing ? <FieldDescription>Ontriq approves new packages before they can be used on requests.</FieldDescription> : null}
        </Field>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {picked.length} {picked.length === 1 ? "check" : "checks"} · <span className="font-semibold text-foreground">{total > 0 ? formatMoney(total, currency) : "Price on quote"}</span>
        </p>
        <Button onClick={save} disabled={pending}>
          {pending ? <Spinner /> : <Check />} {editing ? "Save changes" : "Create package"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PackageActiveToggle({ id, active, waiting }: { id: string; active: boolean; waiting: boolean }) {
  const [pending, start] = useTransition();
  if (waiting) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setClientPackageActive(id, !active);
          if (!r.ok) toast.error(r.error);
          else toast.success(active ? "Package archived" : "Package restored");
        })
      }
    >
      {pending ? <Spinner /> : active ? <Archive /> : <RotateCcw />} {active ? "Archive" : "Restore"}
    </Button>
  );
}
