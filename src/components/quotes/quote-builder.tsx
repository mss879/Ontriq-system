"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentPreview } from "@/components/documents/document-preview";
import { quoteModel, TEMPLATE_KEYS, TEMPLATE_LABELS, type TemplateKey } from "@/domain/documents/model";
import { formatMoney, lineTotal, linesTotals } from "@/domain/pricing/money";
import { draftQuoteText, saveQuoteDraft } from "@/app/(staff)/app/quotes/actions";
import { QuoteLinesEditor, QuoteTiersEditor } from "./quote-lines-editor";
import { QuoteActions } from "./quote-actions";
import type { QuoteBuilderData, QuoteDraft } from "./types";
import { DateField } from "@/components/forms/date-field";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

const NO_CONTACT = "__none__";

/**
 * The two-pane quotation builder: the form on the left, the document exactly
 * as the client will see it on the right (the same model the PDF uses).
 * Drafts save themselves a moment after each change.
 */
export function QuoteBuilder({ data }: { data: QuoteBuilderData }) {
  const editable = data.canEdit && data.quote.rawStatus === "draft";
  const [draft, setDraft] = useState<QuoteDraft>(data.draft);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [tone, setTone] = useState<"formal" | "friendly">("formal");
  const [drafting, startDrafting] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true;
    dirty.current = false;
    setSave({ kind: "saving" });
    const d = latest.current;
    // The server schema drops the client-only row keys.
    const r = await saveQuoteDraft(data.quote.id, d);
    if (!r.ok) {
      dirty.current = true;
      setSave({ kind: "error", message: r.error });
      return false;
    }
    setSave({ kind: "saved", at: r.savedAt });
    return true;
  }, [data.quote.id]);

  const update = useCallback(
    (patch: Partial<QuoteDraft>) => {
      setDraft((d) => {
        const next = { ...d, ...patch };
        latest.current = next;
        return next;
      });
      if (!editable) return;
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        inflight.current = persist();
      }, 900);
    },
    [editable, persist],
  );

  /** Save now (before confirming). */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    return persist();
  }, [persist]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);
      if (dirty.current) void persist();
    };
  }, [persist]);

  const totals = linesTotals(draft.lines);
  const contact = data.contacts.find((c) => c.id === draft.contact_id) ?? null;
  const model = useMemo(
    () =>
      quoteModel({
        issuer: data.issuer,
        client: data.docClient,
        contact: contact ? { name: contact.name, title: contact.title, email: contact.email } : null,
        quote: {
          number: data.quote.number,
          version: data.quote.version,
          status: data.quote.status,
          title: draft.title,
          currency: data.quote.currency,
          issue_date: data.quote.issue_date,
          valid_until: draft.valid_until,
          payment_terms_days: draft.payment_terms_days,
          intro: draft.intro,
          scope: draft.scope,
          assumptions: draft.assumptions,
          tat_text: draft.tat_text,
          closing: draft.closing,
          subtotal: totals.gross,
          discount_total: totals.discount,
          total: totals.net,
          accepted_name: data.quote.accepted_name,
          accepted_at: data.quote.accepted_at,
        },
        items: draft.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, total: lineTotal(l) })),
        tiers: draft.tiers,
      }),
    [data, draft, contact, totals.gross, totals.discount, totals.net],
  );

  function fillText() {
    const hasText = [draft.intro, draft.scope, draft.assumptions, draft.tat_text, draft.closing].some((t) => t.trim());
    if (hasText && !window.confirm("Replace the current intro, scope, turnaround, assumptions and closing?")) return;
    startDrafting(async () => {
      const r = await draftQuoteText(data.quote.id, {
        tone,
        lines: draft.lines.map((l) => ({ description: l.description, kind: l.kind })),
        expectedMonthlyVolume: draft.expected_monthly_volume,
      });
      if (!r.ok) return void toast.error(r.error);
      update(r.text);
      if (r.source === "ai") toast.success("Drafted with AI. Read it through before confirming.");
      else toast.message("Filled from Ontriq's standard wording", { description: r.note });
    });
  }

  return (
    <div className="space-y-4" data-quote-builder>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {editable ? <SaveIndicator state={save} total={formatMoney(totals.net, data.quote.currency)} /> : <span />}
        <QuoteActions data={data} beforeConfirm={editable ? flush : undefined} />
      </div>
      <div className={cn("grid gap-6", editable && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]")}>
        {editable ? (
          <div className="min-w-0 space-y-6">
            <Section title="Details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Labeled label="Title" className="sm:col-span-2">
                  <Input value={draft.title} onChange={(e) => update({ title: e.target.value })} maxLength={200} />
                </Labeled>
                <Labeled label="Contact">
                  <Select value={draft.contact_id ?? NO_CONTACT} onValueChange={(v) => update({ contact_id: v === NO_CONTACT ? null : v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CONTACT}>No contact</SelectItem>
                      {data.contacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.title ? ` · ${c.title}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>
                <Labeled label="Valid until">
                  <DateField value={draft.valid_until} onChange={(e) => e.target.value && update({ valid_until: e.target.value })} />
                </Labeled>
                <Labeled label="Payment terms (days)">
                  <Input type="number" min={0} max={180} value={draft.payment_terms_days} onChange={(e) => update({ payment_terms_days: Math.min(180, Math.max(0, Math.round(Number(e.target.value) || 0))) })} />
                </Labeled>
                <Labeled label="Expected candidates a month">
                  <Input
                    type="number"
                    min={0}
                    value={draft.expected_monthly_volume ?? ""}
                    placeholder="Optional"
                    onChange={(e) => update({ expected_monthly_volume: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                </Labeled>
              </div>
              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium">Design</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Document design">
                  {TEMPLATE_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={draft.template_key === k}
                      onClick={() => update({ template_key: k })}
                      className={cn(
                        "rounded-xl px-3 py-2 text-left ring-1 transition-colors",
                        draft.template_key === k ? "bg-primary/8 ring-primary/40" : "ring-border hover:bg-muted/50",
                      )}
                    >
                      <span className="block text-sm font-medium">{TEMPLATE_LABELS[k].name}</span>
                      <span className="hidden text-[11px] leading-snug text-muted-foreground sm:block">{TEMPLATE_LABELS[k].description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Lines" aside={<span className="text-sm font-semibold tabular-nums">{formatMoney(totals.net, data.quote.currency)}</span>}>
              <QuoteLinesEditor lines={draft.lines} catalog={data.catalog} currency={data.quote.currency} onChange={(lines) => update({ lines })} />
            </Section>

            <Section title="Volume discounts" description="Optional. Offered on the quotation; prices on the lines stay as they are.">
              <QuoteTiersEditor tiers={draft.tiers} onChange={(tiers) => update({ tiers })} />
            </Section>

            <Section
              title="Wording"
              aside={
                <div className="flex items-center gap-2">
                  <Select value={tone} onValueChange={(v) => setTone(v as "formal" | "friendly")}>
                    <SelectTrigger size="sm" className="w-28" aria-label="Tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="formal">Formal</SelectItem>
                      <SelectItem value="friendly">Friendly</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={fillText} disabled={drafting}>
                    {drafting ? <Spinner /> : <Sparkles />} {data.aiConfigured ? "Draft with AI" : "Fill standard text"}
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                <TextArea label="Introduction" value={draft.intro} onChange={(intro) => update({ intro })} rows={3} />
                <TextArea label="Scope" value={draft.scope} onChange={(scope) => update({ scope })} rows={3} />
                <TextArea label="Turnaround" value={draft.tat_text} onChange={(tat_text) => update({ tat_text })} rows={2} />
                <TextArea label="Assumptions" value={draft.assumptions} onChange={(assumptions) => update({ assumptions })} rows={3} />
                <TextArea label="Closing" value={draft.closing} onChange={(closing) => update({ closing })} rows={2} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">AI writes the wording only. Prices and discounts always come from the lines above.</p>
            </Section>

            <Section title="Internal notes" description="Only Ontriq sees these.">
              <Textarea value={draft.internal_notes} onChange={(e) => update({ internal_notes: e.target.value })} rows={3} />
            </Section>
          </div>
        ) : null}

        <div className={cn("min-w-0", editable && "xl:sticky xl:top-20 xl:self-start")}>
          <div className={cn(editable && "xl:max-h-[calc(100svh-6rem)] xl:overflow-y-auto xl:pb-4")}>
            <DocumentPreview model={model} template={draft.template_key as TemplateKey} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state, total }: { state: SaveState; total: string }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-4 py-2 text-sm ring-1 ring-foreground/[0.05]" aria-live="polite">
      <span className="flex items-center gap-2 text-muted-foreground">
        {state.kind === "saving" ? (
          <>
            <Spinner className="size-3.5" /> Saving…
          </>
        ) : state.kind === "saved" ? (
          <>
            <Check className="size-4 text-success" /> Saved {formatDateTime(state.at)}
          </>
        ) : state.kind === "error" ? (
          <span className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> Not saved: {state.message}
          </span>
        ) : (
          "Changes save automatically."
        )}
      </span>
      <span className="font-semibold tabular-nums">Total {total}</span>
    </div>
  );
}

function Section({ title, description, aside, children }: { title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Labeled({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <Labeled label={label}>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
    </Labeled>
  );
}
