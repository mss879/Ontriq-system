/**
 * Sorting the assistant's tables. Cells are display strings ("LKR 12,500.00",
 * "12 Oct", "83%", "—"), so values are compared as amounts, dates or
 * numbers when every filled cell in the column reads as one; otherwise as
 * text. Empty cells ("—", "") always sort last.
 */

type Cell = string | number;
type Kind = "number" | "date" | "text";

const EMPTY = new Set(["", "—", "-", "n/a"]);
const isEmpty = (c: Cell) => typeof c === "string" && EMPTY.has(c.trim().toLowerCase());

export function numberOf(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = c.trim().replace(/^(LKR|Rs\.?|USD|\$)\s*/i, "").replace(/[,%]/g, "").replace(/\s*(days?|hrs?|h)$/i, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function dateOf(c: Cell, year = new Date().getFullYear()): number | null {
  if (typeof c !== "string") return null;
  const s = c.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(t) ? null : t;
  }
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  return month < 0 ? null : Date.UTC(m[3] ? Number(m[3]) : year, month, Number(m[1]));
}

export function columnKind(rows: Cell[][], col: number): Kind {
  const cells = rows.map((r) => r[col]).filter((c) => c !== undefined && !isEmpty(c));
  if (!cells.length) return "text";
  if (cells.every((c) => numberOf(c) !== null)) return "number";
  if (cells.every((c) => dateOf(c) !== null)) return "date";
  return "text";
}

export function sortRows<R extends Cell[]>(rows: R[], col: number, dir: "asc" | "desc"): R[] {
  const kind = columnKind(rows, col);
  const key = (c: Cell) => (kind === "number" ? numberOf(c) : kind === "date" ? dateOf(c) : null);
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[col];
      const y = b.row[col];
      const ex = x === undefined || isEmpty(x);
      const ey = y === undefined || isEmpty(y);
      if (ex || ey) return ex === ey ? a.i - b.i : ex ? 1 : -1;
      const d = kind === "text" ? String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" }) : (key(x) as number) - (key(y) as number);
      return d === 0 ? a.i - b.i : d * sign;
    })
    .map((x) => x.row);
}
