import { ToneChip } from "@/components/cases/badges";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/domain/pricing/invoice-core";
import type { Tone } from "@/domain/workflow/stages";

const TONE: Record<InvoiceStatus, Tone> = {
  draft: "neutral",
  confirmed: "info",
  sent: "progress",
  viewed: "progress",
  partially_paid: "warning",
  paid: "success",
  void: "neutral",
  overdue: "danger",
};

/** An invoice's status as people read it (open and past due shows as overdue). */
export function InvoiceStatusChip({ status, className }: { status: string; className?: string }) {
  const s = (status in TONE ? status : "draft") as InvoiceStatus;
  return (
    <ToneChip tone={TONE[s]} className={className}>
      {INVOICE_STATUS_LABELS[s]}
    </ToneChip>
  );
}

const SLIP_TONE: Record<string, Tone> = { pending: "warning", matched: "success", rejected: "danger", pending_upload: "neutral" };
const SLIP_LABEL: Record<string, string> = { pending: "Being checked", matched: "Matched", rejected: "Not matched", pending_upload: "Uploading" };

export function SlipStatusChip({ status, staff = false }: { status: string; staff?: boolean }) {
  return <ToneChip tone={SLIP_TONE[status] ?? "neutral"}>{staff && status === "pending" ? "To match" : (SLIP_LABEL[status] ?? status)}</ToneChip>;
}

export const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "online", label: "Online payment" },
  { value: "other", label: "Other" },
] as const;

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;
