import type { AssistantEvent, AssistantKind } from "@/lib/ai/assistant/types";

/**
 * Server-sent events from /api/assistant/chat. The parser takes the stream
 * in arbitrary chunks (a frame can be split anywhere) and hands back each
 * complete `data:` payload as an event; frames it can't read are skipped.
 */
export function createSseParser(onEvent: (e: AssistantEvent) => void) {
  let buffer = "";
  const flush = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      const parsed = JSON.parse(data) as AssistantEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") onEvent(parsed);
    } catch {
      // A malformed frame is dropped; the stream carries on.
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, "\n");
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        flush(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
}

/** Send one message and stream the reply. Resolves when the stream ends; rejects only on abort. */
export async function streamChat(
  body: { thread_id?: string; kind: AssistantKind; text: string },
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!res.ok || !res.body || !isStream) {
    // Signed out, the proxy answers with the sign-in page rather than a stream.
    const signedOut = res.status === 401 || res.redirected || (res.ok && !isStream);
    const message = signedOut
      ? undefined
      : await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => undefined);
    onEvent({ type: "error", message: message ?? (signedOut ? "Your session has ended. Sign in again to use the assistant." : "The assistant isn't available right now.") });
    onEvent({ type: "done", message_id: null });
    return;
  }
  const parser = createSseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(value);
  }
  parser.end();
}
