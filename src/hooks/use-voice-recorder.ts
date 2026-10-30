"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Record a voice note in the browser (MediaRecorder), up to `maxSeconds`,
 * with a live input level for a waveform. stop() resolves the recording;
 * cancel() throws it away. The microphone is released as soon as recording
 * ends or the component unmounts.
 */

export type Recording = { blob: Blob; mime: "audio/webm" | "audio/mp4" | "audio/ogg"; durationS: number };
export type RecorderState = "idle" | "recording" | "denied" | "unsupported";

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
const BARS = 32;

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
}

const baseMime = (m: string): Recording["mime"] => (m.startsWith("audio/mp4") ? "audio/mp4" : m.startsWith("audio/ogg") ? "audio/ogg" : "audio/webm");

export function useVoiceRecorder(maxSeconds = 120) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audio: AudioContext | null;
    chunks: Blob[];
    started: number;
    raf: number;
    timer: ReturnType<typeof setInterval>;
    resolve?: (r: Recording | null) => void;
    discard: boolean;
  } | null>(null);
  /** Called when recording stops by itself (the time limit) rather than through stop(). */
  const pending = useRef<((r: Recording) => void) | null>(null);

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.audio?.close().catch(() => undefined);
  }, []);

  const stop = useCallback((): Promise<Recording | null> => {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      r.resolve = resolve;
      r.recorder.stop();
    });
  }, []);

  /** Starts recording; resolves "ok", or why it couldn't. */
  const start = useCallback(async (): Promise<"ok" | "denied" | "unsupported"> => {
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return "unsupported";
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("denied");
      return "denied";
    }
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    let audio: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      audio = new AudioContext();
      analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
    } catch {
      audio = null;
    }
    const chunks: Blob[] = [];
    const started = Date.now();
    const sample = new Uint8Array(analyser?.fftSize ?? 0);
    let lastPush = 0;
    const tick = () => {
      if (analyser && Date.now() - lastPush > 80) {
        lastPush = Date.now();
        analyser.getByteTimeDomainData(sample);
        let sum = 0;
        for (const v of sample) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / sample.length) * 3.2);
        setLevels((prev) => [...prev.slice(1), level]);
      }
      if (rec.current) rec.current.raf = requestAnimationFrame(tick);
    };
    const timer = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      if (s >= maxSeconds && recorder.state === "recording") recorder.stop();
    }, 250);
    rec.current = { recorder, stream, audio, chunks, started, raf: 0, timer, discard: false };
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const r = rec.current;
      release();
      rec.current = null;
      setState("idle");
      setLevels(Array(BARS).fill(0));
      const durationS = Math.min(maxSeconds, Math.max(0.5, (Date.now() - started) / 1000));
      const out = r && !r.discard && chunks.length ? { blob: new Blob(chunks, { type: baseMime(recorder.mimeType || mime) }), mime: baseMime(recorder.mimeType || mime), durationS: Math.round(durationS * 100) / 100 } : null;
      r?.resolve?.(out);
      if (!r?.resolve && out) pending.current?.(out);
    };
    recorder.start(250);
    setElapsed(0);
    setState("recording");
    rec.current.raf = requestAnimationFrame(tick);
    return "ok";
  }, [maxSeconds, release]);

  const onAutoStop = useCallback((fn: ((r: Recording) => void) | null) => {
    pending.current = fn;
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.discard = true;
    if (r.recorder.state !== "inactive") r.recorder.stop();
  }, []);

  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        r.discard = true;
        if (r.recorder.state !== "inactive") r.recorder.stop();
        release();
        rec.current = null;
      }
    },
    [release],
  );

  return { state, elapsed, levels, start, stop, cancel, onAutoStop, maxSeconds };
}
