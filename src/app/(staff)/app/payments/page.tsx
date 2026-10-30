import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, Wallet } from "lucide-react";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SlipStatusChip, methodLabel } from "@/components/billing/invoice-status";
import { getStaffViewer } from "@/lib/server/viewer";
import { listSlips, openInvoicesFor, recentPayments } from "@/lib/server/billing/queries";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { can, canAny } from "@/domain/permissions";
import { VoidPaymentButton } from "../invoices/[invoiceId]/invoice-actions";
import { SlipCard } from "./slip-review";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="Payments"
        description="Payment slips clients uploaded in their portal, waiting to be matched to an invoice, and the payments recorded recently."
      />
      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <PendingSlips />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <Recent />
      </Suspense>
      <Suspense fallback={null}>
        <DoneSlips />
      </Suspense>
    </Page>
  );
}

async function PendingSlips() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["payments.record", "invoices.manage"])) redirect("/app");
  const slips = await listSlips("pending");
  const invoices = await openInvoicesFor([...new Set(slips.map((s) => s.client_id))]);
  const canMatch = can(viewer, "payments.record");
  return (
    <Surface>
      <SurfaceHeader title="Slips to match" description={slips.length ? `${slips.length} waiting · reminders for those invoices pause until you decide` : undefined} />
      {slips.length ? (
        canMatch ? (
          <ul className="divide-y">
            {slips.map((s) => (
              <SlipCard key={s.id} slip={s} invoices={invoices} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">{slips.length} slips wait for someone who can record payments.</p>
        )
      ) : (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Nothing to match</EmptyTitle>
            <EmptyDescription>Slips clients upload against an invoice appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Surface>
  );
}

async function Recent() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["payments.record", "invoices.manage"])) return null;
  const payments = await recentPayments();
  return (
    <Surface>
      <SurfaceHeader title="Recent payments" />
      {payments.length ? (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={`${TH} pl-5`}>Received</TableHead>
              <TableHead className={TH}>Client</TableHead>
              <TableHead className={`${TH} hidden sm:table-cell`}>Invoice</TableHead>
              <TableHead className={`${TH} hidden md:table-cell`}>Method</TableHead>
              <TableHead className={`${TH} text-right`}>Amount</TableHead>
              <TableHead className={`${TH} pr-5`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id} className={p.voided_at ? "opacity-60" : ""}>
                <TableCell className="pl-5 text-sm">{formatPlainDate(p.paid_on)}</TableCell>
                <TableCell className="max-w-44 truncate text-sm">{p.client_name}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">
                  {p.invoice_id ? (
                    <Link href={`/app/invoices/${p.invoice_id}`} className="hover:underline">
                      {p.invoice_number}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {methodLabel(p.method)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(p.amount, p.currency)}
                  {p.voided_at ? <span className="block text-xs font-normal text-destructive">Voided</span> : null}
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {can(viewer, "payments.record") && !p.voided_at ? <VoidPaymentButton paymentId={p.id} label={formatMoney(p.amount, p.currency)} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>No payments yet</EmptyTitle>
            <EmptyDescription>Record payments on an invoice, or match a client&apos;s slip above.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Surface>
  );
}

async function DoneSlips() {
  const viewer = await getStaffViewer();
  if (!canAny(viewer, ["payments.record", "invoices.manage"])) return null;
  const slips = await listSlips("done");
  if (!slips.length) return null;
  return (
    <Surface>
      <SurfaceHeader title="Recently decided slips" />
      <ul className="divide-y">
        {slips.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {s.client_name} · {s.invoice_number ?? "no invoice"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.filename} · {formatDateTime(s.created_at)}
                {s.rejection_reason ? ` · ${s.rejection_reason}` : ""}
              </p>
            </div>
            <SlipStatusChip status={s.status} staff />
          </li>
        ))}
      </ul>
    </Surface>
  );
}
