import Link from "@/components/link";
import { Receipt } from "lucide-react";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { InvoiceStatusChip } from "@/components/billing/invoice-status";
import { StatementDownload } from "@/components/billing/statement-download";
import { getStaffViewer } from "@/lib/server/viewer";
import { clientBilling } from "@/lib/server/billing/queries";
import { formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { canAny } from "@/domain/permissions";

/** The client's balance, latest invoices and statement of account, for finance staff. */
export async function ClientBillingSection({ params }: { params: Promise<{ clientId: string }> }) {
  const [viewer, { clientId }] = await Promise.all([getStaffViewer(), params]);
  if (!canAny(viewer, ["invoices.manage", "invoices.send", "billing.export", "payments.record"]) || !/^[0-9a-f-]{36}$/.test(clientId)) return null;
  const billing = await clientBilling(clientId);
  if (!billing) return null;
  const { balance, invoices } = billing;

  return (
    <Surface>
      <SurfaceHeader title="Billing" description={balance.open_invoices ? `${balance.open_invoices} open ${balance.open_invoices === 1 ? "invoice" : "invoices"}` : "Nothing owed"} />
      <dl className="grid grid-cols-2 gap-px border-b bg-border">
        <div className="bg-card px-5 py-3">
          <dt className="text-xs text-muted-foreground">Outstanding</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoney(balance.outstanding, balance.currency)}</dd>
        </div>
        <div className="bg-card px-5 py-3">
          <dt className="text-xs text-muted-foreground">Overdue</dt>
          <dd className={`text-lg font-semibold tabular-nums ${balance.overdue > 0 ? "text-destructive" : ""}`}>{formatMoney(balance.overdue, balance.currency)}</dd>
        </div>
      </dl>
      {invoices.length ? (
        <ul className="divide-y">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/app/invoices/${i.id}`} className="group flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/40">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:underline">{i.number ?? "Draft"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {i.issue_date ? formatPlainDate(i.issue_date) : "Not issued"} · {formatMoney(i.total, i.currency)}
                    {i.balance > 0 && i.status !== "draft" && i.balance < i.total ? ` · ${formatMoney(i.balance, i.currency)} owed` : ""}
                  </span>
                </span>
                <InvoiceStatusChip status={i.status} className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Receipt className="size-4" /> No invoices yet.
        </p>
      )}
      <Link href={`/app/invoices?client=${clientId}`} className="block border-t px-5 py-2.5 text-xs font-medium text-primary hover:underline">
        All invoices for this client
      </Link>
      <div className="border-t px-5 py-4">
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Statement of account</p>
        <StatementDownload clientId={clientId} compact />
      </div>
    </Surface>
  );
}
