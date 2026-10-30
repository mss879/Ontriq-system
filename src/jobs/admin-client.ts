/**
 * Service-role Supabase client for background work. Plain Node: no next/*,
 * no server-only, relative imports only (bundled by Netlify's esbuild).
 * Never import this from client components.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

export type ServiceClient = ReturnType<typeof createServiceClient>;

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service credentials are not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY).");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "ontriq-worker" } },
  });
}
