/**
 * Does a check's identity detail agree with the candidate's record? The
 * flowchart's Pre-QC looks for mismatches, and a typed NIC can pass every
 * format rule and still be someone else's. These warn: a person decides.
 * Pure module (tests/unit/nic.test.ts).
 */
import { parseNic } from "../nic-core";
import type { FieldDef } from "./schema";

export function identityMismatches(fields: FieldDef[], values: Record<string, unknown> | null | undefined, candidate: { nic: string | null; dateOfBirth: string | null }): string[] {
  const notes: string[] = [];
  const onFile = candidate.nic ? parseNic(candidate.nic) : null;
  for (const f of fields) {
    if (f.type !== "nic" || typeof values?.[f.key] !== "string") continue;
    const typed = parseNic(values[f.key] as string);
    if (!typed.valid) continue;
    if (onFile?.valid && onFile.canonical !== typed.canonical) notes.push(`${f.label} ${typed.display} isn't the NIC on the candidate's record (${onFile.display}).`);
    const born = typeof values.date_of_birth === "string" ? values.date_of_birth : candidate.dateOfBirth;
    if (born && born !== typed.birthDate) notes.push(`${f.label} ${typed.display} gives a birth date of ${typed.birthDate}, but the date of birth on file is ${born}.`);
  }
  return notes;
}
