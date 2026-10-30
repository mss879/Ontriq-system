import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Surface, SurfaceHeader, TH } from "@/components/admin/surface";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuoteStatusChip } from "@/components/quotes/quote-status";
import { NewQuoteForClient } from "@/components/quotes/quote-actions";
import { getStaffViewer } from "@/lib/server/viewer";
import { canReadQuotes, getClientPriceList, getClientQuotes } from "@/lib/server/quotes/queries";
import { formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import { can } from "@/domain/permissions";

/** The client's quotations and the prices they have contracted (accepted quotations). */
export async function ClientQuotesSection({ params }: { params: Promise<{ clientId: string }> }) {
  const [viewer, { clientId }] = await Promise.all([getStaffViewer(), params]);
  if (!canReadQuotes(viewer) || !/^[0-9a-f-]{36}$/.test(clientId)) return null;
  const [quotes, prices] = await Promise.all([getClientQuotes(clientId), getClientPriceList(clientId)]);
  const recent = quotes.slice(0, 6);

  return (
    <Surface>
      <SurfaceHeader
        title="Quotations and prices"
        description="Accepting a quotation sets the prices this client pays."
        aside={can(viewer, "quotes.manage") ? <NewQuoteForClient clientId={clientId} /> : null}
      />
      {recent.length ? (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={`${TH} pl-5`}>Quotation</TableHead>
              <TableHead className={TH}>Status</TableHead>
              <TableHead className={`${TH} pr-5 text-right`}>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((q) => (
              <TableRow key={q.id} className="group">
                <TableCell className="max-w-64 pl-5">
                  <Link href={`/app/quotes/${q.id}`} className="block min-w-0 outline-none">
                    <span className="block truncate font-medium group-hover:underline">
                      {q.number ? `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` : "Draft"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {q.title} · valid until {formatPlainDate(q.valid_until)}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <QuoteStatusChip status={q.status} />
                </TableCell>
                <TableCell className="pr-5 text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(q.total, q.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
          <FileSignature className="size-4" /> No quotations yet.
        </p>
      )}
      {quotes.length > recent.length ? (
        <Link href={`/app/quotes?q=${encodeURIComponent(quotes[0]?.client.name ?? "")}`} className="block border-t px-5 py-2.5 text-xs font-medium text-primary hover:underline">
          All {quotes.length} quotations
        </Link>
      ) : null}
      <div className="border-t px-5 py-4">
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Contracted prices</p>
        {prices.length ? (
          <ul className="divide-y text-sm">
            {prices.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.kind === "package" ? "Package" : "Check"} · from {formatPlainDate(p.valid_from)}
                    {p.valid_to ? ` to ${formatPlainDate(p.valid_to)}` : ""}
                    {p.quote_number ? ` · ${p.quote_number}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(p.unit_price, p.currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet. Until a quotation is accepted, cases are billed at Ontriq&apos;s package prices.</p>
        )}
      </div>
    </Surface>
  );
}
