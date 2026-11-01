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
import { FLOWCHART_ORDER, type WorkflowSettings } from "@/domain/workflow/settings";
import { saveDocumentCategory, saveOwnStatus, saveStatusLabels, saveWorkflowRules } from "./actions";

type StatusRow = { key: string; internal_label: string; client_label: string; candidate_label: string };
type OwnStatus = StatusRow & { is_active: boolean };
type Category = { id: string; key: string; name: string; guide: string; sensitive: boolean; in_report: boolean; is_active: boolean; needs_original: boolean };

/** Spec 6.2: "The exact statuses may be configured according to our workflow." */
export function StatusWording({ rows }: { rows: StatusRow[] }) {
  const [values, setValues] = useState(rows);
  const [pending, start] = useTransition();
  const dirty = values.some((v, i) => v.internal_label !== rows[i]?.internal_label || v.client_label !== rows[i]?.client_label || v.candidate_label !== rows[i]?.candidate_label);
  const set = (key: string, change: Partial<StatusRow>) => setValues((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <Surface>
      <SurfaceHeader title="Status wording" description="What your team, clients and candidates read for each status. The workflow decides when each one applies." />
      <div className="divide-y">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Your team sees</span>
          <span>Clients see</span>
          <span>Candidates see</span>
        </div>
        {values.map((r) => (
          <div key={r.key} className="grid gap-2 px-5 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3">
            <Input aria-label={`${r.internal_label}: what your team sees`} value={r.internal_label} maxLength={60} onChange={(e) => set(r.key, { internal_label: e.target.value })} />
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
              const r = await saveStatusLabels(values.map(({ key, internal_label, client_label, candidate_label }) => ({ key, internal_label, client_label, candidate_label })));
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

/** Statuses the workflow doesn't know about, for a person to set on a case. */
export function OwnStatuses({ rows }: { rows: OwnStatus[] }) {
  const [editing, setEditing] = useState<Partial<OwnStatus> | null>(null);
  return (
    <Surface>
      <SurfaceHeader
        title="Your own statuses"
        description="For a stage of your work the system doesn't track. Set one from the case page; it shows until the case moves on."
        aside={
          <Button variant="outline" size="sm" onClick={() => setEditing({ internal_label: "", client_label: "", candidate_label: "", is_active: true })}>
            <Plus /> New status
          </Button>
        }
      />
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((s) => (
            <li key={s.key} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {s.internal_label}
                  {!s.is_active ? <ToneChip tone="neutral">Turned off</ToneChip> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Clients see {s.client_label} · Candidates see {s.candidate_label}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.internal_label}`} onClick={() => setEditing(s)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">None yet.</p>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">{editing ? <OwnStatusForm key={editing.key ?? "new"} initial={editing} onDone={() => setEditing(null)} /> : null}</DialogContent>
      </Dialog>
    </Surface>
  );
}

function OwnStatusForm({ initial, onDone }: { initial: Partial<OwnStatus>; onDone: () => void }) {
  const [label, setLabel] = useState(initial.internal_label ?? "");
  const [client, setClient] = useState(initial.client_label ?? "");
  const [candidate, setCandidate] = useState(initial.candidate_label ?? "");
  const [active, setActive] = useState(initial.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveOwnStatus({ key: initial.key, internal_label: label, client_label: client, candidate_label: candidate, is_active: active });
          if (r.ok) {
            toast.success("Status saved");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>{initial.key ? "Edit status" : "New status"}</DialogTitle>
        <DialogDescription>Your team&apos;s name for it stays with your team. Say what clients read: it goes to them by email and in the portal.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="own-label">Your team sees</Label>
          <Input id="own-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Waiting for head office" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="own-client">Clients see</Label>
          <Input id="own-client" value={client} onChange={(e) => setClient(e.target.value)} maxLength={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="own-candidate">Candidates see</Label>
          <Input id="own-candidate" value={candidate} onChange={(e) => setCandidate(e.target.value)} maxLength={60} />
        </div>
        {initial.key ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">In use</span>
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
          {pending ? <Spinner /> : null} Save status
        </Button>
      </DialogFooter>
    </form>
  );
}

const ORDER_NAMES: Record<(typeof FLOWCHART_ORDER)[number], string> = {
  education: "Education",
  employment: "Employment",
  nic: "NIC / online ID",
  sanction: "Global sanctions",
  reference: "References",
  address: "Address",
  police: "Police clearance",
};

/** QC checklists, and whether checks must follow the flowchart's order. */
export function WorkflowRules({ rules }: { rules: WorkflowSettings }) {
  const [pre, setPre] = useState(rules.qcChecklists.pre.join("\n"));
  const [post, setPost] = useState(rules.qcChecklists.post.join("\n"));
  const [ordered, setOrdered] = useState(rules.enforceCheckOrder);
  const [pending, start] = useTransition();
  return (
    <Surface>
      <SurfaceHeader title="Reviews and order" description="What each QC reviewer confirms, and whether checks must run in the flowchart's order." />
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pre-items">Pre-QC checklist, one item per line</Label>
          <Textarea id="pre-items" rows={6} value={pre} onChange={(e) => setPre(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="post-items">Post-QC checklist, one item per line</Label>
          <Textarea id="post-items" rows={6} value={post} onChange={(e) => setPost(e.target.value)} />
        </div>
        <label className="flex items-start justify-between gap-3 md:col-span-2">
          <span>
            <span className="block text-sm font-medium">Run checks in the flowchart&rsquo;s order</span>
            <span className="block text-xs text-muted-foreground">
              A check can&rsquo;t finish until the ones before it have: {FLOWCHART_ORDER.map((k) => ORDER_NAMES[k]).join(", ")}. Off lets officers work on any check at any time.
            </span>
          </span>
          <Switch checked={ordered} onCheckedChange={setOrdered} aria-label="Run checks in the flowchart's order" />
        </label>
      </div>
      <div className="flex items-center justify-end border-t px-5 py-3">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveWorkflowRules({ pre, post, enforceCheckOrder: ordered });
              if (r.ok) toast.success("Saved");
              else toast.error(r.error);
            })
          }
        >
          {pending ? <Spinner /> : null} Save
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
          <Button variant="outline" size="sm" onClick={() => setEditing({ name: "", guide: "", sensitive: false, in_report: true, is_active: true, needs_original: false })}>
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
                {c.needs_original ? <ToneChip tone="neutral" dot={false}>Original needed</ToneChip> : null}
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
  const [needsOriginal, setNeedsOriginal] = useState(initial.needs_original ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDocumentCategory({ id: initial.id, name, guide, sensitive, in_report: inReport, is_active: active, needs_original: needsOriginal });
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
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block font-medium">Needs an original or certified copy</span>
            <span className="block text-xs text-muted-foreground">Pre-QC can&rsquo;t approve a plain copy of this type without saying why.</span>
          </span>
          <Switch checked={needsOriginal} onCheckedChange={setNeedsOriginal} />
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
