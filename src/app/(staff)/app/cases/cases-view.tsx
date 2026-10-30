"use client";

import Link from "next/link";
import { FolderSearch, FolderPlus } from "lucide-react";
import { Pagination } from "@/components/admin/pagination";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { CaseFilters, CaseListItem } from "@/lib/server/cases/queries";
import type { SavedView } from "@/lib/server/cases/list-queries";
import { CasesFilters } from "./filters";
import { SavedViews } from "./saved-views";
import { CasesTable, type StaffPick } from "./cases-table";
import { CasesBoard } from "./board";
import { hasFilters } from "./url";

export function CasesView({
  view,
  query,
  filters,
  items,
  total,
  pageSize,
  stageCounts,
  staff,
  clients,
  views,
  canAssign,
  canCreate,
}: {
  view: "table" | "board";
  query: string;
  filters: CaseFilters;
  items: CaseListItem[];
  total: number;
  pageSize: number;
  stageCounts: Record<string, number>;
  staff: StaffPick[];
  clients: { id: string; name: string }[];
  views: SavedView[];
  viewerId: string;
  canAssign: boolean;
  canCreate: boolean;
}) {
  const filtered = hasFilters(query);
  const page = filters.page ?? 1;

  return (
    <div className="space-y-4">
      <CasesFilters query={query} filters={filters} view={view} staff={staff} clients={clients} />
      <SavedViews views={views} query={query} view={view} />

      {items.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed bg-card/60 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">{filtered ? <FolderSearch /> : <FolderPlus />}</EmptyMedia>
            <EmptyTitle>{filtered ? "No cases match these filters" : "No cases yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try a different stage or owner, or clear the filters to see every active case."
                : "New verification requests appear here the moment they're created, already assigned to the freest qualified officer."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button asChild variant="outline">
                <Link href={view === "board" ? "/app/cases?view=board" : "/app/cases"}>Clear filters</Link>
              </Button>
            ) : canCreate ? (
              <Button asChild>
                <Link href="/app/cases/new">Create the first case</Link>
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      ) : view === "board" ? (
        <CasesBoard items={items} counts={stageCounts} query={query} />
      ) : (
        <>
          <CasesTable items={items} staff={staff} canAssign={canAssign} />
          {total > pageSize ? (
            <Pagination page={page} pageSize={pageSize} total={total} params={Object.fromEntries(new URLSearchParams(query))} basePath="/app/cases" />
          ) : (
            <p className="text-sm text-muted-foreground tabular-nums">
              {total} {total === 1 ? "case" : "cases"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
