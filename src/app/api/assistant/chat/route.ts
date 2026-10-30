import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { runAssistant, type AssistantEvent } from "@/lib/ai/assistant/run";

const PRIVATE = { "Cache-Control": "private, no-store" };

const Body = z.object({
  thread_id: z.uuid().optional(),
  kind: z.enum(["staff", "command"]).default("staff"),
  text: z.string().trim().min(1).max(4000),
});

/**
 * Ask Ontriq and the command assistant (plan §8 capability 9, §9). Streams
 * server-sent events: thread, text, tool, artifact, error, done. The person
 * must be staff who may use this assistant; their own client does every
 * read. The person's message is stored before the model runs, the reply
 * after it finishes.
 */
export async function POST(request: NextRequest) {
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: PRIVATE });
  const viewer = state.viewer;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a message first." }, { status: 400, headers: PRIVATE });
  const { kind, text } = parsed.data;

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: allowed } = await supabase.rpc("can_use_assistant", { p_kind: kind });
  if (!allowed) return NextResponse.json({ error: kind === "command" ? "The command assistant is for the Super Admin." : "You don't have access to the assistant." }, { status: 403, headers: PRIVATE });
  const { data: underLimit } = await admin.rpc("rate_limit_check", { p_key: `assistant:${viewer.userId}`, p_window_seconds: 60, p_max: kind === "command" ? 20 : 12 });
  if (underLimit === false) return NextResponse.json({ error: "That's a lot of questions at once. Wait a minute and try again." }, { status: 429, headers: PRIVATE });

  let thread: { id: string; title: string } | null = null;
  if (parsed.data.thread_id) {
    const { data } = await supabase.from("assistant_threads").select("id, title, kind, archived_at").eq("id", parsed.data.thread_id).maybeSingle();
    if (!data || data.kind !== kind) return NextResponse.json({ error: "That conversation isn't available." }, { status: 404, headers: PRIVATE });
    thread = { id: data.id, title: data.title };
    if (data.archived_at) await supabase.from("assistant_threads").update({ archived_at: null }).eq("id", data.id);
  } else {
    const title = text.replace(/\s+/g, " ").slice(0, 60) + (text.length > 60 ? "…" : "");
    const { data, error } = await supabase.from("assistant_threads").insert({ org_id: viewer.orgId, user_id: viewer.userId, kind, title }).select("id, title").single();
    if (error || !data) return NextResponse.json({ error: "Could not start a conversation." }, { status: 500, headers: PRIVATE });
    thread = data;
  }

  const { error: msgError } = await admin
    .from("assistant_messages")
    .insert({ org_id: viewer.orgId, thread_id: thread.id, user_id: viewer.userId, role: "user", content: [{ type: "text", text }] });
  if (msgError) return NextResponse.json({ error: "Could not save your message." }, { status: 500, headers: PRIVATE });

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, e: AssistantEvent) =>
    controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
  const ctx = { supabase, admin, viewer, threadId: thread.id };
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      send(controller, { type: "thread", id: thread.id, title: thread.title });
      try {
        for await (const e of runAssistant(ctx, kind)) send(controller, e);
      } catch {
        send(controller, { type: "error", message: "Something went wrong. Try again in a moment." });
        send(controller, { type: "done", message_id: null });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { ...PRIVATE, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
