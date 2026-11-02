/**
 * What the AI jobs read about a case, and how they leave suggestions.
 * Plain Node: relative imports only.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ServiceClient } from "../admin-client";
import { checkTypeSchema, type FieldDef } from "../../domain/check-types/schema";
import { fileBlock } from "../../lib/ai/claude";
import type { Json } from "../../lib/supabase/database.types";
import { toJpeg } from "../report/convert-image";
import { pageImage, scanPages } from "./pages";

export type AiDoc = {
  id: string;
  case_check_id: string | null;
  category: string;
  category_name: string;
  filename: string;
  mime: string;
  storage_bucket: string;
  storage_path: string;
  size_bytes: number;
  text: string | null;
  classification: Record<string, unknown> | null;
};

export type AiCheck = {
  id: string;
  key: string;
  label: string;
  state: string;
  result: string | null;
  result_tone: string | null;
  client_note: string | null;
  values: Record<string, unknown>;
  fields: FieldDef[];
  resultOptions: { key: string; label: string; tone: string }[];
};

export type AiCase = {
  id: string;
  org_id: string;
  client_id: string;
  reference: string;
  stage: string;
  process_type: string;
  position_title: string | null;
  candidate: { full_name: string; nic: string | null; date_of_birth: string | null; email: string | null; phone: string | null; address: string | null };
  client_name: string;
  checks: AiCheck[];
  documents: AiDoc[];
  requirements: { case_check_id: string | null; category: string; label: string; status: string; min_count: number; received_count: number; client_visible: boolean }[];
};

export async function loadAiCase(admin: ServiceClient, caseId: string): Promise<AiCase> {
  const { data: c } = await admin
    .from("cases")
    .select("id, org_id, client_id, reference, stage, process_type, position_title, client:clients(name), candidate:candidates(full_name, nic, date_of_birth, email, phone, address)")
    .eq("id", caseId)
    .single();
  if (!c) throw new Error(`case ${caseId} not found`);
  const [{ data: checks }, { data: docs }, { data: reqs }, { data: cats }] = await Promise.all([
    admin.from("case_checks").select("id, label, sort, state, result, result_tone, client_note, values, check_type:check_types(key), version:check_type_versions(schema)").eq("case_id", caseId).order("sort"),
    admin.from("documents").select("id, case_check_id, category, filename, mime, storage_bucket, storage_path, size_bytes, text:document_texts(text), ai:document_ai(classification)").eq("case_id", caseId).in("status", ["uploaded", "accepted"]),
    admin.from("case_check_requirements").select("case_check_id, category, label, status, min_count, received_count, client_visible").eq("case_id", caseId),
    admin.from("document_categories").select("key, name").eq("org_id", c.org_id),
  ]);
  const catName = new Map((cats ?? []).map((x) => [x.key, x.name]));
  return {
    id: c.id,
    org_id: c.org_id,
    client_id: c.client_id,
    reference: c.reference,
    stage: c.stage,
    process_type: c.process_type,
    position_title: c.position_title,
    candidate: c.candidate as unknown as AiCase["candidate"],
    client_name: (c.client as unknown as { name: string }).name,
    checks: (checks ?? []).map((k) => {
      const schema = checkTypeSchema.parse((k.version as unknown as { schema: unknown }).schema);
      return {
        id: k.id,
        key: (k.check_type as unknown as { key: string }).key,
        label: k.label,
        state: k.state,
        result: k.result,
        result_tone: k.result_tone,
        client_note: k.client_note,
        values: (k.values ?? {}) as Record<string, unknown>,
        fields: schema.fields,
        resultOptions: schema.result.options,
      };
    }),
    documents: (docs ?? []).map((d) => {
      const text = d.text as unknown as { text: string } | { text: string }[] | null;
      const ai = d.ai as unknown as { classification: Record<string, unknown> } | { classification: Record<string, unknown> }[] | null;
      return {
        id: d.id,
        case_check_id: d.case_check_id,
        category: d.category,
        category_name: catName.get(d.category) ?? d.category,
        filename: d.filename,
        mime: d.mime,
        storage_bucket: d.storage_bucket,
        storage_path: d.storage_path,
        size_bytes: Number(d.size_bytes ?? 0),
        text: (Array.isArray(text) ? text[0]?.text : text?.text) ?? null,
        classification: (Array.isArray(ai) ? ai[0]?.classification : ai?.classification) ?? null,
      };
    }),
    requirements: reqs ?? [],
  };
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What to send for a file: its pages as photos when it is a scan or a photo, else the PDF itself. */
export type DocumentSource = { pages: Uint8Array[] } | { pdf: Anthropic.ContentBlockParam };

/** A document ready for the model (pages.ts says why scans go as photos), or null when it can't be read. */
export async function documentSource(admin: ServiceClient, d: Pick<AiDoc, "storage_bucket" | "storage_path" | "mime" | "size_bytes">): Promise<DocumentSource | null> {
  if (d.size_bytes > MAX_FILE_BYTES) return null;
  const file = await admin.storage.from(d.storage_bucket).download(d.storage_path);
  if (!file.data) return null;
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if (d.mime === "application/pdf") {
    const scans = await scanPages(bytes);
    if (scans) return { pages: scans };
    const pdf = fileBlock(bytes, d.mime);
    return pdf ? { pdf } : null;
  }
  if (!d.mime.startsWith("image/")) return null;
  const readable = d.mime === "image/heic" ? await toJpeg(bytes, d.mime) : bytes;
  return readable ? { pages: [readable] } : null;
}

/** Each page as an image block, turned by `turns` (degrees clockwise) and labelled, or null if one can't be prepared. */
export async function pageBlocks(pages: Uint8Array[], turns: number[]): Promise<Anthropic.ContentBlockParam[] | null> {
  const images = await Promise.all(pages.map((p, i) => pageImage(p, turns[i] ?? 0)));
  if (images.some((x) => !x)) return null;
  return images.flatMap((x, i) => [...(pages.length > 1 ? [{ type: "text" as const, text: `Page ${i + 1} of ${pages.length}` }] : []), fileBlock(x!, "image/jpeg")!]);
}

/** Leave a suggestion for a person to decide. Older pending ones for the same thing are superseded. */
export async function suggest(
  admin: ServiceClient,
  s: { org_id: string; run_id: string | null; capability: string; entity_type: string; entity_id: string; field_key?: string | null; value: unknown; confidence?: number | null; rationale?: string | null; source_refs?: unknown[] },
) {
  let q = admin
    .from("ai_suggestions")
    .update({ decision: "superseded" })
    .eq("entity_type", s.entity_type)
    .eq("entity_id", s.entity_id)
    .eq("capability", s.capability)
    .eq("decision", "pending");
  q = s.field_key ? q.eq("field_key", s.field_key) : q.is("field_key", null);
  await q;
  await admin.from("ai_suggestions").insert({
    org_id: s.org_id,
    run_id: s.run_id,
    capability: s.capability,
    entity_type: s.entity_type,
    entity_id: s.entity_id,
    field_key: s.field_key ?? null,
    value: (s.value ?? {}) as NonNullable<Json>,
    confidence: s.confidence === null || s.confidence === undefined ? null : Math.max(0, Math.min(1, Number(s.confidence))),
    rationale: s.rationale ?? null,
    source_refs: (s.source_refs ?? []) as NonNullable<Json>,
  });
}

/** Case details as compact text for prompts (no contact details beyond what the task needs). */
export function caseSummary(c: AiCase, opts: { values?: boolean } = {}): string {
  const lines = [
    `Reference: ${c.reference}`,
    `Candidate: ${c.candidate.full_name}${c.candidate.nic ? `, NIC ${c.candidate.nic}` : ""}${c.candidate.date_of_birth ? `, born ${c.candidate.date_of_birth}` : ""}`,
    `Client: ${c.client_name}${c.position_title ? `, position ${c.position_title}` : ""}`,
    `Stage: ${c.stage}; documents ${c.process_type === "candidate_collected" ? "collected from the candidate by Ontriq" : "supplied by the client"}`,
  ];
  for (const k of c.checks) {
    lines.push(`\nCheck "${k.label}" (${k.key}): state ${k.state}${k.result ? `, result ${k.result}` : ""}`);
    if (opts.values) {
      for (const f of k.fields) {
        const v = k.values[f.key];
        if (v !== undefined && v !== null && v !== "") lines.push(`  ${f.label}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      }
      if (k.client_note) lines.push(`  Remarks: ${k.client_note}`);
    }
  }
  return lines.join("\n");
}
