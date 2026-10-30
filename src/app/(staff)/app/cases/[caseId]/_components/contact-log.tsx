"use client";

import { useState, useTransition } from "react";
import { Mail, MapPin, MessageSquare, Phone, Plus, ScrollText, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { logContact } from "../../actions";
import type { ContactEntry } from "@/lib/server/cases/detail-queries";
import type { RecordOption } from "@/domain/check-types/records";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/cases/sla-badge";

const CHANNELS = {
  phone: { label: "Phone call", icon: Phone },
  email: { label: "Email", icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageSquare },
  sms: { label: "SMS", icon: Smartphone },
  letter: { label: "Letter", icon: ScrollText },
  visit: { label: "Visit", icon: MapPin },
} as const;
type Channel = keyof typeof CHANNELS;

const OUTCOMES = ["Spoke to them", "Confirmed", "Left a message", "No answer", "Declined to confirm"];
const NO_RECORD = "__none__";

/**
 * Who Ontriq contacted, how, and what came of it: the candidate call in the
 * flowchart's step 2, and each referee's contact record (spec 4.6). Internal.
 */
export function ContactLog({
  caseId,
  entries,
  canLog,
  checkId = null,
  checkLabel,
  people = [],
  records = [],
}: {
  caseId: string;
  entries: ContactEntry[];
  canLog: boolean;
  /** Limit the log to this check (check page). */
  checkId?: string | null;
  checkLabel?: (id: string) => string | undefined;
  /** Names to offer, such as the candidate. */
  people?: string[];
  /** Employers or referees on this check. */
  records?: RecordOption[];
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const shown = checkId ? entries.filter((e) => e.caseCheckId === checkId) : entries;
  const recordName = (key: string | null) => records.find((r) => r.key === key)?.label;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{shown.length ? "Calls, emails and visits, newest first. Staff only." : "Nothing logged yet. Record calls, emails and visits here. Staff only."}</p>
        {canLog ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus /> Log a contact
          </Button>
        ) : null}
      </div>
      {shown.length ? (
        <ul className="divide-y rounded-xl border">
          {shown.map((e) => {
            const c = CHANNELS[e.channel as Channel];
            const Icon = c?.icon ?? MessageSquare;
            const about = [recordName(e.recordKey), !checkId && e.caseCheckId ? checkLabel?.(e.caseCheckId) : null].filter(Boolean).join(" · ");
            return (
              <li key={e.id} className="flex items-start gap-3 px-3.5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {e.counterparty}
                    {e.outcome ? <span className="font-normal text-muted-foreground"> · {e.outcome}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c?.label ?? e.channel}
                    {e.direction === "inbound" ? ", they contacted us" : ""}
                    {about ? ` · ${about}` : ""}
                    {e.by ? ` · ${e.by.name}` : ""} · <RelativeTime iso={e.at} />
                  </p>
                  {e.body ? <p className="mt-1 text-sm whitespace-pre-line">{e.body}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFormKey((k) => k + 1);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <ContactForm
            key={formKey}
            caseId={caseId}
            checkId={checkId}
            people={people}
            records={records}
            onDone={() => {
              setOpen(false);
              setFormKey((k) => k + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactForm({ caseId, checkId, people, records, onDone }: { caseId: string; checkId: string | null; people: string[]; records: RecordOption[]; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [channel, setChannel] = useState<Channel>("phone");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [record, setRecord] = useState(NO_RECORD);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suggestions = [...people, ...records.map((r) => r.label.split(" · ")[1]).filter((x): x is string => Boolean(x))];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!who.trim()) return setError("Say who you spoke to.");
        start(async () => {
          const r = await logContact(caseId, { checkId, recordKey: record === NO_RECORD ? null : record, counterparty: who, channel, direction, outcome, body });
          if (r.ok) {
            toast.success("Contact logged");
            onDone();
          } else setError(r.error);
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Log a contact</DialogTitle>
        <DialogDescription>Stays on the case for staff. Clients and candidates don&rsquo;t see it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="contact-who">Who</Label>
          <Input id="contact-who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name and role" maxLength={200} list="contact-people" />
          <datalist id="contact-people">
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        {records.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="contact-record">About</Label>
            <Select value={record} onValueChange={setRecord}>
              <SelectTrigger id="contact-record" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RECORD}>The whole check</SelectItem>
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
            <Label htmlFor="contact-channel">How</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger id="contact-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNELS) as Channel[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {CHANNELS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-direction">Who started it</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "outbound" | "inbound")}>
              <SelectTrigger id="contact-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outbound">We contacted them</SelectItem>
                <SelectItem value="inbound">They contacted us</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-outcome">Outcome</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger id="contact-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-body">Notes (optional)</Label>
          <Textarea id="contact-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="What was said." />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Log contact
        </Button>
      </DialogFooter>
    </form>
  );
}
