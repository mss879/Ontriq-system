"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChecksProgress, PriorityBadge, stageColor, statusNote, ToneChip } from "@/components/cases/badges";
import { PersonAvatar } from "@/components/cases/person";
import { SlaBadge } from "@/components/cases/sla-badge";
import { ACTIVE_STAGES, STAGE_SHORT, stageStep, type Stage } from "@/domain/workflow/stages";
import type { CaseListItem } from "@/lib/server/cases/queries";
import { casesHref } from "./url";

/** Active cases in stage columns. Cards open the case; moves happen on the case page, where the rules are shown. */
export function CasesBoard({ items, counts, query }: { items: CaseListItem[]; counts: Record<string, number>; query: string }) {
  const params = new URLSearchParams(query);
  const stageFilter = params.get("stage");
  const columns: Stage[] =
    stageFilter && (ACTIVE_STAGES as string[]).includes(stageFilter) ? [stageFilter as Stage] : ACTIVE_STAGES;
  const byStage = new Map<Stage, CaseListItem[]>(columns.map((s) => [s, []]));
  for (const item of items) byStage.get(item.stage)?.push(item);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-3">
        {columns.map((stage) => {
          const list = byStage.get(stage) ?? [];
          const total = counts[stage] ?? list.length;
          return (
            <section key={stage} aria-label={STAGE_SHORT[stage]} className="flex w-[17rem] shrink-0 flex-col overflow-hidden rounded-2xl bg-muted/50 ring-1 ring-foreground/[0.05]">
              <div aria-hidden className="h-1" style={{ background: stageColor(stage) }} />
              <header className="flex items-center justify-between px-3.5 pt-2.5 pb-2">
                <Link href={casesHref(query, { stage, view: null })} className="inline-flex items-center gap-2 text-sm font-semibold hover:underline">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{stageStep(stage)}</span>
                  {STAGE_SHORT[stage]}
                </Link>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums ring-1 ring-foreground/[0.06]">{total}</span>
              </header>
              <ol className="flex max-h-[calc(100svh-18rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {list.length === 0 ? (
                  <li className="rounded-xl px-3 py-6 text-center text-xs text-muted-foreground">Nothing at this stage</li>
                ) : (
                  list.map((c) => (
                    <li key={c.id}>
                      <BoardCard item={c} />
                    </li>
                  ))
                )}
                {total > list.length && list.length > 0 ? (
                  <li className="px-2 py-1 text-center text-xs text-muted-foreground">
                    Showing {list.length} of {total}
                  </li>
                ) : null}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ item: c }: { item: CaseListItem }) {
  return (
    <Link
      href={`/app/cases/${c.id}`}
      className={cn(
        "block rounded-xl bg-card p-3 shadow-soft ring-1 ring-foreground/[0.07] transition hover:-translate-y-px hover:shadow-lift",
        c.onHold && "ring-warning/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-primary dark:text-brand-sky">{c.reference}</span>
        {c.assignee ? <PersonAvatar id={c.assignee.id} name={c.assignee.name} size="sm" /> : <span className="text-[11px] text-muted-foreground">Unassigned</span>}
      </div>
      <p className="mt-1.5 truncate text-sm font-medium">{c.candidateName}</p>
      <p className="truncate text-xs text-muted-foreground">{c.clientName}</p>
      {statusNote(c.statusKey, c.statusLabel) ? <p className="mt-1 truncate text-xs text-muted-foreground">{c.statusLabel}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {c.onHold ? (
          <ToneChip tone="warning" dot={false} className="h-5 px-2 text-[11px]">
            On hold
          </ToneChip>
        ) : null}
        <PriorityBadge priority={c.priority} className="h-5 px-2 text-[11px]" />
        <SlaBadge dueAt={c.dueAt} startedAt={c.receivedAt} compact className="h-5 text-[11px]" />
      </div>
      <ChecksProgress done={c.checksDone} total={c.checksTotal} className="mt-2.5" />
    </Link>
  );
}
