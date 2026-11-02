import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Viewer } from "@/lib/server/viewer";
import type { ServiceClient } from "@/jobs/admin-client";
import { can } from "@/domain/permissions";
import { formatMoney } from "@/domain/pricing/money";
import { displayStatus } from "@/domain/pricing/invoice-core";
import { STAGE_SHORT, type Stage } from "@/domain/workflow/stages";
import { REPORT_KINDS, reportSummary } from "@/domain/business-report/build";
import { loadBusinessReport, queueReportPdf } from "./reports";
import type { Artifact } from "./types";

export type { Artifact } from "./types";

/**
 * The assistant's tools (plan §8 capability 9, §9). Read tools run as the
 * person asking (their row level security client), so the assistant sees only
 * what they may see, and return an artifact the chat draws (table, cards,
 * metrics). Action tools never act: they propose a confirm card
 * (assistant_actions); the person confirms, then `execute` runs with their
 * permissions re-checked. `commandOnly` tools are for the Super Admin's
 * command assistant.
 */

/** `supabase` is the person's own client (every read goes through it). `admin` is only for writes the person cannot make directly once their permission is checked: memories and the email outbox. */
export type ToolContext = { supabase: SupabaseClient<Database>; admin: ServiceClient; viewer: Viewer; threadId: string };
export type Proposal = { title: string; lines: string[]; input: Record<string, unknown> };
type Run = { summary: string; artifact?: Artifact };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  permissions?: string[];
  commandOnly?: boolean;
} & (
  | { kind: "read"; run: (ctx: ToolContext, input: z.infer<S>) => Promise<Run> }
  | {
      kind: "action";
      propose: (ctx: ToolContext, input: z.infer<S>) => Promise<Proposal>;
      execute: (ctx: ToolContext, input: Record<string, unknown>) => Promise<{ summary: string; undo?: Record<string, unknown> }>;
      undo?: (ctx: ToolContext, undo: Record<string, unknown>) => Promise<string>;
    }
);

const def = <S extends z.ZodType>(t: ToolDef<S>) => t as unknown as ToolDef;
const stageLabel = (s: string) => STAGE_SHORT[s as Stage] ?? s;
const REPORT_PERMISSIONS = ["staff.performance.read", "analytics.read", "billing.export", "invoices.manage"];
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const reportInput = {
  kind: z.enum(REPORT_KINDS).describe("team_performance: scores and ranking per staff member. operations: cases, turnaround and results. revenue: invoiced, collected, owed."),
  from: isoDay,
  to: isoDay,
  client: z.string().optional().describe("Limit operations or revenue to one client"),
};
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Colombo" }) : "—");

async function findCase(ctx: ToolContext, ref: string) {
  const q = ref.trim();
  const query = ctx.supabase.from("cases").select("id, reference, candidate_name, stage, client_id, assigned_to, due_at, on_hold");
  const { data } = /^[0-9a-f-]{36}$/i.test(q) ? await query.eq("id", q).maybeSingle() : await query.ilike("reference", `%${q.replace(/[%_]/g, "")}%`).limit(1).maybeSingle();
  return data;
}

async function findPerson(ctx: ToolContext, name: string) {
  const { data } = await ctx.supabase.from("profiles").select("id, full_name, email").or(`full_name.ilike.%${name.replace(/[%_,()]/g, "")}%,email.ilike.%${name.replace(/[%_,()]/g, "")}%`).limit(5);
  const { data: staff } = await ctx.supabase.from("memberships").select("user_id").eq("kind", "staff").eq("status", "active").in("user_id", (data ?? []).map((p) => p.id));
  const ids = new Set((staff ?? []).map((m) => m.user_id));
  return (data ?? []).filter((p) => ids.has(p.id));
}

export const TOOLS: ToolDef[] = [
  def({
    name: "search_records",
    kind: "read",
    description: "Find cases, candidates and clients by reference, name, NIC or company. Use first when the user names something.",
    schema: z.object({ query: z.string().describe("What to look for") }),
    run: async (ctx, { query }) => {
      const { data } = await ctx.supabase.rpc("search_everything", { p_query: query, p_limit: 10 });
      const hits = (data ?? []) as { kind: string; title: string; subtitle: string; href: string }[];
      return {
        summary: hits.length ? hits.map((h) => `${h.kind}: ${h.title} (${h.subtitle}) ${h.href}`).join("\n") : "No matches.",
        artifact: hits.length ? { type: "cards", title: `Results for "${query}"`, items: hits.map((h) => ({ title: h.title, subtitle: h.subtitle, meta: h.kind, href: h.href })) } : undefined,
      };
    },
  }),
  def({
    name: "list_cases",
    kind: "read",
    description: "List cases with optional filters: stage, overdue only, mine only, client name. Returns up to 25.",
    permissions: ["cases.read", "cases.read_assigned"],
    schema: z.object({
      stage: z.enum(["intake", "documents", "pre_qc", "data_entry", "verification", "post_qc", "report", "approval", "released", "cancelled"]).optional(),
      overdue: z.boolean().optional(),
      mine: z.boolean().optional(),
      client: z.string().optional(),
    }),
    run: async (ctx, input) => {
      let q = ctx.supabase.from("cases").select("id, reference, candidate_name, stage, due_at, client:clients(name)").order("received_at", { ascending: false }).limit(25);
      if (input.stage) q = q.eq("stage", input.stage);
      else q = q.not("stage", "in", "(released,cancelled)");
      if (input.overdue) q = q.lt("due_at", new Date().toISOString());
      if (input.mine) q = q.eq("assigned_to", ctx.viewer.userId);
      const { data } = await q;
      let rows = data ?? [];
      if (input.client) rows = rows.filter((r) => ((r.client as unknown as { name: string })?.name ?? "").toLowerCase().includes(input.client!.toLowerCase()));
      const params = new URLSearchParams();
      if (input.stage) params.set("stage", input.stage);
      if (input.overdue) params.set("due", "overdue");
      if (input.mine) params.set("owner", "me");
      return {
        summary: rows.length ? rows.map((r) => `${r.reference} ${r.candidate_name} ${stageLabel(r.stage)} due ${day(r.due_at)}`).join("\n") : "No cases match.",
        artifact: {
          type: "table",
          title: `${rows.length} case${rows.length === 1 ? "" : "s"}`,
          columns: ["Reference", "Candidate", "Client", "Stage", "Due"],
          rows: rows.map((r) => [r.reference, r.candidate_name, (r.client as unknown as { name: string })?.name ?? "", stageLabel(r.stage), day(r.due_at)]),
          href: `/app/cases?${params.toString()}`,
        },
      };
    },
  }),
  def({
    name: "get_case",
    kind: "read",
    description: "Everything about one case by reference (e.g. ONT-2026-000123): stage, checks, missing documents, owner, due date.",
    permissions: ["cases.read", "cases.read_assigned"],
    schema: z.object({ reference: z.string() }),
    run: async (ctx, { reference }) => {
      const c = await findCase(ctx, reference);
      if (!c) return { summary: "Case not found, or you don't have access to it." };
      const [{ data: checks }, { data: reqs }] = await Promise.all([
        ctx.supabase.from("case_checks").select("label, state, result, assigned_to, due_at").eq("case_id", c.id).order("sort"),
        ctx.supabase.from("case_check_requirements").select("label, status, min_count, received_count").eq("case_id", c.id),
      ]);
      const missing = (reqs ?? []).filter((r) => r.status === "pending" && r.min_count > r.received_count).map((r) => r.label);
      return {
        summary: `${c.reference} ${c.candidate_name}: ${stageLabel(c.stage)}${c.on_hold ? " (on hold)" : ""}, due ${day(c.due_at)}. Checks: ${(checks ?? []).map((k) => `${k.label} ${k.state}${k.result ? ` ${k.result}` : ""}`).join("; ")}. Missing documents: ${missing.join(", ") || "none"}.`,
        artifact: {
          type: "cards",
          title: `${c.reference} · ${c.candidate_name}`,
          items: [
            { title: stageLabel(c.stage), subtitle: `Due ${day(c.due_at)}${c.on_hold ? " · on hold" : ""}`, href: `/app/cases/${c.id}` },
            ...(checks ?? []).map((k) => ({ title: k.label, subtitle: k.state.replace(/_/g, " "), meta: k.result ?? undefined })),
            ...(missing.length ? [{ title: "Missing documents", subtitle: missing.join(", ") }] : []),
          ],
        },
      };
    },
  }),
  def({
    name: "my_work",
    kind: "read",
    description: "The user's own open checks and cases with due dates, overdue first.",
    schema: z.object({}),
    run: async (ctx) => {
      const { data } = await ctx.supabase.rpc("my_open_items", {});
      const items = ((data ?? []) as { label: string; reference: string; due_at: string | null; overdue: boolean; case_id: string }[]).sort((a, b) => Number(b.overdue) - Number(a.overdue));
      return {
        summary: items.length ? `${items.length} open items, ${items.filter((i) => i.overdue).length} overdue.` : "Nothing open.",
        artifact: { type: "table", title: "Your open work", columns: ["Reference", "Item", "Due", "Status"], rows: items.map((i) => [i.reference, i.label, day(i.due_at), i.overdue ? "Overdue" : "Open"]), href: "/app/queues" },
      };
    },
  }),
  def({
    name: "team_workload",
    kind: "read",
    description: "Who is busy and who is behind right now: open and overdue items per staff member, with what they completed in the last N days. For scores, rankings or set dates, use business_report.",
    permissions: ["staff.performance.read"],
    schema: z.object({ days: z.number().optional() }),
    run: async (ctx, { days }) => {
      const to = new Date();
      const from = new Date(to.getTime() - (days ?? 7) * 86_400_000);
      const { data } = await ctx.supabase.rpc("performance_board", { p_from: from.toISOString().slice(0, 10), p_to: to.toISOString().slice(0, 10) });
      const rows = ((data ?? []) as { name: string; open: number; overdue: number; checks_completed: number; sla_met: number; sla_missed: number }[]).sort((a, b) => b.overdue - a.overdue);
      return {
        summary: rows.map((r) => `${r.name}: ${r.open} open, ${r.overdue} overdue, ${r.checks_completed} completed`).join("\n") || "No team data.",
        artifact: { type: "table", title: `Team workload (${days ?? 7} days)`, columns: ["Person", "Open", "Overdue", "Completed", "On time"], rows: rows.map((r) => [r.name, r.open, r.overdue, r.checks_completed, r.sla_met + r.sla_missed ? `${Math.round((100 * r.sla_met) / (r.sla_met + r.sla_missed))}%` : "—"]), href: "/app/team/performance" },
      };
    },
  }),
  def({
    name: "list_invoices",
    kind: "read",
    description: "Invoices by status: unpaid (open), overdue, or older than N days past due, with balances.",
    permissions: ["invoices.manage", "invoices.send", "payments.record", "billing.export"],
    schema: z.object({ status: z.enum(["unpaid", "overdue", "paid", "draft"]).optional(), older_than_days: z.number().optional(), client: z.string().optional() }),
    run: async (ctx, input) => {
      let q = ctx.supabase.from("invoices").select("id, number, status, due_date, total, balance, currency, client:clients(name)").order("due_date", { ascending: true }).limit(50);
      if (input.status === "paid") q = q.eq("status", "paid");
      else if (input.status === "draft") q = q.eq("status", "draft");
      else q = q.in("status", ["sent", "viewed", "partially_paid"]);
      if (input.status === "overdue" || input.older_than_days) {
        const cutoff = new Date(Date.now() - (input.older_than_days ?? 0) * 86_400_000).toISOString().slice(0, 10);
        q = q.lt("due_date", cutoff);
      }
      const { data } = await q;
      let rows = data ?? [];
      if (input.client) rows = rows.filter((r) => ((r.client as unknown as { name: string })?.name ?? "").toLowerCase().includes(input.client!.toLowerCase()));
      const total = rows.reduce((a, r) => a + Number(r.balance), 0);
      return {
        summary: `${rows.length} invoices, outstanding ${formatMoney(total)}. ${rows.map((r) => `${r.number} ${(r.client as unknown as { name: string })?.name} ${formatMoney(r.balance, r.currency)} due ${r.due_date}`).join("; ")}`,
        artifact: {
          type: "table",
          title: `${rows.length} invoice${rows.length === 1 ? "" : "s"} · ${formatMoney(total)} outstanding`,
          columns: ["Invoice", "Client", "Due", "Status", "Balance"],
          rows: rows.map((r) => [r.number ?? "Draft", (r.client as unknown as { name: string })?.name ?? "", r.due_date ?? "—", displayStatus(r.status, r.due_date), formatMoney(r.balance, r.currency)]),
          href: "/app/invoices",
        },
      };
    },
  }),
  def({
    name: "client_summary",
    kind: "read",
    description: "A client company at a glance: status, open cases, and (with billing access) what they owe.",
    permissions: ["clients.read", "clients.manage"],
    schema: z.object({ name: z.string() }),
    run: async (ctx, { name }) => {
      const { data: cl } = await ctx.supabase.from("clients").select("id, name, code, status, sla_days, payment_terms_days").or(`name.ilike.%${name.replace(/[%_,()]/g, "")}%,code.ilike.%${name.replace(/[%_,()]/g, "")}%`).limit(1).maybeSingle();
      if (!cl) return { summary: "No client by that name." };
      const { count: open } = await ctx.supabase.from("cases").select("id", { count: "exact", head: true }).eq("client_id", cl.id).not("stage", "in", "(released,cancelled)");
      const billing = can(ctx.viewer, "invoices.manage") || can(ctx.viewer, "billing.export");
      const bal = billing ? ((await ctx.supabase.rpc("client_balance", { p_client: cl.id })).data as { outstanding: number; overdue: number } | null) : null;
      return {
        summary: `${cl.name} (${cl.code}) is ${cl.status}; ${open ?? 0} open cases${bal ? `; owes ${formatMoney(bal.outstanding)} (${formatMoney(bal.overdue)} overdue)` : ""}.`,
        artifact: {
          type: "metrics",
          title: cl.name,
          items: [
            { label: "Status", value: cl.status },
            { label: "Open cases", value: String(open ?? 0) },
            { label: "Turnaround", value: `${cl.sla_days} days` },
            ...(bal ? [{ label: "Outstanding", value: formatMoney(bal.outstanding) }, { label: "Overdue", value: formatMoney(bal.overdue) }] : []),
          ],
        },
      };
    },
  }),
  def({
    name: "ai_usage",
    kind: "read",
    description: "What AI has cost over the last N days, by capability.",
    permissions: ["ai.usage.read", "ai.configure"],
    schema: z.object({ days: z.number().optional() }),
    run: async (ctx, { days }) => {
      const to = new Date();
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      const { data } = await ctx.supabase.rpc("ai_cost_summary", { p_from: from.toISOString(), p_to: to.toISOString(), p_group: "capability" });
      const rows = ((data ?? []) as unknown as { group_key: string; runs: number; cost_usd: number }[]).map((r) => ({ ...r, key: r.group_key }));
      const total = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
      return {
        summary: `AI cost over ${days ?? 30} days: $${total.toFixed(2)}. ${rows.map((r) => `${r.key} $${Number(r.cost_usd).toFixed(2)}`).join("; ")}`,
        artifact: { type: "table", title: `AI usage · $${total.toFixed(2)}`, columns: ["Capability", "Runs", "Cost (USD)"], rows: rows.map((r) => [r.key, r.runs, Number(r.cost_usd).toFixed(4)]), href: "/app/settings/ai" },
      };
    },
  }),
  def({
    name: "business_report",
    kind: "read",
    description: "A full report for exact dates: team performance with scores and a ranking, operations, or revenue. Use it for who performed best, how a period went, or before making a PDF.",
    permissions: REPORT_PERMISSIONS,
    schema: z.object(reportInput),
    run: async (ctx, input) => {
      const report = await loadBusinessReport(ctx, input);
      if (typeof report === "string") return { summary: report };
      if (report.empty) return { summary: `Nothing is recorded for ${report.period}. Say so plainly and don't make a PDF.` };
      const main = report.sections[0];
      return {
        summary: reportSummary(report),
        artifact: { type: "table", title: `${report.title} · ${report.period}`, columns: main.columns.map((c) => c.label), rows: main.rows, href: report.kind === "team_performance" ? "/app/team/performance" : "/app/analytics" },
      };
    },
  }),
  def({
    name: "create_report_pdf",
    kind: "read",
    commandOnly: true,
    description: "Make a branded PDF of a report, with a download button in the chat. Call business_report first, then pass the same kind and dates with key points taken only from its figures.",
    permissions: REPORT_PERMISSIONS,
    schema: z.object({ ...reportInput, key_points: z.array(z.string().max(300)).max(6).describe("Two to five short points for the reader, using only figures from business_report") }),
    run: async (ctx, { key_points, ...input }) => {
      const report = await loadBusinessReport(ctx, input);
      if (typeof report === "string") return { summary: report };
      if (report.empty) return { summary: `Nothing is recorded for ${report.period}, so no PDF was made. Say so plainly.` };
      const id = await queueReportPdf(ctx, { ...report, points: key_points });
      return {
        summary: `The PDF is being prepared and a download button is on screen. Main finding: ${report.headline}`,
        artifact: { type: "file", title: `${report.title} · ${report.period}`, subtitle: report.headline, document_id: id },
      };
    },
  }),

  // ---------------------------------------------------------------- actions (confirm cards)
  def({
    name: "add_case_note",
    kind: "action",
    description: "Propose adding an internal note to a case.",
    permissions: ["cases.update", "cases.read"],
    schema: z.object({ reference: z.string(), note: z.string() }),
    propose: async (ctx, { reference, note }) => {
      const c = await findCase(ctx, reference);
      if (!c) throw new Error("Case not found, or you don't have access to it.");
      return { title: `Add a note to ${c.reference}`, lines: [note], input: { case_id: c.id, note } };
    },
    execute: async (ctx, input) => {
      const { error } = await ctx.supabase.rpc("add_case_note", { p_case: String(input.case_id), p_check: null as unknown as string, p_body: String(input.note) });
      if (error) throw new Error(error.message);
      return { summary: "Note added." };
    },
  }),
  def({
    name: "assign_case",
    kind: "action",
    description: "Propose giving a case to a staff member (by name).",
    permissions: ["cases.assign"],
    schema: z.object({ reference: z.string(), person: z.string(), reason: z.string().optional() }),
    propose: async (ctx, { reference, person, reason }) => {
      const c = await findCase(ctx, reference);
      if (!c) throw new Error("Case not found, or you don't have access to it.");
      const people = await findPerson(ctx, person);
      if (people.length !== 1) throw new Error(people.length ? `Several people match "${person}": ${people.map((p) => p.full_name).join(", ")}` : `No staff member matches "${person}".`);
      return { title: `Give ${c.reference} to ${people[0].full_name}`, lines: [c.candidate_name, ...(reason ? [`Reason: ${reason}`] : [])], input: { case_id: c.id, user_id: people[0].id, previous: c.assigned_to, reason: reason ?? "Assigned from the assistant" } };
    },
    execute: async (ctx, input) => {
      const { error } = await ctx.supabase.rpc("assign_case", { p_case: String(input.case_id), p_user: String(input.user_id), p_reason: String(input.reason), p_include_checks: true });
      if (error) throw new Error(error.message);
      return { summary: "Case reassigned.", undo: input.previous ? { case_id: input.case_id, user_id: input.previous } : undefined };
    },
    undo: async (ctx, undo) => {
      const { error } = await ctx.supabase.rpc("assign_case", { p_case: String(undo.case_id), p_user: String(undo.user_id), p_reason: "Undone from the assistant", p_include_checks: true });
      if (error) throw new Error(error.message);
      return "Assignment undone.";
    },
  }),
  def({
    name: "hold_case",
    kind: "action",
    description: "Propose putting a case on hold (with a reason) or resuming it.",
    permissions: ["cases.hold"],
    schema: z.object({ reference: z.string(), hold: z.boolean(), reason: z.string().optional() }),
    propose: async (ctx, { reference, hold, reason }) => {
      const c = await findCase(ctx, reference);
      if (!c) throw new Error("Case not found, or you don't have access to it.");
      if (c.on_hold === hold) throw new Error(hold ? `${c.reference} is already on hold.` : `${c.reference} isn't on hold.`);
      if (hold && !reason) throw new Error("Say why the case should go on hold.");
      return { title: `${hold ? "Put" : "Resume"} ${c.reference}${hold ? " on hold" : ""}`, lines: [c.candidate_name, ...(reason ? [`Reason: ${reason}`] : [])], input: { case_id: c.id, hold, reason: reason ?? null } };
    },
    execute: async (ctx, input) => {
      const { error } = await ctx.supabase.rpc("set_case_hold", { p_case: String(input.case_id), p_hold: Boolean(input.hold), p_reason: (input.reason as string) ?? undefined });
      if (error) throw new Error(error.message);
      return { summary: input.hold ? "Case on hold." : "Case resumed.", undo: { case_id: input.case_id, hold: !input.hold, reason: "Undone from the assistant" } };
    },
    undo: async (ctx, undo) => {
      const { error } = await ctx.supabase.rpc("set_case_hold", { p_case: String(undo.case_id), p_hold: Boolean(undo.hold), p_reason: String(undo.reason) });
      if (error) throw new Error(error.message);
      return "Hold change undone.";
    },
  }),
  def({
    name: "push_nudge",
    kind: "action",
    description: "Propose pushing a staff member who is behind, with a short constructive message listing their overdue items.",
    permissions: ["staff.nudge"],
    schema: z.object({ person: z.string(), message: z.string() }),
    propose: async (ctx, { person, message }) => {
      const people = await findPerson(ctx, person);
      if (people.length !== 1) throw new Error(people.length ? `Several people match "${person}".` : `No staff member matches "${person}".`);
      return { title: `Push ${people[0].full_name}`, lines: [message], input: { user_id: people[0].id, message } };
    },
    execute: async (ctx, input) => {
      const { error } = await ctx.supabase.rpc("send_nudge", { p_to: String(input.user_id), p_message: String(input.message), p_channels: ["in_app", "email"] });
      if (error) throw new Error(error.message);
      return { summary: "Push sent." };
    },
  }),
  def({
    name: "remember",
    kind: "action",
    description: "Propose remembering a standing instruction or preference for future conversations (the user approves it).",
    schema: z.object({ instruction: z.string() }),
    propose: async (_ctx, { instruction }) => ({ title: "Remember this", lines: [instruction.slice(0, 500)], input: { instruction: instruction.slice(0, 500) } }),
    execute: async (ctx, input) => {
      const { data, error } = await ctx.admin
        .from("assistant_memories")
        .insert({ org_id: ctx.viewer.orgId, user_id: ctx.viewer.userId, content: String(input.instruction), status: "approved" })
        .select("id")
        .single();
      if (error || !data) throw new Error("Could not save the memory.");
      return { summary: "Saved to your memories.", undo: { memory_id: data.id } };
    },
    undo: async (ctx, undo) => {
      await ctx.admin.from("assistant_memories").update({ status: "rejected" }).eq("id", String(undo.memory_id)).eq("user_id", ctx.viewer.userId);
      return "Memory removed.";
    },
  }),
  def({
    name: "create_client",
    kind: "action",
    commandOnly: true,
    description: "Propose creating a client company (and inviting their first portal admin when an email is given).",
    permissions: ["clients.manage"],
    schema: z.object({ name: z.string(), contact_name: z.string().optional(), contact_email: z.string().optional(), payment_terms_days: z.number().optional() }),
    propose: async (_ctx, input) => ({
      title: `Create client ${input.name}`,
      lines: [
        ...(input.contact_name ? [`Contact: ${input.contact_name}${input.contact_email ? ` <${input.contact_email}>` : ""}`] : []),
        `Payment terms: ${input.payment_terms_days ?? 30} days`,
        ...(input.contact_email ? ["The contact gets a client portal invitation."] : []),
      ],
      input: input as Record<string, unknown>,
    }),
    execute: async (ctx, input) => {
      const { data: code } = await ctx.supabase.rpc("suggest_client_code", { p_name: String(input.name) });
      const { data: cl, error } = await ctx.supabase
        .from("clients")
        .insert({ org_id: ctx.viewer.orgId, name: String(input.name), code: String(code ?? String(input.name).slice(0, 8).toUpperCase()), status: "prospect", payment_terms_days: Number(input.payment_terms_days ?? 30) })
        .select("id, code")
        .single();
      if (error || !cl) throw new Error(error?.message ?? "Could not create the client.");
      if (input.contact_name) {
        await ctx.supabase.from("client_contacts").insert({ org_id: ctx.viewer.orgId, client_id: cl.id, name: String(input.contact_name), email: (input.contact_email as string) ?? null, is_primary: true });
      }
      if (input.contact_email && input.contact_name) {
        const { invitePortalPerson } = await import("@/lib/server/admin/portal-invites");
        await invitePortalPerson(ctx.viewer, { clientId: cl.id, email: String(input.contact_email).toLowerCase(), fullName: String(input.contact_name), roleKey: "client_admin" });
      }
      return { summary: `Client ${cl.code} created${input.contact_email ? " and invited to the portal" : ""}. Open /app/clients/${cl.id}.` };
    },
  }),
  def({
    name: "send_invoice_reminders",
    kind: "action",
    commandOnly: true,
    description: "Propose emailing a payment reminder for every unpaid invoice more than N days past due (one card lists them all).",
    permissions: ["invoices.send"],
    schema: z.object({ older_than_days: z.number() }),
    propose: async (ctx, { older_than_days }) => {
      const cutoff = new Date(Date.now() - older_than_days * 86_400_000).toISOString().slice(0, 10);
      const { data } = await ctx.supabase.from("invoices").select("id, number, balance, currency, due_date, client:clients(name)").in("status", ["sent", "viewed", "partially_paid"]).lt("due_date", cutoff).limit(100);
      const rows = data ?? [];
      if (!rows.length) throw new Error(`No unpaid invoices are more than ${older_than_days} days past due.`);
      return {
        title: `Send ${rows.length} payment reminder${rows.length === 1 ? "" : "s"}`,
        lines: rows.map((r) => `${r.number} · ${(r.client as unknown as { name: string })?.name} · ${formatMoney(r.balance, r.currency)} due ${r.due_date}`),
        input: { invoice_ids: rows.map((r) => r.id) },
      };
    },
    execute: async (ctx, input) => {
      const { sendInvoiceReminderNow } = await import("@/lib/ai/assistant/effects");
      let n = 0;
      for (const id of input.invoice_ids as string[]) if (await sendInvoiceReminderNow(ctx, id)) n++;
      return { summary: `${n} reminder${n === 1 ? "" : "s"} queued.` };
    },
  }),
];

export function toolsFor(viewer: Viewer, kind: "staff" | "command"): ToolDef[] {
  return TOOLS.filter((t) => (kind === "command" || !t.commandOnly) && (!t.permissions || t.permissions.some((p) => can(viewer, p as never))));
}

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}
