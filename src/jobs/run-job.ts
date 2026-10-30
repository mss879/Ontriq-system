/**
 * The worker loop. Used by the Netlify Background Function, by the local
 * worker script, and in-process during development. Plain Node only.
 */
import { createServiceClient, type ServiceClient } from "./admin-client";
import { JOB_HANDLERS } from "./registry";
import { NonRetryableError, type JobContext, type JobRow } from "./types";
import type { Json } from "../lib/supabase/database.types";

const LEASE_SECONDS = 600;

export async function runJob(job: JobRow, ctx: JobContext): Promise<"succeeded" | "queued" | "dead"> {
  const handler = JOB_HANDLERS[job.kind];
  try {
    if (!handler) throw new NonRetryableError(`no handler for job kind "${job.kind}"`);
    const result = await handler(job, ctx);
    await ctx.admin.rpc("complete_job", { p_id: job.id, p_worker: ctx.workerId, p_result: (result ?? null) as Json });
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const retryable = !(error instanceof NonRetryableError);
    const { data } = await ctx.admin.rpc("fail_job", {
      p_id: job.id,
      p_worker: ctx.workerId,
      p_error: message,
      p_retryable: retryable,
    });
    console.error(`[job ${job.kind} ${job.id}] attempt ${job.attempts} failed: ${message}`);
    return (data as "queued" | "dead" | null) ?? "dead";
  }
}

export type DrainResult = { workerId: string; processed: number; succeeded: number; failed: number; stoppedBy: "empty" | "deadline" | "max" };

/**
 * Claim and run jobs one at a time until the queue is empty or the time budget
 * is spent. Never starts a job with less than `reserveMs` left.
 */
export async function drainJobs(opts: {
  budgetMs: number;
  reserveMs?: number;
  maxJobs?: number;
  workerId?: string;
  admin?: ServiceClient;
}): Promise<DrainResult> {
  const admin = opts.admin ?? createServiceClient();
  const workerId = opts.workerId ?? `w-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + opts.budgetMs;
  const reserve = opts.reserveMs ?? 90_000;
  const maxJobs = opts.maxJobs ?? 500;
  const now = () => new Date().toISOString();

  await admin.from("job_workers").upsert({ worker_id: workerId, started_at: now(), heartbeat_at: now(), jobs_done: 0 });
  const result: DrainResult = { workerId, processed: 0, succeeded: 0, failed: 0, stoppedBy: "empty" };

  try {
    while (true) {
      if (Date.now() > deadline - reserve) {
        result.stoppedBy = "deadline";
        break;
      }
      if (result.processed >= maxJobs) {
        result.stoppedBy = "max";
        break;
      }
      const { data: claimed, error } = await admin.rpc("claim_jobs", { p_worker: workerId, p_limit: 1, p_lease_seconds: LEASE_SECONDS });
      if (error) throw new Error(`claim_jobs failed: ${error.message}`);
      const job = (claimed as JobRow[] | null)?.[0];
      if (!job) break;

      const ctx: JobContext = {
        admin,
        workerId,
        deadline,
        heartbeat: async (progress) => {
          await admin.rpc("heartbeat_job", { p_id: job.id, p_worker: workerId, p_lease_seconds: LEASE_SECONDS, p_progress: progress ?? null });
          await admin.from("job_workers").update({ heartbeat_at: now() }).eq("worker_id", workerId);
        },
      };
      const outcome = await runJob(job, ctx);
      result.processed += 1;
      if (outcome === "succeeded") result.succeeded += 1;
      else result.failed += 1;
      await admin.from("job_workers").update({ heartbeat_at: now() }).eq("worker_id", workerId);
    }
  } finally {
    await admin.from("job_workers").delete().eq("worker_id", workerId);
  }
  return result;
}

/** True when runnable jobs are waiting. */
export async function hasRunnableJobs(admin: ServiceClient): Promise<boolean> {
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString());
  return (count ?? 0) > 0;
}
