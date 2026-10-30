import { NonRetryableError, type JobHandler } from "../types";
import { transcribe, type SttLanguage } from "../../lib/stt/provider";

/**
 * stt.transcribe: turn an uploaded voice note into text. The transcript goes
 * on the note; the person reviews it in the composer before sending. The
 * audio itself is purged after 30 days by retention.purge.
 */
export const sttTranscribe: JobHandler = async (job, { admin }) => {
  const { voice_note_id } = (job.payload ?? {}) as { voice_note_id?: string };
  if (!voice_note_id) throw new NonRetryableError("stt.transcribe without voice_note_id");
  const { data: note } = await admin.from("assistant_voice_notes").select("id, storage_path, mime, duration_s, status, language").eq("id", voice_note_id).maybeSingle();
  if (!note) return { skipped: "voice note gone" };
  if (note.status === "transcribed") return { skipped: "already transcribed" };
  if (!note.storage_path) throw new NonRetryableError("voice note has no audio");
  const file = await admin.storage.from("documents").download(note.storage_path);
  if (!file.data) throw new Error(`voice note download failed: ${file.error?.message ?? "no data"}`);
  const lang = (["en", "si", "ta"].includes(note.language ?? "") ? note.language : null) as SttLanguage | null;
  const r = await transcribe(new Uint8Array(await file.data.arrayBuffer()), note.mime, lang, Number(note.duration_s ?? 0));
  if (!r.ok) {
    await admin.from("assistant_voice_notes").update({ status: "failed", error: r.message.slice(0, 500) }).eq("id", note.id);
    if (r.reason === "not_configured") return { skipped: "not configured" };
    throw new Error(r.message);
  }
  await admin
    .from("assistant_voice_notes")
    .update({ status: "transcribed", transcript: r.text, provider: `${r.provider}:${r.model}`, cost_usd: r.costUsd, error: null })
    .eq("id", note.id);
  return { chars: r.text.length };
};
