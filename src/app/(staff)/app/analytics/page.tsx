import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Page, PageHeader, SectionSkeleton } from "@/components/layout/page";
import { KpiSkeleton } from "@/components/charts/kpi";
import { getStaffViewer } from "@/lib/server/viewer";
import { analyticsClients } from "@/lib/server/analytics/queries";
import { ANALYTICS_TABS, analyticsAccess, pickTab, type AnalyticsTab } from "@/domain/analytics/access";
import { colomboToday, parsePeriod, periodQuery } from "@/domain/analytics/period";
import type { AnalyticsScope } from "./section";
import { cn } from "@/lib/utils";
import { AnalyticsFilters } from "./analytics-filters";
import { OperationsTab } from "./operations";
import { RevenueTab } from "./revenue";
import { AiTab } from "./ai";

export const metadata: Metadata = { title: "Analytics" };

const DESCRIPTION = "How the operation is running: volumes, turnaround, workload, money in and out, and what AI costs. All dates are Sri Lanka time.";

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeOf(sp: SP): AnalyticsScope {
  const period = parsePeriod(sp);
  const raw = one(sp, "client");
  const client = raw && UUID.test(raw) ? raw : null;
  return { period, client, query: periodQuery(period, { client }) };
}

export default function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  return (
    <Page className="max-w-7xl">
      <PageHeader eyebrow="Insights" title="Analytics" description={DESCRIPTION} />
      <Suspense fallback={<div className="h-[5.5rem]" aria-hidden />}>
        <Toolbar searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<TabSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Toolbar({ searchParams }: Pick<PageProps<"/app/analytics">, "searchParams">) {
  const [viewer, sp] = await Promise.all([getStaffViewer(), searchParams]);
  await connection(); // the period is relative to today
  const access = analyticsAccess(viewer);
  const tab = pickTab(one(sp, "tab"), access);
  if (!tab) redirect("/app");
  const scope = scopeOf(sp);
  const clients = tab === "ai" ? [] : await analyticsClients();
  const exportQuery = new URLSearchParams(scope.query);
  exportQuery.set("section", tab);
  exportQuery.set("from", scope.period.from);
  exportQuery.set("to", scope.period.to);
  return (
    <div className="space-y-4">
      <nav aria-label="Analytics sections" className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ANALYTICS_TABS.filter((t) => access[t.key]).map((t) => {
          const q = new URLSearchParams(scope.query);
          if (t.key !== "operations") q.set("tab", t.key);
          if (t.key === "ai") q.delete("client");
          const href = q.toString() ? `/app/analytics?${q}` : "/app/analytics";
          return (
            <Link
              key={t.key}
              href={href}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn(
                "relative shrink-0 px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                t.key === tab && "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-orange",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <AnalyticsFilters
        preset={scope.period.preset}
        from={scope.period.from}
        to={scope.period.to}
        today={colomboToday()}
        clients={clients}
        showClient={tab !== "ai"}
        exportHref={`/api/exports/analytics?${exportQuery}`}
      />
    </div>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/app/analytics">, "searchParams">) {
  const [viewer, sp] = await Promise.all([getStaffViewer(), searchParams]);
  await connection();
  const tab: AnalyticsTab | null = pickTab(one(sp, "tab"), analyticsAccess(viewer));
  if (!tab) redirect("/app");
  const scope = scopeOf(sp);
  if (tab === "revenue") return <RevenueTab scope={scope} />;
  if (tab === "ai") return <AiTab scope={scope} />;
  return <OperationsTab scope={scope} />;
}

function TabSkeleton() {
  return (
    <div className="space-y-6">
      <KpiSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionSkeleton rows={6} />
        <SectionSkeleton rows={6} />
      </div>
    </div>
  );
}
