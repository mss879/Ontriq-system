"use client";

import { useRef, useState } from "react";
import { Camera, CheckCircle2, CircleAlert, FileText, FolderOpen, Info, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UPLOAD_ACCEPT_ATTR, checkFile, photoQualityWarning, uploadOne } from "@/lib/client/upload";
import { candidateDict, fmt, translateUploadMessage, type CandidateLang } from "@/domain/candidate/i18n";
import { beginUpload, finalizeUpload } from "@/app/(candidate)/c/session/actions";
import { errorText } from "./errors";

export type SlotFile = { id: string; filename: string; status: "uploaded" | "accepted" | "rejected" | "superseded"; rejectionReason: string | null; at: string };

export type SlotData = {
  id: string;
  label: string;
  checkLabel: string | null;
  guide: string | null;
  requestedNote: string | null;
  status: "pending" | "received" | "optional";
  minCount: number;
  receivedCount: number;
  needsReupload: boolean;
  files: SlotFile[];
};

type Item = { key: string; name: string; stage: "checking" | "preparing" | "uploading" | "saving" | "done" | "error"; message?: string; warning?: string };

/** One document the candidate needs to provide: guidance, status, their files, and camera or file upload. */
export function DocumentSlot({ lang, slot, uploadsOpen }: { lang: CandidateLang; slot: SlotData; uploadsOpen: boolean }) {
  const t = candidateDict(lang);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const busy = items.some((i) => i.stage !== "done" && i.stage !== "error");

  const patch = (key: string, next: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  async function send(files: File[]) {
    if (!files.length) return;
    const queue = files.map((file, n) => ({ file, key: `${Date.now()}-${n}-${file.name}` }));
    setItems((list) => [...list.filter((i) => i.stage !== "done"), ...queue.map(({ key, file }) => ({ key, name: file.name, stage: "checking" as const }))]);
    let ok = 0;
    for (const { file, key } of queue) {
      const problem = checkFile(file);
      if (problem) {
        patch(key, { stage: "error", message: translateUploadMessage(t, problem) });
        continue;
      }
      const warning = await photoQualityWarning(file);
      if (warning) patch(key, { warning: translateUploadMessage(t, warning) });
      const result = await uploadOne(
        file,
        (meta) => beginUpload({ requirementId: slot.id, ...meta }),
        finalizeUpload,
        (stage) => patch(key, { stage }),
      );
      if (result.ok) {
        ok += 1;
        patch(key, { stage: "done" });
        // The refreshed page lists the file under "Your uploads"; let the progress row go.
        window.setTimeout(() => setItems((list) => list.filter((i) => i.key !== key || i.warning)), 2500);
      } else patch(key, { stage: "error", message: translateUploadMessage(t, errorText(t, result.error)) });
    }
    if (ok) toast.success(t.documents.uploaded);
  }

  const tone = slot.status === "received" ? "done" : !uploadsOpen || slot.status === "optional" ? "muted" : slot.needsReupload ? "danger" : "pending";
  const badge = slot.status === "received" ? t.documents.received : !uploadsOpen ? t.documents.notReceived : slot.needsReupload ? t.documents.reupload : slot.status === "optional" ? t.documents.optional : t.documents.needed;

  return (
    <article id={`slot-${slot.id}`} className="scroll-mt-20 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
            tone === "done" ? "bg-success/12 text-success" : tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/8 text-primary",
          )}
        >
          {tone === "done" ? <CheckCircle2 className="size-[18px]" /> : tone === "danger" ? <CircleAlert className="size-[18px]" /> : <FileText className="size-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold">{slot.label}</h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                tone === "done" && "bg-success/12 text-success",
                tone === "danger" && "bg-destructive/10 text-destructive",
                tone === "pending" && "bg-warning/15 text-warning-foreground dark:text-warning",
                tone === "muted" && "bg-muted text-muted-foreground",
              )}
            >
              {badge}
            </span>
          </div>
          {slot.checkLabel ? <p className="mt-0.5 text-xs text-muted-foreground">{fmt(t.documents.forCheck, { check: slot.checkLabel })}</p> : null}
          {slot.guide ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{slot.guide}</p> : null}
          {slot.minCount > 1 ? (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{fmt(t.documents.neededCount, { received: slot.receivedCount, min: slot.minCount })}</p>
          ) : null}
        </div>
      </div>

      {slot.requestedNote ? (
        <p className="mt-3 flex gap-2 rounded-xl bg-brand-orange/8 px-3 py-2.5 text-sm leading-relaxed ring-1 ring-brand-orange/15">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-orange-ink" aria-hidden />
          <span>
            <span className="font-medium">{t.documents.noteFromOntriq}: </span>
            {slot.requestedNote}
          </span>
        </p>
      ) : null}

      {slot.files.length ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t.documents.yourFiles}</p>
          <ul className="space-y-1.5">
            {slot.files.map((f) => (
              <li key={f.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium",
                      f.status === "rejected" ? "text-destructive" : f.status === "accepted" ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {f.status === "rejected" ? t.documents.fileRejected : f.status === "accepted" ? t.documents.fileAccepted : t.documents.fileReceived}
                  </span>
                </div>
                {f.status === "rejected" && f.rejectionReason ? <p className="mt-1 pl-5.5 text-xs leading-relaxed text-destructive">{f.rejectionReason}</p> : null}
                <p className="mt-0.5 pl-5.5 text-[11px] text-muted-foreground">{f.at}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length ? (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {items.map((i) => (
            <li key={i.key} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {i.stage === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : i.stage === "error" ? (
                  <CircleAlert className="size-4 shrink-0 text-destructive" />
                ) : (
                  <Spinner className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {i.stage === "done" ? t.documents.uploaded : i.stage === "error" ? "" : t.documents.uploading}
                </span>
              </div>
              {i.message ? <p className="mt-1 text-xs leading-relaxed text-destructive">{i.message}</p> : null}
              {i.warning && i.stage !== "error" ? (
                <p className="mt-1 flex gap-1.5 text-xs leading-relaxed text-warning-foreground dark:text-warning">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {i.warning}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {uploadsOpen ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant={slot.status === "received" ? "outline" : "default"} className="h-11 min-w-fit flex-1 text-[14px]" disabled={busy} onClick={() => camera.current?.click()}>
            <Camera /> {t.documents.takePhoto}
          </Button>
          <Button type="button" variant="outline" className="h-11 min-w-fit flex-1 text-[14px]" disabled={busy} onClick={() => picker.current?.click()}>
            <FolderOpen /> {slot.files.length ? t.documents.addAnother : t.documents.chooseFile}
          </Button>
        </div>
      ) : null}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={t.documents.takePhoto}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          void send(files);
        }}
      />
      <input
        ref={picker}
        type="file"
        accept={UPLOAD_ACCEPT_ATTR}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={t.documents.chooseFile}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          void send(files);
        }}
      />
    </article>
  );
}
