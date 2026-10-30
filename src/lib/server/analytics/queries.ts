import "server-only";
import { cache } from "react";
import { createClient, createRequestClient } from "@/lib/supabase/server";
import type { AiData, OperationsData, RevenueData } from "@/domain/analytics/types";

/**
 * Analytics reads (0034). Each summary is one call made as the signed-in
 * person; the database refuses anyone without the right permission, which
 * comes back here as null. Server Components use the cached getters; route
 * handlers pass their own client.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

async function call<T>(supabase: Client, fn: "analytics_operations" | "analytics_revenue" | "analytics_ai", args: Record<string, string | null>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    if (error.code === "42501") return null;
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

export function fetchOperations(supabase: Client, from: string, to: string, client: string | null) {
  return call<OperationsData>(supabase, "analytics_operations", { p_from: from, p_to: to, p_client: client });
}
export function fetchRevenue(supabase: Client, from: string, to: string, client: string | null) {
  return call<RevenueData>(supabase, "analytics_revenue", { p_from: from, p_to: to, p_client: client });
}
export function fetchAi(supabase: Client, from: string, to: string) {
  return call<AiData>(supabase, "analytics_ai", { p_from: from, p_to: to });
}

export const getOperations = cache(async (from: string, to: string, client: string | null) => fetchOperations(await createRequestClient(), from, to, client));
export const getRevenue = cache(async (from: string, to: string, client: string | null) => fetchRevenue(await createRequestClient(), from, to, client));
export const getAi = cache(async (from: string, to: string) => fetchAi(await createRequestClient(), from, to));

/** Clients for the filter, including archived ones that still have history. */
export const analyticsClients = cache(async (): Promise<{ id: string; name: string }[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("clients").select("id, name").order("name").limit(1000);
  return data ?? [];
});
