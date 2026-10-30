/**
 * Staff bulk case import from a CSV (plan Phase 5): map the headers, check
 * every row the same way the New case form does (name, NIC, email, phone,
 * district, language), catch duplicates inside the file, and build the
 * candidate part of each create_case payload. The browser runs it for the
 * preview and the server action runs it again before creating anything.
 * Pure module (tests/unit/import.test.ts).
 */
import { isValidPhoneNumber } from "libphonenumber-js";
import { parseNic } from "../nic-core";
import { DISTRICTS } from "../districts";
import { BULK_COLUMNS, parseCsv } from "../portal/bulk-core";

export const IMPORT_COLUMNS = [
  ...BULK_COLUMNS,
  { key: "address", label: "Address", required: false, aliases: ["address", "home address", "permanent address", "residential address"] },
  { key: "preferred_language", label: "Language", required: false, aliases: ["language", "preferred language", "lang"] },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];

export const IMPORT_MAX_ROWS = 200;

export type ImportRecord = { line: number; values: Partial<Record<ImportKey, string>> };
export type ImportRow = ImportRecord & {
  nic: { canonical: string; display: string; birthDate: string; gender: "male" | "female" } | null;
  errors: string[];
  warnings: string[];
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ");
const LANGS: Record<string, "en" | "si" | "ta"> = { en: "en", english: "en", si: "si", sinhala: "si", sinhalese: "si", ta: "ta", tamil: "ta" };
const MAX_LEN: Partial<Record<ImportKey, number>> = {
  full_name: 160,
  nic: 20,
  email: 160,
  phone: 40,
  position_title: 120,
  department: 120,
  client_reference: 80,
  address: 400,
};

export function mapImportHeaders(headers: string[]): (ImportKey | null)[] {
  const used = new Set<ImportKey>();
  return headers.map((h) => {
    const n = norm(h);
    const hit = IMPORT_COLUMNS.find((c) => norm(c.key) === n || norm(c.label) === n || (c.aliases as readonly string[]).includes(n));
    if (!hit || used.has(hit.key)) return null;
    used.add(hit.key);
    return hit.key;
  });
}

/** Read the file: which columns were found, and the raw rows (at most IMPORT_MAX_ROWS). */
export function parseImportCsv(text: string): { records: ImportRecord[]; missingColumns: string[]; ignoredHeaders: string[]; total: number; tooMany: boolean } {
  const table = parseCsv(text);
  if (!table.length) return { records: [], missingColumns: ["Full name"], ignoredHeaders: [], total: 0, tooMany: false };
  const keys = mapImportHeaders(table[0]);
  const missingColumns = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.label);
  const ignoredHeaders = table[0].filter((h, i) => !keys[i] && h.trim()).map((h) => h.trim());
  const body = table.slice(1);
  const records = body.slice(0, IMPORT_MAX_ROWS).map((cells, i): ImportRecord => {
    const values: Partial<Record<ImportKey, string>> = {};
    keys.forEach((k, j) => {
      const v = (cells[j] ?? "").replace(/\s+/g, " ").trim();
      if (k && v) values[k] = v;
    });
    return { line: i + 2, values };
  });
  return { records, missingColumns, ignoredHeaders, total: body.length, tooMany: body.length > IMPORT_MAX_ROWS };
}

/** Check each row, then duplicates across the file. */
export function validateRecords(records: ImportRecord[], opts: { processType: "client_supplied" | "candidate_collected"; today?: Date }): ImportRow[] {
  const today = opts.today ?? new Date();
  const seenNic = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  return records.map((r) => {
    const values: Partial<Record<ImportKey, string>> = { ...r.values };
    const errors: string[] = [];
    const warnings: string[] = [];
    let nic: ImportRow["nic"] = null;

    for (const [k, max] of Object.entries(MAX_LEN) as [ImportKey, number][]) {
      if ((values[k]?.length ?? 0) > max) errors.push(`${IMPORT_COLUMNS.find((c) => c.key === k)!.label} is longer than ${max} characters.`);
    }
    if (!values.full_name || values.full_name.length < 2) errors.push("Full name is missing.");

    if (values.nic) {
      const parsed = parseNic(values.nic, today);
      if (!parsed.valid) errors.push(`NIC "${values.nic}": ${parsed.error}`);
      else {
        nic = { canonical: parsed.canonical, display: parsed.display, birthDate: parsed.birthDate, gender: parsed.gender };
        const dup = seenNic.get(parsed.canonical);
        if (dup) errors.push(`Same NIC as line ${dup}.`);
        else seenNic.set(parsed.canonical, r.line);
      }
    } else warnings.push("No NIC: earlier checks for this person can't be matched.");

    if (values.email) {
      values.email = values.email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.push(`Email "${values.email}" looks wrong.`);
      else {
        const dup = seenEmail.get(values.email);
        if (dup) warnings.push(`Same email as line ${dup}.`);
        else seenEmail.set(values.email, r.line);
      }
    }
    if (values.phone && !isValidPhoneNumber(values.phone, "LK")) errors.push(`Phone "${values.phone}" isn't a valid number.`);

    if (values.district) {
      const hit = DISTRICTS.find((d) => d.toLowerCase() === values.district!.toLowerCase());
      if (hit) values.district = hit;
      else errors.push(`District "${values.district}" isn't one of Sri Lanka's 25 districts.`);
    }
    if (values.preferred_language) {
      const lang = LANGS[values.preferred_language.toLowerCase()];
      if (lang) values.preferred_language = lang;
      else errors.push(`Language "${values.preferred_language}" should be English, Sinhala or Tamil.`);
    }
    if (opts.processType === "candidate_collected" && !values.email && !values.phone) {
      warnings.push("No email or phone: the candidate link can't be sent; share it from the case.");
    }
    return { line: r.line, values, nic, errors, warnings };
  });
}

export function validateImport(text: string, opts: { processType: "client_supplied" | "candidate_collected"; today?: Date }) {
  const parsed = parseImportCsv(text);
  return { ...parsed, rows: validateRecords(parsed.records, opts) };
}

/** The candidate object create_case expects (0006), for a row without errors. */
export function candidatePayload(row: ImportRow) {
  const v = row.values;
  return {
    full_name: v.full_name ?? "",
    nic: row.nic?.display ?? null,
    nic_canonical: row.nic?.canonical ?? null,
    date_of_birth: row.nic?.birthDate ?? null,
    gender: row.nic?.gender ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    address: v.address ?? null,
    district: v.district ?? null,
    preferred_language: (v.preferred_language as "en" | "si" | "ta" | undefined) ?? "en",
  };
}

/** The per-case fields from the row (position, department, the client's own reference). */
export function caseFields(row: ImportRow) {
  return { position_title: row.values.position_title ?? null, department: row.values.department ?? null, client_reference: row.values.client_reference ?? null };
}

export function importTemplateCsv(): string {
  return `${IMPORT_COLUMNS.map((c) => c.label).join(",")}\r\nNimal Perera,853400937V,nimal@example.com,0771234567,Accountant,Finance,EMP-1042,Colombo,"12 Temple Road, Colombo 05",English\r\n`;
}
