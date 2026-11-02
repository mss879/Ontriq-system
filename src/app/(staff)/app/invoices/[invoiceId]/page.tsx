import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { Page, SectionSkeleton } from "@/components/layout/page";
import { Surface, SurfaceHeader } from "@/components/admin/surface";
import { ToneChip } from "@/components/cases/badges";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/documents/document-preview";
import { InvoiceStatusChip, SlipStatusChip, methodLabel } from "@/components/billing/invoice-status";
import { getStaffViewer, hasFreshPermission } from "@/lib/server/viewer";
import { activeTaxRates, getInvoice, getIssuer, type InvoiceDetail } from "@/lib/server/billing/queries";
import { invoiceRecipients } from "@/lib/server/billing/recipients";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { invoiceModel, TEMPLATE_KEYS, type TemplateKey } from "@/domain/documents/model";
import { REMINDER_STEPS } from "@/domain/pricing/invoice-core";
import { formatAmount, formatMoney } from "@/domain/pricing/money";
import { can, canAny } from "@/domain/permissions";
import { InvoiceEditor } from "./invoice-editor";
import { InvoiceActions, VoidPaymentButton } from "./invoice-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ = ["invoices.manage", "invoices.send", "billing.export", "payments.record"] as const;

export async function generateMetadata({ params }: PageProps<"/app/invoices/[invoiceId]">): Promise<Metadata> {
  const { invoiceId } = await params;
  const d = UUID.test(invoiceId) ? await getInvoice(invoiceId) : null;
  return { title: d ? (d.invoice.number ?? "Draft invoice") : "Invoice" };
}

async function load(params: PageProps<"/app/invoices/[invoiceId]">["params"]) {
  const [viewer, { invoiceId }] = await Promise.all([getStaffViewer(), params]);
  if (!canAny(viewer, READ)) redirect("/app");
  const detail = UUID.test(invoiceId) ? await getInvoice(invoiceId) : null;
  if (!detail) notFound();
  return { viewer, detail };
}

export default function InvoicePage({ params }: PageProps<"/app/invoices/[invoiceId]">) {
  return (
    <Page className="max-w-7xl">
      <Link href="/app/invoices" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={10} />}>
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

async function Header({ params }: Pick<PageProps<"/app/invoices/[invoiceId]">, "params">) {
  const { viewer, detail } = await load(params);
  const { invoice: i, client } = detail;
  const mayEmail = can(viewer, "invoices.send") && i.status !== "draft" && i.status !== "void" && (await hasFreshPermission("invoices.send"));
  const recipients = mayEmail ? await invoiceRecipients(client.id) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">{i.number ?? "Draft invoice"}</h1>
            <InvoiceStatusChip status={i.display_status} />
            {i.reminders_paused && i.status !== "draft" ? <ToneChip tone="neutral">Reminders paused</ToneChip> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/app/clients/${client.id}`} className="font-medium text-foreground hover:underline">
              {client.name}
            </Link>
            {" · "}
            {i.kind === "monthly" && i.period_from ? `Month of ${formatPlainDate(i.period_from).replace(/^\d+ /, "")}` : i.kind === "manual" ? "Manual invoice" : "Per-case invoice"}
            {i.due_date ? ` · Due ${formatPlainDate(i.due_date)}` : ""}
          </p>
        </div>
        {i.status !== "draft" ? (
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold tabular-nums">{formatMoney(i.total, i.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Balance</p>
              <p className={`text-lg font-semibold tabular-nums ${i.balance > 0 && i.display_status === "overdue" ? "text-destructive" : ""}`}>{i.status === "void" ? "—" : formatMoney(i.balance, i.currency)}</p>
            </div>
          </div>
        ) : null}
      </div>
      {i.status === "void" ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          Voided {formatDateTime(i.voided_at)}. {i.void_reason}
        </p>
      ) : null}
      {i.status !== "draft" ? (
        <InvoiceActions
          invoice={{
            id: i.id,
            number: i.number,
            status: i.status,
            currency: i.currency,
            balance: i.balance,
            total: i.total,
            document_id: i.document_id,
            document_ready: i.document_status === "ready",
            reminders_paused: i.reminders_paused,
            has_payments: detail.payments.some((p) => !p.voided_at),
          }}
          can={{ send: can(viewer, "invoices.send"), pay: can(viewer, "payments.record"), manage: can(viewer, "invoices.manage") }}
          recipients={recipients}
        />
      ) : null}
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/app/invoices/[invoiceId]">, "params">) {
  const { viewer, detail } = await load(params);
  const { invoice: i, client } = detail;
  const issuer = await getIssuer(viewer.orgId);
  const template = ((TEMPLATE_KEYS as readonly string[]).includes(i.template_key) ? i.template_key : "executive") as TemplateKey;

  if (i.status === "draft" && can(viewer, "invoices.manage")) {
    const taxRates = await activeTaxRates();
    return (
      <div className="space-y-6">
        <InvoiceEditor
          // Saving can add lines, or show ones added meanwhile: the form starts again from what is there.
          key={detail.lines.map((l) => l.id).join()}
          invoiceId={i.id}
          issuer={issuer}
          client={{ name: client.name, address: client.address, email: client.email, phone: client.phone }}
          contacts={detail.contacts}
          taxRates={taxRates}
          canConfirm
          initial={{
            currency: i.currency,
            message: i.message,
            internal_notes: i.internal_notes,
            contact_id: i.contact_id,
            template_key: i.template_key,
            issue_date: i.issue_date,
            period_from: i.period_from,
            period_to: i.period_to,
            lines: detail.lines,
          }}
        />
        <Timeline detail={detail} />
      </div>
    );
  }

  const contact = detail.contacts.find((c) => c.id === i.contact_id) ?? null;
  const model = invoiceModel({
    issuer,
    client: { name: client.name, address: client.address, email: client.email, phone: client.phone },
    contact,
    invoice: { ...i },
    items: detail.lines,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Payments detail={detail} canVoid={can(viewer, "payments.record")} />
        {detail.credit_notes.length ? <CreditNotes detail={detail} /> : null}
        {detail.slips.length ? <Slips detail={detail} /> : null}
        <Reminders detail={detail} />
        {i.internal_notes ? (
          <Surface>
            <SurfaceHeader title="Internal notes" />
            <p className="px-5 py-4 text-sm whitespace-pre-line text-muted-foreground">{i.internal_notes}</p>
          </Surface>
        ) : null}
        <Timeline detail={detail} />
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">As the client sees it</p>
        <DocumentPreview model={model} template={template} />
      </div>
    </div>
  );
}

function Payments({ detail, canVoid }: { detail: InvoiceDetail; canVoid: boolean }) {
  const { invoice: i, payments } = detail;
  return (
    <Surface>
      <SurfaceHeader
        title="Payments"
        description={i.amount_paid > 0 ? `${formatMoney(i.amount_paid, i.currency)} received` : "Nothing received yet"}
      />
      {payments.length ? (
        <ul className="divide-y">
          {payments.map((p) => (
            <li key={p.id} className={`flex items-start justify-between gap-3 px-5 py-3 ${p.voided_at ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">
                  {formatMoney(p.amount, i.currency)}
                  {p.voided_at ? <span className="ml-2 text-xs font-normal text-destructive">Voided</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {methodLabel(p.method)} · {formatPlainDate(p.paid_on)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
                {p.voided_at && p.void_reason ? <p className="text-xs text-muted-foreground">{p.void_reason}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {p.receipt_ready && p.receipt_document_id ? (
                  <Button asChild variant="ghost" size="xs">
                    <a href={`/api/documents/${p.receipt_document_id}`} target="_blank" rel="noreferrer">
                      <FileText /> {p.receipt_number}
                    </a>
                  </Button>
                ) : p.receipt_number ? (
                  <span className="text-xs text-muted-foreground">{p.receipt_number}</span>
                ) : null}
                {canVoid && !p.voided_at ? <VoidPaymentButton paymentId={p.id} label={formatMoney(p.amount, i.currency)} /> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">Payments recorded here, or matched from a client&apos;s slip, appear with their receipts.</p>
      )}
    </Surface>
  );
}

function CreditNotes({ detail }: { detail: InvoiceDetail }) {
  return (
    <Surface>
      <SurfaceHeader title="Credit notes" />
      <ul className="divide-y">
        {detail.credit_notes.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {n.number} · <span className="tabular-nums">{formatMoney(n.amount, detail.invoice.currency)}</span>
              </p>
              <p className="text-xs text-muted-foreground">{n.reason}</p>
            </div>
            {n.document_ready && n.document_id ? (
              <Button asChild variant="ghost" size="xs">
                <a href={`/api/documents/${n.document_id}?download=1`}>
                  <Download /> PDF
                </a>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function Slips({ detail }: { detail: InvoiceDetail }) {
  return (
    <Surface>
      <SurfaceHeader title="Payment slips from the client" aside={<Link href="/app/payments" className="text-xs font-medium text-primary hover:underline">Match slips</Link>} />
      <ul className="divide-y">
        {detail.slips.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <a href={`/api/slips/${s.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                {s.filename}
              </a>
              <p className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}{s.rejection_reason ? ` · ${s.rejection_reason}` : ""}</p>
            </div>
            <SlipStatusChip status={s.status} staff />
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function Reminders({ detail }: { detail: InvoiceDetail }) {
  const { invoice: i, reminders } = detail;
  if (i.status === "draft" || i.status === "void") return null;
  const sent = new Map(reminders.map((r) => [r.step, r]));
  return (
    <Surface>
      <SurfaceHeader title="Payment reminders" description={i.reminders_paused ? "Paused for this invoice." : "Sent automatically in office hours until the invoice is paid."} />
      <ol className="space-y-2 px-5 py-4">
        {REMINDER_STEPS.map((s) => {
          const r = sent.get(s.step);
          return (
            <li key={s.step} className="flex items-center justify-between gap-3 text-sm">
              <span className={r ? "" : "text-muted-foreground"}>{s.label}</span>
              <span className="text-xs text-muted-foreground">{r ? `Sent ${formatDateTime(r.sent_at)}` : i.status === "paid" ? "Not needed" : "Not yet"}</span>
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}

const EVENT_LABEL: Record<string, string> = {
  drafted: "Drafted",
  confirmed: "Confirmed",
  sent: "Sent",
  viewed: "Opened by the client",
  payment: "Payment recorded",
  payment_voided: "Payment voided",
  credit_note: "Credit note issued",
  voided: "Voided",
  reminder: "Reminder sent",
  slip_uploaded: "Payment slip uploaded",
};

function Timeline({ detail }: { detail: InvoiceDetail }) {
  if (!detail.events.length) return null;
  return (
    <Surface>
      <SurfaceHeader title="Activity" />
      <ol className="space-y-3 px-5 py-4">
        {detail.events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
            <div className="min-w-0">
              <p>
                <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                {e.amount !== null ? <span className="tabular-nums"> · {formatAmount(e.amount)}</span> : null}
                {e.body ? <span className="text-muted-foreground"> · {e.body}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(e.at)} · {e.actor ?? (e.actor_kind === "client" ? "Client" : e.actor_kind === "system" ? "System" : "Staff")}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Surface>
  );
}
