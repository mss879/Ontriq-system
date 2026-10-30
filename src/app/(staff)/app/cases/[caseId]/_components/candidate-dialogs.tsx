"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { askCandidate, createCandidateLink, recordPaperConsent, resendLink, type AskInput } from "../candidate-actions";
import type { Channel } from "@/lib/server/candidate/links";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export type ContactAvailability = { email: string | null; phone: string | null; preferredLanguage: "en" | "si" | "ta" };
export type AskCheck = { id: string; label: string; fields: { key: string; label: string; type: string; help?: string }[] };

const LANGUAGES = { en: "English", si: "Sinhala", ta: "Tamil" } as const;
const CHANNEL_NAME: Record<Channel, string> = { email: "email", sms: "SMS" };
const WHOLE_CASE = "__case__";

const listChannels = (list: Channel[]) => list.map((c) => CHANNEL_NAME[c]).join(" and ");

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied", { description: "Send it to the candidate yourself, or paste it into a message." });
  } catch {
    toast.message("Copy this link", { description: text, duration: 20_000 });
  }
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  );
}

function ChannelPicker({ contact, value, onChange }: { contact: ContactAvailability; value: Channel[]; onChange: (v: Channel[]) => void }) {
  const options: { key: Channel; label: string; detail: string | null }[] = [
    { key: "email", label: "Email", detail: contact.email },
    { key: "sms", label: "SMS", detail: contact.phone },
  ];
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const id = `channel-${o.key}`;
        return (
          <label key={o.key} htmlFor={id} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3", o.detail ? "cursor-pointer hover:bg-muted/40" : "opacity-60")}>
            <Checkbox
              id={id}
              className="mt-0.5"
              checked={value.includes(o.key)}
              disabled={!o.detail}
              onCheckedChange={(c) => onChange(c ? [...value, o.key] : value.filter((x) => x !== o.key))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{o.detail ?? `No ${o.key === "email" ? "email address" : "phone number"} on file. Add one on the Candidate card.`}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function sentToast(sent: Channel[], missing: Channel[], url?: string) {
  if (sent.length) toast.success(`Link sent by ${listChannels(sent)}`, missing.length ? { description: `Not sent by ${listChannels(missing)}: no contact details on file.` } : undefined);
  else if (url) void copyText(url);
}

// ---------------------------------------------------------------- create

export function CreateLinkDialog({ open, onOpenChange, caseId, contact, replacing }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string; contact: ContactAvailability; replacing: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <CreateLinkForm caseId={caseId} contact={contact} replacing={replacing} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function CreateLinkForm({ caseId, contact, replacing, onDone }: { caseId: string; contact: ContactAvailability; replacing: boolean; onDone: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([...(contact.email ? (["email"] as const) : []), ...(contact.phone ? (["sms"] as const) : [])]);
  const [language, setLanguage] = useState<"en" | "si" | "ta">(contact.preferredLanguage);
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createCandidateLink(caseId, { channels, language, days });
      if (!r.ok) return setError(r.error);
      sentToast(r.sent, r.missing, r.url);
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{replacing ? "Create a new link" : "Send the candidate their link"}</DialogTitle>
        <DialogDescription>
          {replacing
            ? "The old link stops working at once. The candidate's uploads and answers stay on the case."
            : "A private page where the candidate uploads documents, answers your questions and signs the consent form. No account needed."}
        </DialogDescription>
      </DialogHeader>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Label>Send by</Label>
        <ChannelPicker contact={contact} value={channels} onChange={setChannels} />
        {channels.length === 0 ? <p className="text-xs text-muted-foreground">Nothing selected: the link is created and copied for you to share.</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="link-language">Language</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
            <SelectTrigger id="link-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LANGUAGES) as (keyof typeof LANGUAGES)[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {LANGUAGES[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-days">Works for</Label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as typeof days)}>
            <SelectTrigger id="link-days" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {channels.length ? "Create and send" : "Create link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- resend

export function ResendDialog({ open, onOpenChange, linkId, contact }: { open: boolean; onOpenChange: (o: boolean) => void; linkId: string; contact: ContactAvailability }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <ResendForm linkId={linkId} contact={contact} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function ResendForm({ linkId, contact, onDone }: { linkId: string; contact: ContactAvailability; onDone: () => void }) {
  const [channels, setChannels] = useState<Channel[]>(contact.email ? ["email"] : contact.phone ? ["sms"] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await resendLink(linkId, channels);
      if (!r.ok) return setError(r.error);
      sentToast(r.sent, r.missing);
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Send the link again</DialogTitle>
        <DialogDescription>The same link, so anything the candidate already did stays in place.</DialogDescription>
      </DialogHeader>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ChannelPicker contact={contact} value={channels} onChange={setChannels} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || channels.length === 0}>
          {pending ? <Spinner /> : null}
          Send
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- ask

type Kind = AskInput["kind"];
const KIND_LABEL: Record<Kind, { label: string; hint: string }> = {
  document: { label: "A document", hint: "Adds a slot on their page and to the case's documents." },
  field: { label: "A detail", hint: "One detail of a check. Their answer fills the check once you accept it." },
  question: { label: "A question", hint: "Anything else; they answer in their own words." },
};

/** What to start the form with (e.g. a request the Pre-QC copilot drafted). */
export type AskPrefill = { kind?: Kind; category?: string; checkId?: string; title?: string; help?: string };

export function AskCandidateDialog({
  open,
  onOpenChange,
  caseId,
  checks,
  categories,
  linkActive,
  initial,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: string;
  checks: AskCheck[];
  categories: { key: string; name: string; guide: string }[];
  linkActive: boolean;
  initial?: AskPrefill;
  onSent?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <AskForm
            caseId={caseId}
            checks={checks}
            categories={categories}
            linkActive={linkActive}
            initial={initial}
            onDone={() => {
              onOpenChange(false);
              onSent?.();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AskForm({
  caseId,
  checks,
  categories,
  linkActive,
  initial,
  onDone,
}: {
  caseId: string;
  checks: AskCheck[];
  categories: { key: string; name: string; guide: string }[];
  linkActive: boolean;
  initial?: AskPrefill;
  onDone: () => void;
}) {
  const askable = checks.filter((c) => c.fields.length > 0);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "document");
  const [category, setCategory] = useState(initial?.category && categories.some((c) => c.key === initial.category) ? initial.category : "");
  const [checkId, setCheckId] = useState(initial?.checkId ?? WHOLE_CASE);
  const [fieldCheck, setFieldCheck] = useState(askable[0]?.id ?? "");
  const [fieldKey, setFieldKey] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [help, setHelp] = useState(initial?.help ?? "");
  const [dueAt, setDueAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fields = askable.find((c) => c.id === fieldCheck)?.fields ?? [];
  const guide = categories.find((c) => c.key === category)?.guide;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = checkId === WHOLE_CASE ? "" : checkId;
    const input: AskInput =
      kind === "document"
        ? { kind, category, checkId: check, title, note: help, dueAt }
        : kind === "field"
          ? { kind, checkId: fieldCheck, fieldKey, title, help, dueAt }
          : { kind, title, help, checkId: check, dueAt };
    start(async () => {
      const r = await askCandidate(caseId, input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors ? null : r.error);
        return;
      }
      toast.success("Request added", {
        description: r.emailed ? "The candidate was emailed about it." : linkActive ? "It's on their page now." : "Send the candidate a link so they can answer.",
      });
      onDone();
    });
  };

  const err = (k: string) => errors[k]?.[0];

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <DialogHeader>
        <DialogTitle>Ask the candidate</DialogTitle>
        <DialogDescription>It appears on their secure page{linkActive ? "" : " once you send them a link"}, and they&apos;re reminded until they answer.</DialogDescription>
      </DialogHeader>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={pending} className="space-y-5">
        <div role="radiogroup" aria-label="What to ask for" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              disabled={k === "field" && askable.length === 0}
              onClick={() => {
                setKind(k);
                setErrors({});
                setFormError(null);
              }}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50",
                kind === k ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <span className="block font-medium">{KIND_LABEL[k].label}</span>
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{KIND_LABEL[kind].hint}</p>

        {kind === "document" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ask-category">Document</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="ask-category" className="w-full" aria-invalid={Boolean(err("category")) || undefined}>
                  <SelectValue placeholder="Choose a document" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("category") ? <p className="text-sm text-destructive">{err("category")}</p> : guide ? <p className="text-xs text-muted-foreground">{guide}</p> : null}
            </div>
            <CheckSelect checks={checks} value={checkId} onChange={setCheckId} />
            <div className="space-y-1.5">
              <Label htmlFor="ask-title">Title on their page (optional)</Label>
              <Input id="ask-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Service letter from ABC Ltd" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask-note">What exactly you need</Label>
              <Textarea id="ask-note" rows={3} value={help} onChange={(e) => setHelp(e.target.value)} placeholder="Both sides, readable, with the company seal." maxLength={1000} />
            </div>
          </>
        ) : kind === "field" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ask-check">Check</Label>
                <Select
                  value={fieldCheck}
                  onValueChange={(v) => {
                    setFieldCheck(v);
                    setFieldKey("");
                  }}
                >
                  <SelectTrigger id="ask-check" className="w-full">
                    <SelectValue placeholder="Choose a check" />
                  </SelectTrigger>
                  <SelectContent>
                    {askable.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ask-field">Detail</Label>
                <Select
                  value={fieldKey}
                  onValueChange={(v) => {
                    setFieldKey(v);
                    const f = fields.find((x) => x.key === v);
                    if (f?.help && !help) setHelp(f.help);
                  }}
                >
                  <SelectTrigger id="ask-field" className="w-full" aria-invalid={Boolean(err("fieldKey")) || undefined}>
                    <SelectValue placeholder="Choose a detail" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err("fieldKey") ? <p className="text-sm text-destructive">{err("fieldKey")}</p> : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask-title">Question (optional)</Label>
              <Input id="ask-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={fields.find((f) => f.key === fieldKey)?.label ?? "Uses the detail's name"} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask-help">Help for the candidate</Label>
              <Textarea id="ask-help" rows={2} value={help} onChange={(e) => setHelp(e.target.value)} maxLength={1000} />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ask-title">Question</Label>
              <Input id="ask-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="When did you leave ABC Ltd?" maxLength={200} aria-invalid={Boolean(err("title")) || undefined} />
              {err("title") ? <p className="text-sm text-destructive">{err("title")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask-help">Help for the candidate (optional)</Label>
              <Textarea id="ask-help" rows={2} value={help} onChange={(e) => setHelp(e.target.value)} placeholder="Month and year is enough." maxLength={1000} />
            </div>
            <CheckSelect checks={checks} value={checkId} onChange={setCheckId} />
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ask-due">Needed by (optional)</Label>
          <Input id="ask-due" type="date" className="w-full sm:w-48" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Add request
        </Button>
      </DialogFooter>
    </form>
  );
}

function CheckSelect({ checks, value, onChange }: { checks: AskCheck[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="ask-for-check">For check</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="ask-for-check" className="w-full">
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
  );
}

// ---------------------------------------------------------------- paper consent

export function PaperConsentDialog({
  open,
  onOpenChange,
  caseId,
  documents,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: string;
  documents: { id: string; filename: string; createdAt: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <PaperConsentForm caseId={caseId} documents={documents} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function PaperConsentForm({ caseId, documents, onDone }: { caseId: string; documents: { id: string; filename: string; createdAt: string }[]; onDone: () => void }) {
  const [doc, setDoc] = useState(documents[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await recordPaperConsent(caseId, doc, note);
      if (!r.ok) return setError(r.error);
      toast.success("Consent recorded");
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Record a paper consent form</DialogTitle>
        <DialogDescription>For a form the candidate signed on paper and someone uploaded to this case as a signed consent form.</DialogDescription>
      </DialogHeader>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No signed consent form is on the case yet. Upload it under Documents as &ldquo;Signed consent form&rdquo;, then come back.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="consent-doc">Signed form</Label>
            <Select value={doc} onValueChange={setDoc}>
              <SelectTrigger id="consent-doc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {documents.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.filename} · {formatDate(d.createdAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="consent-note">Note (optional)</Label>
            <Textarea id="consent-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Signed in person at our office." maxLength={500} />
          </div>
        </>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !doc}>
          {pending ? <Spinner /> : null}
          Record consent
        </Button>
      </DialogFooter>
    </form>
  );
}
