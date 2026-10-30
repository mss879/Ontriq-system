"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudUpload, FilePlus2, Info, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToneChip } from "@/components/cases/badges";
import { photoQualityWarning, uploadOne, UPLOAD_ACCEPT_ATTR } from "@/lib/client/upload";
import type { PortalRequirement } from "@/domain/portal/types";
import { portalBeginUpload, portalFinalizeUpload } from "../actions";

type Target = { requirementId?: string; category?: "cv" | "other" };
type Busy = { key: string; done: number; total: number; stage: string } | null;

/** The document slots Ontriq shared with the client, each with its own upload button. */
export function DocumentSlots({ caseId, requirements, canUpload, fromCandidate }: { caseId: string; requirements: PortalRequirement[]; canUpload: boolean; fromCandidate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function send(key: string, target: Target, files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    setErrors((e) => ({ ...e, [key]: "" }));
    let ok = 0;
    const problems: string[] = [];
    for (const [i, file] of list.entries()) {
      setBusy({ key, done: i, total: list.length, stage: "Checking…" });
      const warning = await photoQualityWarning(file);
      if (warning) toast.warning(file.name, { description: warning });
      const r = await uploadOne(
        file,
        (meta) => portalBeginUpload({ caseId, ...target, ...meta }),
        (id, sha) => portalFinalizeUpload(id, sha),
        (stage) => setBusy({ key, done: i, total: list.length, stage: stage === "uploading" ? "Uploading…" : stage === "saving" ? "Saving…" : "Preparing…" }),
      );
      if (r.ok) ok += 1;
      else problems.push(`${file.name}: ${r.error}`);
    }
    setBusy(null);
    if (problems.length) setErrors((e) => ({ ...e, [key]: problems.join(" ") }));
    if (ok) {
      toast.success(ok === 1 ? "File uploaded" : `${ok} files uploaded`, { description: "Ontriq has been told." });
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {requirements.length ? (
        <ul className="space-y-2.5">
          {requirements.map((r) => {
            const missing = r.status === "pending" && r.min_count > r.received_count;
            const key = r.id;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl p-4 ring-1 sm:flex-row sm:items-center",
                  missing && !fromCandidate ? "bg-brand-orange/[0.04] ring-brand-orange/25" : "bg-muted/30 ring-foreground/[0.06]",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{r.label}</p>
                    {missing ? (
                      fromCandidate ? (
                        <ToneChip tone="progress">With the candidate</ToneChip>
                      ) : (
                        <ToneChip tone="warning">Needed</ToneChip>
                      )
                    ) : r.status === "optional" ? (
                      <ToneChip tone="neutral">Optional</ToneChip>
                    ) : (
                      <ToneChip tone="success">Received</ToneChip>
                    )}
                    {r.min_count > 1 ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {r.received_count} of {r.min_count}
                      </span>
                    ) : null}
                  </div>
                  {r.check_label ? <p className="text-xs text-muted-foreground">For the {r.check_label} check</p> : null}
                  {r.description || r.guide ? <p className="text-[13px] leading-relaxed text-muted-foreground">{r.description || r.guide}</p> : null}
                  {r.requested_note ? (
                    <p className="flex items-start gap-1.5 rounded-lg bg-info/8 px-2.5 py-1.5 text-[13px] text-foreground ring-1 ring-info/15">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-info" /> {r.requested_note}
                    </p>
                  ) : null}
                  {errors[key] ? (
                    <p className="flex items-start gap-1.5 text-[13px] text-destructive">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {errors[key]}
                    </p>
                  ) : null}
                </div>
                {canUpload ? (
                  <UploadButton
                    label={missing ? "Upload" : "Add another"}
                    variant={missing && !fromCandidate ? "default" : "outline"}
                    busy={busy?.key === key ? busy : null}
                    disabled={Boolean(busy)}
                    onFiles={(files) => send(key, { requirementId: r.id }, files)}
                  />
                ) : !missing ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canUpload ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Add a CV or another document</p>
            <p className="text-[13px] text-muted-foreground">PDF or photos up to 25 MB each. Ontriq sees them on the case straight away.</p>
            {errors.extra ? <p className="mt-1 text-[13px] text-destructive">{errors.extra}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <UploadButton label="CV" icon="file" variant="outline" busy={busy?.key === "cv" ? busy : null} disabled={Boolean(busy)} onFiles={(files) => send("cv", { category: "cv" }, files)} />
            <UploadButton label="Other" icon="file" variant="outline" busy={busy?.key === "extra" ? busy : null} disabled={Boolean(busy)} onFiles={(files) => send("extra", { category: "other" }, files)} />
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Your access lets you follow cases. Ask your company&apos;s portal admin to upload documents.</p>
      )}
    </div>
  );
}

function UploadButton({
  label,
  variant,
  icon = "upload",
  busy,
  disabled,
  onFiles,
}: {
  label: string;
  variant: "default" | "outline";
  icon?: "upload" | "file";
  busy: Busy;
  disabled: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button type="button" variant={variant} className="shrink-0" disabled={disabled} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : icon === "file" ? <FilePlus2 /> : <CloudUpload />}
        {busy ? (busy.total > 1 ? `${busy.stage} ${busy.done + 1}/${busy.total}` : busy.stage) : label}
      </Button>
    </>
  );
}
