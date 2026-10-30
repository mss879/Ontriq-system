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
import { ChecksProgress, PriorityBadge, ResultBadge, shownResult, StagePill, statusNote } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { DataTable, HEAD_ROW, ListCard, ROW, ROW_ACTION, ROW_LINK } from "@/components/layout/data-table";
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
    <DataTable
      header={canAssign && someChecked ? <BulkBar ids={items.filter((i) => selected.has(i.id)).map((i) => i.id)} staff={staff} onDone={() => setSelected(new Set())} /> : undefined}
      cards={items.map((c) => {
        const result = shownResult(c);
        return (
          <ListCard
            key={c.id}
            href={`/app/cases/${c.id}`}
            title={
              <>
                <span className="block font-mono text-xs font-semibold tracking-tight text-primary dark:text-brand-sky">{c.reference}</span>
                {c.candidateName}
              </>
            }
            subtitle={`${c.clientName} · ${c.packageName}`}
            aside={canAssign ? <Checkbox aria-label={`Select ${c.reference}`} checked={selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} /> : undefined}
          >
            <StagePill stage={c.stage} onHold={c.onHold} />
            <PriorityBadge priority={c.priority} />
            {result ? <ResultBadge result={result} /> : null}
            <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} done={c.stage === "released" || c.stage === "cancelled"} compact />
            <ChecksProgress done={c.checksDone} total={c.checksTotal} />
          </ListCard>
        );
      })}
    >
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW}>
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
            <TableHead className={cn(TH, "hidden min-[1400px]:table-cell")}>Client</TableHead>
            <TableHead className={TH}>Stage</TableHead>
            <TableHead className={TH}>Checks</TableHead>
            <TableHead className={cn(TH, "hidden min-[1400px]:table-cell")}>Result</TableHead>
            <TableHead className={cn(TH, "hidden lg:table-cell")}>Owner</TableHead>
            <TableHead className={cn(TH, "pr-5 min-[1700px]:pr-2")}>Due</TableHead>
            <TableHead className={cn(TH, "hidden pr-5 text-right min-[1700px]:table-cell")}>Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => {
            const isSelected = selected.has(c.id);
            const result = shownResult(c);
            const note = statusNote(c.statusKey);
            return (
              <TableRow key={c.id} data-state={isSelected ? "selected" : undefined} className={cn("group", ROW)}>
                {canAssign ? (
                  <TableCell className={cn("pl-5", ROW_ACTION)}>
                    <Checkbox aria-label={`Select ${c.reference}`} checked={isSelected} onCheckedChange={(v) => toggle(c.id, v === true)} />
                  </TableCell>
                ) : null}
                <TableCell className={cn("py-3", !canAssign && "pl-5")}>
                  <Link href={`/app/cases/${c.id}`} className={cn("block min-w-44", ROW_LINK)}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold tracking-tight text-primary group-hover:underline dark:text-brand-sky">{c.reference}</span>
                      <PriorityBadge priority={c.priority} className="h-5 px-2 text-[11px]" />
                    </span>
                    <span className="mt-0.5 block max-w-56 truncate text-sm font-medium">{c.candidateName}</span>
                    <span className="block max-w-56 truncate text-xs text-muted-foreground min-[1400px]:hidden">{c.clientName}</span>
                  </Link>
                </TableCell>
                <TableCell className="hidden max-w-48 min-[1400px]:table-cell">
                  <span className="block truncate text-sm">{c.clientName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.packageName}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StagePill stage={c.stage} onHold={c.onHold} />
                    {note ? <span className={cn("text-xs", c.statusKey === "returned_for_correction" ? "font-medium text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{note}</span> : null}
                    {result ? <ResultBadge result={result} className="min-[1400px]:hidden" /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <ChecksProgress done={c.checksDone} total={c.checksTotal} />
                </TableCell>
                <TableCell className="hidden min-[1400px]:table-cell">{result ? <ResultBadge result={result} /> : <span className="text-sm text-muted-foreground/60">—</span>}</TableCell>
                <TableCell className="hidden max-w-44 lg:table-cell">
                  <PersonChip person={c.assignee} />
                </TableCell>
                <TableCell className="pr-5 min-[1700px]:pr-2">
                  <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} done={c.stage === "released" || c.stage === "cancelled"} compact />
                </TableCell>
                <TableCell className="hidden pr-5 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums min-[1700px]:table-cell">{formatShortDate(c.receivedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTable>
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
