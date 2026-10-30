import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, ExternalLink, FileText } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { Surface, TH } from "@/components/admin/surface";
import { ResultBadge, ToneChip } from "@/components/cases/badges";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { ARCHIVE_LIMIT, getReportArchive, parseArchiveFilters } from "@/lib/server/reports/queries";
import { formatDate } from "@/lib/format";
import { can } from "@/domain/permissions";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/app/reports">) {
  return (
    <Page className="max-w-7xl">
      <PageHeader
        eyebrow="Workspace"
        title="Reports"
        description="Every final report released to a client. Versions replaced by a revision stay here, marked as replaced; nothing is overwritten."
      />
      <Suspense fallback={null}>
        <Filters />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <Archive searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Filters() {
  const viewer = await getStaffViewer();
  if (!can(viewer, "reports.preview")) redirect("/app");
  return (
    <ListFilters
      placeholder="Search reference, candidate or client"
      selects={[
        {
          name: "status",
          label: "Status",
          allLabel: "Released",
          options: [
            { value: "superseded", label: "Replaced by a revision" },
            { value: "all", label: "All versions" },
          ],
        },
      ]}
      dates={[
        { name: "from", label: "Released from" },
        { name: "to", label: "Released to" },
      ]}
    />
  );
}

async function Archive({ searchParams }: Pick<PageProps<"/app/reports">, "searchParams">) {
  const [viewer, sp] = await Promise.all([getStaffViewer(), searchParams]);
  if (!can(viewer, "reports.preview")) redirect("/app");
  const filters = parseArchiveFilters(sp);
  const { rows, total, capped } = await getReportArchive(filters);

  if (!rows.length) {
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>{filters.q || filters.from || filters.to ? "No reports match" : "No reports released yet"}</EmptyTitle>
            <EmptyDescription>Final reports appear here when they’re released to the client.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  return (
    <div className="space-y-3">
      <Surface className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TH}>Case</TableHead>
                <TableHead className={TH}>Client</TableHead>
                <TableHead className={TH}>Result</TableHead>
                <TableHead className={TH}>Released</TableHead>
                <TableHead className={TH}>Version</TableHead>
                <TableHead className={`${TH} text-right`}>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.versionId}>
                  <TableCell>
                    <Link href={`/app/cases/${r.caseId}#report`} className="font-mono text-[13px] font-semibold text-primary hover:underline dark:text-brand-sky">
                      {r.reference}
                    </Link>
                    <p className="text-sm">{r.candidateName}</p>
                  </TableCell>
                  <TableCell className="text-sm">{r.clientName}</TableCell>
                  <TableCell>{r.finalResult ? <ResultBadge result={r.finalResult} /> : "—"}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap tabular-nums">{formatDate(r.releasedAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm tabular-nums">v{r.version}</span>
                      {r.status === "superseded" ? <ToneChip tone="neutral">Replaced</ToneChip> : null}
                    </div>
                    {r.revisionReason ? <p className="max-w-56 truncate text-xs text-muted-foreground" title={r.revisionReason}>Revision: {r.revisionReason}</p> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${r.reference} version ${r.version}`}>
                        <a href={`/api/reports/${r.versionId}`} target="_blank" rel="noreferrer">
                          <ExternalLink />
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${r.reference} version ${r.version}`}>
                        <a href={`/api/reports/${r.versionId}?download=1`}>
                          <Download />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Surface>
      {total > rows.length || capped ? (
        <p className="text-sm text-muted-foreground">
          Showing the latest {Math.min(rows.length, ARCHIVE_LIMIT)} of {capped ? "many" : total}. Narrow the dates or search to find older reports.
        </p>
      ) : null}
    </div>
  );
}
