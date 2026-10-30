/** What the analytics functions (0034_analytics.sql) return. Numbers may arrive as strings from numeric columns; use num(). */

type N = number | string | null;

export type OperationsData = {
  period: { from: string; to: string };
  summary: {
    received: N;
    released: N;
    cancelled: N;
    open_now: N;
    overdue_now: N;
    on_hold_now: N;
    avg_tat_hours: N;
    median_tat_hours: N;
    sla_met: N;
    sla_missed: N;
  };
  weekly: { week: string; received: N; released: N }[];
  by_stage: { stage: string; count: N; on_hold: N }[];
  stage_hours: { stage: string; avg_hours: N; median_hours: N; samples: N }[];
  tat_by_package: { package: string; released: N; avg_hours: N; median_hours: N; sla_met: N; sla_missed: N }[];
  result_mix: { result: "green" | "amber" | "red" | "none"; count: N }[];
  officers: { user_id: string; name: string; open_checks: N; overdue_checks: N; completed: N }[];
  top_clients: { client_id: string; name: string; received: N; released: N; open: N }[];
};

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export type RevenueData = {
  period: { from: string; to: string };
  currency: string;
  other_currency_invoices: N;
  summary: { invoiced: N; invoice_count: N; collected: N; payment_count: N; credited: N; outstanding: N; overdue: N; open_invoices: N };
  aging: { bucket: AgingBucket; amount: N; invoices: N }[];
  monthly: { month: string; invoiced: N; collected: N }[];
  top_billed: { client_id: string; name: string; amount: N; invoices: N }[];
  top_outstanding: { client_id: string; name: string; amount: N; overdue: N; invoices: N }[];
};

export type AiData = {
  period: { from: string; to: string };
  summary: {
    cost_usd: N;
    runs: N;
    failed_runs: N;
    input_tokens: N;
    output_tokens: N;
    cache_read_tokens: N;
    released_cases: N;
    cost_per_released_case: N;
  };
  daily: { day: string; cost_usd: N; runs: N }[];
  by_capability: { key: string; label: string; runs: N; cost_usd: N; input_tokens: N; output_tokens: N }[];
  by_model: { model: string; runs: N; cost_usd: N }[];
};

/** A numeric value from jsonb (numbers or numeric strings), 0 when missing. */
export function num(v: N | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Like num() but keeps "no data" as null. */
export function numOrNull(v: N | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
