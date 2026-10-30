"use client";

import { useState, useTransition } from "react";
import { Archive, Check, Pencil, Plus, RotateCcw, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PortalTemplate } from "@/lib/server/portal/queries";
import { saveTemplate, setTemplateFlags, type TemplateInput } from "./actions";

type PackageOption = { id: string; name: string; default_process_type: "client_supplied" | "candidate_collected" };

const PROCESS = { client_supplied: "We send the documents", candidate_collected: "Ontriq collects from the candidate" } as const;
const PRIORITY = { normal: "Normal", high: "High", urgent: "Urgent" } as const;

export function TemplateButton({ packages, editing }: { packages: PackageOption[]; editing?: PortalTemplate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {editing ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil /> Edit
        </Button>
      ) : (
        <Button variant="brand" size="lg" className="h-9 px-3.5" onClick={() => setOpen(true)} disabled={!packages.length}>
          <Plus /> New template
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">{open ? <TemplateForm packages={packages} editing={editing} onDone={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function TemplateForm({ packages, editing, onDone }: { packages: PackageOption[]; editing?: PortalTemplate; onDone: () => void }) {
  const [form, setForm] = useState<TemplateInput>(() => ({
    id: editing?.id,
    name: editing?.name ?? "",
    description: editing?.description ?? "",
    packageId: editing?.package_id ?? packages[0]?.id ?? "",
    processType: editing?.process_type ?? packages[0]?.default_process_type ?? "client_supplied",
    priority: editing?.priority ?? "normal",
    positionTitle: editing?.defaults.position_title ?? "",
    department: editing?.defaults.department ?? "",
    instructions: editing?.defaults.instructions ?? "",
    isFavourite: editing?.is_favourite ?? false,
  }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pkgName = packages.find((p) => p.id === form.packageId)?.name;

  function save() {
    start(async () => {
      const r = await saveTemplate(form);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Template saved" : "Template created", { description: "It's ready in New request." });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
        <DialogDescription>Save the package and details you use for a role, then request it in one click.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2" data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="tpl-name">Name</FieldLabel>
          <Input id="tpl-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Branch staff" maxLength={80} />
          <FieldError errors={errors.name?.map((message) => ({ message }))} />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="tpl-desc">Description</FieldLabel>
          <Input id="tpl-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" maxLength={300} />
        </Field>
        <Field className="sm:col-span-2" data-invalid={errors.packageId ? true : undefined}>
          <FieldLabel htmlFor="tpl-package">Package</FieldLabel>
          <Select value={form.packageId} onValueChange={(v) => set("packageId", v)}>
            <SelectTrigger id="tpl-package" className="w-full">
              <SelectValue placeholder="Choose a package">{pkgName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {packages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.packageId?.map((message) => ({ message }))} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-process">Documents</FieldLabel>
          <Select value={form.processType} onValueChange={(v) => set("processType", v as TemplateInput["processType"])}>
            <SelectTrigger id="tpl-process" className="w-full">
              <SelectValue>{PROCESS[form.processType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROCESS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-priority">Priority</FieldLabel>
          <Select value={form.priority} onValueChange={(v) => set("priority", v as TemplateInput["priority"])}>
            <SelectTrigger id="tpl-priority" className="w-full">
              <SelectValue>{PRIORITY[form.priority]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITY).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-position">Position</FieldLabel>
          <Input id="tpl-position" value={form.positionTitle} onChange={(e) => set("positionTitle", e.target.value)} placeholder="Optional" />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-dept">Department</FieldLabel>
          <Input id="tpl-dept" value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="Optional" />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="tpl-instructions">Instructions for Ontriq</FieldLabel>
          <Textarea id="tpl-instructions" rows={2} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Optional" />
        </Field>
        <button
          type="button"
          role="switch"
          aria-checked={form.isFavourite}
          onClick={() => set("isFavourite", !form.isFavourite)}
          className={cn("flex items-center gap-2 justify-self-start rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-border transition", form.isFavourite && "bg-brand-orange/8 ring-brand-orange/40")}
        >
          <Star className={cn("size-4", form.isFavourite ? "fill-brand-orange text-brand-orange" : "text-muted-foreground")} /> Favourite
        </button>
      </div>
      <DialogFooter>
        <Button variant="brand" onClick={save} disabled={pending}>
          {pending ? <Spinner /> : <Check />} {editing ? "Save template" : "Create template"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TemplateFlags({ template }: { template: PortalTemplate }) {
  const [pending, start] = useTransition();
  const run = (flags: { isFavourite?: boolean; isActive?: boolean }, done: string) =>
    start(async () => {
      const r = await setTemplateFlags(template.id, flags);
      if (!r.ok) toast.error(r.error);
      else toast.success(done);
    });
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={template.is_favourite ? "Remove from favourites" : "Add to favourites"}
        onClick={() => run({ isFavourite: !template.is_favourite }, template.is_favourite ? "Removed from favourites" : "Added to favourites")}
      >
        <Star className={cn(template.is_favourite && "fill-brand-orange text-brand-orange")} />
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run({ isActive: !template.is_active }, template.is_active ? "Template archived" : "Template restored")}>
        {pending ? <Spinner /> : template.is_active ? <Archive /> : <RotateCcw />} {template.is_active ? "Archive" : "Restore"}
      </Button>
    </>
  );
}
