import { connection, NextResponse } from "next/server";
import { integrationStatus, isSupabaseConfigured, serviceRoleKey } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedMachine } from "@/lib/server/cron-auth";

/**
 * Liveness for uptime monitors: database reachable, scheduler recently ran.
 * The status code is enough for a monitor. The detail goes to a caller with the secret.
 */
export async function GET(request: Request) {
  await connection();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.config = {
    ok: isSupabaseConfigured() && Boolean(serviceRoleKey()),
    detail: integrationStatus()
      .filter((i) => i.required && !i.configured)
      .map((i) => i.key)
      .join(",") || undefined,
  };

  if (checks.config.ok) {
    try {
      const admin = createAdminClient();
      const started = Date.now();
      const { error } = await admin.from("orgs").select("id", { head: true, count: "exact" });
      checks.database = { ok: !error, detail: error ? error.message : `${Date.now() - started} ms` };

      const { data: tick } = await admin
        .from("system_events")
        .select("last_at")
        .eq("fingerprint", "tick.heartbeat")
        .maybeSingle();
      const ageSeconds = tick?.last_at ? Math.round((Date.now() - new Date(tick.last_at).getTime()) / 1000) : null;
      checks.scheduler = {
        ok: ageSeconds !== null && ageSeconds < 300,
        detail: ageSeconds === null ? "never ran" : `last tick ${ageSeconds}s ago`,
      };
    } catch (error) {
      checks.database = { ok: false, detail: error instanceof Error ? error.message : "unreachable" };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  const at = new Date().toISOString();
  return NextResponse.json(isAuthorizedMachine(request) ? { ok, checks, at } : { ok, at }, { status: ok ? 200 : 503 });
}
