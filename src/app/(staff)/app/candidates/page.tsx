import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { one, pageParam, Pagination } from "@/components/admin/pagination";
import { Surface, TH } from "@/components/admin/surface";
import { PersonAvatar } from "@/components/cases/person";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffViewer } from "@/lib/server/viewer";
import { CANDIDATE_PAGE_SIZE, listCandidates } from "@/lib/server/admin/candidates";
import { formatDate } from "@/lib/format";
import { canAny } from "@/domain/permissions";

export const metadata: Metadata = { title: "Candidates" };

export default function CandidatesPage({ searchParams }: PageProps<"/app/candidates">) {
  return (
    <Page>
      <PageHeader
        eyebrow="Directory"
        title="Candidates"
        description="Everyone Ontriq has verified. People are matched by NIC, so an old and a new card number find the same person."
      />
      <Suspense fallback={null}>
        <ListFilters placeholder="Search by name, NIC or email" />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <CandidateList searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function CandidateList({ searchParams }: Pick<PageProps<"/app/candidates">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!canAny(viewer, ["cases.read", "candidates.manage", "cases.read_assigned"])) redirect("/app");
  const q = one(params.q);
  const page = pageParam(params.page);
  const { items, total } = await listCandidates({ q, page });

  if (!items.length) {
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRound />
            </EmptyMedia>
            <EmptyTitle>{q ? "Nobody matches" : "No candidates yet"}</EmptyTitle>
            <EmptyDescription>{q ? "Try a full NIC number or part of the name." : "Candidates appear here when their first case is created."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  return (
    <Surface>
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="text-sm font-semibold">
          {total} {total === 1 ? "candidate" : "candidates"}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={`${TH} pl-5`}>Candidate</TableHead>
            <TableHead className={TH}>NIC</TableHead>
            <TableHead className={`${TH} hidden md:table-cell`}>Contact</TableHead>
            <TableHead className={`${TH} text-right`}>Cases</TableHead>
            <TableHead className={`${TH} hidden pr-5 lg:table-cell`}>First seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => (
            <TableRow key={c.id} className="group">
              <TableCell className="pl-5">
                <Link href={`/app/candidates/${c.id}`} className="flex min-w-0 items-center gap-3">
                  <PersonAvatar id={c.id} name={c.fullName} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:underline">{c.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.district ?? ""}</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{c.nic ?? <span className="font-sans text-muted-foreground">Not given</span>}</TableCell>
              <TableCell className="hidden max-w-56 md:table-cell">
                <span className="block truncate text-sm">{c.email ?? "—"}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.phone ?? ""}</span>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{c.caseCount}</TableCell>
              <TableCell className="hidden pr-5 text-sm text-muted-foreground lg:table-cell">{formatDate(c.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={CANDIDATE_PAGE_SIZE} total={total} params={{ q }} basePath="/app/candidates" />
    </Surface>
  );
}
