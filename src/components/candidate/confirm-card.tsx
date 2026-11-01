"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { candidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { confirmSubmission } from "@/app/(candidate)/c/session/actions";
import { errorText } from "./errors";

/** The candidate's last step. Shown once nothing is owed, and again after anything new. */
export function ConfirmCard({ lang }: { lang: CandidateLang }) {
  const t = candidateDict(lang);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) return setError(t.confirm.tickFirst);
    setError(null);
    start(async () => {
      const r = await confirmSubmission(true);
      if (!r.ok) return setError(errorText(t, r.error));
      toast.success(t.confirm.sent);
    });
  }

  return (
    <form onSubmit={send} className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
      <label htmlFor="confirm-declare" className="flex items-start gap-3 text-sm leading-relaxed">
        <Checkbox id="confirm-declare" className="mt-0.5" checked={agree} onCheckedChange={(on) => setAgree(on === true)} />
        <span>{t.confirm.declare}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : <Send />} {pending ? t.confirm.sending : t.confirm.button}
      </Button>
    </form>
  );
}
