import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Ends the session. If the auth service can't be reached, this browser still signs out. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    const store = await cookies();
    for (const { name } of store.getAll()) if (name.startsWith("sb-")) store.delete(name);
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
