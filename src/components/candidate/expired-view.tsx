import { LinkIcon } from "lucide-react";
import { candidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { CandidateShell } from "./candidate-shell";

export type ExpiredReason = "revoked" | "expired" | "unknown" | "closed" | "session" | "busy" | "unavailable";

export const asExpiredReason = (v: string | undefined): ExpiredReason =>
  (["revoked", "expired", "unknown", "closed", "session", "busy", "unavailable"] as const).find((r) => r === v) ?? "unknown";

/** Why the link isn't working, in the candidate's language, and what to do next. */
export function ExpiredView({ lang, reason, hrefFor }: { lang: CandidateLang; reason: ExpiredReason; hrefFor: (lang: CandidateLang) => string }) {
  const t = candidateDict(lang);
  const message =
    reason === "busy" ? t.errors.tooMany : reason === "unavailable" ? t.errors.generic : t.expired[reason];
  return (
    <CandidateShell lang={lang} t={t} hrefFor={hrefFor} footer={<p>{t.footer.privacy}</p>}>
      <section className="mt-6 rounded-3xl border bg-card px-6 py-10 text-center shadow-soft">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-brand-orange/10 text-brand-orange-ink ring-1 ring-brand-orange/15">
          <LinkIcon className="size-5" aria-hidden />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-balance">{t.expired.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">{message}</p>
        <p className="mx-auto mt-6 max-w-md rounded-xl bg-muted/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground">{t.expired.help}</p>
      </section>
    </CandidateShell>
  );
}
