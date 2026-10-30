import { SegmentedTabs } from "@/components/layout/tabs";
import { PERIODS, type Period } from "@/domain/performance/score-core";

/** Week / month / quarter, kept in the URL. */
export function PeriodSwitch({ period, basePath }: { period: Period; basePath: string }) {
  return <SegmentedTabs label="Period" size="sm" active={period} className="mx-0 px-0" items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: p.key === "week" ? basePath : `${basePath}?period=${p.key}` }))} />;
}
