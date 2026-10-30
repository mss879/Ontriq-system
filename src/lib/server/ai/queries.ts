import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/claude";
import { ConsistencySchema, OutreachSchema, PostQcSchema, PreQcSchema, ResponseSchema } from "@/lib/ai/prompts";
import { organizeSuggestions, type CaseAi, type Suggestion } from "@/domain/ai/suggestions";

/**
 * Read models for the AI review screens. Everything runs as the signed-in
 * person: case_ai_suggestions (0029) checks they can see the case; jobs show
 * only what row level security lets them read (their own re-runs, or all with
 * jobs.read). Suggestion values are parsed against the prompt schemas, so a
 * malformed one is dropped rather than drawn.
 */

type Row = {
  id: string;
  capability: string;
  entity_type: string;
  entity_id: string;
  field_key: string | null;
  value: unknown;
  confidence: number | null;
  rationale: string | null;
  source_refs: unknown;
  decision: Suggestion["decision"];
  created_at: string;
};

const SCHEMAS: Record<string, { safeParse: (v: unknown) => { success: boolean } }> = {
  "case.consistency": ConsistencySchema,
  "case.preqc": PreQcSchema,
  "case.postqc": PostQcSchema,
  "check.outreach": OutreachSchema,
  "check.response": ResponseSchema.partial(),
};

function valid(r: Row): boolean {
  const schema = SCHEMAS[r.capability];
  return schema ? schema.safeParse(r.value).success : r.value !== null && r.value !== undefined;
}

export const getCaseSuggestions = cache(async (caseId: string): Promise<Suggestion[]> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("case_ai_suggestions", { p_case: caseId });
  if (error) return [];
  return ((data ?? []) as unknown as Row[]).filter(valid).map((r) => ({
    id: r.id,
    capability: r.capability,
    entityType: r.entity_type,
    entityId: r.entity_id,
    fieldKey: r.field_key,
    value: r.value,
    confidence: r.confidence === null ? null : Number(r.confidence),
    rationale: r.rationale,
    sourceRefs: Array.isArray(r.source_refs) ? r.source_refs.map(String) : [],
    decision: r.decision,
    createdAt: r.created_at,
  }));
});

export const getCaseAi = cache(async (caseId: string): Promise<CaseAi> => organizeSuggestions(await getCaseSuggestions(caseId), caseId));

export type AiStatus = {
  /** ANTHROPIC_API_KEY is present: new runs can happen. */
  configured: boolean;
  /** Per capability switch in Settings → AI (missing means off). */
  enabled: Record<string, boolean>;
};

export const getAiStatus = cache(async (): Promise<AiStatus> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("ai_capabilities").select("key, enabled");
  return { configured: isAiConfigured(), enabled: Object.fromEntries((data ?? []).map((c) => [c.key, c.enabled])) };
});

/** AI jobs still queued or running for this case, its checks and files, by kind and entity. */
export const getAiWork = cache(async (caseId: string, entityIds: string[]): Promise<{ kind: string; entityId: string | null }[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("jobs")
    .select("kind, entity_id")
    .in("status", ["queued", "running"])
    .like("kind", "ai.%")
    .in("entity_id", [caseId, ...entityIds].slice(0, 200));
  return (data ?? []).map((j) => ({ kind: j.kind, entityId: j.entity_id }));
});

export type DocumentAi = {
  type: string | null;
  readable: boolean | null;
  matchesExpected: boolean | null;
  issues: string[];
  language: string | null;
  possibleTampering: boolean;
  tamperNotes: string | null;
  /** The pending suggestion a reviewer can dismiss, when there is one. */
  qualitySuggestionId: string | null;
  tamperSuggestionId: string | null;
  candidateMessage: string | null;
  /** The file's text in English, when it was written in something else. */
  translation: string | null;
  /** Why the AI couldn't read the file, when it couldn't. */
  notRead: string | null;
};

/** What the classifier made of each file (document_ai), with the pending quality and tamper flags. */
export const getDocumentAi = cache(async (caseId: string, documentIds: string[]): Promise<Record<string, DocumentAi>> => {
  if (!documentIds.length) return {};
  const supabase = await createRequestClient();
  const [{ data }, ai] = await Promise.all([
    supabase.from("document_ai").select("document_id, classification").in("document_id", documentIds.slice(0, 300)),
    getCaseAi(caseId),
  ]);
  const out: Record<string, DocumentAi> = {};
  for (const r of data ?? []) {
    const c = (r.classification ?? {}) as Record<string, unknown>;
    const flags = ai.documents[r.document_id] ?? {};
    const q = (flags.quality?.value ?? {}) as Record<string, unknown>;
    out[r.document_id] = {
      type: typeof c.document_type === "string" ? c.document_type : null,
      readable: typeof c.readable === "boolean" ? c.readable : null,
      matchesExpected: typeof c.matches_expected === "boolean" ? c.matches_expected : null,
      issues: Array.isArray(c.quality_issues) ? c.quality_issues.map(String) : [],
      language: typeof c.language === "string" ? c.language : null,
      possibleTampering: c.possible_tampering === true || Boolean(flags.tamper),
      tamperNotes: (flags.tamper?.value as { notes?: string } | undefined)?.notes ?? (typeof c.tampering_notes === "string" ? c.tampering_notes : null),
      qualitySuggestionId: flags.quality?.id ?? null,
      tamperSuggestionId: flags.tamper?.id ?? null,
      candidateMessage: typeof q.message === "string" ? q.message : null,
      translation: typeof c.translation_en === "string" ? c.translation_en : null,
      notRead: typeof c.not_read === "string" ? c.not_read : null,
    };
  }
  // Flags can exist before document_ai does (or without it, in seeded data).
  for (const [id, flags] of Object.entries(ai.documents)) {
    if (out[id] || !documentIds.includes(id) || (!flags.quality && !flags.tamper)) continue;
    const q = (flags.quality?.value ?? {}) as Record<string, unknown>;
    out[id] = {
      type: typeof q.detected === "string" ? q.detected : null,
      readable: typeof q.readable === "boolean" ? q.readable : null,
      matchesExpected: typeof q.matches_expected === "boolean" ? q.matches_expected : null,
      issues: Array.isArray(q.issues) ? q.issues.map(String) : [],
      language: null,
      possibleTampering: Boolean(flags.tamper),
      tamperNotes: (flags.tamper?.value as { notes?: string } | undefined)?.notes ?? null,
      qualitySuggestionId: flags.quality?.id ?? null,
      tamperSuggestionId: flags.tamper?.id ?? null,
      candidateMessage: typeof q.message === "string" ? q.message : null,
      translation: null,
      notRead: null,
    };
  }
  return out;
});

/** A suggestion in the shape the review components take (value already checked against its schema above). */
export function aiItem<T>(s: Suggestion | undefined): { id: string; decision: Suggestion["decision"]; value: T; createdAt: string; confidence: number | null } | undefined {
  return s ? { id: s.id, decision: s.decision, value: s.value as T, createdAt: s.createdAt, confidence: s.confidence } : undefined;
}
