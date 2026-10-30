/**
 * Invoice totals and status (mirrors public.recompute_invoice in 0015) and
 * the reminder ladder: 3 days before the due date, on the due date, 7 and 14
 * days late, then one alert to Ontriq's finance team 3 days after that.
 * Reminders go out in office hours and pause while a payment slip waits or
 * staff paused them. Pure module (tests/unit/pricing.test.ts).
 */
import { toZonedTime } from "date-fns-tz";
import { TZ } from "../sla-core";
import { linesTotals, round2, type PricedLine } from "./money";
import { inOfficeHours } from "../candidate/reminders-core";

export type TaxRate = { code: string; name: string; rate: number; inclusive: boolean };
export type TaxLine = TaxRate & { amount: number };

export function invoiceTotals(lines: PricedLine[], taxes: TaxRate[]) {
  const { gross, discount, net } = linesTotals(lines);
  const tax_lines: TaxLine[] = taxes.map((t) => ({
    ...t,
    amount: t.inclusive ? round2(net - net / (1 + t.rate / 100)) : round2((net * t.rate) / 100),
  }));
  const taxTotal = round2(tax_lines.reduce((a, t) => a + t.amount, 0));
  const inclusive = round2(tax_lines.filter((t) => t.inclusive).reduce((a, t) => a + t.amount, 0));
  return { subtotal: gross, discount_total: discount, net_total: net, tax_lines, tax_total: taxTotal, total: round2(net + taxTotal - inclusive) };
}

export type InvoiceStatus = "draft" | "confirmed" | "sent" | "viewed" | "partially_paid" | "paid" | "void" | "overdue";

/** The status people see: open invoices past their due date read as overdue. */
export function displayStatus(status: string, dueDate: string | null, today: Date = new Date()): InvoiceStatus {
  if (["sent", "viewed", "partially_paid"].includes(status) && dueDate) {
    const local = toZonedTime(today, TZ);
    const todayIso = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    if (dueDate < todayIso) return "overdue";
  }
  return status as InvoiceStatus;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Part paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export const REMINDER_STEPS = [
  { step: "before_due", days: -3, label: "3 days before the due date" },
  { step: "due", days: 0, label: "On the due date" },
  { step: "late_7", days: 7, label: "7 days late" },
  { step: "late_14", days: 14, label: "14 days late" },
  { step: "escalated", days: 17, label: "Alert to Ontriq's finance team" },
] as const;
export type ReminderStep = (typeof REMINDER_STEPS)[number]["step"];

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const colomboDay = (d: Date) => {
  const l = toZonedTime(d, TZ);
  return Math.floor(Date.UTC(l.getFullYear(), l.getMonth(), l.getDate()) / 86_400_000);
};

/**
 * The step to send now, if any: the latest step that is due and not yet sent.
 * Earlier missed steps are skipped (one reminder per run, never a burst).
 */
export function nextInvoiceReminder(
  inv: { dueDate: string; balance: number; stepsSent: string[]; paused: boolean },
  now: Date,
): ReminderStep | null {
  if (inv.balance <= 0 || inv.paused || !inOfficeHours(now)) return null;
  const daysFromDue = colomboDay(now) - dayNumber(inv.dueDate);
  const due = REMINDER_STEPS.filter((s) => daysFromDue >= s.days);
  const latest = due[due.length - 1];
  if (!latest || inv.stepsSent.includes(latest.step)) return null;
  // Never go backwards: a later step already sent covers the earlier ones.
  const sentIdx = Math.max(-1, ...inv.stepsSent.map((s) => REMINDER_STEPS.findIndex((r) => r.step === s)));
  const idx = REMINDER_STEPS.findIndex((r) => r.step === latest.step);
  return idx > sentIdx ? latest.step : null;
}
