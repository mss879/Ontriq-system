"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Inbox, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChecksProgress, PriorityBadge, ResultBadge, StagePill, statusLabel } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { formatShortDate } from "@/lib/format";
import type { CaseListItem } from "@/lib/server/cases/queries";
import { assignCases } from "./actions";

const TH = "h-9 text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase";
const QUEUE = "__queue";

export type StaffPick = { id: string; name: string; roleName: string };

export function CasesTable({ items, staff, canAssign }: { items: CaseListItem[]; staff: StaffPick[]; canAssign: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));
  const someChecked = items.some((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      {canAssign && someChecked ? (
        <BulkBar ids={items.filter((i) => selected.has(i.id)).map((i) => i.id)} staff={staff} onDone={() => setSelected(new Set())} />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {canAssign ? (
              <TableHead className="w-10 pl-5">
                <Checkbox
                  aria-label="Select all cases on this page"
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((i) => i.id)) : new Set())}
                />
              </TableHead>
            ) : null}
            <TableHead className={cn(TH, !canAssign && "pl-5")}>Case</TableHead>
            <TableHead className={TH}>Client</TableHead>
            <TableHead className={TH}>Stage</TableHead>
            <TableHead className={TH}>Checks</TableHead>
            <TableHead className={TH}>Result</TableHead>
            <TableHead className={TH}>Owner</TableHead>
            <TableHead className={TH}>Due</TableHead>
            <TableHead className={cn(TH, "pr-5 text-right")}>Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <TableRow key={c.id} data-state={isSelected ? "selected" : undefined} className="group">
                {canAssign ? (
                  <TableCell className="pl-5">
                    <Checkbox aria-label={`Select ${c.reference}`} checked={isSelected} onCheckedChange={(v) => toggle(c.id, v === true)} />
                  </TableCell>
                ) : null}
                <TableCell className={cn("py-3", !canAssign && "pl-5")}>
                  <Link href={`/app/cases/${c.id}`} className="block min-w-44 outline-none">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold tracking-tight text-primary group-hover:underline dark:text-brand-sky">{c.reference}</span>
                      <PriorityBadge priority={c.priority} className="h-5 px-2 text-[11px]" />
                    </span>
                    <span className="mt-0.5 block max-w-56 truncate text-sm font-medium">{c.candidateName}</span>
                  </Link>
                </TableCell>
                <TableCell className="max-w-48">
                  <span className="block truncate text-sm">{c.clientName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.packageName}</span>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-36 flex-col items-start gap-1">
                    <StagePill stage={c.stage} onHold={c.onHold} />
                    <span className="text-xs text-muted-foreground">{statusLabel(c.statusKey)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <ChecksProgress done={c.checksDone} total={c.checksTotal} />
                </TableCell>
                <TableCell>
                  <ResultBadge result={c.proposedResult} />
                </TableCell>
                <TableCell className="max-w-44">
                  <PersonChip person={c.assignee} />
                </TableCell>
                <TableCell>
                  <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} done={c.stage === "released" || c.stage === "cancelled"} compact />
                </TableCell>
                <TableCell className="pr-5 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums">{formatShortDate(c.receivedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function BulkBar({ ids, staff, onDone }: { ids: string[]; staff: StaffPick[]; onDone: () => void }) {
  const [target, setTarget] = useState<string>("");
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const userId = target === QUEUE ? null : target;
      const r = await assignCases(ids, userId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const who = userId ? (staff.find((s) => s.id === userId)?.name ?? "them") : "the manager queue";
      toast.success(`${r.assigned} ${r.assigned === 1 ? "case" : "cases"} moved to ${who}`, r.failed ? { description: `${r.failed} could not be changed: ${r.error}` } : undefined);
      setTarget("");
      onDone();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-primary/[0.04] px-5 py-2.5 dark:bg-brand-sky/[0.06]">
      <span className="text-sm font-medium">
        {ids.length} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-8 min-w-48 bg-card" aria-label="Assign to">
            <SelectValue placeholder="Assign to…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={QUEUE}>
              <Inbox className="size-4 text-muted-foreground" /> Manager queue (unassign)
            </SelectItem>
            <SelectSeparator />
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                <span className="text-xs text-muted-foreground">{s.roleName}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8" disabled={!target || pending} onClick={run}>
          {pending ? <Spinner /> : <UserCheck />} Assign
        </Button>
        <Button size="icon-sm" variant="ghost" className="size-8" aria-label="Clear selection" onClick={onDone}>
          <X />
        </Button>
      </div>
    </div>
  );
}
