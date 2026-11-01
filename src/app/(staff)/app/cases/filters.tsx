"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { KanbanSquare, Rows3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterChips, type FilterChip } from "@/components/admin/filter-chips";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_LABELS, STAGES, type Stage } from "@/domain/workflow/stages";
import type { CaseFilters } from "@/lib/server/cases/queries";
import { casesHref } from "./url";

const ALL = "__all";

type Option = { id: string; name: string };

const STAGE_GROUPS: Record<string, string> = { all: "All cases", on_hold: "On hold", closed: "Released or cancelled" };
const OWNER_WORDS: Record<string, string> = { me: "Mine", unassigned: "Unassigned" };
const DUE_WORDS: Record<string, string> = { overdue: "Overdue", this_week: "Due within 7 days" };

export function CasesFilters({
  query,
  filters,
  view,
  staff,
  clients,
  statuses,
}: {
  query: string;
  filters: CaseFilters;
  view: "table" | "board";
  staff: Option[];
  clients: Option[];
  /** Ontriq's wording for each status, their own included. */
  statuses: { key: string; label: string }[];
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

  const chips: FilterChip[] = [];
  const add = (key: string, label: string | undefined) => {
    if (label) chips.push({ key, label, href: casesHref(query, { [key]: null }) });
  };
  add("q", filters.q ? `“${filters.q}”` : undefined);
  add("stage", filters.stage && filters.stage !== "active" ? (STAGE_GROUPS[filters.stage] ?? STAGE_LABELS[filters.stage as Stage]) : undefined);
  add("status", filters.status ? (statuses.find((s) => s.key === filters.status)?.label ?? "Status") : undefined);
  add("client", filters.client ? (clients.find((c) => c.id === filters.client)?.name ?? "Client") : undefined);
  add("assignee", filters.assignee ? (OWNER_WORDS[filters.assignee] ?? staff.find((p) => p.id === filters.assignee)?.name ?? "Owner") : undefined);
  add("priority", filters.priority ? `${filters.priority.charAt(0).toUpperCase()}${filters.priority.slice(1)} priority` : undefined);
  add("due", filters.due ? DUE_WORDS[filters.due] : undefined);

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

        <Select value={filters.status ?? ALL} onValueChange={(v) => go({ status: v === ALL ? null : v })}>
          <SelectTrigger className="h-9 max-w-52 min-w-32 bg-card" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
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

      </div>

      <FilterChips chips={chips} clearHref={view === "board" ? "/app/cases?view=board" : "/app/cases"} />
    </div>
  );
}

function ViewToggle({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}
