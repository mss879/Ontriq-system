/**
 * Speech to text for recorded voice notes (plan §9). Claude has no speech
 * input, so a hosted transcription model does this; today OpenAI's audio
 * transcription endpoint, used only when STT_PROVIDER=openai and STT_API_KEY
 * are set. Without them the app relies on the browser's own dictation (Web
 * Speech API) or typing. Plain Node: the stt.transcribe job imports it.
 */

export type SttLanguage = "en" | "si" | "ta";
export type SttResult = { ok: true; text: string; provider: string; model: string; costUsd: number } | { ok: false; reason: "not_configured" | "error"; message: string };

export function sttConfigured(): boolean {
  return process.env.STT_PROVIDER === "openai" && Boolean(process.env.STT_API_KEY);
}

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav" };

/** Planning price per minute of audio; override with STT_COST_PER_MINUTE when the provider's price changes. */
const perMinute = () => Number(process.env.STT_COST_PER_MINUTE ?? 0.003);

export async function transcribe(bytes: Uint8Array, mime: string, language: SttLanguage | null, durationS: number): Promise<SttResult> {
  if (!sttConfigured()) return { ok: false, reason: "not_configured", message: "Voice transcription isn't set up (STT_PROVIDER, STT_API_KEY)." };
  const model = process.env.STT_MODEL || "gpt-4o-mini-transcribe";
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), `note.${EXT[mime] ?? "webm"}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STT_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return { ok: false, reason: "error", message: `Transcription failed (${res.status}).` };
    const body = (await res.json()) as { text?: string };
    return { ok: true, text: (body.text ?? "").trim(), provider: "openai", model, costUsd: Math.round((Math.max(durationS, 1) / 60) * perMinute() * 1e6) / 1e6 };
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : "Transcription failed." };
  }
}
