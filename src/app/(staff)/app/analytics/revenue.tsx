import { Suspense } from "react";
import { AlertTriangle, BadgeDollarSign, HandCoins, ReceiptText, Undo2 } from "lucide-react";
import { BarList, CHART_COLORS, ColumnChart, StackedBar, TONE_COLORS } from "@/components/charts/charts";
import { KpiSkeleton, KpiTile } from "@/components/charts/kpi";
import { getRevenue } from "@/lib/server/analytics/queries";
import { formatAmount, formatMoney } from "@/domain/pricing/money";
import { AGING_LABELS, compactNumber, monthLabel } from "@/domain/analytics/shape";
import { num, type AgingBucket } from "@/domain/analytics/types";
import { GRID_2, Panel, PanelEmpty, PanelSkeleton, type AnalyticsScope } from "./section";

/** Headline figures in whole rupees, so they fit their tile. */
const whole = (n: Parameters<typeof num>[0], currency: string) => formatMoney(Math.round(num(n)), currency).replace(/\.00$/, "");

/** Revenue: invoiced and collected, receivables and how old they are, who owes what. */
export function RevenueTab({ scope }: { scope: AnalyticsScope }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<KpiSkeleton count={5} />}>
        <Kpis scope={scope} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={7} />}>
        <Monthly scope={scope} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={3} />}>
        <Aging scope={scope} />
      </Suspense>
      <div className={GRID_2}>
        <Suspense fallback={<PanelSkeleton />}>
          <TopBilled scope={scope} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <TopOutstanding scope={scope} />
        </Suspense>
      </div>
    </div>
  );
}

const load = (s: AnalyticsScope) => getRevenue(s.period.from, s.period.to, s.client);

const AGING_COLORS: Record<AgingBucket, string> = {
  current: TONE_COLORS.blue,
  "1-30": "var(--chart-4)",
  "31-60": "var(--warning)",
  "61-90": "var(--chart-2)",
  "90+": "var(--destructive)",
};

async function Kpis({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const s = d.summary;
  const c = d.currency;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile label="Invoiced" value={whole(s.invoiced, c)} sub={`${num(s.invoice_count)} invoice${num(s.invoice_count) === 1 ? "" : "s"} issued`} icon={ReceiptText} />
        <KpiTile label="Collected" value={whole(s.collected, c)} sub={`${num(s.payment_count)} payment${num(s.payment_count) === 1 ? "" : "s"}`} icon={HandCoins} tone="good" href="/app/payments" />
        <KpiTile label="Outstanding now" value={whole(s.outstanding, c)} sub={`${num(s.open_invoices)} open invoice${num(s.open_invoices) === 1 ? "" : "s"}`} icon={BadgeDollarSign} href="/app/invoices?status=open" />
        <KpiTile label="Overdue now" value={whole(s.overdue, c)} sub="Past the due date" icon={AlertTriangle} tone={num(s.overdue) ? "bad" : "default"} href="/app/invoices?status=overdue" />
        <KpiTile label="Credited" value={whole(s.credited, c)} sub="Credit notes issued" icon={Undo2} />
      </div>
      {num(d.other_currency_invoices) ? (
        <p className="text-xs text-muted-foreground">
          Amounts are in {c}. {num(d.other_currency_invoices)} invoice{num(d.other_currency_invoices) === 1 ? " is" : "s are"} in another currency and left out.
        </p>
      ) : null}
    </div>
  );
}

async function Monthly({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const any = d.monthly.some((m) => num(m.invoiced) || num(m.collected));
  return (
    <Panel title="Invoiced and collected by month" description={`Invoices by issue date, payments by the date they were paid (${d.currency}).`}>
      {any ? (
        <ColumnChart
          title={`Invoiced and collected by month (${d.currency})`}
          categories={d.monthly.map((m) => monthLabel(m.month))}
          series={[
            { key: "invoiced", label: "Invoiced", color: CHART_COLORS[0] },
            { key: "collected", label: "Collected", color: CHART_COLORS[4] },
          ]}
          values={[d.monthly.map((m) => num(m.invoiced)), d.monthly.map((m) => num(m.collected))]}
          format={(n) => formatMoney(n, d.currency)}
          axisFormat={compactNumber}
        />
      ) : (
        <PanelEmpty>Nothing was invoiced or paid in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function Aging({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const parts = d.aging.map((a) => ({ label: AGING_LABELS[a.bucket], value: num(a.amount), color: AGING_COLORS[a.bucket] }));
  return (
    <Panel title="Receivables by age" description="Everything unpaid today, by how far past its due date it is.">
      {parts.some((p) => p.value) ? (
        <StackedBar title="Receivables by age" parts={parts} format={(n) => formatAmount(n)} />
      ) : (
        <PanelEmpty>Nothing is outstanding.</PanelEmpty>
      )}
    </Panel>
  );
}

async function TopBilled({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="Billed by client" description="Invoiced in the period.">
      {d.top_billed.length ? (
        <BarList
          title="Billed by client"
          items={d.top_billed.map((c) => ({ label: c.name, value: num(c.amount), href: `/app/clients/${c.client_id}`, detail: `${num(c.invoices)} inv.` }))}
          format={(n) => formatMoney(n, d.currency)}
          color={CHART_COLORS[0]}
        />
      ) : (
        <PanelEmpty>No invoices in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function TopOutstanding({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="Who owes the most" description="Unpaid balances today.">
      {d.top_outstanding.length ? (
        <BarList
          title="Outstanding by client"
          items={d.top_outstanding.map((c) => ({
            label: c.name,
            value: num(c.amount),
            href: `/app/clients/${c.client_id}`,
            detail: num(c.overdue) ? `${formatAmount(c.overdue)} overdue` : "none overdue",
            color: num(c.overdue) ? "var(--destructive)" : CHART_COLORS[0],
          }))}
          format={(n) => formatMoney(n, d.currency)}
        />
      ) : (
        <PanelEmpty>Nobody owes anything.</PanelEmpty>
      )}
    </Panel>
  );
}
