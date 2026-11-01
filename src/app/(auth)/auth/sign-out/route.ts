import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirectTo } from "@/lib/server/redirect";

/** Ends the session. If the auth service can't be reached, this browser still signs out. */
export async function POST() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    const store = await cookies();
    for (const { name } of store.getAll()) if (name.startsWith("sb-")) store.delete(name);
  }
  return redirectTo("/login");
}
