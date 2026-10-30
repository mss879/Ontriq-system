/**
 * Money arithmetic and formatting. Amounts are rounded half-up to cents the
 * same way Postgres numeric round() does, so totals shown in the app match
 * the ones the database stores (0014, 0015). Pure module.
 */

export function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/** "LKR 12,500.00" */
export function formatMoney(amount: number | string | null | undefined, currency = "LKR"): string {
  const n = Number(amount ?? 0);
  return `${currency} ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "12,500.00" for table cells where the currency is in the header. */
export function formatAmount(amount: number | string | null | undefined): string {
  return Number(amount ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type PricedLine = { quantity: number; unit_price: number; discount_pct: number };

/** quantity × unit price less the line discount. Mirrors recompute_quote / recompute_invoice. */
export function lineTotal(l: PricedLine): number {
  return round2(l.quantity * l.unit_price * (1 - l.discount_pct / 100));
}

/** Gross (before discounts), discount and net of a set of lines. */
export function linesTotals(lines: PricedLine[]): { gross: number; discount: number; net: number } {
  const gross = round2(lines.reduce((a, l) => a + l.quantity * l.unit_price, 0));
  const net = round2(lines.reduce((a, l) => a + lineTotal(l), 0));
  return { gross, discount: round2(gross - net), net };
}
