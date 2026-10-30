"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Download, Eye, Lock, Plus, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { confirmQuote, createQuote, regenerateQuotePdf, reviseQuote, sendQuote } from "@/app/(staff)/app/quotes/actions";
import type { QuoteBuilderData } from "./types";

/** Confirm, PDF, send and new version: what can happen to a quotation next. */
export function QuoteActions({ data, beforeConfirm }: { data: QuoteBuilderData; beforeConfirm?: () => Promise<boolean> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const q = data.quote;
  const draft = q.rawStatus === "draft";
  const sendable = ["confirmed", "sent", "viewed"].includes(q.rawStatus) && q.status !== "expired";
  const revisable = !draft && q.rawStatus !== "superseded" && !data.versions.some((v) => v.version > q.version && v.status === "draft");
  const pdfReady = data.document?.status === "ready";
  const pdfFailed = data.document?.status === "failed";

  function confirm() {
    start(async () => {
      if (beforeConfirm && !(await beforeConfirm())) return;
      const r = await confirmQuote(q.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Quotation ${r.number} confirmed. The PDF is being prepared.`);
      setConfirmOpen(false);
    });
  }

  function revise() {
    start(async () => {
      const r = await reviseQuote(q.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("New version started");
      router.push(`/app/quotes/${r.id}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {draft && data.canEdit ? (
        <Button variant="brand" size="lg" className="h-9 px-3.5" onClick={() => setConfirmOpen(true)} disabled={pending}>
          <Lock /> Confirm
        </Button>
      ) : null}
      {!draft && data.document ? (
        pdfReady ? (
          <>
            <Button asChild variant="outline" size="lg" className="h-9">
              <a href={`/api/documents/${data.document.id}`} target="_blank" rel="noreferrer">
                <Eye /> View PDF
              </a>
            </Button>
            <Button asChild variant="outline" size="icon-lg" aria-label="Download PDF">
              <a href={`/api/documents/${data.document.id}?download=1`}>
                <Download />
              </a>
            </Button>
          </>
        ) : pdfFailed ? (
          <Button
            variant="outline"
            size="lg"
            className="h-9"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await regenerateQuotePdf(q.id);
                if (!r.ok) toast.error(r.error);
                else toast.success("Trying the PDF again");
              })
            }
          >
            <RefreshCw /> Retry PDF
          </Button>
        ) : (
          <span className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground ring-1 ring-border">
            <Spinner className="size-3.5" /> Preparing PDF…
          </span>
        )
      ) : null}
      {sendable && data.canSend ? (
        <Button variant={q.sent_at ? "outline" : "brand"} size="lg" className="h-9 px-3.5" onClick={() => setSendOpen(true)} disabled={pending}>
          <Send /> {q.sent_at ? "Send again" : "Send"}
        </Button>
      ) : null}
      {revisable && data.canEdit ? (
        <Button variant="ghost" size="lg" className="h-9" onClick={revise} disabled={pending}>
          {pending ? <Spinner /> : <Copy />} New version
        </Button>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm this quotation?</AlertDialogTitle>
            <AlertDialogDescription>
              It gets its number and its lines, prices and wording lock. The PDF is prepared next, then you can send it. Later changes need a new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirm();
              }}
              disabled={pending}
            >
              {pending ? <Spinner /> : <CheckCircle2 />} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg">{sendOpen ? <SendForm data={data} onDone={() => setSendOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </div>
  );
}

function SendForm({ data, onDone }: { data: QuoteBuilderData; onDone: () => void }) {
  const primary = data.contacts.find((c) => c.id === data.draft.contact_id)?.email?.toLowerCase();
  const [picked, setPicked] = useState<string[]>(primary ? [primary] : data.recipients.slice(0, 1).map((r) => r.email.toLowerCase()));
  const [extra, setExtra] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const toggle = (email: string) => setPicked((p) => (p.includes(email) ? p.filter((x) => x !== email) : [...p, email]));

  function send() {
    const more = extra
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    start(async () => {
      const r = await sendQuote(data.quote.id, { to: [...picked, ...more], message: message.trim() || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Sent to ${r.sentTo} ${r.sentTo === 1 ? "person" : "people"}. The client can accept it in the portal.`);
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send quotation {data.quote.number}</DialogTitle>
        <DialogDescription>The email links to the quotation in {data.client.name}&apos;s client portal, where they can read it, download the PDF and accept it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {data.recipients.length ? (
          <ul className="space-y-1.5">
            {data.recipients.map((r) => {
              const email = r.email.toLowerCase();
              return (
                <li key={email}>
                  <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox checked={picked.includes(email)} onCheckedChange={() => toggle(email)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.email} · {r.source === "portal" ? "portal admin" : "contact"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">This client has no contacts with an email yet. Add an address below.</p>
        )}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Other recipients</span>
          <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="name@company.lk, another@company.lk" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Message (optional)</span>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="A short note shown above the link" />
        </label>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button variant="brand" onClick={send} disabled={pending || (!picked.length && !extra.trim())}>
          {pending ? <Spinner /> : <Send />} Send
        </Button>
      </DialogFooter>
    </>
  );
}

/** "New quotation" for a client (client page, quotations list). */
export function NewQuoteForClient({ clientId, label = "New quotation", variant = "outline" }: { clientId: string; label?: string; variant?: "outline" | "brand" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createQuote(clientId);
          if (!r.ok) return void toast.error(r.error);
          router.push(`/app/quotes/${r.id}`);
        })
      }
    >
      {pending ? <Spinner /> : <Plus />} {label}
    </Button>
  );
}
