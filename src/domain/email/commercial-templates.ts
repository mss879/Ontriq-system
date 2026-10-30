/**
 * Emails for quotations, invoices and payment reminders. They link to the
 * client portal (the PDF is there); no attachments, so nothing sensitive sits
 * in mailboxes. Pure: shared by server actions and the worker.
 */
import { renderEmail, type EmailBrand, DEFAULT_BRAND } from "./layout";
import { formatMoney } from "../pricing/money";
import { reportDate } from "../reports/compile-core";

const hello = (name: string | null | undefined) => (name ? `Hello ${name.trim().split(/\s+/)[0]},` : "Hello,");

export function quoteEmail(
  input: { contactName: string | null; clientName: string; orgName: string; number: string; title: string; total: number; currency: string; validUntil: string; url: string; message?: string | null },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const rendered = renderEmail(
    {
      preheader: `Quotation ${input.number} for ${input.clientName}`,
      heading: `Quotation ${input.number}`,
      paragraphs: [
        hello(input.contactName),
        input.message?.trim() || `Thank you for considering ${input.orgName}. Our quotation for ${input.title.toLowerCase()} is ready in your client portal.`,
        `Total ${formatMoney(input.total, input.currency)}, valid until ${reportDate(input.validUntil)}. You can read it, download the PDF and accept it online.`,
      ],
      cta: { label: "View the quotation", url: input.url },
      note: "Questions? Reply to this email or use 'Ask a question' on the quotation.",
    },
    brand,
  );
  return { subject: `${input.orgName} quotation ${input.number}`, ...rendered };
}

export function invoiceEmail(
  input: { contactName: string | null; clientName: string; orgName: string; number: string; total: number; currency: string; dueDate: string; url: string; message?: string | null },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const rendered = renderEmail(
    {
      preheader: `Invoice ${input.number}: ${formatMoney(input.total, input.currency)} due ${reportDate(input.dueDate)}`,
      heading: `Invoice ${input.number}`,
      paragraphs: [
        hello(input.contactName),
        input.message?.trim() || `Please find invoice ${input.number} for ${input.clientName} in your client portal.`,
        `Amount due: ${formatMoney(input.total, input.currency)} by ${reportDate(input.dueDate)}. After paying by bank transfer, upload the slip in the portal so we can match it quickly.`,
      ],
      cta: { label: "View the invoice", url: input.url },
    },
    brand,
  );
  return { subject: `${input.orgName} invoice ${input.number}`, ...rendered };
}

const REMINDER_COPY: Record<string, { subject: (n: string) => string; line: (due: string) => string }> = {
  before_due: { subject: (n) => `Invoice ${n} is due soon`, line: (due) => `A friendly reminder that this invoice is due on ${due}.` },
  due: { subject: (n) => `Invoice ${n} is due today`, line: () => "This invoice is due today." },
  late_7: { subject: (n) => `Invoice ${n} is overdue`, line: (due) => `This invoice was due on ${due} and is now a week overdue.` },
  late_14: { subject: (n) => `Second notice: invoice ${n} is overdue`, line: (due) => `This invoice was due on ${due} and is now two weeks overdue. Please arrange payment or let us know if something is wrong.` },
};

export function invoiceReminderEmail(
  input: { step: string; clientName: string; orgName: string; number: string; balance: number; currency: string; dueDate: string; url: string },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const copy = REMINDER_COPY[input.step] ?? REMINDER_COPY.due;
  const due = reportDate(input.dueDate) ?? input.dueDate;
  const rendered = renderEmail(
    {
      preheader: copy.subject(input.number),
      heading: copy.subject(input.number),
      paragraphs: [
        `Hello ${input.clientName} team,`,
        copy.line(due),
        `Balance: ${formatMoney(input.balance, input.currency)}. If you have already paid, upload the slip in the portal and we'll match it; please ignore this message.`,
      ],
      cta: { label: "View the invoice", url: input.url },
    },
    brand,
  );
  return { subject: `${input.orgName}: ${copy.subject(input.number)}`, ...rendered };
}
