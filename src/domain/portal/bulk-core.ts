/**
 * Bulk requests from a spreadsheet saved as CSV: parse, map headers, validate
 * each row, and produce create_case payloads. Excel users save as CSV first.
 * Pure module (tests/unit/portal.test.ts).
 */
import { parseNic } from "../nic-core";

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const BULK_COLUMNS = [
  { key: "full_name", label: "Full name", required: true, aliases: ["name", "candidate", "candidate name", "full name"] },
  { key: "nic", label: "NIC", required: false, aliases: ["nic", "nic number", "national id", "id number"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "e-mail", "email address"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "contact", "contact number", "phone number"] },
  { key: "position_title", label: "Position", required: false, aliases: ["position", "job title", "role", "designation", "position title"] },
  { key: "department", label: "Department", required: false, aliases: ["department", "dept", "division"] },
  { key: "client_reference", label: "Your reference", required: false, aliases: ["reference", "your reference", "ref", "employee id", "client reference"] },
  { key: "district", label: "District", required: false, aliases: ["district"] },
] as const;
export type BulkKey = (typeof BULK_COLUMNS)[number]["key"];

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Map each header to a column key by name or alias. */
export function mapHeaders(headers: string[]): (BulkKey | null)[] {
  return headers.map((h) => {
    const n = norm(h);
    const hit = BULK_COLUMNS.find((c) => norm(c.key) === n || c.aliases.some((a) => a === n));
    return hit ? hit.key : null;
  });
}

export type BulkRow = {
  line: number;
  values: Partial<Record<BulkKey, string>>;
  nicCanonical: string | null;
  errors: string[];
  warnings: string[];
};

export const BULK_MAX_ROWS = 100;

export function validateBulk(text: string, today = new Date()): { rows: BulkRow[]; missingColumns: string[]; tooMany: boolean } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], missingColumns: ["Full name"], tooMany: false };
  const keys = mapHeaders(table[0]);
  const missingColumns = BULK_COLUMNS.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.label);
  const body = table.slice(1);
  const seen = new Map<string, number>();
  const rows = body.slice(0, BULK_MAX_ROWS).map((cells, i): BulkRow => {
    const values: Partial<Record<BulkKey, string>> = {};
    keys.forEach((k, j) => {
      const v = (cells[j] ?? "").trim();
      if (k && v) values[k] = v;
    });
    const errors: string[] = [];
    const warnings: string[] = [];
    let nicCanonical: string | null = null;
    if (!values.full_name || values.full_name.length < 2) errors.push("Full name is missing.");
    if (values.nic) {
      const nic = parseNic(values.nic, today);
      if (!nic.valid) errors.push(`NIC "${values.nic}" is not valid.`);
      else {
        nicCanonical = nic.canonical;
        const dup = seen.get(nic.canonical);
        if (dup) errors.push(`Same NIC as line ${dup}.`);
        seen.set(nic.canonical, i + 2);
      }
    } else warnings.push("No NIC: we can't match earlier checks for this person.");
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.push(`Email "${values.email}" looks wrong.`);
    return { line: i + 2, values, nicCanonical, errors, warnings };
  });
  return { rows, missingColumns, tooMany: body.length > BULK_MAX_ROWS };
}

/** A CSV template people can download and fill in. */
export function bulkTemplateCsv(): string {
  return `${BULK_COLUMNS.map((c) => c.label).join(",")}\nNimal Perera,853400937V,nimal@example.com,0771234567,Accountant,Finance,EMP-1042,Colombo\n`;
}
