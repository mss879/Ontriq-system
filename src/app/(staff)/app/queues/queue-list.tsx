"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Inbox, RotateCw, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CheckStatePill, ChecksProgress, PriorityBadge, ResultBadge, StagePill, statusLabel } from "@/components/cases/badges";
import { PersonChip } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { formatShortDate } from "@/lib/format";
import type { CaseListItem } from "@/lib/server/cases/queries";
import type { MyCheck } from "@/lib/server/cases/list-queries";
import { assignCases, autoAssignAgain } from "../cases/actions";

type StaffPick = { id: string; name: string; roleName: string };

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-5 py-8 text-sm text-muted-foreground">
      <Inbox className="size-5 shrink-0" />
      {text}
    </div>
  );
}

/** Compact case rows: everything needed to pick the next thing to do. */
export function QueueList({ items, empty, assign }: { items: CaseListItem[]; empty: string; assign?: { staff: StaffPick[] } }) {
  if (!items.length) return <EmptyRow text={empty} />;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      {items.map((c) => (
        <li key={c.id} className={cn("flex flex-col gap-3 px-5 py-3.5", assign ? "xl:flex-row xl:items-center xl:gap-5" : "md:flex-row md:items-center md:gap-5")}>
          <Link href={`/app/cases/${c.id}`} className="group min-w-0 flex-1 md:min-w-56">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-primary group-hover:underline dark:text-brand-sky">{c.reference}</span>
              <PriorityBadge priority={c.priority} className="h-5 px-2 text-[11px]" />
              <span className="truncate text-sm font-medium">{c.candidateName}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {c.clientName} · {c.packageName} · received {formatShortDate(c.receivedAt)}
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <StagePill stage={c.stage} onHold={c.onHold} />
            <span className="hidden text-xs text-muted-foreground lg:inline">{statusLabel(c.statusKey)}</span>
            <ChecksProgress done={c.checksDone} total={c.checksTotal} />
            <ResultBadge result={c.proposedResult} />
            <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} compact />
            {assign ? <AssignControl caseId={c.id} staff={assign.staff} /> : <PersonChip person={c.assignee} className="max-w-40" />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AssignControl({ caseId, staff }: { caseId: string; staff: StaffPick[] }) {
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();
  const [retrying, startRetry] = useTransition();
  return (
    <div className="flex items-center gap-1.5">
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger className="h-8 w-44" aria-label="Assign to">
          <SelectValue placeholder="Assign to…" />
        </SelectTrigger>
        <SelectContent>
          {staff.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="h-8"
        disabled={!target || pending}
        onClick={() =>
          start(async () => {
            const r = await assignCases([caseId], target);
            if (r.ok) toast.success(`Assigned to ${staff.find((s) => s.id === target)?.name ?? "them"}`);
            else toast.error(r.error);
          })
        }
      >
        {pending ? <Spinner /> : <UserCheck />} Assign
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-8"
        title="Try auto-assign again"
        aria-label="Try auto-assign again"
        disabled={retrying}
        onClick={() =>
          startRetry(async () => {
            const r = await autoAssignAgain(caseId);
            if (r.ok) toast.success("Auto-assignment is running", { description: "If nobody qualified has capacity, the case stays here." });
            else toast.error(r.error);
          })
        }
      >
        {retrying ? <Spinner /> : <RotateCw />}
      </Button>
    </div>
  );
}

export function MyChecks({ checks, empty }: { checks: MyCheck[]; empty: string }) {
  if (!checks.length) return <EmptyRow text={empty} />;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
      {checks.map((k) => (
        <li key={k.id}>
          <Link href={`/app/cases/${k.caseId}/checks/${k.id}`} className="group flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:gap-5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                <span className="font-mono">{k.caseReference}</span> · {k.candidateName}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <StagePill stage={k.caseStage} />
              <CheckStatePill state={k.state} />
              <SlaBadge dueAt={k.dueAt} startedAt={k.receivedAt} compact />
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
