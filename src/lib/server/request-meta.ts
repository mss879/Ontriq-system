import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceRoleKey } from "@/lib/env";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Shared, database-backed rate limit (works across serverless instances).
 * Fails open when the service key is missing so local setup is not blocked.
 */
export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  if (!serviceRoleKey()) return true;
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_check", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
