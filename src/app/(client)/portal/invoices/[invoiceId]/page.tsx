import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleAlert, Download, FileText } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/documents/document-preview";
import { InvoiceStatusChip, methodLabel } from "@/components/billing/invoice-status";
import { getClientViewer } from "@/lib/server/viewer";
import { portalInvoiceDetail, portalParties } from "@/lib/server/billing/portal";
import { MarkViewed } from "@/components/documents/mark-viewed";
import { markInvoiceViewed } from "../actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { invoiceModel } from "@/domain/documents/model";
import { can } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { SlipUpload } from "./slip-upload";

export const metadata: Metadata = { title: "Invoice" };

const CARD = "rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.07]";

export default function PortalInvoicePage({ params }: PageProps<"/portal/invoices/[invoiceId]">) {
  return (
    <Page className="max-w-6xl">
      <Link href="/portal/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: Pick<PageProps<"/portal/invoices/[invoiceId]">, "params">) {
  const [viewer, { invoiceId }] = await Promise.all([getClientViewer(), params]);
  if (!can(viewer, "portal.invoices.view")) redirect("/portal");
  const inv = /^[0-9a-f-]{36}$/.test(invoiceId) ? await portalInvoiceDetail(invoiceId) : null;
  if (!inv) notFound();
  const parties = await portalParties();
  const model = invoiceModel({ issuer: parties.issuer, client: parties.client, contact: inv.contact, invoice: inv, items: inv.items });
  const open = ["sent", "viewed", "partially_paid", "overdue"].includes(inv.status) && inv.balance > 0;

  return (
    <div className="space-y-6">
      {inv.status === "sent" || inv.status === "overdue" ? <MarkViewed markViewed={markInvoiceViewed.bind(null, inv.id)} /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Invoice {inv.number}</h1>
            <InvoiceStatusChip status={inv.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatMoney(inv.total, inv.currency)} · issued {formatPlainDate(inv.issue_date)}
            {open && inv.due_date ? ` · due ${formatPlainDate(inv.due_date)}` : ""}
          </p>
        </div>
        {inv.document_ready && inv.document_id ? (
          <Button asChild variant="outline" size="lg" className="h-10">
            <a href={`/api/documents/${inv.document_id}?download=1`}>
              <Download /> Download PDF
            </a>
          </Button>
        ) : null}
      </div>

      {inv.status === "overdue" ? (
        <Note tone="danger">This invoice is past its due date. If you have paid, upload the slip so we can match it.</Note>
      ) : inv.status === "paid" ? (
        <Note tone="success">Paid in full{inv.paid_at ? ` on ${formatDate(inv.paid_at)}` : ""}. Thank you.</Note>
      ) : inv.status === "void" ? (
        <Note tone="warning">This invoice was cancelled. Nothing is owed on it.</Note>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 overflow-x-auto rounded-2xl bg-muted/30 p-3 ring-1 ring-foreground/[0.05] sm:p-6">
          <DocumentPreview model={model} template={inv.template_key} />
        </div>
        <aside className="space-y-4">
          <section className={`${CARD} px-5 py-4`}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="tabular-nums">{formatMoney(inv.total, inv.currency)}</dd>
              </div>
              {inv.amount_paid > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="tabular-nums">−{formatMoney(inv.amount_paid, inv.currency)}</dd>
                </div>
              ) : null}
              {inv.amount_credited > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Credited</dt>
                  <dd className="tabular-nums">−{formatMoney(inv.amount_credited, inv.currency)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t pt-1.5 font-semibold">
                <dt>Balance</dt>
                <dd className="tabular-nums">{formatMoney(inv.balance, inv.currency)}</dd>
              </div>
            </dl>
          </section>

          {open && inv.can_pay ? (
            <section className={`${CARD} px-5 py-4`}>
              <h2 className="mb-1 text-sm font-semibold">Paid this invoice?</h2>
              <p className="mb-3 text-xs text-muted-foreground">Upload the bank slip or transfer confirmation. We match it and email you a receipt.</p>
              <SlipUpload invoiceId={inv.id} pending={inv.slip_pending} />
            </section>
          ) : open && inv.slip_pending ? (
            <section className={`${CARD} px-5 py-4 text-sm text-muted-foreground`}>Your payment slip is being checked.</section>
          ) : null}

          {inv.payments.length ? (
            <section className={CARD}>
              <h2 className="border-b px-5 py-3 text-sm font-semibold">Payments</h2>
              <ul className="divide-y">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium tabular-nums">{formatMoney(p.amount, inv.currency)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatPlainDate(p.paid_on)} · {methodLabel(p.method)}
                      </span>
                    </span>
                    {p.receipt_ready && p.receipt_document_id ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/api/documents/${p.receipt_document_id}?download=1`}>
                          <FileText /> {p.receipt_number ?? "Receipt"}
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Receipt on its way</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {inv.credit_notes.length ? (
            <section className={CARD}>
              <h2 className="border-b px-5 py-3 text-sm font-semibold">Credit notes</h2>
              <ul className="divide-y">
                {inv.credit_notes.map((n) => (
                  <li key={n.number} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium tabular-nums">
                        {n.number} · {formatMoney(n.amount, inv.currency)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{n.reason}</span>
                    </span>
                    {n.document_id ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/api/documents/${n.document_id}?download=1`} aria-label={`Download credit note ${n.number}`}>
                          <Download />
                        </a>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Note({ tone, children }: { tone: "success" | "danger" | "warning"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1",
        tone === "success" && "bg-success/10 text-success ring-success/20",
        tone === "danger" && "bg-destructive/10 text-destructive ring-destructive/20",
        tone === "warning" && "bg-warning/15 text-warning-foreground ring-warning/30 dark:text-warning",
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
