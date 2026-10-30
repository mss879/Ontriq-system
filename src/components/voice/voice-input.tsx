"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVoiceRecorder, type Recording } from "@/hooks/use-voice-recorder";
import { cn } from "@/lib/utils";
import { useDictation, type DictationLang } from "./use-dictation";
import { transcribeRecording } from "./upload";

const LANGS: { key: DictationLang; short: string; label: string; stt: "en" | "si" | "ta" }[] = [
  { key: "en-LK", short: "EN", label: "English", stt: "en" },
  { key: "si-LK", short: "සිං", label: "Sinhala", stt: "si" },
  { key: "ta-LK", short: "த", label: "Tamil", stt: "ta" },
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The composer's voice controls. Dictation (the browser's speech
 * recognition) types as you speak, for everyone whose browser offers it.
 * Recorded voice notes (up to two minutes, transcribed on the server) are
 * for the Super Admin when a transcription service is set up. Either way the
 * words land in the composer for review; nothing is sent until the person
 * presses Send.
 */
export function VoiceInput({
  onText,
  onInterim,
  canRecord,
  threadId,
  disabled,
}: {
  onText: (text: string) => void;
  onInterim?: (text: string) => void;
  canRecord: boolean;
  threadId?: string | null;
  disabled?: boolean;
}) {
  const [lang, setLang] = useState<DictationLang>("en-LK");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dictation = useDictation(onText);
  const recorder = useVoiceRecorder(120);

  useEffect(() => onInterim?.(dictation.interim), [dictation.interim, onInterim]);
  useEffect(() => {
    if (dictation.error) toast.error(dictation.error);
  }, [dictation.error]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (rec: Recording | null) => {
    if (!rec) return;
    if (rec.durationS < 1) {
      toast.error("That recording was too short.");
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const text = await transcribeRecording(rec, { threadId, language: LANGS.find((l) => l.key === lang)!.stt }, abort.current.signal);
      if (text.trim()) onText(text.trim());
      else toast.error("We didn't catch any words in that note.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : "The voice note failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    recorder.onAutoStop((rec) => void send(rec));
    return () => recorder.onAutoStop(null);
  });

  const cycleLang = () => setLang((l) => LANGS[(LANGS.findIndex((x) => x.key === l) + 1) % LANGS.length].key);
  const current = LANGS.find((l) => l.key === lang)!;

  if (recorder.state === "recording") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-destructive/5 px-2 py-1 ring-1 ring-destructive/20" role="status" aria-label="Recording a voice note">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
        <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
          {recorder.levels.map((v, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-destructive/70 transition-[height] duration-75" style={{ height: `${Math.max(8, v * 100)}%` }} />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {clock(recorder.elapsed)} / {clock(recorder.maxSeconds)}
        </span>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Discard the recording" onClick={recorder.cancel}>
          <X />
        </Button>
        <Button type="button" size="icon-sm" variant="destructive" aria-label="Stop and transcribe" onClick={async () => send(await recorder.stop())}>
          <Square className="fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {(dictation.supported || canRecord) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" className="w-auto px-1.5 text-[11px] font-semibold text-muted-foreground" onClick={cycleLang} aria-label={`Voice language: ${current.label}. Change`}>
              {current.short}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice language: {current.label}</TooltipContent>
        </Tooltip>
      )}
      {dictation.supported && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={dictation.listening ? "destructive" : "ghost"}
              disabled={disabled || busy}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))}
              className={cn(dictation.listening && "animate-pulse")}
            >
              {dictation.listening ? <MicOff /> : <Mic />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dictation.listening ? "Stop dictation" : "Dictate (speak and it types)"}</TooltipContent>
        </Tooltip>
      )}
      {canRecord && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || busy || dictation.listening}
              aria-label="Record a voice note"
              onClick={async () => {
                const started = await recorder.start();
                if (started !== "ok") toast.error(started === "unsupported" ? "This browser can't record audio." : "Allow the microphone to record a voice note.");
              }}
            >
              {busy ? <Spinner /> : <AudioLines />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{busy ? "Transcribing…" : "Record a voice note (up to 2 minutes)"}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
