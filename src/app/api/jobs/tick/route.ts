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
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const quarter = `${hour}:${String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, "0")}`;
  const colomboNow = new Date(now.getTime() + 5.5 * 3600_000);
  const day = colomboNow.toISOString().slice(0, 10);
  const minutes = colomboNow.getUTCHours() * 60 + colomboNow.getUTCMinutes();
  const recurring: { kind: string; key: string }[] = [
    { kind: "reminder.candidate", key: `reminder.candidate:${hour}` },
    { kind: "invoice.reminders", key: `invoice.reminders:${hour}` },
    { kind: "sla.scan", key: `sla.scan:${quarter}` },
    { kind: "nudge.auto", key: `nudge.auto:${hour}` },
    // Once a day each, from their time onward (the idempotency key stops repeats).
    ...(minutes >= 30 ? [{ kind: "performance.rollup", key: `performance.rollup:${day}` }, { kind: "retention.purge", key: `retention.purge:${day}` }] : []),
    ...(minutes >= 7 * 60 + 30 ? [{ kind: "briefing.daily", key: `briefing.daily:${day}` }] : []),
  ];
  for (const job of recurring) {
    await admin.rpc("enqueue_job", { p_kind: job.kind, p_idempotency_key: job.key });
  }
  // Daily: sent quotations past their date expire. In the first week (Colombo): monthly invoices for last
  // month, so a day the scheduler was down costs nothing. The idempotency key stops repeats.
  await admin.rpc("expire_quotes");
  if (colomboNow.getUTCDate() <= 7) {
    const lastMonth = new Date(Date.UTC(colomboNow.getUTCFullYear(), colomboNow.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const { data: due } = await admin.rpc("monthly_billing_due", { p_month: lastMonth });
    for (const row of (due ?? []) as { client_id: string }[]) {
      await admin.rpc("enqueue_job", {
        p_kind: "invoice.draft",
        p_payload: { client_id: row.client_id, month: lastMonth },
        p_idempotency_key: `invoice.draft:monthly:${row.client_id}:${lastMonth.slice(0, 7)}`,
      });
    }
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
