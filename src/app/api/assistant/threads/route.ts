import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadViewerState } from "@/lib/server/viewer";
import { listThreads } from "@/lib/ai/assistant/queries";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The person's recent assistant conversations of one kind (staff or command). */
export async function GET(request: NextRequest) {
  await connection();
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff") return NextResponse.json({ threads: [] }, { status: 401, headers: PRIVATE });
  const kind = request.nextUrl.searchParams.get("kind") === "command" ? "command" : "staff";
  const supabase = await createClient();
  return NextResponse.json({ threads: await listThreads(supabase, kind) }, { headers: PRIVATE });
}
