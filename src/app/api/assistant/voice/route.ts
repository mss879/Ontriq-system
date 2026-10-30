import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { enqueueJob } from "@/lib/server/jobs/enqueue";
import { rpcErrorMessage } from "@/lib/server/errors";
import { sttConfigured } from "@/lib/stt/provider";

const PRIVATE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE });

const Begin = z.object({
  action: z.literal("begin"),
  thread_id: z.uuid().optional(),
  mime: z.enum(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"]),
  duration: z.number().positive().max(120),
  language: z.enum(["en", "si", "ta"]).default("en"),
});
const Finalize = z.object({ action: z.literal("finalize"), id: z.uuid() });

async function staff() {
  const state = await loadViewerState();
  return state.state === "ready" && state.viewer.kind === "staff" ? state.viewer : null;
}

/**
 * Voice notes for the command assistant (plan §9). `begin` records the note
 * (begin_voice_note checks the Super Admin) and returns a signed upload URL
 * into the private documents bucket; the browser uploads the audio there;
 * `finalize` confirms it arrived and queues stt.transcribe. GET ?id= reports
 * the transcript once it is ready, for the person to review before sending.
 */
export async function POST(request: NextRequest) {
  const viewer = await staff();
  if (!viewer) return json({ error: "Sign in again." }, 401);
  const raw = await request.json().catch(() => null);
  const supabase = await createClient();
  const admin = createAdminClient();

  const begin = Begin.safeParse(raw);
  if (begin.success) {
    if (!sttConfigured()) return json({ error: "Voice notes need a transcription service. Use dictation or type instead." }, 503);
    const { data: ok } = await admin.rpc("rate_limit_check", { p_key: `voice:${viewer.userId}`, p_window_seconds: 600, p_max: 30 });
    if (ok === false) return json({ error: "That's a lot of voice notes. Wait a few minutes and try again." }, 429);
    const { data, error } = await supabase.rpc("begin_voice_note", { p_thread: begin.data.thread_id ?? (null as unknown as string), p_mime: begin.data.mime, p_duration: begin.data.duration });
    if (error || !data) return json({ error: error?.code === "42501" ? "Voice notes are for the Super Admin." : rpcErrorMessage(error) }, error?.code === "42501" ? 403 : 400);
    const note = data as { id: string; bucket: string; path: string };
    await admin.from("assistant_voice_notes").update({ language: begin.data.language }).eq("id", note.id);
    const signed = await admin.storage.from(note.bucket).createSignedUploadUrl(note.path);
    if (signed.error) return json({ error: "We couldn't prepare the upload. Try again in a moment." }, 503);
    return json({ id: note.id, bucket: note.bucket, path: note.path, token: signed.data.token });
  }

  const fin = Finalize.safeParse(raw);
  if (fin.success) {
    const { data: note } = await supabase.from("assistant_voice_notes").select("id, status, storage_path").eq("id", fin.data.id).maybeSingle();
    if (!note || !note.storage_path) return json({ error: "That voice note no longer exists." }, 404);
    if (note.status !== "pending_upload") return json({ id: note.id, status: note.status });
    const exists = await admin.storage.from("documents").exists(note.storage_path);
    if (!exists.data) return json({ error: "The recording didn't reach storage. Try again." }, 409);
    await admin.from("assistant_voice_notes").update({ status: "uploaded" }).eq("id", note.id).eq("status", "pending_upload");
    await enqueueJob({ kind: "stt.transcribe", payload: { voice_note_id: note.id }, idempotencyKey: `stt.transcribe:${note.id}`, entityType: "assistant_voice_note", entityId: note.id, orgId: viewer.orgId, createdBy: viewer.userId });
    return json({ id: note.id, status: "uploaded" });
  }

  return json({ error: "Unknown request." }, 400);
}

export async function GET(request: NextRequest) {
  await connection();
  const viewer = await staff();
  if (!viewer) return json({ error: "Sign in again." }, 401);
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) return json({ error: "Not found" }, 404);
  const { data } = await (await createClient()).from("assistant_voice_notes").select("id, status, transcript, error").eq("id", id).maybeSingle();
  if (!data) return json({ error: "Not found" }, 404);
  return json({ id: data.id, status: data.status, transcript: data.transcript, error: data.status === "failed" ? "We couldn't transcribe that note. Try again or type instead." : null });
}
