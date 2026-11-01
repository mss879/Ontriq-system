import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { ChevronRight, Receipt } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InvoiceStatusChip, SlipStatusChip } from "@/components/billing/invoice-status";
import { StatementDownload } from "@/components/billing/statement-download";
import { getClientViewer } from "@/lib/server/viewer";
import { portalInvoiceList } from "@/lib/server/billing/portal";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { can } from "@/domain/permissions";

export const metadata: Metadata = { title: "Invoices" };

const DESCRIPTION = "Invoices from Ontriq, what you owe, and your statement of account. Upload a payment slip on any open invoice.";

export default function PortalInvoicesPage() {
  return (
    <Page>
      <PageHeader eyebrow="Commercial" title="Invoices" description={DESCRIPTION} />
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

const CARD = "rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]";

async function Content() {
  const viewer = await getClientViewer();
  if (!can(viewer, "portal.invoices.view")) redirect("/portal");
  const { invoices, balance, slips } = await portalInvoiceList();
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className={`${CARD} px-5 py-4`}>
          <dt className="text-xs text-muted-foreground">You owe</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(balance.outstanding, balance.currency)}</dd>
          <dd className="text-xs text-muted-foreground">
            {balance.open_invoices} open {balance.open_invoices === 1 ? "invoice" : "invoices"}
          </dd>
        </div>
        <div className={`${CARD} px-5 py-4`}>
          <dt className="text-xs text-muted-foreground">Overdue</dt>
          <dd className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${balance.overdue > 0 ? "text-destructive" : ""}`}>{formatMoney(balance.overdue, balance.currency)}</dd>
          <dd className="text-xs text-muted-foreground">{balance.overdue > 0 ? "Past the due date" : "Nothing overdue"}</dd>
        </div>
        <div className={`${CARD} px-5 py-4`}>
          <dt className="mb-2 text-xs text-muted-foreground">Statement of account</dt>
          <dd>{viewer.clientId ? <StatementDownload clientId={viewer.clientId} compact /> : null}</dd>
        </div>
      </dl>

      {invoices.length ? (
        <ul className={`overflow-hidden ${CARD}`}>
          {invoices.map((inv, i) => (
            <li key={inv.id} className={i ? "border-t" : undefined}>
              <Link href={`/portal/invoices/${inv.id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/40">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/15">
                  <Receipt className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium group-hover:underline">{inv.number}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatPlainDate(inv.issue_date)}
                    {inv.balance > 0 && inv.due_date ? ` · due ${formatPlainDate(inv.due_date)}` : ""}
                    {inv.slip_pending ? " · slip being checked" : ""}
                  </span>
                </span>
                <span className="hidden text-right sm:block">
                  <span className="block font-semibold tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
                  {inv.balance > 0 && inv.balance < inv.total ? <span className="block text-xs text-muted-foreground tabular-nums">{formatMoney(inv.balance, inv.currency)} left</span> : null}
                </span>
                <InvoiceStatusChip status={inv.status} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={CARD}>
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyTitle>No invoices yet</EmptyTitle>
              <EmptyDescription>When Ontriq sends you an invoice it appears here and you get an email.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}

      {slips.length ? (
        <section className={CARD}>
          <h2 className="border-b px-5 py-3 text-sm font-semibold">Payment slips you sent</h2>
          <ul className="divide-y">
            {slips.slice(0, 10).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.filename}
                    {s.invoice_id && numberOf.get(s.invoice_id) ? <span className="font-normal text-muted-foreground"> · {numberOf.get(s.invoice_id)}</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(s.created_at)}
                    {s.status === "rejected" && s.rejection_reason ? ` · ${s.rejection_reason}` : ""}
                  </p>
                </div>
                <SlipStatusChip status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
