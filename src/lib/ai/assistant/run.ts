import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, capability, isAiConfigured, overBudget, record, type AiContext } from "@/lib/ai/claude";
import type { Json } from "@/lib/supabase/database.types";
import { toolsFor, type ToolContext, type ToolDef } from "./tools";
import type { Artifact, AssistantEvent, Block } from "./types";

/**
 * One assistant turn (plan §8 capability 9, §9): a manual streaming tool loop.
 * Text streams to the browser as it is written; tool results come back as
 * artifacts (tables, cards, metrics) drawn beside the reply; action tools
 * only leave a confirm card. Each model call is priced in the ledger. The
 * turn stops at the tool-turn cap (4 staff, 6 command) or the wall budget.
 */

export type { AssistantEvent, Block } from "./types";

export const ASSISTANT_VERSION = "assistant-v1";
const BUDGET_MS = Number(process.env.ASSISTANT_BUDGET_MS ?? 22_000);
const TOOL_TIMEOUT_MS = 6_000;
const HISTORY = 16;

const LABELS: Record<string, string> = {
  search_records: "Searching",
  list_cases: "Looking up cases",
  get_case: "Opening the case",
  my_work: "Checking your work",
  team_workload: "Checking the team",
  list_invoices: "Looking up invoices",
  client_summary: "Looking up the client",
  ai_usage: "Adding up AI costs",
};

const BASE = `You are Ask Ontriq, the assistant inside Ontriq's background verification CRM in Sri Lanka. Ontriq verifies job applicants (candidates) for employers (clients): education, employment, address, police, NIC, references and sanctions checks.

How to work:
- Look things up with the tools. Never guess references, names, numbers, dates or amounts. If a tool finds nothing, say so plainly.
- The screen draws tool results as tables and cards beside your reply, so don't repeat a whole table. Answer in one to three short sentences: the count, the total, what stands out, what to do next.
- To change anything, call an action tool. That only shows the person a confirm card; nothing happens until they press Confirm. Never say an action is done: say it is ready for them to confirm.
- You see only what this person may see. When something isn't found, don't speculate whether it exists.
- Case references look like ONT-2026-000123. Money is in LKR unless shown otherwise. Dates and times are Sri Lanka time.
- Green, Amber and Red results are decided by people. Never present a result as final before the report is released.
- Be brief, plain and friendly. No headings or long lists for short answers.`;

const COMMAND = `\n\nYou are the Super Admin's command assistant, with reach across the whole system. Bulk actions show one card listing every item they will touch. There are no deletes: cancelling and voiding are done on the relevant screens.`;

function contextBlock(ctx: ToolContext, memories: string[]): string {
  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines = [`Now: ${now}.`, `You are talking to ${ctx.viewer.fullName || ctx.viewer.email} (${ctx.viewer.roleName}).`];
  if (memories.length) lines.push("Standing instructions they approved:", ...memories.map((m) => `- ${m}`));
  return lines.join("\n");
}

function inputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Tool.InputSchema;
}

/** Past messages as plain text turns (artifacts summarised), alternating and starting with the person. */
function history(rows: { role: string; content: Json }[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    const blocks = (Array.isArray(r.content) ? r.content : []) as Block[];
    const text = blocks
      .map((b) => (b.type === "text" ? b.text : b.type === "error" ? "" : b.type === "action" ? `[Proposed for confirmation: ${b.title}]` : `[Showed: ${b.title}]`))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;
    const role = r.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The lookup took too long.")), ms))]);

export async function* runAssistant(ctx: ToolContext, kind: "staff" | "command"): AsyncGenerator<AssistantEvent> {
  const capKey = kind === "command" ? "assistant.command" : "assistant.staff";
  const blocks: Block[] = [];
  const runIds: string[] = [];
  const actionIds: string[] = [];
  let model: string | null = null;

  const say = (text: string) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "text") last.text += text;
    else blocks.push({ type: "text", text });
  };

  const stopReason = await (async () => {
    if (!isAiConfigured()) return "AI isn't set up yet (ANTHROPIC_API_KEY). Ask an administrator to add it.";
    const cap = await capability(ctx.admin, capKey);
    if (!cap || !cap.enabled) return "The assistant is switched off in Settings → AI.";
    const budget = await overBudget(ctx.admin, ctx.viewer.orgId, capKey);
    if (budget) return `The assistant is paused: ${budget}.`;
    return null;
  })();
  if (stopReason) {
    blocks.push({ type: "error", text: stopReason });
    yield { type: "error", message: stopReason };
    yield { type: "done", message_id: await persist() };
    return;
  }

  const cap = (await capability(ctx.admin, capKey))!;
  model = cap.model;
  const tools = toolsFor(ctx.viewer, kind);
  const byName = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));
  const apiTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.kind === "action" ? `${t.description} This only shows a confirm card; the person decides.` : t.description,
    input_schema: inputSchema(t.schema),
    eager_input_streaming: true,
  }));

  const [{ data: past }, { data: mems }] = await Promise.all([
    ctx.supabase.from("assistant_messages").select("role, content, created_at").eq("thread_id", ctx.threadId).order("created_at", { ascending: false }).limit(HISTORY),
    ctx.supabase.from("assistant_memories").select("content").eq("user_id", ctx.viewer.userId).eq("status", "approved").order("created_at").limit(30),
  ]);
  const messages = history([...(past ?? [])].reverse());
  if (!messages.length) {
    yield { type: "error", message: "Nothing to answer." };
    return;
  }
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: kind === "command" ? BASE + COMMAND : BASE, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextBlock(ctx, (mems ?? []).map((m) => m.content)) },
  ];
  const aiCtx: AiContext = { orgId: ctx.viewer.orgId, userId: ctx.viewer.userId, source: `assistant.${kind}`, promptVersion: ASSISTANT_VERSION };

  const maxTurns = kind === "command" ? 6 : 4;
  const started = Date.now();
  let finished = false;
  let jsonRetries = 0;

  for (let turn = 0; turn < maxTurns && !finished; ) {
    const remaining = BUDGET_MS - (Date.now() - started);
    if (remaining < 2_000) break;
    const t0 = Date.now();
    const stream = anthropic().messages.stream(
      { model: cap.model, max_tokens: cap.max_tokens, system, messages, tools: apiTools, thinking: { type: "adaptive" }, output_config: { effort: cap.effort } },
      { signal: AbortSignal.timeout(remaining) },
    );
    let message: Anthropic.Message;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          say(ev.delta.text);
          yield { type: "text", delta: ev.delta.text };
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      const timedOut = error instanceof Anthropic.APIUserAbortError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
      // An unparseable streamed tool input is the one failure worth re-asking once.
      if (!timedOut && !(error instanceof Anthropic.APIError) && jsonRetries++ < 1) continue;
      const msg = error instanceof Anthropic.APIError ? `${error.status ?? ""} ${error.message}` : error instanceof Error ? error.message : String(error);
      const id = await record(ctx.admin, aiCtx, capKey, cap.model, t0, { status: "error", error: msg });
      if (id) runIds.push(id);
      const text = timedOut ? "That took longer than I'm allowed. Try a narrower question." : "Something went wrong reaching the AI. Try again in a moment.";
      blocks.push({ type: "error", text });
      yield { type: "error", message: text };
      break;
    }
    turn++;

    const status = message.stop_reason === "refusal" ? "refused" : message.stop_reason === "max_tokens" ? "truncated" : "ok";
    const id = await record(ctx.admin, aiCtx, capKey, cap.model, t0, { status, usage: message.usage, stopReason: message.stop_reason });
    if (id) runIds.push(id);

    if (message.stop_reason === "refusal") {
      say("\n\nI can't help with that one.");
      yield { type: "text", delta: "\n\nI can't help with that one." };
      break;
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length || message.stop_reason === "end_turn") break;
    if (message.stop_reason === "max_tokens") {
      blocks.push({ type: "error", text: "My answer was cut off. Try asking for less at once." });
      break;
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = byName.get(use.name);
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "That tool isn't available to this person." });
        continue;
      }
      const parsed = tool.schema.safeParse(use.input);
      if (!parsed.success) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(use.input) }) });
        continue;
      }
      try {
        if (tool.kind === "read") {
          yield { type: "tool", name: tool.name, label: LABELS[tool.name] ?? "Looking it up" };
          const out = await withTimeout(tool.run(ctx, parsed.data), TOOL_TIMEOUT_MS);
          if (out.artifact) {
            blocks.push(out.artifact);
            yield { type: "artifact", artifact: out.artifact };
          }
          results.push({ type: "tool_result", tool_use_id: use.id, content: out.summary.slice(0, 8000) });
        } else {
          const proposal = await withTimeout(tool.propose(ctx, parsed.data), TOOL_TIMEOUT_MS);
          const { data: row, error } = await ctx.admin
            .from("assistant_actions")
            .insert({
              org_id: ctx.viewer.orgId,
              thread_id: ctx.threadId,
              user_id: ctx.viewer.userId,
              tool: tool.name,
              input: proposal.input as NonNullable<Json>,
              preview: { title: proposal.title, lines: proposal.lines } as NonNullable<Json>,
            })
            .select("id")
            .single();
          if (error || !row) throw new Error("Could not prepare the confirm card.");
          actionIds.push(row.id);
          const card: Artifact = { type: "action", action_id: row.id, title: proposal.title, lines: proposal.lines, status: "proposed" };
          blocks.push(card);
          yield { type: "artifact", artifact: card };
          results.push({ type: "tool_result", tool_use_id: use.id, content: `A confirm card is now on screen: "${proposal.title}". It has NOT happened yet; the person must press Confirm.` });
        }
      } catch (error) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: error instanceof Error ? error.message : "The tool failed." });
      }
    }
    messages.push({ role: "user", content: results });
    if (turn >= maxTurns) {
      finished = true;
      const note = "\n\nI've reached my limit of steps for one question. Ask me to carry on if you need more.";
      say(note);
      yield { type: "text", delta: note };
    }
  }

  yield { type: "done", message_id: await persist() };

  async function persist(): Promise<string | null> {
    const { data } = await ctx.admin
      .from("assistant_messages")
      .insert({ org_id: ctx.viewer.orgId, thread_id: ctx.threadId, user_id: ctx.viewer.userId, role: "assistant", content: blocks as unknown as NonNullable<Json>, model, run_ids: runIds, status: blocks.some((b) => b.type === "error") && !blocks.some((b) => b.type === "text") ? "error" : "done" })
      .select("id")
      .single();
    if (data && actionIds.length) await ctx.admin.from("assistant_actions").update({ message_id: data.id }).in("id", actionIds);
    await ctx.admin.from("assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", ctx.threadId);
    return data?.id ?? null;
  }
}
