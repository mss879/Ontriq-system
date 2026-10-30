import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/** Supabase client acting as the signed-in user (RLS applies). Create it where you use it. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the session on the next request.
        }
      },
    },
  });
}

/**
 * For Server Components that read business data. Those reads are never cached,
 * and creating a client reads the clock (the auth library checks the session's
 * expiry), which Next forbids while it prerenders a route for prefetching.
 * `connection()` marks the read as request-time. The viewer cache
 * ('use cache: private', which forbids connection()) uses createClient directly.
 */
export async function createRequestClient() {
  await connection();
  return createClient();
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
