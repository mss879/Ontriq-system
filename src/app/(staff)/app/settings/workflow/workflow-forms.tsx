"use client";

import { useState, useTransition } from "react";
import { Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveDocumentCategory, saveStatusLabels } from "./actions";

type StatusRow = { key: string; internal_label: string; client_label: string; candidate_label: string };
type Category = { id: string; key: string; name: string; guide: string; sensitive: boolean; in_report: boolean; is_active: boolean };

/** Spec 6.2: "The exact statuses may be configured according to our workflow." */
export function StatusWording({ rows }: { rows: StatusRow[] }) {
  const [values, setValues] = useState(rows);
  const [pending, start] = useTransition();
  const dirty = values.some((v, i) => v.client_label !== rows[i]?.client_label || v.candidate_label !== rows[i]?.candidate_label);
  const set = (key: string, change: Partial<StatusRow>) => setValues((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <Surface>
      <SurfaceHeader title="Status wording" description="What clients and candidates read for each status. Your team always sees the name on the left." />
      <div className="divide-y">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Status</span>
          <span>Clients see</span>
          <span>Candidates see</span>
        </div>
        {values.map((r) => (
          <div key={r.key} className="grid gap-2 px-5 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3">
            <p className="text-sm font-medium">{r.internal_label}</p>
            <Input aria-label={`${r.internal_label}: what clients see`} value={r.client_label} maxLength={60} onChange={(e) => set(r.key, { client_label: e.target.value })} />
            <Input aria-label={`${r.internal_label}: what candidates see`} value={r.candidate_label} maxLength={60} onChange={(e) => set(r.key, { candidate_label: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end border-t px-5 py-3">
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await saveStatusLabels(values.map(({ key, client_label, candidate_label }) => ({ key, client_label, candidate_label })));
              if (r.ok) toast.success("Status wording saved");
              else toast.error(r.error);
            })
          }
        >
          {pending ? <Spinner /> : null} Save wording
        </Button>
      </div>
    </Surface>
  );
}

export function DocumentTypes({ rows }: { rows: Category[] }) {
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  return (
    <Surface>
      <SurfaceHeader
        title="Document types"
        description="The kinds of document a check can ask for. New types appear under each check type's documents."
        aside={
          <Button variant="outline" size="sm" onClick={() => setEditing({ name: "", guide: "", sensitive: false, in_report: true, is_active: true })}>
            <Plus /> New type
          </Button>
        }
      />
      <ul className="divide-y">
        {rows.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {c.name}
                {c.sensitive ? <Lock className="size-3 text-muted-foreground" aria-label="Sensitive evidence" /> : null}
                {c.in_report ? <ToneChip tone="info" dot={false}>In the report</ToneChip> : null}
                {!c.is_active ? <ToneChip tone="neutral">Turned off</ToneChip> : null}
              </p>
              {c.guide ? <p className="text-xs text-muted-foreground">{c.guide}</p> : null}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
              <Pencil />
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">{editing ? <CategoryForm key={editing.id ?? "new"} initial={editing} onDone={() => setEditing(null)} /> : null}</DialogContent>
      </Dialog>
    </Surface>
  );
}

function CategoryForm({ initial, onDone }: { initial: Partial<Category>; onDone: () => void }) {
  const [name, setName] = useState(initial.name ?? "");
  const [guide, setGuide] = useState(initial.guide ?? "");
  const [sensitive, setSensitive] = useState(initial.sensitive ?? false);
  const [inReport, setInReport] = useState(initial.in_report ?? false);
  const [active, setActive] = useState(initial.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDocumentCategory({ id: initial.id, name, guide, sensitive, in_report: inReport, is_active: active });
          if (r.ok) {
            toast.success("Document type saved");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>{initial.id ? "Edit document type" : "New document type"}</DialogTitle>
        <DialogDescription>Clients and candidates read the guidance when they upload.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-guide">Guidance</Label>
          <Textarea id="cat-guide" rows={3} value={guide} onChange={(e) => setGuide(e.target.value)} maxLength={400} />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block font-medium">Sensitive evidence</span>
            <span className="block text-xs text-muted-foreground">Only staff with &ldquo;View sensitive evidence&rdquo; can open these files.</span>
          </span>
          <Switch checked={sensitive} onCheckedChange={setSensitive} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block font-medium">Goes in the report</span>
            <span className="block text-xs text-muted-foreground">New files of this type are annexed to the final report unless someone sets them to Internal only.</span>
          </span>
          <Switch checked={inReport} onCheckedChange={setInReport} />
        </label>
        {initial.id ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">In use</span>
              <span className="block text-xs text-muted-foreground">Turning it off hides it from new uploads and requests. Existing files stay.</span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Save
        </Button>
      </DialogFooter>
    </form>
  );
}
