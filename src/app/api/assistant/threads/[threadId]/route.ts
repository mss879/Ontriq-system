import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadViewerState } from "@/lib/server/viewer";
import { threadDetail } from "@/lib/ai/assistant/queries";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** One conversation: its messages and the live state of its confirm cards. Owner only (row level security). */
export async function GET(_request: Request, ctx: RouteContext<"/api/assistant/threads/[threadId]">) {
  await connection();
  const { threadId } = await ctx.params;
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: PRIVATE });
  if (!z.uuid().safeParse(threadId).success) return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE });
  const detail = await threadDetail(await createClient(), threadId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE });
  return NextResponse.json(detail, { headers: PRIVATE });
}
