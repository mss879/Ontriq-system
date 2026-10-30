import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Download, FileClock, Receipt, Wallet } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { ListFilters } from "@/components/admin/list-filters";
import { Pagination, one } from "@/components/admin/pagination";
import { Surface, TH } from "@/components/admin/surface";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceStatusChip } from "@/components/billing/invoice-status";
import { getStaffViewer } from "@/lib/server/viewer";
import { billingClients, INVOICE_PAGE_SIZE, invoiceHeadline, listInvoices } from "@/lib/server/billing/queries";
import { formatPlainDate } from "@/lib/format";
import { formatAmount, formatMoney } from "@/domain/pricing/money";
import { can, canAny } from "@/domain/permissions";
import { NewInvoiceDialog } from "./new-invoice-dialog";

export const metadata: Metadata = { title: "Invoices" };

const READ = ["invoices.manage", "invoices.send", "billing.export"] as const;
const STATUS_OPTIONS = [
  { value: "draft", label: "Drafts" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "partially_paid", label: "Part paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

export default function InvoicesPage({ searchParams }: PageProps<"/app/invoices">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader eyebrow="Billing" title="Invoices" description="Drafts to confirm, invoices out with clients, and what is owed." />}>
        <Header />
      </Suspense>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-muted" />}>
        <Totals />
      </Suspense>
      <Suspense fallback={null}>
        <Filters />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <InvoiceList searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, READ)) redirect("/app");
  const clients = can(viewer, "invoices.manage") ? await billingClients() : [];
  return (
    <PageHeader
      eyebrow="Billing"
      title="Invoices"
      description="Invoices are drafted when a report is released (or monthly for clients billed that way). Check the draft, confirm it, then send it to the client's portal."
      actions={
        <>
          {can(viewer, "billing.export") ? (
            <Button asChild variant="outline">
              <a href="/api/exports/invoices">
                <Download /> Export CSV
              </a>
            </Button>
          ) : null}
          {can(viewer, "invoices.manage") ? <NewInvoiceDialog clients={clients} /> : null}
        </>
      }
    />
  );
}

async function Filters() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, READ)) return null;
  const clients = await billingClients();
  return (
    <ListFilters
      placeholder="Invoice number"
      selects={[
        { name: "status", label: "Status", allLabel: "All invoices", options: STATUS_OPTIONS },
        { name: "client", label: "Client", allLabel: "All clients", options: clients.map((c) => ({ value: c.id, label: c.name })), className: "sm:w-56" },
      ]}
      dates={[
        { name: "from", label: "From" },
        { name: "to", label: "To" },
      ]}
    />
  );
}

function Tile({ label, value, sub, tone, icon: Icon, href }: { label: string; value: string; sub?: string; tone?: "danger" | "default"; icon: typeof Receipt; href?: string }) {
  const body = (
    <div className="flex items-start gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.07] transition-colors hover:bg-muted/30">
      <span className={tone === "danger" ? "flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive" : "flex size-9 items-center justify-center rounded-xl bg-primary/8 text-primary"}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

async function Totals() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, READ)) return null;
  const r = await invoiceHeadline();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile label="Outstanding" value={formatMoney(r.outstanding)} sub="Confirmed and not yet paid" icon={Wallet} href="/app/invoices?status=open" />
      <Tile label="Overdue" value={formatMoney(r.overdue)} sub="Past their due date" icon={AlertTriangle} tone={r.overdue > 0 ? "danger" : "default"} href="/app/invoices?status=overdue" />
      <Tile label="Drafts to check" value={String(r.drafts)} sub={r.drafts === 1 ? "invoice waiting to be confirmed" : "invoices waiting to be confirmed"} icon={FileClock} href="/app/invoices?status=draft" />
    </div>
  );
}

async function InvoiceList({ searchParams }: Pick<PageProps<"/app/invoices">, "searchParams">) {
  const [viewer, sp] = await Promise.all([getStaffViewer(), searchParams]);
  if (!canAny(viewer, READ)) return null;
  const filters = { q: one(sp.q), status: one(sp.status), client: one(sp.client), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page) ?? 1) || 1 };
  const { rows, total } = await listInvoices(filters);

  if (!rows.length) {
    const filtered = Boolean(filters.q || filters.status || filters.client || filters.from || filters.to);
    return (
      <Surface>
        <Empty className="py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Receipt />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No invoices match" : "No invoices yet"}</EmptyTitle>
            <EmptyDescription>{filtered ? "Try other filters." : "The first draft appears when a case's report is released."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Surface>
    );
  }

  return (
    <Surface>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={`${TH} pl-5`}>Invoice</TableHead>
            <TableHead className={TH}>Client</TableHead>
            <TableHead className={`${TH} hidden md:table-cell`}>Issued</TableHead>
            <TableHead className={`${TH} hidden sm:table-cell`}>Due</TableHead>
            <TableHead className={TH}>Status</TableHead>
            <TableHead className={`${TH} hidden text-right lg:table-cell`}>Total</TableHead>
            <TableHead className={`${TH} pr-5 text-right`}>Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="group">
              <TableCell className="pl-5">
                <Link href={`/app/invoices/${r.id}`} className="block outline-none">
                  <span className="block font-medium group-hover:underline">{r.number ?? "Draft"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.kind === "monthly" && r.period_from ? `Month of ${formatPlainDate(r.period_from).replace(/^\d+ /, "")}` : r.kind === "manual" ? "Manual" : "Per case"}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="max-w-48">
                <span className="block truncate text-sm">{r.client_name}</span>
                <span className="block text-xs text-muted-foreground">{r.client_code}</span>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatPlainDate(r.issue_date)}</TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatPlainDate(r.due_date)}</TableCell>
              <TableCell>
                <InvoiceStatusChip status={r.status} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatAmount(r.total)}</TableCell>
              <TableCell className="pr-5 text-right font-medium tabular-nums">{r.status === "void" || r.status === "draft" ? "—" : formatAmount(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        page={filters.page}
        pageSize={INVOICE_PAGE_SIZE}
        total={total}
        basePath="/app/invoices"
        params={{ q: filters.q, status: filters.status, client: filters.client, from: filters.from, to: filters.to }}
      />
    </Surface>
  );
}
