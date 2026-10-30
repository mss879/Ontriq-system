import { describe, expect, it } from "vitest";
import { formatMoney, lineTotal, linesTotals, round2 } from "@/domain/pricing/money";
import { displayStatus, invoiceTotals, nextInvoiceReminder } from "@/domain/pricing/invoice-core";
import { invoiceModel, issuerFromBranding, quoteModel, statementModel } from "@/domain/documents/model";

describe("money", () => {
  it("rounds like Postgres numeric round()", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(formatMoney(12500)).toBe("LKR 12,500.00");
  });

  it("totals lines with discounts (same numbers the database stores)", () => {
    expect(lineTotal({ quantity: 1, unit_price: 2000, discount_pct: 10 })).toBe(1800);
    expect(linesTotals([{ quantity: 1, unit_price: 2000, discount_pct: 10 }, { quantity: 2, unit_price: 3500, discount_pct: 0 }])).toEqual({ gross: 9000, discount: 200, net: 8800 });
  });
});

describe("invoice totals", () => {
  const lines = [{ quantity: 1, unit_price: 1800, discount_pct: 0 }, { quantity: 1, unit_price: 3500, discount_pct: 0 }, { quantity: 1, unit_price: 4000, discount_pct: 0 }];

  it("adds exclusive VAT on top", () => {
    const t = invoiceTotals(lines, [{ code: "VAT", name: "VAT", rate: 18, inclusive: false }]);
    expect(t.net_total).toBe(9300);
    expect(t.tax_total).toBe(1674);
    expect(t.total).toBe(10974);
  });

  it("extracts inclusive tax without changing the total", () => {
    const t = invoiceTotals([{ quantity: 1, unit_price: 1180, discount_pct: 0 }], [{ code: "VAT", name: "VAT", rate: 18, inclusive: true }]);
    expect(t.tax_lines[0].amount).toBe(180);
    expect(t.total).toBe(1180);
  });

  it("shows open invoices past their due date as overdue (Colombo time)", () => {
    const now = new Date("2026-11-10T08:00:00+05:30");
    expect(displayStatus("sent", "2026-11-09", now)).toBe("overdue");
    expect(displayStatus("sent", "2026-11-10", now)).toBe("sent");
    expect(displayStatus("paid", "2026-01-01", now)).toBe("paid");
  });
});

describe("invoice reminders", () => {
  const base = { dueDate: "2026-11-20", balance: 5000, stepsSent: [] as string[], paused: false };
  const at = (iso: string) => new Date(`${iso}T10:00:00+05:30`);

  it("follows the ladder: 3 days before, on the day, 7 and 14 days late, then escalation", () => {
    expect(nextInvoiceReminder(base, at("2026-11-16"))).toBeNull();
    expect(nextInvoiceReminder(base, at("2026-11-17"))).toBe("before_due");
    expect(nextInvoiceReminder({ ...base, stepsSent: ["before_due"] }, at("2026-11-18"))).toBeNull();
    expect(nextInvoiceReminder({ ...base, stepsSent: ["before_due"] }, at("2026-11-20"))).toBe("due");
    expect(nextInvoiceReminder({ ...base, stepsSent: ["before_due", "due"] }, at("2026-11-27"))).toBe("late_7");
    expect(nextInvoiceReminder({ ...base, stepsSent: ["before_due", "due", "late_7"] }, at("2026-12-04"))).toBe("late_14");
    expect(nextInvoiceReminder({ ...base, stepsSent: ["before_due", "due", "late_7", "late_14"] }, at("2026-12-07"))).toBe("escalated");
  });

  it("skips missed steps instead of sending a burst, and stops when paid or paused", () => {
    expect(nextInvoiceReminder(base, at("2026-11-28"))).toBe("late_7");
    expect(nextInvoiceReminder({ ...base, stepsSent: ["late_7"] }, at("2026-11-29"))).toBeNull();
    expect(nextInvoiceReminder({ ...base, balance: 0 }, at("2026-11-20"))).toBeNull();
    expect(nextInvoiceReminder({ ...base, paused: true }, at("2026-11-20"))).toBeNull();
    expect(nextInvoiceReminder(base, new Date("2026-11-22T10:00:00+05:30"))).toBeNull(); // Sunday
  });
});

describe("document models", () => {
  const issuer = issuerFromBranding({ name: "Ontriq (Pvt) Ltd", branding: { display_name: "Ontriq", legal_name: "Ontriq (Pvt) Ltd", email: "info@ontriq.com" } });
  const client = { name: "Hemas Holdings", address: { line1: "36 Bristol St", city: "Colombo" }, email: "ap@hemas.lk" };

  it("marks drafts and shows the quote's discount and tiers", () => {
    const m = quoteModel({
      issuer,
      client,
      contact: { name: "Nadeesha Perera", title: "HR Manager" },
      quote: { number: null, version: 1, status: "draft", title: "Verification services", currency: "LKR", issue_date: "2026-11-01", valid_until: "2026-12-01", payment_terms_days: 30, intro: "Thank you.", scope: "Seven checks.", assumptions: "", tat_text: "7 working days.", closing: "", subtotal: 9000, discount_total: 200, total: 8800 },
      items: [{ description: "NIC", quantity: 1, unit_price: 2000, discount_pct: 10, total: 1800 }],
      tiers: [{ min_volume: 51, max_volume: 200, discount_pct: 10, note: "" }],
    });
    expect(m.badge).toBe("DRAFT");
    expect(m.number).toBe("Draft");
    expect(m.to.lines[0]).toBe("Attn: Nadeesha Perera, HR Manager");
    expect(m.sections.map((s) => s.heading)).toEqual(["Scope", "Turnaround"]);
    expect(m.tiers[0].range).toBe("51–200 cases a month");
    expect(m.totals.at(-1)).toMatchObject({ value: "8,800.00", strong: true });
  });

  it("titles a taxed invoice as a tax invoice and shows the balance after payments", () => {
    const m = invoiceModel({
      issuer,
      client,
      contact: null,
      invoice: { number: "INV-2026-0001", status: "partially_paid", currency: "LKR", issue_date: "2026-11-01", due_date: "2026-12-01", period_from: null, period_to: null, message: "", subtotal: 9300, discount_total: 0, net_total: 9300, tax_lines: [{ code: "VAT", name: "VAT", rate: 18, inclusive: false, amount: 1674 }], total: 10974, amount_paid: 5000, amount_credited: 0, balance: 5974 },
      items: [],
    });
    expect(m.title).toBe("Tax invoice");
    expect(m.totals.map((t) => t.label)).toEqual(["Subtotal", "VAT 18%", "Total (LKR)", "Paid", "Balance due"]);
    expect(m.payment[0]).toMatch(/upload the slip/);
  });

  it("prints a free-text client address line by line", () => {
    const m = invoiceModel({
      issuer,
      client: { name: "Hemas Holdings", address: { text: "36 Bristol Street\nColombo 01, Sri Lanka" }, email: null },
      contact: null,
      invoice: { number: "INV-2026-0002", status: "sent", currency: "LKR", issue_date: "2026-11-01", due_date: "2026-12-01", period_from: null, period_to: null, message: "", subtotal: 0, discount_total: 0, net_total: 0, tax_lines: [], total: 0, amount_paid: 0, amount_credited: 0, balance: 0 },
      items: [],
    });
    expect(m.to.lines).toEqual(["36 Bristol Street", "Colombo 01", "Sri Lanka"]);
  });

  it("lays out a statement with running balances", () => {
    const m = statementModel({ issuer, client, currency: "LKR", statement: { from: "2026-11-01", to: "2026-11-30", opening: 0, closing: 0, lines: [{ date: "2026-11-02", kind: "invoice", reference: "INV-1", debit: 1000, credit: 0, balance: 1000 }, { date: "2026-11-05", kind: "payment", reference: "BOC", debit: 0, credit: 1000, balance: 0 }] } });
    expect(m.statement?.rows.map((r) => [r.kind, r.debit, r.credit, r.balance])).toEqual([["Invoice", "1,000.00", "", "1,000.00"], ["Payment", "", "1,000.00", "0.00"]]);
    expect(m.payment).toEqual([]);
  });
});
