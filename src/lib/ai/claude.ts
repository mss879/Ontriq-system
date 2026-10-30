/**
 * Every Claude call goes through here. It reads the capability's routing
 * (model, effort, max tokens, on/off) from ai_capabilities, checks the AI
 * budgets, calls the Anthropic SDK (streaming, structured output when a zod
 * schema is given), and records an ai_runs row priced from ai_cost_rates
 * (0018). A refusal, truncation or error is recorded too and returned as a
 * typed failure, never thrown at the caller's user.
 *
 * Plain Node (no next/*, no server-only): the worker and server actions both
 * use it, with a service-role client for the ledger.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ServiceClient } from "../../jobs/admin-client";

export type AiContext = {
  orgId: string;
  caseId?: string | null;
  clientId?: string | null;
  documentId?: string | null;
  jobId?: string | null;
  userId?: string | null;
  source: string;
  promptVersion: string;
};

export type AiFailure = { ok: false; reason: "not_configured" | "disabled" | "over_budget" | "refused" | "truncated" | "error"; message: string };
export type AiSuccess<T> = { ok: true; text: string; data: T; model: string; runId: string | null };

type Capability = { key: string; model: string; effort: "low" | "medium" | "high" | "xhigh" | "max"; max_tokens: number; enabled: boolean };

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}
const capabilityCache = new Map<string, { at: number; value: Capability | null }>();

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function capability(admin: ServiceClient, key: string): Promise<Capability | null> {
  const hit = capabilityCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const { data } = await admin.from("ai_capabilities").select("key, model, effort, max_tokens, enabled").eq("key", key).maybeSingle();
  const value = (data as Capability | null) ?? null;
  capabilityCache.set(key, { at: Date.now(), value });
  return value;
}

/** Budgets with action "pause" stop non-essential calls once today's or this month's spend reaches them. */
export async function overBudget(admin: ServiceClient, orgId: string, capabilityKey: string): Promise<string | null> {
  const { data: budgets } = await admin.from("ai_budgets").select("capability, daily_usd, monthly_usd, action").eq("org_id", orgId);
  const relevant = (budgets ?? []).filter((b) => b.action === "pause" && (b.capability === null || b.capability === capabilityKey));
  if (!relevant.length) return null;
  const now = new Date();
  const dayStart = new Date(now.getTime() - (now.getTime() % 86_400_000)).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  for (const b of relevant) {
    let q = admin.from("ai_runs").select("cost_usd").eq("org_id", orgId).gte("created_at", monthStart);
    if (b.capability) q = q.eq("capability", b.capability);
    const { data: runs } = await q;
    const rows = (runs ?? []) as { cost_usd: number }[];
    const month = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
    if (b.monthly_usd !== null && month >= Number(b.monthly_usd)) return `monthly AI budget reached for ${b.capability ?? "the organisation"}`;
    if (b.daily_usd !== null) {
      let dq = admin.from("ai_runs").select("cost_usd").eq("org_id", orgId).gte("created_at", dayStart);
      if (b.capability) dq = dq.eq("capability", b.capability);
      const day = ((await dq).data ?? []).reduce((a, r) => a + Number((r as { cost_usd: number }).cost_usd), 0);
      if (day >= Number(b.daily_usd)) return `daily AI budget reached for ${b.capability ?? "the organisation"}`;
    }
  }
  return null;
}

/** Record one model call in the ledger (the assistant loop uses it for each turn). */
export async function record(
  admin: ServiceClient,
  ctx: AiContext,
  capabilityKey: string,
  model: string,
  started: number,
  outcome: { status: "ok" | "error" | "refused" | "truncated"; usage?: Anthropic.Usage; stopReason?: string | null; error?: string },
): Promise<string | null> {
  const u = outcome.usage;
  const { data } = await admin
    .from("ai_runs")
    .insert({
      org_id: ctx.orgId,
      capability: capabilityKey,
      model,
      prompt_version: ctx.promptVersion,
      source: ctx.source,
      case_id: ctx.caseId ?? null,
      client_id: ctx.clientId ?? null,
      document_id: ctx.documentId ?? null,
      job_id: ctx.jobId ?? null,
      input_tokens: u?.input_tokens ?? 0,
      output_tokens: u?.output_tokens ?? 0,
      cache_read_tokens: u?.cache_read_input_tokens ?? 0,
      cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
      duration_ms: Date.now() - started,
      status: outcome.status,
      stop_reason: outcome.stopReason ?? null,
      error: outcome.error?.slice(0, 2000) ?? null,
      created_by: ctx.userId ?? null,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * One structured call. `schema` describes the JSON the model must return; the
 * parsed value comes back in `data`. `content` may mix text and images/PDFs.
 */
export async function runStructured<S extends z.ZodType>(
  admin: ServiceClient,
  capabilityKey: string,
  ctx: AiContext,
  input: { system: string; content: Anthropic.ContentBlockParam[]; schema: S },
): Promise<AiSuccess<z.infer<S>> | AiFailure> {
  if (!isAiConfigured()) return { ok: false, reason: "not_configured", message: "AI is not set up (ANTHROPIC_API_KEY)." };
  const cap = await capability(admin, capabilityKey);
  if (!cap || !cap.enabled) return { ok: false, reason: "disabled", message: "This AI feature is switched off in Settings → AI." };
  const budget = await overBudget(admin, ctx.orgId, capabilityKey);
  if (budget) return { ok: false, reason: "over_budget", message: `Paused: ${budget}.` };

  client ??= new Anthropic();
  const started = Date.now();
  try {
    const stream = client.messages.stream({
      model: cap.model,
      max_tokens: cap.max_tokens,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.content }],
      output_config: { effort: cap.effort, format: zodOutputFormat(input.schema) },
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      await record(admin, ctx, cap.key, cap.model, started, { status: "refused", usage: message.usage, stopReason: message.stop_reason });
      return { ok: false, reason: "refused", message: "The AI declined this request." };
    }
    if (message.stop_reason === "max_tokens") {
      await record(admin, ctx, cap.key, cap.model, started, { status: "truncated", usage: message.usage, stopReason: message.stop_reason });
      return { ok: false, reason: "truncated", message: "The AI's answer was cut off." };
    }
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = (message as unknown as { parsed_output?: z.infer<S> | null }).parsed_output;
    const data = parsed ?? (input.schema.parse(JSON.parse(text)) as z.infer<S>);
    const runId = await record(admin, ctx, cap.key, cap.model, started, { status: "ok", usage: message.usage, stopReason: message.stop_reason });
    return { ok: true, text, data, model: cap.model, runId };
  } catch (error) {
    const msg = error instanceof Anthropic.APIError ? `${error.status ?? ""} ${error.message}` : error instanceof Error ? error.message : String(error);
    await record(admin, ctx, cap.key, cap.model, started, { status: "error", error: msg });
    return { ok: false, reason: "error", message: "The AI request failed. Try again in a moment." };
  }
}

/** Files larger than this are never sent to the model, whatever size the upload declared. */
export const MAX_AI_FILE_BYTES = 10 * 1024 * 1024;

/** A file from Storage as a content block Claude can read (images and PDFs), or null when it is too big or not readable. */
export function fileBlock(bytes: Uint8Array, mime: string): Anthropic.ContentBlockParam | null {
  if (bytes.byteLength > MAX_AI_FILE_BYTES) return null;
  const data = Buffer.from(bytes).toString("base64");
  if (mime === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") {
    return { type: "image", source: { type: "base64", media_type: mime, data } };
  }
  return null;
}
