"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KanbanSquare, Rows3, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_LABELS, STAGES } from "@/domain/workflow/stages";
import type { CaseFilters } from "@/lib/server/cases/queries";
import { casesHref, hasFilters } from "./url";

const ALL = "__all";

type Option = { id: string; name: string };

export function CasesFilters({
  query,
  filters,
  view,
  staff,
  clients,
}: {
  query: string;
  filters: CaseFilters;
  view: "table" | "board";
  staff: Option[];
  clients: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const urlQ = filters.q ?? "";
  const [q, setQ] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  // The URL changed elsewhere (a saved view, Clear): follow it unless the person has typed since.
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ);
    if (q.trim() === syncedQ.trim()) setQ(urlQ);
  }

  const go = (changes: Record<string, string | null>) => start(() => router.push(casesHref(query, changes)));

  // Debounced search: the URL stays the source of truth.
  useEffect(() => {
    const value = q.trim();
    if (value === urlQ) return;
    const timer = setTimeout(() => start(() => router.push(casesHref(query, { q: value || null }))), 350);
    return () => clearTimeout(timer);
  }, [q, urlQ, query, router]);

  const stageValue = filters.stage ?? "active";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Reference, candidate or client ref"
            aria-label="Search cases"
            className="h-9 bg-card pl-8"
          />
          {pending ? <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" /> : null}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 ml-auto shrink-0" role="group" aria-label="View">
          <ViewToggle href={casesHref(query, { view: null }, { keepPage: true })} active={view === "table"} icon={<Rows3 className="size-4" />} label="Table" />
          <ViewToggle href={casesHref(query, { view: "board", page: null })} active={view === "board"} icon={<KanbanSquare className="size-4" />} label="Board" />
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select value={stageValue} onValueChange={(v) => go({ stage: v === "active" ? null : v })}>
          <SelectTrigger className="h-9 min-w-36 bg-card" aria-label="Stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="active">Active cases</SelectItem>
              <SelectItem value="all">All cases</SelectItem>
              <SelectItem value="on_hold">On hold</SelectItem>
              <SelectItem value="closed">Released or cancelled</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Stage</SelectLabel>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={filters.client ?? ALL} onValueChange={(v) => go({ client: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 max-w-48 min-w-32 bg-card" aria-label="Client">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.assignee ?? ALL} onValueChange={(v) => go({ assignee: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 max-w-48 min-w-32 bg-card" aria-label="Owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any owner</SelectItem>
            <SelectItem value="me">Mine</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectSeparator />
            {staff.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.priority ?? ALL} onValueChange={(v) => go({ priority: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 min-w-28 bg-card" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.due ?? ALL} onValueChange={(v) => go({ due: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 min-w-28 bg-card" aria-label="Due">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any due date</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="this_week">Due within 7 days</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters(query) ? (
          <Link
            href={view === "board" ? "/app/cases?view=board" : "/app/cases"}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" /> Clear
          </Link>
        ) : null}
      </div>

    </div>
  );
}

function ViewToggle({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        active ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}
