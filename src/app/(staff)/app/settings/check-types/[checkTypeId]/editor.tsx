"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Eye,
  FileText,
  Layers,
  ListPlus,
  Pencil,
  Plus,
  Rocket,
  Save,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { discardDraft, publishCheckType, saveDraft, setCheckTypeArchived, updateCheckTypeDetails } from "../actions";
import type { CheckTypeEditorData } from "@/lib/server/admin/settings";
import { checkTypeSchema, FIELD_TYPE_LABELS, FIELD_TYPES, type CheckTypeSchema, type FieldDef, type FieldType } from "@/domain/check-types/schema";
import { Eyebrow } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = { key: string; name: string; sensitive: boolean };
type BaseField = Omit<FieldDef, "fields" | "group">;

const toKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 48) || "field";

const newField = (): FieldDef => ({
  key: "",
  label: "",
  type: "text",
  required: false,
  visibility: { client: false, report: true, candidate: false },
  fill_by: ["staff"],
  width: "half",
});

const TONES = [
  { value: "green", label: "Green · clear" },
  { value: "amber", label: "Amber · review" },
  { value: "red", label: "Red · discrepancy" },
] as const;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function CheckTypeEditor({ data, categories }: { data: CheckTypeEditorData; categories: Category[] }) {
  const [schema, setSchema] = useState<CheckTypeSchema>(data.schema);
  const [saved, setSaved] = useState(JSON.stringify(data.schema));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<{ index: number; field: FieldDef } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(schema) !== saved;
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.key, c.name])), [categories]);

  const update = (patch: Partial<CheckTypeSchema>) => setSchema((s) => ({ ...s, ...patch }));

  /** Validate locally first; returns the parsed schema or null with errors shown. */
  const check = (): CheckTypeSchema | null => {
    const r = checkTypeSchema.safeParse(schema);
    if (r.success) {
      setErrors({});
      return r.data;
    }
    const out: Record<string, string[]> = {};
    for (const issue of r.error.issues) (out[issue.path.map(String).join(".") || "_"] ??= []).push(issue.message);
    setErrors(out);
    toast.error("Some parts of the definition need fixing.");
    return null;
  };

  const doSave = () => {
    const parsed = check();
    if (!parsed) return;
    start(async () => {
      const r = await saveDraft(data.id, parsed);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      setSaved(JSON.stringify(schema));
      toast.success("Draft saved. Publish it when you're ready.");
    });
  };

  const doPublish = () => {
    const parsed = check();
    if (!parsed) return;
    start(async () => {
      const r = await publishCheckType(data.id, parsed, notes);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      setPublishOpen(false);
      setSaved(JSON.stringify(schema));
      toast.success(`Version ${r.version} published. New cases use it from now on.`);
    });
  };

  const fieldErrorsAt = (i: number) => Object.entries(errors).filter(([k]) => k === `fields.${i}` || k.startsWith(`fields.${i}.`));
  const topErrors = Object.entries(errors).filter(([k]) => !k.startsWith("fields.") && !k.startsWith("documents.") && !k.startsWith("result."));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <Eyebrow>Check type · {data.key}</Eyebrow>
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">{data.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {data.currentVersion ? <span>Version {data.currentVersion} is live</span> : <span>Not published yet</span>}
            {data.editingDraft || dirty ? <ToneChip tone="warning">Unpublished changes</ToneChip> : <ToneChip tone="success">Up to date</ToneChip>}
            {data.archived ? <ToneChip tone="neutral">Archived</ToneChip> : null}
            {data.usage ? <span>· used on {data.usage} {data.usage === 1 ? "check" : "checks"}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.editingDraft ? (
            <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={pending}>
              <Undo2 /> Discard draft
            </Button>
          ) : null}
          <Button variant="outline" onClick={doSave} disabled={pending || !dirty}>
            {pending ? <Spinner /> : <Save />} Save draft
          </Button>
          <Button onClick={() => (check() ? setPublishOpen(true) : null)} disabled={pending || (!dirty && !data.editingDraft && data.currentVersion !== null)}>
            <Rocket /> Publish
          </Button>
        </div>
      </div>

      <Alert>
        <Layers />
        <AlertTitle>Versions protect running cases</AlertTitle>
        <AlertDescription>
          Publishing makes a new version for cases created from now on. Cases already open keep the version they started with, so their forms and
          reports never change underneath them.
        </AlertDescription>
      </Alert>

      {topErrors.length ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Fix before saving</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {topErrors.map(([k, v]) => (
                <li key={k}>{v.join(" ")}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <DetailsCard data={data} />

      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">
            Fields <span className="ml-1 text-muted-foreground tabular-nums">{schema.fields.length}</span>
          </TabsTrigger>
          <TabsTrigger value="documents">
            Documents <span className="ml-1 text-muted-foreground tabular-nums">{schema.documents.length}</span>
          </TabsTrigger>
          <TabsTrigger value="results">Results and timing</TabsTrigger>
        </TabsList>

        {/* Fields */}
        <TabsContent value="fields" className="mt-4">
          <Surface>
            <SurfaceHeader
              title="Fields"
              description="What the officer records for this check. Repeating groups hold several items, such as employers or referees."
              aside={
                <Button size="sm" onClick={() => setEditing({ index: -1, field: newField() })}>
                  <Plus /> Add field
                </Button>
              }
            />
            <ul className="divide-y">
              {schema.fields.map((f, i) => {
                const fe = fieldErrorsAt(i);
                return (
                  <li key={`${f.key}-${i}`} className={cn("flex items-start gap-3 px-5 py-3.5", fe.length && "bg-destructive/5")}>
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => update({ fields: move(schema.fields, i, i - 1) })}>
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === schema.fields.length - 1} onClick={() => update({ fields: move(schema.fields, i, i + 1) })}>
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{f.label || <span className="text-muted-foreground">Untitled field</span>}</p>
                        {f.required ? <span className="rounded-full bg-brand-orange/10 px-2 py-0.5 text-[11px] font-medium text-brand-orange-ink">Required</span> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{f.key || "—"}</span> · {FIELD_TYPE_LABELS[f.type]}
                        {f.type === "repeatable_group" ? ` · ${f.fields?.length ?? 0} fields per ${(f.group?.item_label ?? "item").toLowerCase()} · ${f.group?.min ?? 0}–${f.group?.max ?? 10}` : ""}
                        {f.options?.length ? ` · ${f.options.length} choices` : ""}
                        {f.width === "full" ? " · full width" : ""}
                      </p>
                      <Visibility v={f.visibility} />
                      {fe.length ? <p className="mt-1 text-xs text-destructive">{fe.flatMap(([, v]) => v).join(" ")}</p> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${f.label}`} onClick={() => setEditing({ index: i, field: f })}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${f.label}`}
                        disabled={schema.fields.length === 1}
                        onClick={() => update({ fields: schema.fields.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Surface>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <DocumentsEditor schema={schema} categories={categories} categoryName={categoryName} errors={errors} onChange={(documents) => update({ documents })} />
        </TabsContent>

        {/* Results and timing */}
        <TabsContent value="results" className="mt-4 space-y-6">
          <ResultsEditor schema={schema} errors={errors} onChange={update} categories={categories} />
        </TabsContent>
      </Tabs>

      {data.versions.length ? (
        <Surface>
          <SurfaceHeader title="Published versions" />
          <ul className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                <span className="font-medium">Version {v.version}</span>
                <span className="text-muted-foreground">{formatDate(v.publishedAt)}</span>
                {v.notes ? <span className="text-muted-foreground">· {v.notes}</span> : null}
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      <ArchiveCard data={data} />

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing ? (
            <FieldEditor
              key={editing.index}
              initial={editing.field}
              existingKeys={schema.fields.filter((_, j) => j !== editing.index).map((f) => f.key)}
              onCancel={() => setEditing(null)}
              onSave={(field) => {
                update({ fields: editing.index === -1 ? [...schema.fields, field] : schema.fields.map((f, j) => (j === editing.index ? field : f)) });
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish version {(data.currentVersion ?? 0) + 1}</DialogTitle>
            <DialogDescription>New cases with {data.name} use this version. Cases already open keep their version.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="publish-notes">What changed (optional)</FieldLabel>
            <Textarea id="publish-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Added the HR contact fields" />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={doPublish} disabled={pending}>
              {pending ? <Spinner /> : <Rocket />} Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the draft?</AlertDialogTitle>
            <AlertDialogDescription>Unpublished changes are deleted. The live version stays as it is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                start(async () => {
                  const r = await discardDraft(data.id);
                  if (r.ok) toast.success("Draft discarded");
                  else toast.error(r.error);
                })
              }
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Visibility({ v }: { v: FieldDef["visibility"] }) {
  const items = [v.client ? { icon: Users, label: "Client sees" } : null, v.report ? { icon: FileText, label: "In report" } : null, v.candidate ? { icon: Eye, label: "Candidate sees" } : null].filter(
    (x): x is { icon: typeof Users; label: string } => Boolean(x),
  );
  if (!items.length) return <p className="mt-1 text-[11px] text-muted-foreground">Ontriq staff only</p>;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {items.map(({ icon: Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Icon className="size-3" /> {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- details

function DetailsCard({ data }: { data: CheckTypeEditorData }) {
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description);
  const [sort, setSort] = useState(String(data.sort));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const changed = name !== data.name || description !== data.description || sort !== String(data.sort);
  return (
    <Surface>
      <SurfaceHeader title="Name and description" description="Shown to staff and clients when they pick checks. These change at once, without a new version." />
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_7rem] sm:items-start">
        <TextField name="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} errors={errors.name} />
        <TextField name="description" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} errors={errors.description} />
        <TextField name="sort" label="Order" type="number" value={sort} onChange={(e) => setSort(e.target.value)} errors={errors.sort} />
      </div>
      {changed ? (
        <div className="flex justify-end border-t px-5 py-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateCheckTypeDetails(data.id, { name, description, sort: Number(sort) });
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                } else toast.success("Saved");
              })
            }
          >
            {pending ? <Spinner /> : null} Save name and description
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

function ArchiveCard({ data }: { data: CheckTypeEditorData }) {
  const [pending, start] = useTransition();
  return (
    <Surface>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{data.archived ? "This check type is archived" : "Archive this check type"}</p>
          <p className="text-sm text-muted-foreground">
            {data.archived ? "It can't be added to new cases. Restore it to use it again." : "Archived checks can't be added to new cases. Existing cases are not affected."}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setCheckTypeArchived(data.id, !data.archived);
              if (r.ok) toast.success(data.archived ? "Restored" : "Archived");
              else toast.error(r.error);
            })
          }
        >
          {pending ? <Spinner /> : data.archived ? <ArchiveRestore /> : <Archive />} {data.archived ? "Restore" : "Archive"}
        </Button>
      </div>
    </Surface>
  );
}

// ---------------------------------------------------------------- field editor

function FieldEditor({ initial, existingKeys, onSave, onCancel, nested = false }: { initial: FieldDef; existingKeys: string[]; onSave: (f: FieldDef) => void; onCancel: () => void; nested?: boolean }) {
  const isNew = !initial.key;
  const [f, setF] = useState<FieldDef>(initial);
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [subEditing, setSubEditing] = useState<{ index: number; field: FieldDef } | null>(null);
  const set = <K extends keyof FieldDef>(k: K, v: FieldDef[K]) => setF((x) => ({ ...x, [k]: v }));
  const hasOptions = f.type === "select" || f.type === "multi_select";
  const types = FIELD_TYPES.filter((t) => !nested || t !== "repeatable_group");

  if (subEditing) {
    return (
      <FieldEditor
        nested
        initial={subEditing.field}
        existingKeys={(f.fields ?? []).filter((_, j) => j !== subEditing.index).map((x) => x.key)}
        onCancel={() => setSubEditing(null)}
        onSave={(sub) => {
          const list = f.fields ?? [];
          set("fields", subEditing.index === -1 ? [...list, sub as BaseField] : list.map((x, j) => (j === subEditing.index ? (sub as BaseField) : x)));
          setSubEditing(null);
        }}
      />
    );
  }

  const save = () => {
    const clean: FieldDef = { ...f, key: f.key.trim(), label: f.label.trim() };
    if (!clean.label) return setError("Give the field a label.");
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(clean.key)) return setError("The key must use lowercase letters, digits and underscores, starting with a letter.");
    if (existingKeys.includes(clean.key)) return setError(`Another field already uses the key "${clean.key}".`);
    if (hasOptions && !(clean.options ?? []).filter((o) => o.value && o.label).length) return setError("Add at least one choice.");
    if (clean.type === "repeatable_group" && !(clean.fields ?? []).length) return setError("Add at least one field for each item.");
    if (hasOptions) clean.options = (clean.options ?? []).filter((o) => o.value && o.label);
    else delete clean.options;
    if (clean.type !== "repeatable_group") {
      delete clean.fields;
      delete clean.group;
    } else clean.group = { min: clean.group?.min ?? 0, max: clean.group?.max ?? 10, item_label: clean.group?.item_label || "Item" };
    if (!clean.help) delete clean.help;
    if (!clean.placeholder) delete clean.placeholder;
    onSave(clean);
  };

  return (
    <div>
      <DialogHeader className="mb-5">
        <DialogTitle>{isNew ? (nested ? "Add a field to each item" : "Add a field") : `Edit ${initial.label}`}</DialogTitle>
        <DialogDescription>{nested ? "Shown once for every item in the group." : "Shown on the check's form for the officer."}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {error ? (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <TextField
          name="label"
          label="Label"
          autoFocus
          value={f.label}
          onChange={(e) => {
            set("label", e.target.value);
            if (!keyTouched) set("key", toKey(e.target.value));
          }}
        />
        <TextField
          name="key"
          label="Key"
          inputClassName="font-mono"
          value={f.key}
          onChange={(e) => {
            setKeyTouched(true);
            set("key", e.target.value);
          }}
          description={isNew ? "Stored with the values. Keep it once cases use it." : "Changing it in a new version leaves old values under the old key."}
        />
        <Field>
          <FieldLabel>Type</FieldLabel>
          <Select value={f.type} onValueChange={(v) => set("type", v as FieldType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Width on the form</FieldLabel>
          <Select value={f.width} onValueChange={(v) => set("width", v as FieldDef["width"])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="half">Half</SelectItem>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <TextField name="help" label="Help text" className="sm:col-span-2" value={f.help ?? ""} onChange={(e) => set("help", e.target.value)} />
        {["text", "textarea", "number", "phone", "email", "address", "nic"].includes(f.type) ? (
          <TextField name="placeholder" label="Placeholder" value={f.placeholder ?? ""} onChange={(e) => set("placeholder", e.target.value)} />
        ) : null}
        {f.type === "number" ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              name="min"
              label="Minimum"
              type="number"
              value={f.validation?.min ?? ""}
              onChange={(e) => set("validation", { ...f.validation, min: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
            <TextField
              name="max"
              label="Maximum"
              type="number"
              value={f.validation?.max ?? ""}
              onChange={(e) => set("validation", { ...f.validation, max: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </div>
        ) : null}
        {f.type === "text" || f.type === "textarea" ? (
          <TextField
            name="maxLength"
            label="Longest answer (characters)"
            type="number"
            value={f.validation?.maxLength ?? ""}
            onChange={(e) => set("validation", { ...f.validation, maxLength: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        ) : null}

        <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05] sm:col-span-2">
          <span>
            <span className="block font-medium">Required</span>
            <span className="block text-xs text-muted-foreground">Verification can’t start until it’s filled in.</span>
          </span>
          <Switch checked={f.required} onCheckedChange={(v) => set("required", v)} />
        </label>

        {hasOptions ? <OptionsEditor options={f.options ?? []} onChange={(options) => set("options", options)} /> : null}

        {f.type === "repeatable_group" ? (
          <div className="space-y-3 rounded-xl bg-muted/40 p-3.5 ring-1 ring-foreground/[0.05] sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                name="item_label"
                label="Each item is called"
                value={f.group?.item_label ?? ""}
                placeholder="Employer"
                onChange={(e) => set("group", { min: f.group?.min ?? 0, max: f.group?.max ?? 10, item_label: e.target.value })}
              />
              <TextField
                name="group_min"
                label="At least"
                type="number"
                min={0}
                value={f.group?.min ?? 0}
                onChange={(e) => set("group", { min: Number(e.target.value), max: f.group?.max ?? 10, item_label: f.group?.item_label ?? "Item" })}
              />
              <TextField
                name="group_max"
                label="At most"
                type="number"
                min={1}
                value={f.group?.max ?? 10}
                onChange={(e) => set("group", { min: f.group?.min ?? 0, max: Number(e.target.value), item_label: f.group?.item_label ?? "Item" })}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Fields for each {(f.group?.item_label || "item").toLowerCase()}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setSubEditing({ index: -1, field: newField() })}>
                <ListPlus /> Add
              </Button>
            </div>
            <ul className="divide-y rounded-lg bg-background ring-1 ring-foreground/[0.07]">
              {(f.fields ?? []).length === 0 ? <li className="px-3 py-2.5 text-xs text-muted-foreground">No fields yet.</li> : null}
              {(f.fields ?? []).map((sub, j) => (
                <li key={`${sub.key}-${j}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {sub.label}
                      {sub.required ? <span className="text-brand-orange"> *</span> : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-mono">{sub.key}</span> · {FIELD_TYPE_LABELS[sub.type]}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={j === 0} onClick={() => set("fields", move(f.fields ?? [], j, j - 1))}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={j === (f.fields ?? []).length - 1} onClick={() => set("fields", move(f.fields ?? [], j, j + 1))}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${sub.label}`} onClick={() => setSubEditing({ index: j, field: sub as FieldDef })}>
                    <Pencil />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${sub.label}`} onClick={() => set("fields", (f.fields ?? []).filter((_, k) => k !== j))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium">Who sees it</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["report", "Printed in the report"],
                ["client", "Client sees it in the portal"],
                ["candidate", "Candidate sees it on their link"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ring-1 ring-foreground/[0.07]">
                <Checkbox checked={f.visibility[k]} onCheckedChange={(c) => set("visibility", { ...f.visibility, [k]: c === true })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium">Who may fill it in</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["staff", "Ontriq staff"],
                ["candidate", "The candidate"],
                ["client", "The client"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ring-1 ring-foreground/[0.07]">
                <Checkbox
                  checked={f.fill_by.includes(k)}
                  onCheckedChange={(c) => set("fill_by", c === true ? [...new Set([...f.fill_by, k])] : f.fill_by.filter((x) => x !== k))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">AI pre-fill</span>
              <span className="block text-xs text-muted-foreground">From Phase 4, AI reads uploaded documents and suggests this value for the officer to confirm.</span>
            </span>
            <Switch checked={Boolean(f.ai?.extract)} onCheckedChange={(v) => set("ai", { extract: v, hint: f.ai?.hint })} />
          </label>
          {f.ai?.extract ? (
            <Input
              aria-label="Hint for the AI"
              placeholder="Hint for the AI, e.g. the index number printed under the photo"
              value={f.ai?.hint ?? ""}
              onChange={(e) => set("ai", { extract: true, hint: e.target.value || undefined })}
            />
          ) : null}
        </div>
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {nested ? "Back" : "Cancel"}
        </Button>
        <Button type="button" onClick={save}>
          {isNew ? "Add field" : "Done"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: { value: string; label: string }[]; onChange: (o: { value: string; label: string }[]) => void }) {
  const rows = options.length ? options : [{ value: "", label: "" }];
  return (
    <div className="space-y-2 sm:col-span-2">
      <p className="text-sm font-medium">Choices</p>
      {rows.map((o, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <Input
            aria-label="Choice label"
            placeholder="Label people see"
            value={o.label}
            onChange={(e) => {
              const label = e.target.value;
              const autoValue = !o.value || o.value === toKey(o.label);
              onChange(rows.map((x, j) => (j === i ? { label, value: autoValue ? toKey(label) : x.value } : x)));
            }}
          />
          <Input aria-label="Stored value" className="font-mono" placeholder="stored_value" value={o.value} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove choice" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { value: "", label: "" }])}>
        <Plus /> Add choice
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- documents

function DocumentsEditor({
  schema,
  categories,
  categoryName,
  errors,
  onChange,
}: {
  schema: CheckTypeSchema;
  categories: Category[];
  categoryName: Map<string, string>;
  errors: Record<string, string[]>;
  onChange: (docs: CheckTypeSchema["documents"]) => void;
}) {
  const docs = schema.documents;
  const set = (i: number, patch: Partial<CheckTypeSchema["documents"][number]>) => onChange(docs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const unused = categories.filter((c) => !docs.some((d) => d.category === c.key));
  return (
    <Surface>
      <SurfaceHeader
        title="Documents"
        description="What the case needs as evidence. Required documents must arrive (or be waived) before the case can leave the stage you choose."
        aside={
          <Button
            size="sm"
            disabled={!unused.length}
            onClick={() => onChange([...docs, { category: unused[0].key, label: unused[0].name, min: 1, stage: "documents", client_visible: false }])}
          >
            <Plus /> Add document
          </Button>
        }
      />
      {docs.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No documents needed.</p> : null}
      <ul className="divide-y">
        {docs.map((d, i) => {
          const err = Object.entries(errors).filter(([k]) => k.startsWith(`documents.${i}`));
          return (
            <li key={`${d.category}-${i}`} className={cn("grid gap-3 px-5 py-4 sm:grid-cols-6", err.length && "bg-destructive/5")}>
              <Field className="sm:col-span-2">
                <FieldLabel>Category</FieldLabel>
                <Select value={d.category} onValueChange={(v) => set(i, { category: v, label: d.label === categoryName.get(d.category) ? (categoryName.get(v) ?? d.label) : d.label })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) => c.key === d.category || !docs.some((x) => x.category === c.key))
                      .map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.name}
                          {c.sensitive ? " · sensitive" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel>Label</FieldLabel>
                <Input value={d.label} onChange={(e) => set(i, { label: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel>How many</FieldLabel>
                <Input type="number" min={0} max={20} value={d.min} onChange={(e) => set(i, { min: Number(e.target.value) })} />
                <FieldDescription>0 = optional</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Needed by</FieldLabel>
                <Select value={d.stage} onValueChange={(v) => set(i, { stage: v as "documents" | "verification" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="documents">Pre-QC</SelectItem>
                    <SelectItem value="verification">End of verification</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-4">
                <FieldLabel>Guidance</FieldLabel>
                <Input value={d.description ?? ""} placeholder="What exactly to upload" onChange={(e) => set(i, { description: e.target.value || undefined })} />
              </Field>
              <div className="flex items-end justify-between gap-3 sm:col-span-2">
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <Switch checked={d.client_visible} onCheckedChange={(v) => set(i, { client_visible: v })} /> Client can see
                </label>
                <Button variant="ghost" size="icon-sm" aria-label="Remove document" onClick={() => onChange(docs.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              {err.length ? <p className="text-xs text-destructive sm:col-span-6">{err.flatMap(([, v]) => v).join(" ")}</p> : null}
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}

// ---------------------------------------------------------------- results and timing

function ResultsEditor({
  schema,
  errors,
  onChange,
  categories,
}: {
  schema: CheckTypeSchema;
  errors: Record<string, string[]>;
  onChange: (patch: Partial<CheckTypeSchema>) => void;
  categories: Category[];
}) {
  const options = schema.result.options;
  const setOption = (i: number, patch: Partial<(typeof options)[number]>) => onChange({ result: { options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)) } });
  const resultErrors = Object.entries(errors).filter(([k]) => k.startsWith("result"));
  return (
    <>
      <Surface>
        <SurfaceHeader
          title="Result options"
          description="What an officer can conclude. Green and amber close the check as completed; red is recorded as a discrepancy, which only a person can set."
          aside={
            <Button size="sm" variant="outline" onClick={() => onChange({ result: { options: [...options, { key: "", label: "", tone: "amber" }] } })}>
              <Plus /> Add result
            </Button>
          }
        />
        <ul className="divide-y">
          {options.map((o, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,10rem)_auto] items-center gap-2 px-5 py-3">
              <Input aria-label="Result label" placeholder="Label" value={o.label} onChange={(e) => setOption(i, { label: e.target.value, key: !o.key || o.key === toKey(o.label) ? toKey(e.target.value) : o.key })} />
              <Input aria-label="Result key" className="font-mono" placeholder="key" value={o.key} onChange={(e) => setOption(i, { key: e.target.value })} />
              <Select value={o.tone} onValueChange={(v) => setOption(i, { tone: v as "green" | "amber" | "red" })}>
                <SelectTrigger className="w-full" aria-label="Colour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-sm" aria-label="Remove result" disabled={options.length <= 2} onClick={() => onChange({ result: { options: options.filter((_, j) => j !== i) } })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        {resultErrors.length ? <p className="border-t px-5 py-2.5 text-xs text-destructive">{resultErrors.flatMap(([, v]) => v).join(" ")}</p> : null}
      </Surface>

      <Surface>
        <SurfaceHeader title="Timing and handling" />
        <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
          <TextField
            name="sla_days"
            label="Turnaround for this check (working days)"
            type="number"
            min={1}
            max={90}
            value={schema.sla_days}
            onChange={(e) => onChange({ sla_days: Number(e.target.value) })}
            description="The check is due this many working days after the case arrives, or by the case deadline if sooner."
            errors={errors.sla_days}
          />
          <label className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05]">
            <span>
              <span className="block font-medium">Done on the ground</span>
              <span className="block text-xs text-muted-foreground">Address and police checks. Auto-assignment prefers officers who cover the candidate&apos;s district.</span>
            </span>
            <Switch checked={schema.location_bound} onCheckedChange={(v) => onChange({ location_bound: v })} />
          </label>
          <Field className="sm:col-span-2">
            <FieldLabel>Attach a document to the report unchanged</FieldLabel>
            <Select
              value={schema.fixed_annexure?.category ?? "__none"}
              onValueChange={(v) => onChange({ fixed_annexure: v === "__none" ? undefined : { category: v, untouched: true } })}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No fixed annexure</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Used for the Global Sanction report, which goes into the final report exactly as the screening platform produced it.</FieldDescription>
          </Field>
        </div>
      </Surface>
    </>
  );
}
