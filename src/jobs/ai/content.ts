/**
 * The text each AI job sends about a case. Kept apart from the jobs so the
 * evaluation in scripts/ai-eval scores exactly what production asks. Pure.
 */
import { parseNic } from "../../domain/nic-core";
import type { ReportSnapshot } from "../../domain/reports/compile-core";
import { caseSummary, type AiCase, type AiCheck } from "./context";

const TRANSLATION = "\n\n[English translation]\n";

/** A document's stored text, English first, so a cut falls on the original script rather than the translation. */
export function documentText(text: string | null, limit: number): string {
  if (!text) return "(no text read yet)";
  const at = text.indexOf(TRANSLATION);
  if (at < 0) return text.slice(0, limit);
  return `${text.slice(at + TRANSLATION.length)}\n\n[Original text]\n${text.slice(0, at)}`.slice(0, limit);
}

/** What every NIC number in the case encodes, worked out by code so the model doesn't have to. */
export function nicFacts(c: { candidate: { nic: string | null }; documents: { text: string | null }[]; checks: { values: Record<string, unknown> }[] }): string {
  const seen = new Set(
    [c.candidate.nic ?? "", ...c.documents.map((d) => d.text ?? ""), ...c.checks.map((k) => JSON.stringify(k.values))].flatMap((s) => s.match(/\b\d{9}[VvXx]\b|\b\d{12}\b/g) ?? []),
  );
  const byPerson = new Map<string, { numbers: string[]; birthDate: string; gender: string }>();
  for (const raw of seen) {
    const nic = parseNic(raw);
    if (!nic.valid) continue;
    const entry = byPerson.get(nic.canonical) ?? { numbers: [], birthDate: nic.birthDate, gender: nic.gender };
    entry.numbers.push(nic.display);
    byPerson.set(nic.canonical, entry);
  }
  if (!byPerson.size) return "";
  const lines = [...byPerson.values()].map((e) => `${[...new Set(e.numbers)].join(" and ")}: born ${e.birthDate}, ${e.gender}${new Set(e.numbers).size > 1 ? " (one number in its two formats)" : ""}`);
  return `\n\nNIC facts:\n${lines.join("\n")}${byPerson.size > 1 ? "\nThese are different NIC numbers." : ""}`;
}

export function consistencyContent(c: AiCase): string {
  const docs = c.documents.map((d) => `--- ${d.filename} (${d.category_name})\n${documentText(d.text, 6000)}`).join("\n");
  return `${caseSummary(c, { values: true })}${nicFacts(c)}\n\nDocuments:\n${docs}`;
}

/** A combined file's documents, so a slot waiting for someone to match it isn't chased as missing. */
const holds = (d: AiCase["documents"][number]) => {
  const parts = (d.classification?.contains ?? []) as { category: string }[];
  return parts.length > 1 ? parts.map((p) => p.category) : undefined;
};

export type CandidateReportInput = {
  reference: string;
  client: string;
  position: string | null;
  candidate: { full_name: string; nic: string | null; date_of_birth: string | null; email: string | null; phone: string | null; address: string | null };
  checks: string[];
  answers: { question: string; answer: string }[];
  /** Each file, cited by its appendix reference. No text means it couldn't be read. */
  documents: { ref: string; title: string; filename: string; text: string | null }[];
};

export function candidateReportContent(r: CandidateReportInput): string {
  const details = [
    `Candidate: ${r.candidate.full_name}`,
    r.candidate.nic ? `NIC: ${r.candidate.nic}` : null,
    r.candidate.date_of_birth ? `Date of birth: ${r.candidate.date_of_birth}` : null,
    r.candidate.address ? `Address: ${r.candidate.address}` : null,
    `Client: ${r.client}`,
    r.position ? `Position: ${r.position}` : null,
    `Checks on this case: ${r.checks.join(", ") || "none"}`,
  ].filter(Boolean);
  const answers = r.answers.map((a) => `- ${a.question}: ${a.answer}`).join("\n");
  const docs = r.documents.map((d) => `--- ${d.ref}: ${d.title}, file ${d.filename}\n${d.text ? documentText(d.text, 5000) : "(this file could not be read)"}`).join("\n");
  return `Write the report for ${r.reference}.\n${details.join("\n")}${nicFacts({ candidate: r.candidate, documents: r.documents, checks: [] })}\n\nThe candidate's answers:\n${answers || "(none)"}\n\nDocuments, with their appendix references:\n${docs || "(none)"}`;
}

export function preqcContent(c: AiCase, consistency: unknown): string {
  const reqs = c.requirements.map((r) => `- ${r.label} (${r.category}): ${r.status}, ${r.received_count}/${r.min_count}${r.client_visible ? ", client-supplied" : ""}`).join("\n");
  const quality = c.documents
    .filter((d) => d.classification)
    .map((d) => `- ${d.filename}, uploaded as ${d.category_name}: ${JSON.stringify({ readable: d.classification?.readable, matches: d.classification?.matches_expected, looks_like: d.classification?.document_type, holds: holds(d), issues: d.classification?.quality_issues })}`)
    .join("\n");
  return `${caseSummary(c, { values: true })}\n\nRequired documents:\n${reqs}\n\nDocument checks:\n${quality || "(none yet)"}\n\nConsistency findings:\n${JSON.stringify(consistency ?? "not run")}`;
}

export function postqcContent(c: AiCase, consistency: unknown): string {
  const evidence = c.documents
    .map((d) => `--- ${d.filename} (${d.category_name})${d.case_check_id ? ` for ${c.checks.find((k) => k.id === d.case_check_id)?.label}` : ""}\n${documentText(d.text, 3000)}`)
    .join("\n");
  return `${caseSummary(c, { values: true })}${nicFacts(c)}\n\nEvidence on file:\n${evidence || "(none)"}\n\nConsistency findings:\n${JSON.stringify(consistency ?? "not run")}`;
}

/** The key the model answers with for each check. A case can have two checks of one type. */
export function narrativeKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((key) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}-${n}`;
  });
}

export function narrativeContent(snapshot: Pick<ReportSnapshot, "case" | "candidate" | "checks">): string {
  const keys = narrativeKeys(snapshot.checks.map((k) => k.key));
  return `Write remarks for each check and an executive summary.\n${JSON.stringify({ case: { reference: snapshot.case.reference, client: snapshot.case.client, position: snapshot.case.position }, candidate: { name: snapshot.candidate.full_name }, checks: snapshot.checks.map((k, i) => ({ key: keys[i], label: k.label, status: k.status_label, result: k.result_label, fields: k.fields, groups: k.groups, current_remarks: k.remarks })) })}`;
}

export function outreachContent(check: AiCheck, candidate: string, target: string | undefined): string {
  const details = check.fields.map((f) => (check.values[f.key] !== undefined ? `${f.label}: ${JSON.stringify(check.values[f.key])}` : null)).filter(Boolean).join("\n");
  return `Check: ${check.label}\nCandidate: ${candidate}\nWho to contact: ${target || "the issuing institution or employer"}\nDetails to confirm:\n${details}`;
}

export function responseContent(check: AiCheck, reply: string): string {
  const declared = check.fields.map((f) => (check.values[f.key] !== undefined ? `${f.key} (${f.label}): ${JSON.stringify(check.values[f.key])}` : null)).filter(Boolean).join("\n");
  return `Check: ${check.label}\nResult options: ${check.resultOptions.map((o) => `${o.key} (${o.label}, ${o.tone})`).join(", ")}\nDeclared:\n${declared}\n\nReply received:\n${reply.slice(0, 8000)}`;
}
