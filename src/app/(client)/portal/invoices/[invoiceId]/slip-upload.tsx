"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/client/upload";
import { formatBytes } from "@/lib/format";
import { beginSlip, finalizeSlip } from "../actions";

const MAX = 10 * 1024 * 1024;
const BY_EXT: Record<string, "application/pdf" | "image/jpeg" | "image/png"> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const slipMime = (f: File) =>
  (["application/pdf", "image/jpeg", "image/png"] as const).find((m) => m === f.type) ?? BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

/** Upload a bank slip or transfer confirmation for this invoice. Finance matches it and the payment shows here. */
export function SlipUpload({ invoiceId, pending: slipPending }: { invoiceId: string; pending: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return setFile(null);
    if (!slipMime(f)) return setError("Upload a PDF, JPEG or PNG.");
    if (f.size > MAX) return setError("This file is over 10 MB. Try a smaller photo or a PDF.");
    if (f.size < 1024) return setError("This file looks empty.");
    setFile(f);
  };

  const send = () =>
    start(async () => {
      if (!file) return;
      setError(null);
      const mime = slipMime(file)!;
      setStage("Preparing");
      const [hash, begun] = await Promise.all([sha256Hex(file), beginSlip({ invoiceId, filename: file.name, mime, size: file.size, note })]);
      if (!begun.ok) {
        setStage(null);
        return setError(begun.error);
      }
      setStage("Uploading");
      const sent = await createClient().storage.from("documents").uploadToSignedUrl(begun.path, begun.token, file, { contentType: mime });
      if (sent.error) {
        setStage(null);
        return setError("The upload didn't go through. Check your connection and try again.");
      }
      setStage("Saving");
      const done = await finalizeSlip(begun.slipId, hash);
      setStage(null);
      if (!done.ok) return setError(done.error);
      toast.success("Slip sent. We'll confirm the payment once it's matched.");
      setFile(null);
      setNote("");
      if (input.current) input.current.value = "";
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {slipPending ? <p className="text-sm text-muted-foreground">A slip you sent is being checked. You can add another if you paid in parts.</p> : null}
      <label
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 px-4 py-6 text-center transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files[0]);
        }}
      >
        <FileUp className="size-6 text-muted-foreground" />
        {file ? (
          <span className="text-sm">
            <span className="font-medium">{file.name}</span> · {formatBytes(file.size)}
          </span>
        ) : (
          <span className="text-sm">
            <span className="font-medium text-primary">Choose your payment slip</span> or drop it here
            <span className="block text-xs text-muted-foreground">PDF, JPEG or PNG, up to 10 MB</span>
          </span>
        )}
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {file ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Note for Ontriq (optional)
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="For example: paid in two transfers" />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button onClick={send} disabled={!file || busy}>
        {busy ? <Spinner /> : <Upload />} {stage ? `${stage}…` : "Send slip"}
      </Button>
    </div>
  );
}
