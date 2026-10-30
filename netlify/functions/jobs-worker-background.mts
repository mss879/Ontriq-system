/**
 * Netlify Background Function (the "-background" suffix gives it 15 minutes
 * and an immediate 202). Claims and runs jobs for up to 13 minutes, then
 * re-invokes itself if work remains. Plain Node: no Next.js imports.
 */
import { createServiceClient } from "../../src/jobs/admin-client";
import { drainJobs, hasRunnableJobs } from "../../src/jobs/run-job";

const BUDGET_MS = 13 * 60_000;
const MAX_LIVE_WORKERS = 3;

const worker = async (request: Request) => {
  const secret = process.env.JOBS_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const admin = createServiceClient();
  const { count } = await admin
    .from("job_workers")
    .select("worker_id", { count: "exact", head: true })
    .gt("heartbeat_at", new Date(Date.now() - 90_000).toISOString());
  if ((count ?? 0) >= MAX_LIVE_WORKERS) return new Response(null, { status: 202 });

  const result = await drainJobs({ admin, budgetMs: BUDGET_MS, reserveMs: 90_000, workerId: `nf-${crypto.randomUUID()}` });
  console.info("[worker]", JSON.stringify(result));

  if (result.stoppedBy !== "empty" && (await hasRunnableJobs(admin))) {
    const base = process.env.URL;
    if (base) {
      await fetch(`${base}/.netlify/functions/jobs-worker-background`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }
  }
  return new Response(null, { status: 202 });
};

export default worker;
