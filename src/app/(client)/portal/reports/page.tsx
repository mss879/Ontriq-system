import { Suspense } from "react";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PortalCaseList } from "@/components/portal/case-list";
import { getClientViewer } from "@/lib/server/viewer";
import { parsePortalFilters, portalCases } from "@/lib/server/portal/queries";
import { PortalCasesFilters } from "../cases/cases-filters";

export const metadata: Metadata = { title: "Reports" };

const DESCRIPTION = "Every verification Ontriq has completed and released for your company.";

export default function ReportsPage({ searchParams }: PageProps<"/portal/reports">) {
  return (
    <Page>
      <PageHeader eyebrow="Verifications" title="Reports" description={DESCRIPTION} />
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/portal/reports">, "searchParams">) {
  const [, sp] = await Promise.all([getClientViewer(), searchParams]);
  const filters = { ...parsePortalFilters(sp), status: "released" as const };
  const { rows, total } = await portalCases(filters);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  return (
    <div className="space-y-4">
      <PortalCasesFilters query={query} q={filters.q ?? ""} status="released" sort={filters.sort ?? "recent"} base="/portal/reports" tabs={false} />
      <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        {rows.length ? (
          <PortalCaseList rows={rows} />
        ) : (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>{filters.q ? "No reports match" : "No reports yet"}</EmptyTitle>
              <EmptyDescription>Reports appear here as soon as Ontriq approves and releases them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {total > rows.length ? <p className="text-sm text-muted-foreground">Showing the latest {rows.length} of {total}. Search to find older reports.</p> : null}
    </div>
  );
}
