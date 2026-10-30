"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, FileText, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { BillingReasonDialog } from "@/components/billing/reason-dialog";
import { PAYMENT_METHODS } from "@/components/billing/invoice-status";
import { formatBytes, formatDateTime, formatPlainDate } from "@/lib/format";
import { formatMoney } from "@/domain/pricing/money";
import type { SlipRow } from "@/lib/server/billing/queries";
import { matchSlip, rejectSlip } from "./actions";
import { DateField } from "@/components/forms/date-field";

type OpenInvoice = { id: string; client_id: string; number: string | null; balance: number; currency: string; due_date: string | null };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** One client slip: what AI read from it (if set up), and Match / Reject. */
export function SlipCard({ slip, invoices }: { slip: SlipRow; invoices: OpenInvoice[] }) {
  const options = invoices.filter((i) => i.client_id === slip.client_id);
  const ai = slip.ai;
  const read = ai && !ai.skipped;
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{slip.client_name}</p>
          <p className="text-xs text-muted-foreground">
            {slip.invoice_number ? `For ${slip.invoice_number}` : "No invoice chosen"}
            {slip.invoice_balance !== null ? ` · ${formatMoney(slip.invoice_balance, slip.currency)} owed` : ""} · uploaded {formatDateTime(slip.created_at)}
          </p>
          {slip.client_note ? <p className="mt-1 text-sm">“{slip.client_note}”</p> : null}
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href={`/api/slips/${slip.id}`} target="_blank" rel="noreferrer">
            <Eye /> View slip
          </a>
        </Button>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" /> {slip.filename} · {formatBytes(slip.size_bytes)}
      </p>
      <div className="rounded-xl bg-muted/40 p-3 text-sm ring-1 ring-foreground/[0.06]">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Sparkles className="size-3.5" /> Read by AI
        </p>
        {read ? (
          ai.is_payment_slip === false ? (
            <p className="text-sm text-destructive">This doesn&apos;t look like a payment slip.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <div>
                <dt className="text-[11px] text-muted-foreground">Amount</dt>
                <dd className="font-medium tabular-nums">{ai.amount != null ? formatMoney(ai.amount, slip.currency) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Date</dt>
                <dd>{ai.paid_on ? formatPlainDate(ai.paid_on) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Reference</dt>
                <dd className="truncate">{ai.reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Confidence</dt>
                <dd className="capitalize">{ai.confidence ?? "—"}</dd>
              </div>
              {ai.notes ? <p className="col-span-full text-xs text-muted-foreground">{ai.notes}</p> : null}
            </dl>
          )
        ) : (
          <p className="text-xs text-muted-foreground">{ai?.skipped ? `Not read: ${ai.skipped}.` : "Not read yet."} Check the slip and enter the details yourself.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <MatchDialog slip={slip} options={options} />
        <BillingReasonDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-destructive">
              <X /> Reject
            </Button>
          }
          title="Reject this slip?"
          description="The client is told why in their portal and can upload another."
          label="What's wrong"
          confirmLabel="Reject slip"
          destructive
          success="Slip rejected"
          onSubmit={(reason) => rejectSlip(slip.id, reason)}
        />
      </div>
    </li>
  );
}

function MatchDialog({ slip, options }: { slip: SlipRow; options: OpenInvoice[] }) {
  const router = useRouter();
  const ai = slip.ai && !slip.ai.skipped ? slip.ai : null;
  const initialInvoice = slip.invoice_id && options.some((o) => o.id === slip.invoice_id) ? slip.invoice_id : (options[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState(initialInvoice);
  const chosen = options.find((o) => o.id === invoiceId);
  const [amount, setAmount] = useState(String(ai?.amount ?? chosen?.balance ?? ""));
  const [paidOn, setPaidOn] = useState(ai?.paid_on && /^\d{4}-\d{2}-\d{2}$/.test(ai.paid_on) ? ai.paid_on : today());
  const [reference, setReference] = useState(ai?.reference ?? "");
  const [method, setMethod] = useState("bank_transfer");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!options.length}>
          <Check /> Match
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Match the slip to an invoice</DialogTitle>
          <DialogDescription>Check the amount against the slip itself. A receipt is made and the client sees the payment.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await matchSlip(slip.id, { invoiceId, amount, method: method as "bank_transfer", reference, paid_on: paidOn });
              if (!r.ok) return setError(r.error);
              toast.success("Payment recorded and slip matched");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Invoice
            <Select value={invoiceId} onValueChange={setInvoiceId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose an invoice" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.number ?? "Unnumbered"} · {formatMoney(o.balance, o.currency)} owed
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Amount
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Paid on
              <DateField value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || !invoiceId}>
              {pending ? <Spinner /> : null} Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
