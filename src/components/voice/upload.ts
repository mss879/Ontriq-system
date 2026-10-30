"use client";

import { createClient } from "@/lib/supabase/client";
import type { Recording } from "@/hooks/use-voice-recorder";

/**
 * A recorded note to text: begin (server records it and signs an upload),
 * upload straight to private Storage, finalize (queues transcription), then
 * wait for the transcript. Resolves the text, or throws a readable error.
 */
export async function transcribeRecording(rec: Recording, opts: { threadId?: string | null; language: "en" | "si" | "ta" }, signal?: AbortSignal): Promise<string> {
  const post = async (body: unknown) => {
    const res = await fetch("/api/assistant/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    if (!res.ok) throw new Error(json.error ?? "The voice note couldn't be sent.");
    return json;
  };
  const begun = (await post({ action: "begin", thread_id: opts.threadId ?? undefined, mime: rec.mime, duration: rec.durationS, language: opts.language })) as { id: string; bucket: string; path: string; token: string };
  const sent = await createClient().storage.from(begun.bucket).uploadToSignedUrl(begun.path, begun.token, rec.blob, { contentType: rec.mime });
  if (sent.error) throw new Error("The recording didn't upload. Check your connection and try again.");
  await post({ action: "finalize", id: begun.id });

  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await fetch(`/api/assistant/voice?id=${begun.id}`, { cache: "no-store", signal });
    const note = (await res.json().catch(() => ({}))) as { status?: string; transcript?: string | null; error?: string | null };
    if (note.status === "transcribed") return note.transcript ?? "";
    if (note.status === "failed") throw new Error(note.error ?? "We couldn't transcribe that note.");
  }
  throw new Error("Transcription is taking too long. Try again, or type instead.");
}
