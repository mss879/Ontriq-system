/**
 * CSV for downloads that open cleanly in Excel: a UTF-8 byte order mark (so
 * Sinhala and Tamil names survive), quoted cells, CRLF line ends, and cells
 * that start with = + - @ (or a tab/CR) prefixed with a quote so a
 * spreadsheet never runs them as formulas. Pure module.
 */

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  // Numbers are data, not formulas: only text gets the guard (a negative amount stays a number).
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** A safe download name: letters, digits, dots and dashes only. */
export function csvFilename(...parts: (string | null | undefined)[]): string {
  const base = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "export"}.csv`;
}

const colombo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A timestamp as Sri Lanka local time, "2026-10-30 14:05", sortable in a spreadsheet. */
export function csvDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(colombo.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
