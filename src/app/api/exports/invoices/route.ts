import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadViewerState } from "@/lib/server/viewer";
import { can } from "@/domain/permissions";
import { displayStatus, INVOICE_STATUS_LABELS } from "@/domain/pricing/invoice-core";
import { toCsv, type CsvCell } from "@/domain/analytics/csv";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Billing export (billing.export): every confirmed invoice issued in a period
 * as CSV, for the accounts package.
 *   /api/exports/invoices?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  await connection();
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff" || !can(state.viewer, "billing.export")) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  }
  const sp = request.nextUrl.searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select("number, kind, status, issue_date, due_date, period_from, period_to, currency, subtotal, discount_total, net_total, tax_lines, tax_total, total, amount_paid, amount_credited, balance, paid_at, client:clients(name, code)")
    .not("number", "is", null)
    .order("issue_date")
    .order("number");
  const from = isDate(sp.get("from"));
  const to = isDate(sp.get("to"));
  if (from) q = q.gte("issue_date", from);
  if (to) q = q.lte("issue_date", to);
  const { data, error } = await q.limit(10000);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });

  const head = ["Invoice", "Client", "Client code", "Kind", "Status", "Issue date", "Due date", "Period from", "Period to", "Currency", "Subtotal", "Discount", "Net", "Tax", "Tax detail", "Total", "Paid", "Credited", "Balance", "Paid at"];
  const rows = (data ?? []).map((i) => {
    const client = i.client as unknown as { name: string; code: string } | null;
    const taxes = ((i.tax_lines ?? []) as { code: string; rate: number; amount: number }[]).map((t) => `${t.code} ${t.rate}%: ${t.amount}`).join("; ");
    return [
      i.number, client?.name, client?.code, i.kind, INVOICE_STATUS_LABELS[displayStatus(i.status, i.due_date)], i.issue_date, i.due_date, i.period_from, i.period_to,
      i.currency, i.subtotal, i.discount_total, i.net_total, i.tax_total, taxes, i.total, i.amount_paid, i.amount_credited, i.balance, i.paid_at,
    ];
  });
  // Formula-safe: payment references can come from slips a client uploaded.
  const body = toCsv([head, ...rows] as CsvCell[][]);
  const name = `invoices${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.csv`;
  return new NextResponse(body, { headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
