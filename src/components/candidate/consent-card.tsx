"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, Download, FileSignature, FolderOpen, PenLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { UPLOAD_ACCEPT_ATTR, uploadOne } from "@/lib/client/upload";
import { candidateDict, fmt, translateUploadMessage, type CandidateLang } from "@/domain/candidate/i18n";
import { beginUpload, finalizeUpload, signConsent, submitConsentUpload } from "@/app/(candidate)/c/session/actions";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { errorText } from "./errors";

export type ConsentData = {
  status: "pending" | "submitted" | "accepted" | "rejected";
  method: "esign" | "upload" | "staff" | null;
  signedName: string | null;
  signedText: string | null;
  reviewNote: string | null;
};

/** Consent: sign on the page, or download, sign on paper and upload a photo. */
export function ConsentCard({
  lang,
  consent,
  candidateName,
  orgName,
  clientName,
  uploadsOpen,
}: {
  lang: CandidateLang;
  consent: ConsentData;
  candidateName: string;
  orgName: string;
  clientName: string;
  /** Signing closes with verification, like uploads. */
  uploadsOpen: boolean;
}) {
  const t = candidateDict(lang);
  const pad = useRef<SignaturePadHandle>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(candidateName);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const given = consent.status === "submitted" || consent.status === "accepted";

  function sign(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return setError(t.errors.nameNeeded);
    if (!agree) return setError(t.errors.agreeNeeded);
    setError(null);
    const signature = pad.current?.toDataUrl() ?? null;
    start(async () => {
      const r = await signConsent({ fullName: name.trim(), agree: true, signature });
      if (!r.ok) return setError(errorText(t, r.error));
      toast.success(t.consent.statusSubmitted);
    });
  }

  async function upload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const r = await uploadOne(file, (meta) => beginUpload({ consent: true, ...meta }), finalizeUpload);
      if (!r.ok) return setUploadError(translateUploadMessage(t, errorText(t, r.error)));
      const done = await submitConsentUpload(r.documentId);
      if (!done.ok) return setUploadError(errorText(t, done.error));
      toast.success(t.consent.statusSubmitted);
    } finally {
      setUploading(false);
    }
  }

  if (given) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/6 p-4 sm:p-5">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="space-y-0.5">
          <p className="text-[15px] font-semibold">{consent.status === "accepted" ? t.consent.statusAccepted : t.consent.statusSubmitted}</p>
          {consent.signedText ? <p className="text-sm text-muted-foreground">{consent.signedText}</p> : null}
        </div>
      </div>
    );
  }

  if (!uploadsOpen) return <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">{t.documents.closed}</p>;

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    void upload(files);
  };

  return (
    <div className="space-y-4">
      {consent.status === "rejected" ? (
        <p className="rounded-xl bg-destructive/8 px-3 py-2.5 text-sm leading-relaxed text-destructive ring-1 ring-destructive/15">
          <span className="font-medium">{t.consent.statusRejected}</span>
          {consent.reviewNote ? ` ${consent.reviewNote}` : ""}
        </p>
      ) : null}

      <div className="rounded-2xl border bg-muted/30 p-4 text-sm leading-relaxed sm:p-5">
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden /> {t.consent.title}
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground marker:text-foreground/60">
          <li>{fmt(t.consent.textAuthorise, { org: orgName, client: clientName })}</li>
          <li>{fmt(t.consent.textData, { org: orgName, client: clientName })}</li>
          <li>{t.consent.textTrue}</li>
        </ol>
      </div>

      <form onSubmit={sign} className="space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            <PenLine className="size-4 text-primary" aria-hidden /> {t.consent.signHere}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t.consent.signHereHint}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="consent-name" className="text-xs font-medium text-muted-foreground">
            {t.consent.fullName}
          </label>
          <Input id="consent-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11 text-[15px]" />
        </div>
        <SignaturePad ref={pad} label={t.consent.drawSignature} hint={t.consent.drawHint} clearLabel={t.consent.clear} />
        <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed", agree && "border-primary/40 bg-primary/5")}>
          <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5 size-5" />
          <span>{t.consent.agree}</span>
        </label>
        {error ? <p className="text-xs leading-relaxed text-destructive">{error}</p> : null}
        <Button type="submit" className="h-11 w-full text-[15px]" disabled={pending}>
          {pending ? <Spinner /> : <FileSignature />} {pending ? t.consent.signing : t.consent.submit}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" /> {t.consent.or} <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <div>
          <h3 className="text-[15px] font-semibold">{t.consent.paper}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.consent.paperHint}</p>
        </div>
        <Button asChild variant="outline" className="h-11 w-full text-[14px]">
          <a href="/c/session/consent-form" download>
            <Download /> {t.consent.download}
          </a>
        </Button>
        <p className="pt-1 text-xs font-medium text-muted-foreground">{t.consent.uploadSigned}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11 min-w-fit flex-1 text-[14px]" disabled={uploading} onClick={() => camera.current?.click()}>
            {uploading ? <Spinner /> : <Camera />} {t.documents.takePhoto}
          </Button>
          <Button type="button" variant="outline" className="h-11 min-w-fit flex-1 text-[14px]" disabled={uploading} onClick={() => picker.current?.click()}>
            <FolderOpen /> {t.documents.chooseFile}
          </Button>
        </div>
        {uploadError ? <p className="text-xs leading-relaxed text-destructive">{uploadError}</p> : null}
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label={t.documents.takePhoto} onChange={picked} />
        <input ref={picker} type="file" accept={UPLOAD_ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-label={t.consent.uploadSigned} onChange={picked} />
      </div>
    </div>
  );
}
