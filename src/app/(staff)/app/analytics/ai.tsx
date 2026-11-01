import { Suspense } from "react";
import Link from "@/components/link";
import { Activity, Bot, CircleDollarSign, FileCheck2 } from "lucide-react";
import { BarList, CHART_COLORS, Donut, LineChart } from "@/components/charts/charts";
import { KpiSkeleton, KpiTile } from "@/components/charts/kpi";
import { getAi } from "@/lib/server/analytics/queries";
import { dayLabel, formatUsd } from "@/domain/analytics/shape";
import { num, numOrNull } from "@/domain/analytics/types";
import { GRID_2, Panel, PanelEmpty, PanelSkeleton, type AnalyticsScope } from "./section";

/** AI cost: spend per day, per capability and per model, and cost per released case. */
export function AiTab({ scope }: { scope: AnalyticsScope }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<KpiSkeleton count={4} />}>
        <Kpis scope={scope} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={6} />}>
        <Daily scope={scope} />
      </Suspense>
      <div className={GRID_2}>
        <Suspense fallback={<PanelSkeleton />}>
          <ByCapability scope={scope} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <ByModel scope={scope} />
        </Suspense>
      </div>
    </div>
  );
}

const load = (s: AnalyticsScope) => getAi(s.period.from, s.period.to);
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n));

async function Kpis({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const s = d.summary;
  const perCase = numOrNull(s.cost_per_released_case);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile label="AI cost" value={formatUsd(s.cost_usd)} sub={scope.period.label} icon={CircleDollarSign} />
      <KpiTile label="AI calls" value={String(num(s.runs))} sub={num(s.failed_runs) ? `${num(s.failed_runs)} didn't finish` : "All finished"} icon={Activity} tone={num(s.failed_runs) ? "warn" : "default"} />
      <KpiTile
        label="Cost per released case"
        value={perCase === null ? "—" : formatUsd(perCase, 3)}
        sub={`${num(s.released_cases)} report${num(s.released_cases) === 1 ? "" : "s"} released`}
        icon={FileCheck2}
      />
      <KpiTile label="Tokens" value={tokens(num(s.input_tokens) + num(s.output_tokens))} sub={`${tokens(num(s.input_tokens))} in · ${tokens(num(s.output_tokens))} out · ${tokens(num(s.cache_read_tokens))} cached`} icon={Bot} />
    </div>
  );
}

async function Daily({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel
      title="Cost per day"
      description="Every AI call is priced from the rates in Settings → AI."
      aside={
        <Link href="/app/settings/ai" className="text-xs font-medium text-primary hover:underline">
          Budgets and switches
        </Link>
      }
    >
      {num(d.summary.runs) ? (
        <LineChart title="AI cost per day (USD)" points={d.daily.map((x) => ({ label: dayLabel(x.day), value: num(x.cost_usd) }))} format={(n) => formatUsd(n)} />
      ) : (
        <PanelEmpty>No AI calls in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function ByCapability({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="By feature" description="What each AI feature cost.">
      {d.by_capability.length ? (
        <BarList
          title="AI cost by feature"
          items={d.by_capability.map((c) => ({ label: c.label, value: num(c.cost_usd), detail: `${num(c.runs)} call${num(c.runs) === 1 ? "" : "s"}` }))}
          format={(n) => formatUsd(n)}
          color={CHART_COLORS[0]}
        />
      ) : (
        <PanelEmpty>No AI calls in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function ByModel({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const parts = d.by_model.map((m, i) => ({ label: m.model, value: num(m.cost_usd), color: CHART_COLORS[i % CHART_COLORS.length] }));
  return (
    <Panel title="By model" description="Spend per Claude model.">
      {parts.some((p) => p.value) ? <Donut title="AI cost by model" parts={parts} centerLabel="USD" format={(n) => formatUsd(n)} /> : <PanelEmpty>No AI spend in this period.</PanelEmpty>}
    </Panel>
  );
}
