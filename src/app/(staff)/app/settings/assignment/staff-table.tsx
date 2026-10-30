"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addLeave, removeLeave, saveStaffSettings } from "./actions";
import type { LeaveRow, StaffLoadRow } from "@/lib/server/admin/settings";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISTRICTS, type District } from "@/domain/districts";
import { formatPlainDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/forms/date-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type CheckOption = { id: string; name: string; locationBound: boolean };

const roleLabel = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const canVerify = (s: StaffLoadRow) => s.permissions.includes("*") || s.permissions.includes("checks.verify");

export function StaffTable({ staff, leave, checkTypes }: { staff: StaffLoadRow[]; leave: LeaveRow[]; checkTypes: CheckOption[] }) {
  const [editing, setEditing] = useState<StaffLoadRow | null>(null);
  const leaveByUser = (id: string) => leave.filter((l) => l.userId === id);

  return (
    <Surface>
      <SurfaceHeader title="Team workload and settings" description="Live numbers from open cases. Set who gets work, how much, which checks and which districts." />
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={`${TH} pl-5`}>Person</TableHead>
            <TableHead className={TH}>Auto-assign</TableHead>
            <TableHead className={`${TH} text-right`}>Open cases</TableHead>
            <TableHead className={`${TH} text-right`}>Open checks</TableHead>
            <TableHead className={`${TH} hidden text-right md:table-cell`}>Overdue</TableHead>
            <TableHead className={`${TH} hidden text-right lg:table-cell`}>Done, 7 days</TableHead>
            <TableHead className={`${TH} hidden lg:table-cell`}>Covers</TableHead>
            <TableHead className="w-12 pr-5" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map((s) => {
            const verifies = canVerify(s);
            return (
              <TableRow key={s.userId}>
                <TableCell className="pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <PersonAvatar id={s.userId} name={s.name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {roleLabel(s.roleKey)}
                        {s.isNew ? " · new" : ""}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {!verifies ? (
                    <span className="text-xs text-muted-foreground">Can&apos;t verify</span>
                  ) : s.onLeave ? (
                    <ToneChip tone="warning">On leave</ToneChip>
                  ) : s.autoAssign ? (
                    <ToneChip tone="success">On</ToneChip>
                  ) : (
                    <ToneChip tone="neutral">Off</ToneChip>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.openCases}
                  <span className="text-muted-foreground">/{s.maxOpenCases}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.openChecks}
                  <span className="text-muted-foreground">/{s.maxOpenChecks}</span>
                </TableCell>
                <TableCell className={cn("hidden text-right tabular-nums md:table-cell", s.overdue > 0 && "font-medium text-destructive")}>{s.overdue}</TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{s.completed7d}</TableCell>
                <TableCell className="hidden max-w-48 lg:table-cell">
                  <p className="truncate text-xs text-muted-foreground">
                    {s.skills.length ? `${s.skills.length} ${s.skills.length === 1 ? "check" : "checks"}` : "Any check"} ·{" "}
                    {s.regions.length ? s.regions.slice(0, 3).join(", ") + (s.regions.length > 3 ? ` +${s.regions.length - 3}` : "") : "Anywhere"}
                  </p>
                </TableCell>
                <TableCell className="pr-5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Settings for ${s.name}`} onClick={() => setEditing(s)}>
                    <Settings2 />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing ? <StaffForm key={editing.userId} person={editing} checkTypes={checkTypes} leave={leaveByUser(editing.userId)} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Surface>
  );
}

function StaffForm({ person, checkTypes, leave, onDone }: { person: StaffLoadRow; checkTypes: CheckOption[]; leave: LeaveRow[]; onDone: () => void }) {
  const [autoAssign, setAutoAssign] = useState(person.autoAssign);
  const [maxCases, setMaxCases] = useState(String(person.maxOpenCases));
  const [maxChecks, setMaxChecks] = useState(String(person.maxOpenChecks));
  const [skills, setSkills] = useState<string[]>(person.skills);
  const [regions, setRegions] = useState<District[]>(person.regions as District[]);
  const [pending, start] = useTransition();
  const verifies = canVerify(person);

  const save = () =>
    start(async () => {
      const r = await saveStaffSettings(person.userId, { autoAssign, maxOpenCases: Number(maxCases), maxOpenChecks: Number(maxChecks), regions, skills });
      if (r.ok) {
        toast.success(`Saved for ${person.name}`);
        onDone();
      } else toast.error(r.error);
    });

  return (
    <div>
      <DialogHeader className="mb-5">
        <DialogTitle>{person.name}</DialogTitle>
        <DialogDescription>
          {roleLabel(person.roleKey)} · {person.openCases} open cases, {person.openChecks} open checks
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-6">
        <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm ring-1 ring-foreground/[0.05]">
          <span>
            <span className="block font-medium">Give this person work automatically</span>
            <span className="block text-xs text-muted-foreground">{verifies ? "New cases and checks can land on them." : "Their designation can't verify checks, so this has no effect."}</span>
          </span>
          <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="maxCases" label="Most open cases" type="number" min={0} max={1000} value={maxCases} onChange={(e) => setMaxCases(e.target.value)} />
          <TextField name="maxChecks" label="Most open checks" type="number" min={0} max={5000} value={maxChecks} onChange={(e) => setMaxChecks(e.target.value)} />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Checks they handle</legend>
          <p className="text-xs text-muted-foreground">Leave all unticked for “any check”.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {checkTypes.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ring-1 ring-foreground/[0.07]">
                <Checkbox checked={skills.includes(t.id)} onCheckedChange={(c) => setSkills(c === true ? [...skills, t.id] : skills.filter((x) => x !== t.id))} />
                {t.name}
                {t.locationBound ? <span className="ml-auto text-[11px] text-muted-foreground">field</span> : null}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Districts they cover for field checks</legend>
          <p className="text-xs text-muted-foreground">Leave all unticked for “anywhere”.</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {DISTRICTS.map((d) => (
              <label key={d} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox checked={regions.includes(d)} onCheckedChange={(c) => setRegions(c === true ? [...regions, d] : regions.filter((x) => x !== d))} />
                {d}
              </label>
            ))}
          </div>
        </fieldset>

        <LeaveEditor userId={person.userId} leave={leave} />
      </div>
      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <Spinner /> : null} Save
        </Button>
      </DialogFooter>
    </div>
  );
}

function LeaveEditor({ userId, leave }: { userId: string; leave: LeaveRow[] }) {
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [kind, setKind] = useState<"leave" | "training" | "other">("leave");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <fieldset className="space-y-2">
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        <CalendarOff className="size-4" /> Leave and time away
      </legend>
      <p className="text-xs text-muted-foreground">Nothing is assigned to them on these days. Changes here save at once.</p>
      {leave.length ? (
        <ul className="divide-y rounded-xl ring-1 ring-foreground/[0.08]">
          {leave.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {formatPlainDate(l.startsOn)} – {formatPlainDate(l.endsOn)} <span className="text-muted-foreground">· {l.kind}</span>
                {l.note ? <span className="text-muted-foreground"> · {l.note}</span> : null}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove"
                disabled={pending}
                onClick={() => setRemoving(l.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No leave booked.</p>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this leave?"
        description="They can be assigned work on these dates again."
        onConfirm={() =>
          removing &&
          start(async () => {
            const r = await removeLeave(removing);
            if (!r.ok) toast.error(r.error);
          })
        }
      />
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
        <DateField aria-label="From" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        <DateField aria-label="To" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="w-full" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="leave">Leave</SelectItem>
            <SelectItem value="training">Training</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !startsOn || !endsOn}
          onClick={() =>
            start(async () => {
              const r = await addLeave(userId, { startsOn, endsOn, kind, note });
              if (r.ok) {
                setStartsOn("");
                setEndsOn("");
                setNote("");
                toast.success("Leave added");
              } else toast.error(r.error);
            })
          }
        >
          {pending ? <Spinner /> : null} Add
        </Button>
        <Input className="sm:col-span-4" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </fieldset>
  );
}
