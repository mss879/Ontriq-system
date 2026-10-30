import { can, type HasPermissions } from "../permissions";

/**
 * Which analytics sections a person may open. Mirrors the checks inside the
 * 0034 functions, which are what actually protect the numbers.
 */
export function analyticsAccess(viewer: HasPermissions) {
  const operations = can(viewer, "analytics.read");
  // Money figures are for finance: analytics.read alone (Viewer, Operations Manager) doesn't open them.
  const revenue = can(viewer, "billing.export") || can(viewer, "invoices.manage");
  const ai = operations || can(viewer, "ai.usage.read");
  return { operations, revenue, ai, any: operations || revenue || ai };
}

export const ANALYTICS_TABS = [
  { key: "operations", label: "Operations" },
  { key: "revenue", label: "Revenue" },
  { key: "ai", label: "AI cost" },
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];

/** The tab to show: the one asked for if allowed, else the first allowed. */
export function pickTab(requested: string | undefined, access: ReturnType<typeof analyticsAccess>): AnalyticsTab | null {
  const allowed = ANALYTICS_TABS.filter((t) => access[t.key]).map((t) => t.key);
  if (!allowed.length) return null;
  return (allowed as string[]).includes(requested ?? "") ? (requested as AnalyticsTab) : allowed[0];
}
