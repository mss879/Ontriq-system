import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ResultBadge } from "@/components/cases/badges";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getClientViewer } from "@/lib/server/viewer";
import { parsePortalFilters, portalCases, PORTAL_PAGE_SIZE } from "@/lib/server/portal/queries";
import { Pagination } from "@/components/admin/pagination";
import { getPortalReport } from "@/lib/server/reports/queries";
import { formatDate } from "@/lib/format";
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
  const files = await Promise.all(rows.map((r) => getPortalReport(r.id)));
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  return (
    <div className="space-y-4">
      <PortalCasesFilters query={query} q={filters.q ?? ""} status="released" sort={filters.sort ?? "recent"} base="/portal/reports" tabs={false} />
      <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]">
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((r, i) => {
              const file = files[i];
              return (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/portal/cases/${r.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline dark:text-brand-sky">
                        {r.reference}
                      </Link>
                      <span className="truncate text-sm font-medium">{r.candidate_name}</span>
                      {r.final_result ? <ResultBadge result={r.final_result} /> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[r.position_title, r.client_reference ? `Your ref. ${r.client_reference}` : null, `Released ${formatDate(file?.releasedAt ?? r.released_at)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {file?.fileRemoved ? (
                    <span className="text-xs text-muted-foreground">Removed under the retention policy</span>
                  ) : file ? (
                    <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/reports/${file.versionId}?download=1`} aria-label={`Download the report for ${r.reference}`}>
                          <Download /> Download
                        </a>
                      </Button>
                      {Array.from({ length: file.extraParts }, (_, n) => (
                        <Button key={n} asChild size="sm" variant="ghost">
                          <a href={`/api/reports/${file.versionId}?download=1&part=${n + 2}`} aria-label={`Download part ${n + 2} of the report for ${r.reference}`}>
                            Part {n + 2}
                          </a>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Ask Ontriq for a copy</span>
                  )}
                </li>
              );
            })}
          </ul>
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
      {total > PORTAL_PAGE_SIZE ? <Pagination page={filters.page ?? 1} pageSize={PORTAL_PAGE_SIZE} total={total} params={Object.fromEntries(new URLSearchParams(query))} basePath="/portal/reports" /> : null}
    </div>
  );
}
