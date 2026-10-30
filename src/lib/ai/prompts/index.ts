/**
 * Versioned prompts and output schemas for every AI capability (plan §8).
 * Each builder returns the system prompt (stable, so it caches) and the
 * user content; the schema is what the model must return (structured
 * output). The model proposes; people decide. Prices, results and assignees
 * are never set from these outputs without a person or a rule.
 *
 * Plain Node (jobs and server actions both use it).
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

const ONTRIQ =
  "You work inside Ontriq's background verification system in Sri Lanka. Candidates are job applicants; clients are employers; Ontriq staff verify documents and facts with the issuing sources. Documents are often photos of Sri Lankan NIC cards, O/L and A/L certificates, degree certificates, service letters, Grama Niladhari certificates and police reports, sometimes in Sinhala or Tamil.";
const HONEST =
  "Only report what you can see or what is given. If something is unclear, missing or unreadable, say so and lower your confidence. Never invent names, numbers, dates or results. A possible issue is never proof of wrongdoing: describe it neutrally.";

// ---------------------------------------------------------------- 1. classify

export const CLASSIFY_VERSION = "classify-v1";
export const ClassifySchema = z.object({
  document_type: z.string().describe("Best category key from the list given, or 'other'"),
  matches_expected: z.boolean().describe("True if it is the kind of document the slot asked for"),
  readable: z.boolean(),
  quality_issues: z.array(z.enum(["blurred", "cropped", "too_dark", "glare", "rotated", "low_resolution", "missing_pages", "other"])),
  is_photocopy: z.boolean().nullable(),
  language: z.string().nullable().describe("Main language: en, si, ta or other"),
  names_seen: z.array(z.string()).describe("Personal names printed on the document"),
  key_numbers: z.array(z.object({ label: z.string(), value: z.string() })).describe("NIC numbers, index numbers, dates and similar"),
  text: z.string().describe("The document's text, transcribed (up to about 3000 characters)"),
  possible_tampering: z.boolean(),
  tampering_notes: z.string().nullable(),
  candidate_message: z.string().nullable().describe("If the file is not usable, one friendly sentence telling the candidate what to upload instead"),
});
export type ClassifyResult = z.infer<typeof ClassifySchema>;

export function classifyPrompt(input: { expectedCategory: string; expectedLabel: string; categories: { key: string; name: string }[] }) {
  return {
    system: `${ONTRIQ}\nYou check uploaded documents as they arrive: what they are, whether they can be read, and the text on them. ${HONEST}\nFlag signs of editing (mismatched fonts, misaligned text, inconsistent dates, pasted photos) only when you see them.`,
    text: `This file was uploaded for the slot "${input.expectedLabel}" (category ${input.expectedCategory}).\nCategories: ${input.categories.map((c) => `${c.key} (${c.name})`).join(", ")}.\nClassify it, check its quality and transcribe it.`,
  };
}

// ---------------------------------------------------------------- 2. extract

export const EXTRACT_VERSION = "extract-v1";
export const ExtractSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ from: z.string().nullable(), to: z.string().nullable() })]),
      confidence: z.number().describe("0 to 1"),
      source: z.string().nullable().describe("Which document (file name) the value came from"),
    }),
  ),
  notes: z.string().nullable(),
});
export type ExtractResult = z.infer<typeof ExtractSchema>;

export function extractPrompt(input: { checkLabel: string; fields: { key: string; label: string; type: string; hint?: string; options?: { value: string; label: string }[] }[] }) {
  return {
    system: `${ONTRIQ}\nYou pre-fill a verification check's fields from the candidate's documents so a data entry officer can confirm them side by side. ${HONEST}\nDates are YYYY-MM-DD; a period is {"from","to"}. For a choice field, return one of the option values. Leave a field out if the documents don't show it.`,
    text: `Check: ${input.checkLabel}\nFields:\n${input.fields
      .map((f) => `- ${f.key} (${f.type}): ${f.label}${f.hint ? `. Hint: ${f.hint}` : ""}${f.options ? `. Options: ${f.options.map((o) => `${o.value}=${o.label}`).join(", ")}` : ""}`)
      .join("\n")}\nThe documents follow.`,
  };
}

// ---------------------------------------------------------------- 3. consistency

export const CONSISTENCY_VERSION = "consistency-v1";
export const ConsistencySchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(["high", "medium", "low"]),
      topic: z.string().describe("e.g. name, NIC, date of birth, dates, institution"),
      description: z.string(),
      documents: z.array(z.string()),
    }),
  ),
  summary: z.string(),
});
export type ConsistencyResult = z.infer<typeof ConsistencySchema>;

export const CONSISTENCY_SYSTEM = `${ONTRIQ}\nYou compare everything known about one candidate across their documents and declared details: name spellings (allow initials and transliteration differences between Sinhala, Tamil and English), NIC number, date of birth derived from the NIC, dates of study and employment, institutions and employers. ${HONEST}\nReport real inconsistencies only, most important first. If everything agrees, return no issues and say so.`;

// ---------------------------------------------------------------- 4. Pre-QC copilot

export const PREQC_VERSION = "preqc-v1";
export const PreQcSchema = z.object({
  checklist: z.array(z.object({ item: z.string(), ok: z.boolean(), note: z.string().nullable() })),
  requests: z.array(
    z.object({ to: z.enum(["candidate", "client"]), kind: z.enum(["document", "question"]), title: z.string(), message: z.string(), category: z.string().nullable() }),
  ),
  summary: z.string(),
});
export type PreQcResult = z.infer<typeof PreQcSchema>;

export const PREQC_SYSTEM = `${ONTRIQ}\nYou prepare the Pre-QC review: is the case complete, readable and consistent enough to start verification? Build a short checklist and draft polite, specific requests for anything missing or unclear (to the candidate when Ontriq collects documents, to the client when the client supplies them). ${HONEST}`;

// ---------------------------------------------------------------- 5. outreach

export const OUTREACH_VERSION = "outreach-v1";
export const OutreachSchema = z.object({
  subject: z.string(),
  body: z.string().describe("A short, professional email asking the institution, employer or referee to confirm the details"),
  call_script: z.string().nullable(),
  follow_up_days: z.number().describe("Whole days, 1 to 14"),
});
export type OutreachResult = z.infer<typeof OutreachSchema>;

export const OUTREACH_SYSTEM = `${ONTRIQ}\nYou draft verification requests to schools, universities, employers and referees on Ontriq's behalf. Be brief, courteous and specific: say who Ontriq is, that the candidate consented, and list exactly the details to confirm. Never reveal the client's other findings. ${HONEST}`;

// ---------------------------------------------------------------- 6. response capture

export const RESPONSE_VERSION = "response-v1";
export const ResponseSchema = z.object({
  comparisons: z.array(z.object({ field: z.string(), claimed: z.string().nullable(), confirmed: z.string().nullable(), matches: z.boolean().nullable() })),
  proposed_result: z.string().describe("One of the result option keys given"),
  confidence: z.number().describe("0 to 1"),
  reasoning: z.string(),
  client_note: z.string().describe("One or two neutral sentences suitable for the client report"),
});
export type ResponseResult = z.infer<typeof ResponseSchema>;

export const RESPONSE_SYSTEM = `${ONTRIQ}\nYou read a verifier's reply (email text or call notes) and compare what it confirms with what the candidate declared. Propose a result from the options given, with your reasoning. ${HONEST} If the reply doesn't confirm or deny something, treat it as unconfirmed, not as a discrepancy.`;

// ---------------------------------------------------------------- 7. Post-QC cross-check

export const POSTQC_VERSION = "postqc-v1";
export const PostQcSchema = z.object({
  checks: z.array(z.object({ check: z.string(), ok: z.boolean(), concerns: z.array(z.string()) })),
  missing: z.array(z.string()),
  proposed_result: z.enum(["green", "amber", "red"]),
  reasoning: z.string(),
});
export type PostQcResult = z.infer<typeof PostQcSchema>;

export const POSTQC_SYSTEM = `${ONTRIQ}\nYou are the second pair of eyes before the final report: audit every check's recorded details and result against the evidence listed and the consistency findings. Point out results that the evidence doesn't support, checks marked complete without confirmation, and anything still missing. Propose an overall result: green only if every check is completed and clear; red only for a confirmed discrepancy; otherwise amber. ${HONEST}`;

// ---------------------------------------------------------------- 8. narrative

export const NARRATIVE_VERSION = "narrative-v1";
export const NarrativeSchema = z.object({
  checks: z.array(z.object({ key: z.string(), remarks: z.string().describe("Two or three neutral, factual sentences for the report") })),
  executive_summary: z.string(),
});
export type NarrativeResult = z.infer<typeof NarrativeSchema>;

export const NARRATIVE_SYSTEM = `${ONTRIQ}\nYou write the remarks in the final verification report in Ontriq's house style: neutral, factual, past tense, no speculation, no adjectives about the candidate's character. Say what was verified, with whom and how, and what (if anything) did not match. For incomplete checks, say they were not completed. ${HONEST}`;

// ---------------------------------------------------------------- briefing and nudges

export const BRIEFING_VERSION = "briefing-v1";
export const BriefingSchema = z.object({ headline: z.string(), bullets: z.array(z.string()).describe("Up to 8"), risks: z.array(z.string()).describe("Up to 5") });
export type BriefingResult = z.infer<typeof BriefingSchema>;
export const BRIEFING_SYSTEM = `${ONTRIQ}\nYou write the operations manager's morning briefing from the numbers given: what changed, what is at risk today, who may need help. Short, plain sentences. ${HONEST}`;

export const NUDGE_VERSION = "nudge-v1";
export const NudgeSchema = z.object({ message: z.string().describe("Two to four sentences, constructive and specific, naming the items") });
export const NUDGE_SYSTEM = `${ONTRIQ}\nA manager wants to push a team member who is behind. Write a short, respectful, constructive message: acknowledge they may be busy, name the overdue items, ask what help they need. Never threaten or blame.`;

/** A text block. */
export const text = (t: string): Anthropic.ContentBlockParam => ({ type: "text", text: t });
