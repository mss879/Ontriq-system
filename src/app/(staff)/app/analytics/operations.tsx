import { Suspense } from "react";
import { AlarmClock, CheckCircle2, FolderInput, Gauge, Timer } from "lucide-react";
import { BarList, CHART_COLORS, ColumnChart, Donut, TONE_COLORS } from "@/components/charts/charts";
import { KpiSkeleton, KpiTile } from "@/components/charts/kpi";
import { TH } from "@/components/admin/surface";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOperations } from "@/lib/server/analytics/queries";
import { dayLabel, formatHours, formatPct, onTimePct, RESULT_META, stageDurations, stagePipeline } from "@/domain/analytics/shape";
import { num } from "@/domain/analytics/types";
import { GRID_2, Panel, PanelEmpty, PanelSkeleton, type AnalyticsScope } from "./section";

/** Operations: volumes, turnaround, SLA, results and workload. Each region streams on its own. */
export function OperationsTab({ scope }: { scope: AnalyticsScope }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<KpiSkeleton count={5} />}>
        <Kpis scope={scope} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={7} />}>
        <Weekly scope={scope} />
      </Suspense>
      <div className={GRID_2}>
        <Suspense fallback={<PanelSkeleton />}>
          <Pipeline scope={scope} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <StageTime scope={scope} />
        </Suspense>
      </div>
      <div className={GRID_2}>
        <Suspense fallback={<PanelSkeleton />}>
          <Results scope={scope} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <Packages scope={scope} />
        </Suspense>
      </div>
      <div className={GRID_2}>
        <Suspense fallback={<PanelSkeleton />}>
          <Officers scope={scope} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <Clients scope={scope} />
        </Suspense>
      </div>
    </div>
  );
}

const load = (s: AnalyticsScope) => getOperations(s.period.from, s.period.to, s.client);

async function Kpis({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const s = d.summary;
  const onTime = onTimePct(s.sla_met, s.sla_missed);
  const overdue = num(s.overdue_now);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <KpiTile label="Cases received" value={String(num(s.received))} sub={scope.period.label} icon={FolderInput} />
      <KpiTile label="Reports released" value={String(num(s.released))} sub={num(s.cancelled) ? `${num(s.cancelled)} cancelled` : scope.period.label} icon={CheckCircle2} tone="good" />
      <KpiTile
        label="Open now"
        value={String(num(s.open_now))}
        sub={overdue ? `${overdue} overdue${num(s.on_hold_now) ? `, ${num(s.on_hold_now)} on hold` : ""}` : num(s.on_hold_now) ? `${num(s.on_hold_now)} on hold` : "None overdue"}
        icon={AlarmClock}
        tone={overdue ? "bad" : "default"}
        href={overdue ? "/app/cases?due=overdue" : "/app/cases"}
      />
      <KpiTile label="Average turnaround" value={formatHours(s.avg_tat_hours)} sub={s.median_tat_hours !== null ? `Median ${formatHours(s.median_tat_hours)}` : "Received to released"} icon={Timer} />
      <KpiTile
        label="Released on time"
        value={formatPct(onTime)}
        sub={onTime === null ? "Nothing released with a due date" : `${num(s.sla_met)} on time, ${num(s.sla_missed)} late`}
        icon={Gauge}
        tone={onTime === null ? "default" : onTime >= 90 ? "good" : onTime >= 75 ? "warn" : "bad"}
      />
    </div>
  );
}

async function Weekly({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const any = d.weekly.some((w) => num(w.received) || num(w.released));
  return (
    <Panel title="Cases per week" description="Received and released, by the week they happened in (weeks start on Monday).">
      {any ? (
        <ColumnChart
          title="Cases received and released per week"
          categories={d.weekly.map((w) => dayLabel(w.week))}
          series={[
            { key: "received", label: "Received", color: CHART_COLORS[0] },
            { key: "released", label: "Released", color: CHART_COLORS[1] },
          ]}
          values={[d.weekly.map((w) => num(w.received)), d.weekly.map((w) => num(w.released))]}
        />
      ) : (
        <PanelEmpty>No cases were received or released in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function Pipeline({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const rows = stagePipeline(d.by_stage);
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <Panel title="Open cases by stage" description="Where everything still open is right now.">
      {total ? (
        <ColumnChart
          title="Open cases by stage"
          categories={rows.map((r) => r.label)}
          series={[{ key: "open", label: "Open cases", color: CHART_COLORS[2] }]}
          values={[rows.map((r) => r.count)]}
          height={150}
        />
      ) : (
        <PanelEmpty>No open cases.</PanelEmpty>
      )}
    </Panel>
  );
}

async function StageTime({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const rows = stageDurations(d.stage_hours);
  return (
    <Panel title="Time in each stage" description="Average time a case spent in a stage it entered in this period.">
      {rows.length ? (
        <BarList
          title="Average hours per stage"
          items={rows.map((r) => ({ label: r.label, value: r.avg, detail: `median ${formatHours(r.median)} · ${r.samples} case${r.samples === 1 ? "" : "s"}` }))}
          format={formatHours}
          color={CHART_COLORS[0]}
        />
      ) : (
        <PanelEmpty>No stage was completed in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function Results({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  const parts = d.result_mix.map((r) => ({ label: RESULT_META[r.result]?.label ?? r.result, value: num(r.count), color: TONE_COLORS[RESULT_META[r.result]?.tone ?? "slate"] }));
  return (
    <Panel title="Results of released reports" description="The final result each released report carried.">
      {parts.some((p) => p.value) ? <Donut title="Result mix" parts={parts} centerLabel="released" /> : <PanelEmpty>No reports were released in this period.</PanelEmpty>}
    </Panel>
  );
}

async function Packages({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="Turnaround by package" description="Received to released, for reports released in this period.">
      {d.tat_by_package.length ? (
        <div className="-mx-5 -my-5 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={`${TH} pl-5`}>Package</TableHead>
                <TableHead className={`${TH} text-right`}>Released</TableHead>
                <TableHead className={`${TH} text-right`}>Average</TableHead>
                <TableHead className={`${TH} text-right`}>Median</TableHead>
                <TableHead className={`${TH} pr-5 text-right`}>On time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.tat_by_package.map((p) => (
                <TableRow key={p.package}>
                  <TableCell className="pl-5 font-medium">{p.package}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(p.released)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(p.avg_hours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(p.median_hours)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{formatPct(onTimePct(p.sla_met, p.sla_missed))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <PanelEmpty>No reports were released in this period.</PanelEmpty>
      )}
    </Panel>
  );
}

async function Officers({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="Workload by officer" description="Open and overdue checks now, and checks completed in the period.">
      {d.officers.length ? (
        <div className="-mx-5 -my-5 max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={`${TH} pl-5`}>Officer</TableHead>
                <TableHead className={`${TH} text-right`}>Open</TableHead>
                <TableHead className={`${TH} text-right`}>Overdue</TableHead>
                <TableHead className={`${TH} pr-5 text-right`}>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.officers.map((o) => (
                <TableRow key={o.user_id}>
                  <TableCell className="pl-5 font-medium">{o.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(o.open_checks)}</TableCell>
                  <TableCell className={num(o.overdue_checks) ? "text-right font-medium text-destructive tabular-nums" : "text-right tabular-nums"}>{num(o.overdue_checks)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{num(o.completed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <PanelEmpty>No checks are assigned to anyone yet.</PanelEmpty>
      )}
    </Panel>
  );
}

async function Clients({ scope }: { scope: AnalyticsScope }) {
  const d = await load(scope);
  if (!d) return null;
  return (
    <Panel title="Busiest clients" description="Cases received in the period, with what's still open.">
      {d.top_clients.length ? (
        <BarList
          title="Cases received per client"
          items={d.top_clients.map((c) => ({ label: c.name, value: num(c.received), href: `/app/clients/${c.client_id}`, detail: `${num(c.open)} open · ${num(c.released)} released` }))}
          color={CHART_COLORS[1]}
        />
      ) : (
        <PanelEmpty>No client sent cases in this period.</PanelEmpty>
      )}
    </Panel>
  );
}
