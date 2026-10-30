import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download, Plus, Upload } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { getStaffViewer } from "@/lib/server/viewer";
import { clientOptions, listCases, parseCaseFilters, stageCounts, staffOptions, PAGE_SIZE } from "@/lib/server/cases/queries";
import { savedViews } from "@/lib/server/cases/list-queries";
import { can } from "@/domain/permissions";
import { redirect } from "next/navigation";
import { CasesView } from "./cases-view";

export const metadata: Metadata = { title: "Cases" };

const DESCRIPTION = "Every verification request, from documents to the final report. Filter, save views and assign work in bulk.";

export default function CasesPage({ searchParams }: PageProps<"/app/cases">) {
  return (
    <Page className="max-w-7xl">
      <Suspense fallback={<PageHeader eyebrow="Workspace" title="Cases" description={DESCRIPTION} />}>
        <CasesHeader searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<CasesSkeleton />}>
        <CasesContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function CasesHeader({ searchParams }: Pick<PageProps<"/app/cases">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "cases.read") && !can(viewer, "cases.read_assigned")) redirect("/app");
  // The export uses the same filters as the list on screen.
  const exportQuery = new URLSearchParams();
  for (const key of ["q", "stage", "client", "assignee", "priority", "due"]) {
    const v = params[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) exportQuery.set(key, value);
  }
  return (
    <PageHeader
      eyebrow="Workspace"
      title="Cases"
      description={DESCRIPTION}
      actions={
        <>
          <Button asChild variant="outline" size="lg" className="h-9 px-3">
            <a href={`/api/exports/cases${exportQuery.size ? `?${exportQuery}` : ""}`} download>
              <Download /> Export CSV
            </a>
          </Button>
          {can(viewer, "cases.create") ? (
            <>
              <Button asChild variant="outline" size="lg" className="h-9 px-3">
                <Link href="/app/cases/import">
                  <Upload /> Import
                </Link>
              </Button>
              <Button asChild size="lg" className="h-9 px-3.5">
                <Link href="/app/cases/new">
                  <Plus /> New case
                </Link>
              </Button>
            </>
          ) : null}
        </>
      }
    />
  );
}

async function CasesContent({ searchParams }: Pick<PageProps<"/app/cases">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "cases.read") && !can(viewer, "cases.read_assigned")) return null;
  const filters = parseCaseFilters(params);
  const view = params.view === "board" ? "board" : "table";
  const [{ items, total }, staff, clients, views, counts] = await Promise.all([
    listCases(filters, viewer.userId, { limit: view === "board" ? 200 : PAGE_SIZE }),
    staffOptions(),
    clientOptions(),
    savedViews(viewer.userId),
    view === "board" ? stageCounts() : Promise.resolve({} as Record<string, number>),
  ]);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) query.set(key, v);
  }

  return (
    <>
      <RealtimeRefresh sources={[{ table: "cases" }]} />
      <CasesView
        view={view}
        query={query.toString()}
        filters={filters}
        items={items}
        total={total}
        pageSize={view === "board" ? 200 : PAGE_SIZE}
        stageCounts={counts}
        staff={staff.map(({ id, name, roleName }) => ({ id, name, roleName }))}
        clients={clients.map(({ id, name }) => ({ id, name }))}
        views={views}
        viewerId={viewer.userId}
        canAssign={can(viewer, "cases.assign")}
        canCreate={can(viewer, "cases.create")}
      />
    </>
  );
}

function CasesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex flex-wrap gap-2">
        {[220, 140, 140, 140, 120].map((w, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" style={{ width: w }} />
        ))}
      </div>
      <SectionSkeleton rows={8} />
    </div>
  );
}
