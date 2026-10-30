import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadViewerState } from "@/lib/server/viewer";

export type SearchHit = { kind: "case" | "candidate" | "client"; id: string; title: string; subtitle: string; href: string };

/**
 * Global search for the ⌘K palette. search_everything() runs as the caller,
 * so row level security filters every result.
 */
export async function GET(request: NextRequest) {
  await connection();
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff") return NextResponse.json({ hits: [] }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  if (q.trim().length < 2) return NextResponse.json({ hits: [] });
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_everything", { p_query: q, p_limit: 6 });
  return NextResponse.json({ hits: (data ?? []) as SearchHit[] }, { headers: { "Cache-Control": "private, no-store" } });
}
