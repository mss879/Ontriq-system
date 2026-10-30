import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { one } from "@/components/admin/pagination";
import { Surface, TH } from "@/components/admin/surface";
import { DataTable, HEAD_ROW, ListCard, ROW, ROW_LINK } from "@/components/layout/data-table";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuoteStatusChip } from "@/components/quotes/quote-status";
import { getStaffViewer } from "@/lib/server/viewer";
import { canReadQuotes, listQuotes, quoteClientOptions } from "@/lib/server/quotes/queries";
import { formatDate, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { can } from "@/domain/permissions";
import { NewQuoteDialog } from "./new-quote-dialog";

export const metadata: Metadata = { title: "Quotes" };

const DESCRIPTION = "Quotations for clients: build them with a live preview, confirm, send, and see who accepted.";
const STATUS_OPTIONS = [
  { value: "draft", label: "Drafts" },
  { value: "confirmed", label: "Confirmed, not sent" },
  { value: "open", label: "Waiting for the client" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "superseded", label: "Replaced by a newer version" },
];

export default function QuotesPage({ searchParams }: PageProps<"/app/quotes">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Billing" title="Quotes" description={DESCRIPTION} />}>
        <Header />
      </Suspense>
      <Suspense fallback={null}>
        <ListFilters placeholder="Search by number, title or client" selects={[{ name: "status", label: "Status", allLabel: "All current", options: STATUS_OPTIONS }]} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <QuoteList searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header() {
  const viewer = await getStaffViewer();
  if (!canReadQuotes(viewer)) redirect("/app");
  const clients = can(viewer, "quotes.manage") ? await quoteClientOptions() : [];
  return <PageHeader eyebrow="Billing" title="Quotes" description={DESCRIPTION} actions={can(viewer, "quotes.manage") ? <NewQuoteDialog clients={clients} /> : null} />;
}

async function QuoteList({ searchParams }: Pick<PageProps<"/app/quotes">, "searchParams">) {
  const [viewer, params] = await Promise.all([getStaffViewer(), searchParams]);
  if (!canReadQuotes(viewer)) return null;
  const q = one(params.q);
  const status = one(params.status);
  const rows = await listQuotes({ q, status });

  if (!rows.length) {
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSignature />
            </EmptyMedia>
            <EmptyTitle>{q || status ? "No quotations match" : "No quotations yet"}</EmptyTitle>
            <EmptyDescription>{q || status ? "Try another search or status." : "Start one from New quotation, or from a client's page."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  const open = rows.filter((r) => r.status === "sent" || r.status === "viewed");
  return (
    <DataTable
      header={
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
          <p className="text-sm font-semibold">
            {rows.length} {rows.length === 1 ? "quotation" : "quotations"}
          </p>
          {open.length ? (
            <p className="text-xs text-muted-foreground">
              {open.length} waiting for the client · {formatMoney(open.reduce((a, r) => a + r.total, 0))}
            </p>
          ) : null}
        </div>
      }
      cards={rows.map((r) => (
        <ListCard
          key={r.id}
          href={`/app/quotes/${r.id}`}
          title={r.number ? `${r.number}${r.version > 1 ? ` v${r.version}` : ""}` : "Draft"}
          subtitle={r.client?.name}
          aside={<span className="font-medium tabular-nums">{formatMoney(r.total, r.currency)}</span>}
        >
          <QuoteStatusChip status={r.status} />
          <span className="text-xs text-muted-foreground">Valid until {formatPlainDate(r.valid_until)}</span>
        </ListCard>
      ))}
    >
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW}>
            <TableHead className={`${TH} pl-5`}>Quotation</TableHead>
            <TableHead className={`${TH} hidden md:table-cell`}>Client</TableHead>
            <TableHead className={TH}>Status</TableHead>
            <TableHead className={`${TH} text-right`}>Total</TableHead>
            <TableHead className={`${TH} hidden pr-5 text-right sm:table-cell`}>Valid until</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={`group ${ROW}`}>
              <TableCell className="max-w-72 pl-5">
                <Link href={`/app/quotes/${r.id}`} className={`block min-w-0 ${ROW_LINK}`}>
                  <span className="block truncate font-medium group-hover:underline">
                    {r.number ? `${r.number}${r.version > 1 ? ` v${r.version}` : ""}` : "Draft"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.title}
                    <span className="md:hidden"> · {r.client?.name}</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="hidden max-w-56 md:table-cell">
                <span className="block truncate text-sm">{r.client?.name}</span>
                <span className="block truncate text-xs text-muted-foreground">Updated {formatDate(r.updated_at)}</span>
              </TableCell>
              <TableCell>
                <QuoteStatusChip status={r.status} />
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(r.total, r.currency)}</TableCell>
              <TableCell className="hidden pr-5 text-right text-muted-foreground tabular-nums sm:table-cell">{formatPlainDate(r.valid_until)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}
