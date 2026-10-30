import "server-only";
import { after } from "next/server";
import { drainJobs } from "@/jobs/run-job";

/**
 * Wake a worker after enqueueing. On Netlify this calls the Background
 * Function (returns 202 at once). Elsewhere (local dev) it drains the queue
 * in-process after the response is sent. Failures are harmless: the
 * 1-minute sweeper picks the work up.
 */
export function kickWorker(): void {
  const secret = process.env.JOBS_WORKER_SECRET;
  const base = process.env.URL ?? process.env.APP_ORIGIN;
  const onNetlify = Boolean(process.env.NETLIFY || process.env.JOBS_WORKER_URL);

  after(async () => {
    try {
      if (onNetlify && secret && base) {
        const url = process.env.JOBS_WORKER_URL ?? `${base.replace(/\/+$/, "")}/.netlify/functions/jobs-worker-background`;
        await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(2500) });
      } else {
        await drainJobs({ budgetMs: 25_000, reserveMs: 2_000, maxJobs: 25 });
      }
    } catch (error) {
      console.warn("[jobs] kick failed; the sweeper will retry", error);
    }
  });
}
