"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DocumentPreview } from "@/components/documents/document-preview";
import { invoiceModel, TEMPLATE_KEYS, TEMPLATE_LABELS, type Issuer, type TemplateKey } from "@/domain/documents/model";
import { invoiceTotals, type TaxRate } from "@/domain/pricing/invoice-core";
import { formatAmount, formatMoney, lineTotal } from "@/domain/pricing/money";
import { confirmInvoice, saveInvoiceDraft } from "../actions";
import { DateField } from "@/components/forms/date-field";

type Line = { key: string; id?: string; description: string; quantity: string; unit_price: string; discount_pct: string; case_reference: string | null };
type Contact = { id: string; name: string; title: string | null; email: string | null };

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The draft invoice, two panes: what staff edit on the left, the client's
 * invoice as it will look on the right (same layout as the PDF). Totals use
 * the active tax rates, exactly as the database will on confirmation.
 */
export function InvoiceEditor({
  invoiceId,
  issuer,
  client,
  contacts,
  taxRates,
  initial,
  canConfirm,
}: {
  invoiceId: string;
  issuer: Issuer;
  client: { name: string; address: Record<string, string> | null; email: string | null; phone: string | null };
  contacts: Contact[];
  taxRates: TaxRate[];
  initial: {
    currency: string;
    message: string;
    internal_notes: string;
    contact_id: string | null;
    template_key: string;
    issue_date: string | null;
    period_from: string | null;
    period_to: string | null;
    lines: { id: string; description: string; quantity: number; unit_price: number; discount_pct: number; case_reference: string | null }[];
  };
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() =>
    initial.lines.map((l) => ({ key: l.id, id: l.id, description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price), discount_pct: String(l.discount_pct), case_reference: l.case_reference })),
  );
  const [message, setMessage] = useState(initial.message);
  const [notes, setNotes] = useState(initial.internal_notes);
  const [contactId, setContactId] = useState(initial.contact_id ?? "");
  const [template, setTemplate] = useState<TemplateKey>((TEMPLATE_KEYS as readonly string[]).includes(initial.template_key) ? (initial.template_key as TemplateKey) : "executive");
  const [issueDate, setIssueDate] = useState(initial.issue_date ?? "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const touch = () => setDirty(true);

  const priced = lines.map((l) => ({ quantity: n(l.quantity), unit_price: n(l.unit_price), discount_pct: n(l.discount_pct) }));
  const totals = invoiceTotals(priced, taxRates);
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  const model = invoiceModel({
        issuer,
        client,
        contact: contact ? { name: contact.name, title: contact.title, email: contact.email } : null,
        invoice: {
          number: null,
          status: "draft",
          currency: initial.currency,
          issue_date: issueDate || null,
          due_date: null,
          period_from: initial.period_from,
          period_to: initial.period_to,
          message,
          ...totals,
          amount_paid: 0,
          amount_credited: 0,
          balance: totals.total,
        },
        items: lines.map((l, i) => ({ description: l.description || "—", quantity: priced[i].quantity, unit_price: priced[i].unit_price, discount_pct: priced[i].discount_pct, total: lineTotal(priced[i]) })),
  });

  const payload = () => ({
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct || "0" })),
    message,
    internal_notes: notes,
    contact_id: contactId || null,
    template_key: template,
    issue_date: issueDate || null,
  });

  const save = (then?: () => void) =>
    startSave(async () => {
      setError(null);
      const r = await saveInvoiceDraft(invoiceId, payload());
      if (!r.ok) return setError(r.error);
      setDirty(false);
      if (then) then();
      else {
        toast.success("Draft saved");
        router.refresh();
      }
    });

  const confirm = () =>
    startConfirm(async () => {
      setError(null);
      if (dirty) {
        const saved = await saveInvoiceDraft(invoiceId, payload());
        if (!saved.ok) return setError(saved.error);
        setDirty(false);
      }
      const r = await confirmInvoice(invoiceId);
      if (!r.ok) return setError(r.error);
      toast.success(`Invoice ${r.number} confirmed`, { description: "The PDF is being prepared." });
      router.refresh();
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
          <h2 className="text-sm font-semibold">Lines</h2>
          {lines.length ? (
            <ul className="space-y-3">
              {lines.map((l, i) => (
                <li key={l.key} className="space-y-2 rounded-xl bg-muted/30 p-3 ring-1 ring-foreground/[0.06]">
                  <div className="flex items-start gap-2">
                    <Textarea
                      aria-label={`Line ${i + 1} description`}
                      value={l.description}
                      rows={2}
                      className="min-h-0 flex-1 resize-none text-sm"
                      onChange={(e) => {
                        setLines((all) => all.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)));
                        touch();
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => {
                        setLines((all) => all.filter((x) => x.key !== l.key));
                        touch();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["quantity", "Qty"],
                        ["unit_price", `Unit (${initial.currency})`],
                        ["discount_pct", "Disc. %"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        {label}
                        <Input
                          inputMode="decimal"
                          value={l[field]}
                          className="h-8 text-sm tabular-nums"
                          onChange={(e) => {
                            setLines((all) => all.map((x) => (x.key === l.key ? { ...x, [field]: e.target.value } : x)));
                            touch();
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="flex justify-between text-xs text-muted-foreground">
                    <span>{l.case_reference ? `Case ${l.case_reference}` : "Manual line"}</span>
                    <span className="font-medium text-foreground tabular-nums">{formatAmount(lineTotal(priced[i]))}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No lines yet.</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((all) => [...all, { key: `new-${Date.now()}`, description: "", quantity: "1", unit_price: "0", discount_pct: "0", case_reference: null }]);
              touch();
            }}
          >
            <Plus /> Add a line
          </Button>
          <dl className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Net</dt>
              <dd className="tabular-nums">{formatAmount(totals.net_total)}</dd>
            </div>
            {totals.tax_lines.map((t) => (
              <div key={t.code} className="flex justify-between">
                <dt className="text-muted-foreground">
                  {t.name} {t.rate}%{t.inclusive ? " (included)" : ""}
                </dt>
                <dd className="tabular-nums">{formatAmount(t.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(totals.total, initial.currency)}</dd>
            </div>
            {!taxRates.length ? <p className="pt-1 text-xs text-muted-foreground">No tax is switched on (Settings → Billing &amp; taxes).</p> : null}
          </dl>
        </section>

        <section className="space-y-4 rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/[0.07]">
          <h2 className="text-sm font-semibold">Details</h2>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Addressed to
            <Select
              value={contactId || "__none"}
              onValueChange={(v) => {
                setContactId(v === "__none" ? "" : v);
                touch();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">The company (no contact)</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.title ? ` · ${c.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Design
              <Select
                value={template}
                onValueChange={(v) => {
                  setTemplate(v as TemplateKey);
                  touch();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TEMPLATE_LABELS[k].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Invoice date
              <DateField

                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  touch();
                }}
              />
              <span className="text-[11px] font-normal text-muted-foreground">Leave empty to use the day it is confirmed.</span>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Message on the invoice
            <Textarea
              value={message}
              rows={2}
              placeholder="Thank you for your business."
              onChange={(e) => {
                setMessage(e.target.value);
                touch();
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Internal notes
            <Textarea
              value={notes}
              rows={2}
              placeholder="Only Ontriq staff see this."
              onChange={(e) => {
                setNotes(e.target.value);
                touch();
              }}
            />
          </label>
        </section>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => save()} disabled={saving || confirming || !dirty}>
            {saving ? <Spinner /> : <Save />} {dirty ? "Save draft" : "Saved"}
          </Button>
          {canConfirm ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={saving || confirming || !lines.length}>
                  {confirming ? <Spinner /> : <CheckCircle2 />} Confirm invoice
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm this invoice?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It gets its number and due date, the taxes are fixed, and the PDF is made. After this, changes need a credit note or voiding.
                    {totals.total <= 0 ? " The total is zero: check the prices first, the system will refuse a zero invoice." : ` Total ${formatMoney(totals.total, initial.currency)}.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep editing</AlertDialogCancel>
                  <AlertDialogAction onClick={confirm} disabled={totals.total <= 0}>
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Preview · {TEMPLATE_LABELS[template].name}</p>
        <DocumentPreview model={model} template={template} />
      </div>
    </div>
  );
}
