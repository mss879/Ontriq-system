/**
 * Scheduled every minute. Hands off to /api/jobs/tick and returns within a
 * few seconds so the scheduler never double-fires.
 */
import type { Config } from "@netlify/functions";

const sweeper = async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return new Response("not configured", { status: 200 });
  try {
    await fetch(`${base}/api/jobs/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The tick keeps running server-side after the abort; the next minute retries anyway.
  }
  return new Response("ok", { status: 200 });
};

export default sweeper;

export const config: Config = { schedule: "* * * * *" };
