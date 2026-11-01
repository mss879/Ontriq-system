import { Suspense } from "react";
import Link from "@/components/link";
import type { Metadata } from "next";
import { FilePlus2, SearchX } from "lucide-react";
import { Pagination } from "@/components/admin/pagination";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PortalCaseList } from "@/components/portal/case-list";
import { getClientViewer } from "@/lib/server/viewer";
import { parsePortalFilters, portalCases, PORTAL_PAGE_SIZE } from "@/lib/server/portal/queries";
import { can } from "@/domain/permissions";
import { PortalCasesFilters } from "./cases-filters";

export const metadata: Metadata = { title: "Cases" };

const DESCRIPTION = "Every verification request from your company, with live progress and what Ontriq needs from you.";

export default function PortalCasesPage({ searchParams }: PageProps<"/portal/cases">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Verifications" title="Cases" description={DESCRIPTION} />}>
        <Header />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <CasesContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header() {
  const viewer = await getClientViewer();
  return (
    <PageHeader
      eyebrow="Verifications"
      title="Cases"
      description={DESCRIPTION}
      actions={
        can(viewer, "portal.cases.create") ? (
          <Button asChild size="lg" className="h-9 px-3.5">
            <Link href="/portal/cases/new">
              <FilePlus2 /> New request
            </Link>
          </Button>
        ) : null
      }
    />
  );
}

async function CasesContent({ searchParams }: Pick<PageProps<"/portal/cases">, "searchParams">) {
  const sp = await searchParams;
  const filters = parsePortalFilters(sp);
  const { total, rows } = await portalCases(filters);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const page = filters.page ?? 1;

  return (
    <div className="space-y-4">
      <PortalCasesFilters query={query} q={filters.q ?? ""} status={filters.status ?? "all"} sort={filters.sort ?? "recent"} />
      <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_9rem_6.5rem_1rem] gap-x-4 border-b bg-muted/40 px-5 py-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase md:grid">
          <span>Candidate</span>
          <span>Status</span>
          <span>Checks</span>
          <span>Deadline</span>
          <span />
        </div>
        {rows.length ? (
          <PortalCaseList rows={rows} />
        ) : (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>{filters.q || filters.status !== "all" ? "No cases match" : "No cases yet"}</EmptyTitle>
              <EmptyDescription>
                {filters.q || filters.status !== "all" ? "Try another search or status." : "Requests you send to Ontriq appear here with their progress."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {total > PORTAL_PAGE_SIZE ? (
        <Pagination page={page} pageSize={PORTAL_PAGE_SIZE} total={total} params={Object.fromEntries(new URLSearchParams(query))} basePath="/portal/cases" />
      ) : total > 0 ? (
        <p className="text-sm text-muted-foreground tabular-nums">
          {total} {total === 1 ? "case" : "cases"}
        </p>
      ) : null}
    </div>
  );
}
