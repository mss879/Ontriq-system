/**
 * The rows of a check's repeating groups (employers, referees) as records that
 * a file or a contact can belong to (spec 4.2, 4.6). A record's key is the
 * group and its position: "employers.0". Pure module.
 */
import type { FieldDef } from "./schema";

export type RecordOption = { key: string; label: string };

const nameOf = (row: Record<string, unknown>, group: FieldDef) => {
  const first = (group.fields ?? []).find((f) => f.type === "text" && typeof row[f.key] === "string" && String(row[f.key]).trim());
  return first ? String(row[first.key]).trim() : null;
};

/** "Employer 1 · Dialog Axiata", for each row entered so far. */
export function recordOptions(fields: FieldDef[], values: Record<string, unknown> | null | undefined): RecordOption[] {
  return fields.flatMap((f) => {
    if (f.type !== "repeatable_group") return [];
    const rows = Array.isArray(values?.[f.key]) ? (values?.[f.key] as Record<string, unknown>[]) : [];
    return rows.map((row, i) => {
      const name = nameOf(row ?? {}, f);
      return { key: `${f.key}.${i}`, label: `${f.group?.item_label ?? "Item"} ${i + 1}${name ? ` · ${name}` : ""}` };
    });
  });
}

export function recordLabel(fields: FieldDef[], values: Record<string, unknown> | null | undefined, key: string | null | undefined): string | null {
  if (!key) return null;
  return recordOptions(fields, values).find((r) => r.key === key)?.label ?? null;
}
