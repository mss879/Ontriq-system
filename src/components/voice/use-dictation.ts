"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Live dictation with the browser's own speech recognition (Web Speech API):
 * free and instant where the browser offers it (Chrome, Edge, Safari).
 * Final phrases are handed to `onFinal`; the phrase being spoken shows as
 * `interim`. Sinhala and Tamil depend on the browser's language support.
 */

export type DictationLang = "en-LK" | "si-LK" | "ta-LK";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => undefined;

export function useDictation(onFinal: (text: string) => void) {
  const supported = useSyncExternalStore(noSubscribe, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const final = useRef(onFinal);
  useEffect(() => {
    final.current = onFinal;
  }, [onFinal]);

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback((lang: DictationLang) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) final.current(text.trim());
        else live += text;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Allow the microphone to dictate." : e.error === "language-not-supported" ? "This browser can't dictate in that language." : e.error === "no-speech" ? null : "Dictation stopped.");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Dictation couldn't start.");
    }
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported, listening, interim, error, start, stop };
}
