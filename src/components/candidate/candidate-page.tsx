import { Check, CirclePause, Clock3, Mail, PartyPopper, Phone, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/layout/page";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { CandidateView } from "@/domain/candidate/view";
import { CANDIDATE_STEPS, candidateOutstanding, candidateProgress, candidateStepIndex } from "@/domain/candidate/steps";
import { candidateDict, categoryLabel, checkLabel, fmt, timelineTitle, type CandidateDict, type CandidateLang } from "@/domain/candidate/i18n";
import { candidateDate, candidateDateTime } from "./format";
import { CandidateShell } from "./candidate-shell";
import { DocumentSlot, type SlotData } from "./document-slot";
import { RequestCard, type RequestData } from "./request-card";
import { ConsentCard } from "./consent-card";
import { MessagesCard } from "./messages-card";
import { KeepAlive } from "./keep-alive";

/**
 * The candidate's page: welcome, progress, the documents and answers we
 * still need, consent, messages and a candidate-safe timeline. Server
 * component; the interactive parts are small client islands.
 */
export function CandidatePage({ view, lang }: { view: CandidateView; lang: CandidateLang }) {
  const t = candidateDict(lang);
  const first = view.candidate.full_name.trim().split(/\s+/)[0] || view.candidate.full_name;
  const left = candidateOutstanding(view);
  const percent = candidateProgress(view);
  const nothingOwed = left.documents === 0 && left.requests === 0 && !left.consent;
  const step = candidateStepIndex(view.case.stage);
  const categoryNames = Object.fromEntries(view.requirements.map((r) => [r.category, r.category_name ?? r.label]));

  const slots: SlotData[] = view.requirements.map((r) => {
    const own = r.files.filter((f) => f.status !== "superseded");
    const latest = own[own.length - 1];
    return {
      id: r.id,
      // The slot's own English label is the most specific ("NIC copy (both sides)"); other languages use the category's name.
      label: lang === "en" ? r.label : categoryLabel(t, r.category, r.label),
      checkLabel: r.check_label,
      guide: r.description ?? r.guide,
      requestedNote: r.requested_note,
      status: r.status,
      minCount: r.min_count,
      receivedCount: r.received_count,
      needsReupload: r.status === "pending" && latest?.status === "rejected",
      files: own.map((f) => ({ id: f.id, filename: f.filename, status: f.status, rejectionReason: f.rejection_reason, at: candidateDateTime(f.created_at, lang) })),
    };
  });
  // Slots still needed first, then optional ones, then those already received.
  const order = (s: SlotData) => (s.needsReupload ? 0 : s.status === "pending" ? 1 : s.status === "optional" ? 2 : 3);
  slots.sort((a, b) => order(a) - order(b));

  const requests: RequestData[] = view.requests.map((q) => ({
    id: q.id,
    kind: q.kind,
    title: q.title,
    help: q.help,
    fieldType: q.field_type,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o === "string" ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) })),
    requirementId: q.requirement_id,
    dueText: q.due_at ? fmt(t.requests.dueBy, { date: candidateDate(q.due_at, lang) }) : null,
    status: q.status,
    answer: typeof q.answer?.value === "string" ? q.answer.value : null,
    reviewNote: q.review_note,
  }));
  requests.sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open"));

  const consent = view.consent ?? { status: "pending" as const, method: null, signed_name: null, signed_at: null, review_note: null };
  const signedText =
    consent.signed_at && consent.method === "esign" && consent.signed_name
      ? fmt(t.consent.signedBy, { name: consent.signed_name, date: candidateDate(consent.signed_at, lang) })
      : consent.signed_at
        ? fmt(t.consent.uploadedOn, { date: candidateDate(consent.signed_at, lang) })
        : null;

  return (
    <CandidateShell
      lang={lang}
      t={t}
      hrefFor={(l) => `/c/session?lang=${l}`}
      footer={
        <>
          <p className="flex items-center gap-1.5 font-medium text-foreground/80">
            <ShieldCheck className="size-3.5" aria-hidden /> {t.footer.private}
          </p>
          <p>{fmt(t.footer.expires, { date: candidateDate(view.link.expires_at, lang) })}</p>
          <p>{t.footer.privacy}</p>
        </>
      }
    >
      <KeepAlive />
      <div className="space-y-8">
        <Welcome view={view} t={t} first={first} />

        {view.case.on_hold ? (
          <p className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed">
            <CirclePause className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden /> {t.steps.onHold}
          </p>
        ) : null}

        <section aria-labelledby="progress-title" className="rounded-3xl border bg-card p-5 shadow-soft">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="progress-title" className="text-base font-semibold">
              {t.steps.title}
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">{fmt(t.steps.stepOf, { n: step + 1 })}</span>
          </div>
          <ol className="mt-4 grid grid-cols-5 gap-1">
            {CANDIDATE_STEPS.map((s, i) => (
              <li key={s} className="flex flex-col items-center gap-1.5 text-center">
                <span className="relative flex w-full items-center justify-center">
                  {i > 0 ? <span aria-hidden className={cn("absolute top-1/2 right-1/2 h-0.5 w-full -translate-y-1/2", i <= step ? "bg-primary" : "bg-border")} /> : null}
                  <span
                    className={cn(
                      "relative flex size-7 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-card",
                      i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-brand-orange text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i < step ? <Check className="size-3.5" /> : i + 1}
                  </span>
                </span>
                <span className={cn("text-[11px] leading-tight", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>{t.steps[s]}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t.steps[`hint_${CANDIDATE_STEPS[step]}`]}</p>

          {nothingOwed ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-success/8 p-4 ring-1 ring-success/20">
              <PartyPopper className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div>
                <p className="font-semibold">{t.steps.allDone}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t.steps.allDoneBody}</p>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3 rounded-2xl bg-muted/50 p-4">
              <div className="flex items-center gap-3">
                <Progress value={percent} className="h-2 flex-1" aria-label={fmt(t.steps.percentDone, { n: percent })} />
                <span className="text-xs font-medium text-muted-foreground tabular-nums">{fmt(t.steps.percentDone, { n: percent })}</span>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.steps.leftTitle}</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {left.documents ? (
                    <li>
                      <a href="#documents" className="flex items-center gap-2 underline-offset-4 hover:underline">
                        <Dot /> {left.documents === 1 ? t.steps.leftDocumentsOne : fmt(t.steps.leftDocumentsMany, { n: left.documents })}
                      </a>
                    </li>
                  ) : null}
                  {left.requests ? (
                    <li>
                      <a href="#requests" className="flex items-center gap-2 underline-offset-4 hover:underline">
                        <Dot /> {left.requests === 1 ? t.steps.leftRequestsOne : fmt(t.steps.leftRequestsMany, { n: left.requests })}
                      </a>
                    </li>
                  ) : null}
                  {left.consent ? (
                    <li>
                      <a href="#consent" className="flex items-center gap-2 underline-offset-4 hover:underline">
                        <Dot /> {t.steps.leftConsent}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>
          )}
        </section>

        <Section id="documents" title={t.documents.title} subtitle={t.documents.subtitle}>
          {slots.length ? (
            <>
              <p className="text-xs text-muted-foreground">{t.documents.tips}</p>
              {slots.map((s) => (
                <DocumentSlot key={s.id} lang={lang} slot={s} />
              ))}
            </>
          ) : (
            <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">{t.documents.none}</p>
          )}
        </Section>

        {requests.length ? (
          <Section id="requests" title={t.requests.title} subtitle={t.requests.subtitle}>
            {requests.map((r) => (
              <RequestCard key={`${r.id}-${r.status}`} lang={lang} request={r} />
            ))}
          </Section>
        ) : null}

        <Section id="consent" title={t.consent.title} subtitle={t.consent.why}>
          <ConsentCard
            lang={lang}
            consent={{ status: consent.status, method: consent.method, signedName: consent.signed_name, signedText, reviewNote: consent.review_note }}
            candidateName={view.candidate.full_name}
            orgName={view.org.name}
            clientName={view.case.client_name}
          />
        </Section>

        <Section id="messages" title={t.messages.title} subtitle={t.messages.subtitle}>
          <MessagesCard lang={lang} messages={view.messages.map((m) => ({ id: m.id, from: m.from, body: m.body, at: candidateDateTime(m.at, lang) }))} />
        </Section>

        <Section id="updates" title={t.timeline.title}>
          {view.timeline.length ? (
            <ol className="relative space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
              {view.timeline.map((e, i) => (
                <li key={e.id} className="relative flex gap-3">
                  {i < view.timeline.length - 1 ? <span aria-hidden className="absolute top-5 bottom-[-18px] left-[5px] w-px bg-border" /> : null}
                  <span aria-hidden className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-card", i === 0 ? "bg-brand-orange" : "bg-primary/40")} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{timelineTitle(t, e, categoryNames)}</p>
                    {e.body ? <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{e.body}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">{candidateDateTime(e.at, lang)}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t.timeline.empty}</p>
          )}
        </Section>
      </div>
    </CandidateShell>
  );
}

function Welcome({ view, t, first }: { view: CandidateView; t: CandidateDict; first: string }) {
  const intro = view.case.position_title
    ? fmt(t.welcome.introRole, { client: view.case.client_name, org: view.org.name, position: view.case.position_title })
    : fmt(t.welcome.intro, { client: view.case.client_name, org: view.org.name });
  return (
    <section className="brand-glow relative overflow-hidden rounded-3xl px-5 py-7 text-white shadow-lift ring-1 ring-black/5 sm:px-7 dark:ring-white/[0.07]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <div className="relative space-y-4">
        <Eyebrow tone="onDark">{view.case.client_name}</Eyebrow>
        <h1 className="font-display text-[1.9rem] leading-[1.12] font-semibold tracking-tight text-balance">{fmt(t.welcome.hello, { name: first })}</h1>
        <p className="text-[15px] leading-relaxed text-white/85">{intro}</p>
        <p className="text-sm leading-relaxed text-white/65">{fmt(t.welcome.whatIs, { org: view.org.name })}</p>
        <ul className="space-y-1.5 text-sm text-white/80">
          <li className="flex gap-2">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-brand-peach" aria-hidden /> {t.welcome.howLong}
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-peach" aria-hidden /> {t.welcome.yourPart}
          </li>
        </ul>
        {view.checks.length ? (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/55 uppercase">{t.welcome.checksTitle}</p>
            <ul className="flex flex-wrap gap-1.5">
              {view.checks.map((c) => (
                <li key={`${c.key}-${c.label}`} className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90 ring-1 ring-white/10">
                  {checkLabel(t, c.key, c.label)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-xs text-white/70">
          <span>
            {t.welcome.reference} <span className="font-mono text-white/90">{view.case.reference}</span>
          </span>
          {view.org.email || view.org.phone ? <span className="text-white/55">{fmt(t.welcome.contact, { org: view.org.name })}:</span> : null}
          {view.org.email ? (
            <a href={`mailto:${view.org.email}`} className="flex items-center gap-1 text-white/90 underline-offset-4 hover:underline">
              <Mail className="size-3.5" aria-hidden /> {view.org.email}
            </a>
          ) : null}
          {view.org.phone ? (
            <a href={`tel:${view.org.phone.replace(/\s+/g, "")}`} className="flex items-center gap-1 text-white/90 underline-offset-4 hover:underline">
              <Phone className="size-3.5" aria-hidden /> {view.org.phone}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <div>
        <h2 id={`${id}-title`} className="font-display text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const Dot = () => <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-brand-orange" />;

export function CandidatePageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-20 pb-10" aria-busy>
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
    </div>
  );
}
