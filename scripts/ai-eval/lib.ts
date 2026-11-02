/**
 * The evaluation harness. Every call goes through the app's own runStructured,
 * with a stand-in database that only supplies the capability's model and
 * records the run, so a score reflects the real request. Identical requests
 * are answered from a disk cache, so re-running costs nothing, and a hard
 * spending cap stops the run.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { anthropic, runStructured } from "../../src/lib/ai/claude";
import type { ServiceClient } from "../../src/jobs/admin-client";
import { OUT_DIR } from "./paths";

export const PRICE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export type Arm = { name: string; model: string; effort: "low" | "medium" | "high"; thinking?: "off"; maxTokens?: number; attempt?: number };
const MODEL = { h: "claude-haiku-5-5", s: "claude-sonnet-5-5", o: "claude-opus-5-5" };
export const arm = (tier: keyof typeof MODEL, effort: Arm["effort"], extra: Partial<Arm> = {}): Arm => ({ name: `${tier}-${effort}${extra.thinking === "off" ? "-nothink" : ""}`, model: MODEL[tier], effort, ...extra });

/** The max_tokens each capability has in the database today. */
const CAP_MAX: Record<string, number> = { "document.classify": 2000, "document.extract": 4000, "case.consistency": 4000, "case.preqc": 4000, "check.outreach": 2000, "check.response": 2000, "case.postqc": 16000, "report.narrative": 8000, "briefing.daily": 2000, "team.nudge": 600, "commercial.draft": 4000, "payment.slip": 600, "candidate.report": 6000 };

const CACHE_DIR = path.join(OUT_DIR, "cache");
mkdirSync(CACHE_DIR, { recursive: true });

export const spend = { live: 0, calls: 0, cached: 0, cap: Number(process.env.AI_EVAL_CAP ?? 20) };

type Seen = { message?: Anthropic.Message; cached?: boolean; thinking?: "off"; attempt: number };
const scope = new AsyncLocalStorage<Seen>();

function hashable(v: unknown): string {
  return JSON.stringify(v, (k, x) => (k === "data" && typeof x === "string" && x.length > 200 ? createHash("sha256").update(x).digest("hex") : x));
}

const client = anthropic();
const realStream = client.messages.stream.bind(client.messages);
(client.messages as unknown as { stream: unknown }).stream = (params: Anthropic.MessageStreamParams, opts?: Anthropic.RequestOptions) => {
  const seen = scope.getStore();
  const send = { ...params } as Anthropic.MessageStreamParams;
  if (seen?.thinking === "off") {
    // Claude Haiku 5.5 takes "disabled"; Claude Sonnet 5.5 turns thinking off with "between_tools".
    (send as unknown as { thinking: unknown }).thinking = { type: send.model.includes("haiku") ? "disabled" : "between_tools" };
  }
  const key = createHash("sha256").update(`${seen?.attempt ?? 0}:${hashable(send)}`).digest("hex").slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(file)) {
    const m = JSON.parse(readFileSync(file, "utf8")) as Anthropic.Message;
    if (seen) Object.assign(seen, { message: m, cached: true });
    return { finalMessage: async () => m };
  }
  if (spend.live >= spend.cap) throw new Error(`Spending cap of $${spend.cap} reached`);
  const stream = realStream(send, opts);
  const final = stream.finalMessage.bind(stream);
  stream.finalMessage = async () => {
    const m = await final();
    writeFileSync(file, JSON.stringify(m));
    if (seen) seen.message = m;
    spend.live += costOf(m.model, m.usage);
    spend.calls++;
    return m;
  };
  return stream;
};

export function costOf(model: string, u: Anthropic.Usage): number {
  const p = PRICE[model] ?? PRICE["claude-opus-5-5"];
  return (u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1_000_000;
}

/** Stands in for the service client: capability routing and the ledger, nothing else. */
function standIn(): ServiceClient {
  const from = (table: string) => {
    let key = "";
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (_c: string, v: string) => ((key = v), chain),
      gte: () => chain,
      insert: (row: { error_message?: string; error?: string }) => {
        if (row?.error_message ?? row?.error) console.error(`  call failed: ${row.error_message ?? row.error}`);
        return chain;
      },
      single: async () => ({ data: { id: "eval" } }),
      then: (done: (v: { data: unknown[] }) => unknown) => done({ data: [] }),
      maybeSingle: async () => {
        if (table !== "ai_capabilities") return { data: null };
        const [capability, model, effort, max] = key.split("|");
        return { data: { key, model, effort, max_tokens: Number(max) || CAP_MAX[capability] || 4000, enabled: true } };
      },
    };
    return chain;
  };
  return { from } as unknown as ServiceClient;
}
const admin = standIn();

export type Call<T> = {
  ok: boolean;
  data?: T;
  reason?: string;
  message?: string;
  model: string;
  usage?: Anthropic.Usage;
  thinkingTokens: number;
  stop?: string | null;
  ms: number;
  cost: number;
  cached: boolean;
};

export async function call<S extends z.ZodType>(capability: string, a: Arm, input: { system: string; content: Anthropic.ContentBlockParam[]; schema: S; minTokens?: number }): Promise<Call<z.infer<S>>> {
  const seen: Seen = { thinking: a.thinking, attempt: a.attempt ?? 0 };
  const key = `${capability}|${a.model}|${a.effort}|${a.maxTokens ?? ""}`;
  const t0 = Date.now();
  const r = await scope.run(seen, () => runStructured(admin, key, { orgId: "eval", source: "ai-eval", promptVersion: "eval" }, input));
  const u = seen.message?.usage;
  return {
    ok: r.ok,
    data: r.ok ? (r.data as z.infer<S>) : undefined,
    reason: r.ok ? undefined : r.reason,
    message: r.ok ? undefined : r.message,
    model: a.model,
    usage: u,
    thinkingTokens: (u as unknown as { output_tokens_details?: { thinking_tokens?: number } } | undefined)?.output_tokens_details?.thinking_tokens ?? 0,
    stop: seen.message?.stop_reason ?? null,
    ms: Date.now() - t0,
    cost: u ? costOf(a.model, u) : 0,
    cached: Boolean(seen.cached),
  };
}

export async function pool<T, R>(items: T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  }));
  return out;
}

export function save(run: string, suite: string, name: string, value: unknown) {
  const dir = path.join(OUT_DIR, "results", run, suite);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------- grading

export function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** How close a transcription is to the page, ignoring spacing and joiner characters. */
export function textSimilarity(truth: string, read: string): number {
  const clean = (s: string) => s.normalize("NFC").replace(/[\s‌‍﻿]/g, "");
  return ratio(clean(truth), clean(read));
}

const words = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|prof|professor|rev)\b\.?/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
const digits = (s: string) => s.replace(/\D/g, "");

export type Grade = "ok" | "wrong" | "missing";

export function gradeValue(truth: import("./docs").FieldTruth, value: unknown): Grade {
  if (value === undefined || value === null || value === "") return "missing";
  if ("period" in truth) {
    const v = (typeof value === "object" ? value : {}) as { from?: string | null; to?: string | null; present?: boolean };
    const p = truth.period;
    const fromOk = Boolean(v.from?.startsWith(p.from));
    const toOk = p.present ? v.present === true : Boolean(v.to?.startsWith(p.to ?? "~"));
    return fromOk && toOk ? "ok" : "wrong";
  }
  const s = String(value);
  if ("exact" in truth) return s.trim().toLowerCase().replace(/\s/g, "") === String(truth.exact).toLowerCase().replace(/\s/g, "") ? "ok" : "wrong";
  if ("name" in truth) return truth.name.some((n) => ratio([...words(n)].sort().join(" "), [...words(s)].sort().join(" ")) >= 0.86) ? "ok" : "wrong";
  const seen = s.toLowerCase();
  const found = (part: string) => (/^[\d ]+$/.test(part) ? digits(seen).includes(digits(part)) : seen.includes(part.toLowerCase()));
  if ("has" in truth) return truth.has.every(found) ? "ok" : "wrong";
  return truth.any.some(found) ? "ok" : "wrong";
}
