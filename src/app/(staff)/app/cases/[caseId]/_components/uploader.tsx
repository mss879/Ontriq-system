"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CloudUpload, FileImage, FileText, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { beginUpload, finalizeUpload } from "../../actions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { RecordOption } from "@/domain/check-types/records";

const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
type Mime = (typeof ACCEPT)[number];
const MAX = 25 * 1024 * 1024;
const WHOLE_CASE = "__case__";
const WHOLE_CHECK = "__check__";

const BY_EXTENSION: Record<string, Mime> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic" };

function mimeOf(file: File): Mime | null {
  if ((ACCEPT as readonly string[]).includes(file.type)) return file.type as Mime;
  if (file.type === "image/heif") return "image/heic";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

async function sha256(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Stage = "ready" | "hashing" | "preparing" | "uploading" | "saving" | "done" | "error";
type Item = { key: string; file: File; mime: Mime | null; stage: Stage; error?: string };

const STAGE_LABEL: Record<Stage, string> = {
  ready: "Ready",
  hashing: "Fingerprinting…",
  preparing: "Preparing…",
  uploading: "Uploading…",
  saving: "Saving…",
  done: "Uploaded",
  error: "Failed",
};
const STAGE_PCT: Record<Stage, number> = { ready: 0, hashing: 15, preparing: 30, uploading: 65, saving: 90, done: 100, error: 100 };

export type UploadTarget = { category?: string; checkId?: string | null; parentId?: string | null; label?: string; parentName?: string; recordKey?: string | null };

/**
 * Uploads straight from the browser to private Storage: the server creates the
 * document row and a signed upload URL (beginUpload), the browser sends the
 * file, then the server confirms the object exists (finalizeUpload).
 */
export function UploadDialog({
  open,
  onOpenChange,
  caseId,
  target,
  categories,
  checks,
  records = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  target: UploadTarget;
  categories: { key: string; name: string; guide: string }[];
  checks: { id: string; label: string }[];
  records?: RecordOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <UploadForm caseId={caseId} target={target} categories={categories} checks={checks} records={records} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  caseId,
  target,
  categories,
  checks,
  records,
  onClose,
}: {
  caseId: string;
  target: UploadTarget;
  categories: { key: string; name: string; guide: string }[];
  checks: { id: string; label: string }[];
  records: RecordOption[];
  onClose: () => void;
}) {
  const [category, setCategory] = useState(target.category ?? "");
  const [checkId, setCheckId] = useState<string>(target.checkId ?? WHOLE_CASE);
  const [label, setLabel] = useState(target.label ?? "");
  const [record, setRecord] = useState(target.recordKey ?? WHOLE_CHECK);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVersion = Boolean(target.parentId);
  const guide = categories.find((c) => c.key === category)?.guide;

  const add = (files: FileList | File[]) => {
    const list = Array.from(files);
    const next = list.map<Item>((file, i) => {
      const mime = mimeOf(file);
      const error = !mime ? "Use a PDF, JPEG, PNG, WebP or HEIC file." : file.size > MAX ? "Files must be under 25 MB." : file.size === 0 ? "This file is empty." : undefined;
      return { key: `${file.name}-${file.size}-${file.lastModified}-${i}-${Math.random()}`, file, mime, stage: error ? "error" : "ready", error };
    });
    setItems((prev) => (isVersion ? next.slice(0, 1) : [...prev, ...next]));
  };

  const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  const run = async () => {
    if (!category) {
      toast.error("Choose what kind of document this is.");
      return;
    }
    setRunning(true);
    const supabase = createClient();
    let ok = 0;
    for (const it of items) {
      if (it.stage !== "ready" || !it.mime) continue;
      try {
        patch(it.key, { stage: "hashing" });
        const hash = await sha256(it.file);
        patch(it.key, { stage: "preparing" });
        const begun = await beginUpload({
          caseId,
          checkId: checkId === WHOLE_CASE ? null : checkId,
          category,
          label: label.trim() || undefined,
          parentId: target.parentId ?? null,
          recordKey: record === WHOLE_CHECK ? null : record,
          filename: it.file.name,
          mime: it.mime,
          size: it.file.size,
        });
        if (!begun.ok) throw new Error(begun.error);
        patch(it.key, { stage: "uploading" });
        const sent = await supabase.storage.from("case-files").uploadToSignedUrl(begun.path, begun.token, it.file, { contentType: it.mime });
        if (sent.error) throw new Error("The upload didn't go through. Check your connection and try again.");
        patch(it.key, { stage: "saving" });
        const done = await finalizeUpload(begun.documentId, hash);
        if (!done.ok) throw new Error(done.error);
        patch(it.key, { stage: "done" });
        ok += 1;
      } catch (error) {
        patch(it.key, { stage: "error", error: error instanceof Error ? error.message : "Upload failed." });
      }
    }
    setRunning(false);
    if (ok) toast.success(ok === 1 ? "1 file uploaded" : `${ok} files uploaded`);
  };

  const pending = items.filter((i) => i.stage === "ready").length;
  const allDone = items.length > 0 && items.every((i) => i.stage === "done" || i.stage === "error") && !running;

  return (
    <div>
      <DialogHeader className="mb-4">
        <DialogTitle>{isVersion ? "Upload a new version" : "Upload documents"}</DialogTitle>
        <DialogDescription>
          {isVersion ? `Replaces ${target.parentName ?? "the rejected file"}. The old version is kept in the history.` : "PDF or photos, up to 25 MB each. Files go straight to private storage."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {records.length ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="upload-record">
              Belongs to
            </label>
            <Select value={record} onValueChange={setRecord} disabled={running}>
              <SelectTrigger id="upload-record" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_CHECK}>The whole check</SelectItem>
                {records.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="upload-category">
              Document
            </label>
            <Select value={category} onValueChange={setCategory} disabled={isVersion || running}>
              <SelectTrigger id="upload-category" className="w-full">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="upload-check">
              For
            </label>
            <Select value={checkId} onValueChange={setCheckId} disabled={isVersion || running}>
              <SelectTrigger id="upload-check" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_CASE}>The whole case</SelectItem>
                {checks.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {guide ? <p className="-mt-1 text-xs text-muted-foreground">{guide}</p> : null}
        {!isVersion ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="upload-label">
              Label <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id="upload-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. A/L certificate, Dialog service letter" disabled={running} />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) add(e.dataTransfer.files);
          }}
          disabled={running}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            dragging ? "border-brand-blue bg-brand-blue/5" : "border-border hover:bg-muted/40",
          )}
        >
          <CloudUpload className="size-7 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{isVersion ? "Drop the new file here, or choose it" : "Drop files here, or choose them"}</span>
          <span className="text-xs text-muted-foreground">On a phone you can take a photo instead.</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple={!isVersion}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length ? (
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {items.map((it) => (
              <li key={it.key} className="rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2.5">
                  {it.mime === "application/pdf" ? <FileText className="size-4 shrink-0 text-muted-foreground" /> : <FileImage className="size-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{it.file.name}</p>
                    <p className={cn("text-xs", it.stage === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {it.stage === "error" ? it.error : `${formatBytes(it.file.size)} · ${STAGE_LABEL[it.stage]}`}
                    </p>
                  </div>
                  {it.stage === "done" ? (
                    <CheckCircle2 className="size-4 text-success" aria-label="Uploaded" />
                  ) : it.stage === "error" ? (
                    <TriangleAlert className="size-4 text-destructive" aria-hidden />
                  ) : it.stage === "ready" && !running ? (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}>
                      <X />
                    </Button>
                  ) : (
                    <Spinner className="size-4" />
                  )}
                </div>
                {it.stage !== "ready" && it.stage !== "error" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-all duration-500", it.stage === "done" ? "bg-success" : "bg-brand-blue dark:bg-brand-sky")} style={{ width: `${STAGE_PCT[it.stage]}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <DialogFooter className="mt-5">
        {allDone ? (
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button type="button" onClick={run} disabled={running || pending === 0 || !category}>
            {running ? <Spinner /> : <CloudUpload />}
            {pending > 1 ? `Upload ${pending} files` : "Upload"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
