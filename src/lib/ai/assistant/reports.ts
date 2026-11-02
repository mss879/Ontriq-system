import "server-only";
import { analyticsAccess } from "@/domain/analytics/access";
import { cleanPeriod, operationsReport, performanceReport, revenueReport, type BusinessReport, type ReportKind } from "@/domain/business-report/build";
import { can } from "@/domain/permissions";
import { normaliseWeights, scoreBoard, toBoardRow } from "@/domain/performance/score-core";
import { fetchOperations, fetchRevenue } from "@/lib/server/analytics/queries";
import type { Json } from "@/lib/supabase/database.types";
import type { ToolContext } from "./tools";

export type ReportRequest = { kind: ReportKind; from: string; to: string; client?: string };

/** Who may have which report. The database functions refuse anyone else as well. */
function mayRead(ctx: ToolContext, kind: ReportKind): boolean {
  if (kind === "team_performance") return can(ctx.viewer, "staff.performance.read");
  const access = analyticsAccess(ctx.viewer);
  return kind === "operations" ? access.operations : access.revenue;
}

async function findClient(ctx: ToolContext, name: string) {
  const safe = name.replace(/[%_,()]/g, "");
  const { data } = await ctx.supabase.from("clients").select("id, name").or(`name.ilike.%${safe}%,code.ilike.%${safe}%`).limit(2);
  return data ?? [];
}

/** Builds a report as the person asking. Returns a sentence to pass on when it can't. */
export async function loadBusinessReport(ctx: ToolContext, input: ReportRequest): Promise<BusinessReport | string> {
  if (!mayRead(ctx, input.kind)) return "This person doesn't have access to that report.";
  const period = cleanPeriod(input.from, input.to);
  if (typeof period === "string") return period;
  const { from, to } = period;

  if (input.kind === "team_performance") {
    const [{ data, error }, { data: rules }] = await Promise.all([
      ctx.supabase.rpc("performance_board", { p_from: from, p_to: to }),
      ctx.supabase.from("assignment_rules").select("performance_weights").eq("org_id", ctx.viewer.orgId).maybeSingle(),
    ]);
    if (error) return "The team figures couldn't be read.";
    const weights = normaliseWeights(rules?.performance_weights as Record<string, unknown> | null);
    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(toBoardRow);
    return performanceReport(scoreBoard(rows, weights, { from, to }), weights, from, to);
  }

  let client: { id: string; name: string } | null = null;
  if (input.client) {
    const found = await findClient(ctx, input.client);
    if (found.length !== 1) return found.length ? `Several clients match "${input.client}". Ask which one.` : `No client matches "${input.client}".`;
    client = found[0];
  }
  if (input.kind === "operations") {
    const data = await fetchOperations(ctx.supabase, from, to, client?.id ?? null);
    return data ? operationsReport(data, from, to, client?.name ?? null) : "This person doesn't have access to that report.";
  }
  const data = await fetchRevenue(ctx.supabase, from, to, client?.id ?? null);
  return data ? revenueReport(data, from, to, client?.name ?? null) : "This person doesn't have access to that report.";
}

/**
 * Queues the PDF and returns its document id. The figures wait in a table only
 * the worker can read, because job records can be read by more roles than the report.
 */
export async function queueReportPdf(ctx: ToolContext, report: BusinessReport): Promise<string> {
  const { data: doc, error } = await ctx.admin
    .from("generated_documents")
    .insert({ org_id: ctx.viewer.orgId, kind: "assistant_report", title: `${report.title}, ${report.from} to ${report.to}`, status: "queued", created_by: ctx.viewer.userId })
    .select("id")
    .single();
  if (error || !doc) throw new Error("The PDF couldn't be started.");
  const saved = await ctx.admin.from("assistant_report_figures").insert({ document_id: doc.id, org_id: ctx.viewer.orgId, report: report as unknown as NonNullable<Json> });
  if (saved.error) {
    await ctx.admin.from("generated_documents").update({ status: "failed" }).eq("id", doc.id);
    throw new Error("The PDF couldn't be started.");
  }
  const { enqueueJob } = await import("@/lib/server/jobs/enqueue");
  await enqueueJob({ kind: "assistant.report", payload: { document_id: doc.id }, entityType: "generated_document", entityId: doc.id, orgId: ctx.viewer.orgId, createdBy: ctx.viewer.userId });
  return doc.id;
}
