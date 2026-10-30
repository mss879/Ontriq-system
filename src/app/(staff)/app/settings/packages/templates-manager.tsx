"use client";

import { useState, useTransition } from "react";
import { FileStack, Pencil, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { saveTemplate } from "./actions";
import type { CatalogTemplate } from "@/lib/server/cases/queries";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { PriorityBadge, ToneChip } from "@/components/cases/badges";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_LABELS, PROCESS_TYPE_LABELS, PROCESS_TYPE_SHORT, type Priority, type ProcessType } from "@/domain/workflow/stages";
import { cn } from "@/lib/utils";

type PackageOption = { id: string; name: string; active: boolean; defaultProcessType: ProcessType };
type Draft = {
  id?: string;
  name: string;
  description: string;
  packageId: string;
  processType: ProcessType;
  priority: Priority;
  positionTitle: string;
  department: string;
  instructions: string;
  isFavourite: boolean;
  isActive: boolean;
};

const toDraft = (t: CatalogTemplate | undefined, packages: PackageOption[]): Draft => ({
  id: t?.id,
  name: t?.name ?? "",
  description: t?.description ?? "",
  packageId: t?.packageId ?? packages.find((p) => p.active)?.id ?? "",
  processType: t?.processType ?? packages.find((p) => p.active)?.defaultProcessType ?? "client_supplied",
  priority: t?.priority ?? "normal",
  positionTitle: t?.defaults.position_title ?? "",
  department: t?.defaults.department ?? "",
  instructions: t?.defaults.instructions ?? "",
  isFavourite: t?.isFavourite ?? false,
  isActive: t?.isActive ?? true,
});

export function TemplatesManager({ templates, packages, canEdit }: { templates: CatalogTemplate[]; packages: PackageOption[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const pkgName = new Map(packages.map((p) => [p.id, p.name]));
  return (
    <Surface>
      <SurfaceHeader
        title="Request templates"
        description="Shown first when someone starts a new case. Favourites and the most used appear at the top."
        aside={
          canEdit ? (
            <Button size="sm" onClick={() => setEditing(toDraft(undefined, packages))} disabled={!packages.length}>
              <Plus /> New template
            </Button>
          ) : null
        }
      />
      {templates.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <ul className="divide-y">
          {templates.map((t) => (
            <li key={t.id} className={cn("flex items-start gap-3 px-5 py-4", !t.isActive && "opacity-60")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                <FileStack className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{t.name}</p>
                  {t.isFavourite ? <Star className="size-3.5 fill-brand-orange text-brand-orange" aria-label="Favourite" /> : null}
                  <PriorityBadge priority={t.priority} className="h-5 px-2 text-[11px]" />
                  {!t.isActive ? <ToneChip tone="neutral" className="h-5 px-2 text-[11px]">Inactive</ToneChip> : null}
                </div>
                {t.description ? <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {pkgName.get(t.packageId) ?? "Package"} · {PROCESS_TYPE_SHORT[t.processType]} · used {t.usageCount} {t.usageCount === 1 ? "time" : "times"}
                </p>
              </div>
              {canEdit ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(toDraft(t, packages))}>
                  <Pencil />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {editing ? <TemplateForm key={editing.id ?? "new"} draft={editing} packages={packages} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Surface>
  );
}

function TemplateForm({ draft, packages, onDone }: { draft: Draft; packages: PackageOption[]; onDone: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveTemplate(d);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            setError(r.fieldErrors ? null : r.error);
            return;
          }
          toast.success(d.id ? "Template saved" : `${d.name} created`);
          onDone();
        });
      }}
    >
      <DialogHeader className="mb-5">
        <DialogTitle>{d.id ? `Edit ${draft.name}` : "New request template"}</DialogTitle>
        <DialogDescription>Everything here is filled in for the person creating the case; they can still change it.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {error ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <TextField name="name" label="Name" autoFocus className="sm:col-span-2" value={d.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} />
          <TextField name="description" label="Description" className="sm:col-span-2" value={d.description} onChange={(e) => set("description", e.target.value)} errors={errors.description} />
          <Field data-invalid={Boolean(errors.packageId) || undefined}>
            <FieldLabel>Package</FieldLabel>
            <Select
              value={d.packageId}
              onValueChange={(v) => {
                set("packageId", v);
                const p = packages.find((x) => x.id === v);
                if (p && !d.id) set("processType", p.defaultProcessType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={!p.active && p.id !== draft.packageId}>
                    {p.name}
                    {!p.active ? " · inactive" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={errors.packageId?.map((message) => ({ message }))} />
          </Field>
          <Field>
            <FieldLabel>Priority</FieldLabel>
            <Select value={d.priority} onValueChange={(v) => set("priority", v as Priority)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["normal", "high", "urgent"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>Process</FieldLabel>
            <Select value={d.processType} onValueChange={(v) => set("processType", v as ProcessType)}>
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
          <TextField name="positionTitle" label="Position (optional)" value={d.positionTitle} onChange={(e) => set("positionTitle", e.target.value)} errors={errors.positionTitle} />
          <TextField name="department" label="Department (optional)" value={d.department} onChange={(e) => set("department", e.target.value)} errors={errors.department} />
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="template-instructions">Instructions to Ontriq (optional)</FieldLabel>
            <Textarea id="template-instructions" rows={3} value={d.instructions} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05]">
            <span className="font-medium">Favourite</span>
            <Switch checked={d.isFavourite} onCheckedChange={(v) => set("isFavourite", v)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05]">
            <span className="font-medium">Active</span>
            <Switch checked={d.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </label>
        </FieldGroup>
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Save template
        </Button>
      </DialogFooter>
    </form>
  );
}
