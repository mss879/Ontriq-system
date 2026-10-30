"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { checkTypeSchema } from "@/domain/check-types/schema";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Check type builder. Definitions change only through save_check_type_draft()
 * and publish_check_type() (0004_check_types.sql); a published version is
 * frozen, and cases keep the version they started with.
 */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    await requireViewer({ kind: "staff", permission: "check_types.manage" });
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const STARTER = checkTypeSchema.parse({
  fields: [
    { key: "candidate_name", label: "Candidate name", type: "text", required: true },
    { key: "notes", label: "Verification notes", type: "textarea", width: "full", visibility: { client: false, report: true, candidate: false } },
  ],
});

const metaSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,47}$/, "Use lowercase letters, digits and underscores, starting with a letter."),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  description: z.string().trim().max(300).default(""),
});

export async function createCheckType(input: z.input<typeof metaSchema>): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "check_types.manage" });
    const parsed = metaSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data: max } = await supabase.from("check_types").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from("check_types")
      .insert({ org_id: viewer.orgId, key: parsed.data.key, name: parsed.data.name, description: parsed.data.description, sort: (max?.sort ?? 0) + 10, created_by: viewer.userId })
      .select("id")
      .single();
    if (error?.code === "23505") return fail("Check the highlighted fields.", { key: ["Another check type already uses this key."] });
    if (error || !data) return fail(rpcErrorMessage(error));
    const draft = await supabase.rpc("save_check_type_draft", { p_check_type: data.id, p_schema: STARTER as unknown as Json });
    if (draft.error) return fail(rpcErrorMessage(draft.error));
    refresh();
    return { ok: true, id: data.id };
  });
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  description: z.string().trim().max(300).default(""),
  sort: z.coerce.number().int().min(0).max(10000),
});

export async function updateCheckTypeDetails(id: string, input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  return guarded(async () => {
    const parsed = detailsSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data, error } = await supabase.from("check_types").update(parsed.data).eq("id", id).select("id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("That check type no longer exists.");
    refresh();
    return { ok: true };
  });
}

export async function setCheckTypeArchived(id: string, archived: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("check_types")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** Issues from the definition language, keyed by path ("fields.2.options"). */
function schemaIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Record<string, string[]> {
  return zodFieldErrors(issues);
}

export async function saveDraft(id: string, schema: unknown): Promise<ActionResult<{ draftId: string }>> {
  return guarded(async () => {
    const parsed = checkTypeSchema.safeParse(schema);
    if (!parsed.success) return { ok: false, error: "Some parts of the definition need fixing.", fieldErrors: schemaIssues(parsed.error.issues) };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_check_type_draft", { p_check_type: id, p_schema: parsed.data as unknown as Json });
    if (error || !data) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, draftId: data as string };
  });
}

export async function publishCheckType(id: string, schema: unknown, notes: string): Promise<ActionResult<{ version: number }>> {
  return guarded(async () => {
    const parsed = checkTypeSchema.safeParse(schema);
    if (!parsed.success) return { ok: false, error: "Some parts of the definition need fixing.", fieldErrors: schemaIssues(parsed.error.issues) };
    const supabase = await createClient();
    const saved = await supabase.rpc("save_check_type_draft", { p_check_type: id, p_schema: parsed.data as unknown as Json });
    if (saved.error) return fail(rpcErrorMessage(saved.error));
    const { data, error } = await supabase.rpc("publish_check_type", { p_check_type: id, p_notes: notes.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, version: data as number };
  });
}

export async function discardDraft(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("discard_check_type_draft", { p_check_type: id });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
