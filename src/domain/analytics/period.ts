/**
 * The Analytics page's period, read from the URL (?period=30d|quarter|year|custom
 * &from=YYYY-MM-DD&to=YYYY-MM-DD) in Sri Lanka time. Pure module.
 */

export const PERIOD_PRESETS = [
  { key: "30d", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

export type Period = { preset: PeriodPreset; from: string; to: string; label: string };

export const MAX_PERIOD_DAYS = 1100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Colombo as YYYY-MM-DD. */
export function colomboToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => fromDay(toDay(iso) + days * 86_400_000);
export const daysBetween = (from: string, to: string) => Math.round((toDay(to) - toDay(from)) / 86_400_000);

function validIso(v: string | undefined): v is string {
  if (!v || !ISO.test(v)) return false;
  return fromDay(toDay(v)) === v;
}

/** A short human label for a date range: "1 Oct – 30 Oct 2026". */
export function rangeLabel(from: string, to: string): string {
  const fmt = (iso: string, year: boolean) =>
    new Date(toDay(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to, true)}`;
}

export function parsePeriod(params: Record<string, string | string[] | undefined>, now: Date = new Date()): Period {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const today = colomboToday(now);
  const preset = (PERIOD_PRESETS.some((p) => p.key === one("period")) ? one("period") : "30d") as PeriodPreset;
  const label = (key: PeriodPreset) => PERIOD_PRESETS.find((p) => p.key === key)!.label;

  if (preset === "custom") {
    const from = one("from");
    let to = one("to");
    if (validIso(from) && validIso(to)) {
      if (to > today) to = today;
      if (from <= to && daysBetween(from, to) <= MAX_PERIOD_DAYS) return { preset, from, to, label: rangeLabel(from, to) };
    }
    return { preset: "30d", from: addDays(today, -29), to: today, label: label("30d") };
  }
  if (preset === "quarter") {
    const m = Number(today.slice(5, 7));
    const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0");
    return { preset, from: `${today.slice(0, 4)}-${qm}-01`, to: today, label: label("quarter") };
  }
  if (preset === "year") return { preset, from: `${today.slice(0, 4)}-01-01`, to: today, label: label("year") };
  return { preset, from: addDays(today, -29), to: today, label: label("30d") };
}

/** URL search params for a period (and any extra keys), dropping defaults. */
export function periodQuery(p: Pick<Period, "preset" | "from" | "to">, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (p.preset !== "30d") q.set("period", p.preset);
  if (p.preset === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}
