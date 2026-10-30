"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileSearch, TriangleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type State = { kind: "idle" } | { kind: "reading" } | { kind: "match"; name: string } | { kind: "mismatch"; name: string; hash: string } | { kind: "error"; message: string };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare a PDF someone holds with the report's fingerprint. The file is read
 * and hashed in this browser only; nothing is uploaded.
 */
export function FileCheck({ expected }: { expected: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = async (file: File | undefined) => {
    if (!file) return;
    if (!globalThis.crypto?.subtle) {
      setState({ kind: "error", message: "This browser can't compute file fingerprints. Try a current version of Chrome, Safari or Edge." });
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setState({ kind: "error", message: "That file is too large to be one of our reports." });
      return;
    }
    setState({ kind: "reading" });
    try {
      const hash = await sha256Hex(file);
      setState(hash === expected.toLowerCase() ? { kind: "match", name: file.name } : { kind: "mismatch", name: file.name, hash });
    } catch {
      setState({ kind: "error", message: "We couldn't read that file." });
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void check(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          over ? "border-primary bg-primary/[0.05]" : "border-input hover:bg-muted/50",
        )}
      >
        {state.kind === "reading" ? <Spinner className="size-5" /> : <Upload className="size-5 text-muted-foreground" aria-hidden />}
        <span className="text-sm font-medium">{state.kind === "reading" ? "Checking the file…" : "Drop the PDF here, or choose it"}</span>
        <span className="text-xs text-muted-foreground">The file stays on your device. Only its fingerprint is compared.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void check(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div aria-live="polite">
        {state.kind === "match" ? (
          <p className="flex gap-2 rounded-xl border border-success/30 bg-success/[0.07] px-3 py-2.5 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              <span className="font-medium">It matches.</span> {state.name} is exactly the report Ontriq issued, unchanged.
            </span>
          </p>
        ) : state.kind === "mismatch" ? (
          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p>
                <span className="font-medium">It doesn’t match.</span> {state.name} is not the file Ontriq issued for this report: it may have been edited, or it’s a different version.
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={state.hash}>
                Your file: {state.hash}
              </p>
            </div>
          </div>
        ) : state.kind === "error" ? (
          <p className="flex gap-2 text-sm text-destructive">
            <FileSearch className="mt-0.5 size-4 shrink-0" />
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
