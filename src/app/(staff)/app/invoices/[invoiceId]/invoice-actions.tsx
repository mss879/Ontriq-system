"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, BellOff, BellRing, CircleDollarSign, Download, Eye, FileMinus2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BillingReasonDialog } from "@/components/billing/reason-dialog";
import { PAYMENT_METHODS } from "@/components/billing/invoice-status";
import { formatMoney } from "@/domain/pricing/money";
import { issueCreditNote, recordPayment, sendInvoice, setRemindersPaused, voidInvoice, voidPayment } from "../actions";
import { DateField } from "@/components/forms/date-field";

type Recipient = { email: string; name: string; source: "contact" | "portal"; preselected: boolean };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/** The buttons for a confirmed invoice; each one appears only when the viewer may use it. */
export function InvoiceActions({
  invoice,
  can,
  recipients,
}: {
  invoice: { id: string; number: string | null; status: string; currency: string; balance: number; total: number; document_id: string | null; document_ready: boolean; reminders_paused: boolean; has_payments: boolean };
  can: { send: boolean; pay: boolean; manage: boolean };
  recipients: Recipient[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = !["draft", "void", "paid"].includes(invoice.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {invoice.document_id && invoice.document_ready ? (
        <>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/documents/${invoice.document_id}`} target="_blank" rel="noreferrer">
              <Eye /> View PDF
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/api/documents/${invoice.document_id}?download=1`}>
              <Download /> Download
            </a>
          </Button>
        </>
      ) : invoice.status !== "draft" ? (
        <span className="text-xs text-muted-foreground">PDF being prepared…</span>
      ) : null}
      {can.send && invoice.status !== "draft" && invoice.status !== "void" ? <SendDialog invoice={invoice} recipients={recipients} /> : null}
      {can.pay && open ? <PaymentDialog invoice={invoice} /> : null}
      {can.manage && open && invoice.balance > 0 ? <CreditDialog invoice={invoice} /> : null}
      {can.manage && open ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setRemindersPaused(invoice.id, !invoice.reminders_paused);
              if (!r.ok) return void toast.error(r.error);
              toast.success(invoice.reminders_paused ? "Reminders back on" : "Reminders paused");
              router.refresh();
            })
          }
        >
          {invoice.reminders_paused ? <BellRing /> : <BellOff />} {invoice.reminders_paused ? "Resume reminders" : "Pause reminders"}
        </Button>
      ) : null}
      {can.manage && invoice.status !== "void" && invoice.status !== "draft" && !invoice.has_payments ? (
        <BillingReasonDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-destructive">
              <Ban /> Void
            </Button>
          }
          title={`Void ${invoice.number ?? "this invoice"}?`}
          description="The invoice stays on record marked void and nothing is owed on it. Its cases can be billed again."
          confirmLabel="Void invoice"
          destructive
          success="Invoice voided"
          onSubmit={(reason) => voidInvoice(invoice.id, reason)}
        />
      ) : null}
    </div>
  );
}

function SendDialog({ invoice, recipients }: { invoice: { id: string; number: string | null }; recipients: Recipient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(recipients.filter((r) => r.preselected).map((r) => r.email)));
  const [extra, setExtra] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => {
    const to = [...chosen, ...extra.split(/[\s,;]+/).filter(Boolean)];
    start(async () => {
      setError(null);
      const r = await sendInvoice(invoice.id, { to, message: message || undefined });
      if (!r.ok) return setError(r.error);
      toast.success(`Sent to ${r.sentTo} ${r.sentTo === 1 ? "person" : "people"}`, { description: "They get a link to the invoice in their portal." });
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Send /> Send
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {invoice.number}</DialogTitle>
          <DialogDescription>The email links to the invoice in the client portal; the PDF is not attached.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {recipients.length ? (
            <ul className="space-y-1.5">
              {recipients.map((r) => (
                <li key={r.email}>
                  <label className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      checked={chosen.has(r.email)}
                      onCheckedChange={(v) =>
                        setChosen((s) => {
                          const next = new Set(s);
                          if (v) next.add(r.email);
                          else next.delete(r.email);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.email} · {r.source === "contact" ? "contact" : "portal user"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No contacts or portal users with an email yet. Add an address below.</p>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Other addresses
            <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="accounts@client.lk" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Message (optional)
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Replaces the standard opening line." />
          </label>
          <ErrorLine error={error} />
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={pending}>
            {pending ? <Spinner /> : <Send />} Send invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ invoice }: { invoice: { id: string; number: string | null; currency: string; balance: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(invoice.balance));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAmount(String(invoice.balance));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CircleDollarSign /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {invoice.number}: {formatMoney(invoice.balance, invoice.currency)} still owed. A receipt is made automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await recordPayment(invoice.id, { amount, method: method as "bank_transfer", reference, paid_on: paidOn, notes });
              if (!r.ok) return setError(r.error);
              toast.success("Payment recorded");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Amount ({invoice.currency})
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Received on
              <DateField value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Method
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reference
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank reference or cheque number" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Notes (optional)
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <ErrorLine error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ invoice }: { invoice: { id: string; number: string | null; currency: string; balance: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAmount("");
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <FileMinus2 /> Credit note
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue a credit note</DialogTitle>
          <DialogDescription>
            Reduces what is owed on {invoice.number} (up to {formatMoney(invoice.balance, invoice.currency)}). It gets its own number and PDF.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await issueCreditNote(invoice.id, { amount, reason });
              if (!r.ok) return setError(r.error);
              toast.success("Credit note issued");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Amount ({invoice.currency})
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reason
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Shown on the credit note." />
          </label>
          <ErrorLine error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Issue credit note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Void one payment (e.g. a bounced cheque). */
export function VoidPaymentButton({ paymentId, label }: { paymentId: string; label: string }) {
  return (
    <BillingReasonDialog
      trigger={
        <Button variant="ghost" size="xs" className="text-destructive">
          Void
        </Button>
      }
      title={`Void the payment ${label}?`}
      description="The amount goes back onto the invoice. Use this for bounced cheques or payments recorded by mistake."
      confirmLabel="Void payment"
      destructive
      success="Payment voided"
      onSubmit={(reason) => voidPayment(paymentId, reason)}
    />
  );
}
