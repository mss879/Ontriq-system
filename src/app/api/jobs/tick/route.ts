import { connection, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedMachine } from "@/lib/server/cron-auth";
import { kickWorker } from "@/lib/server/jobs/kick";
import { hasRunnableJobs } from "@/jobs/run-job";

/**
 * Called every minute by netlify/functions/jobs-sweeper.mts.
 * Recovers expired leases, enqueues recurring work by idempotency key,
 * and wakes a worker when jobs are waiting. Mostly SQL; well under 30 s.
 */
export async function POST(request: Request) {
  await connection();
  if (!isAuthorizedMachine(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const swept = await admin.rpc("sweep_jobs");

  // Recurring work is added here phase by phase (sla.scan, briefings…). One job per bucket via the idempotency key.
  const hour = new Date().toISOString().slice(0, 13);
  const recurring: { kind: string; key: string }[] = [{ kind: "reminder.candidate", key: `reminder.candidate:${hour}` }];
  for (const job of recurring) {
    await admin.rpc("enqueue_job", { p_kind: job.kind, p_idempotency_key: job.key });
  }

  await admin.rpc("log_system_event", {
    p_kind: "tick",
    p_message: "Scheduler heartbeat",
    p_severity: "debug",
    p_fingerprint: "tick.heartbeat",
  });

  const waiting = await hasRunnableJobs(admin);
  if (waiting) kickWorker();

  return NextResponse.json({ ok: true, swept: swept.data ?? null, kicked: waiting });
}
