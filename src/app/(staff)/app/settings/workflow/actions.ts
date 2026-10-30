"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";

/**
 * Workflow settings (spec 6.2, 10): status wording and document types. Writes
 * go straight to the tables, under row level security (settings.manage for
 * status wording, check_types.manage for document types).
 */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const labelSchema = z.object({
  key: z.string().regex(/^[a-z_]+$/),
  client_label: z.string().trim().min(1, "Every status needs wording for clients.").max(60, "Keep each status under 60 characters."),
  candidate_label: z.string().trim().min(1, "Every status needs wording for candidates.").max(60, "Keep each status under 60 characters."),
});

export async function saveStatusLabels(input: z.input<typeof labelSchema>[]): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "settings.manage" });
    const parsed = z.array(labelSchema).max(40).safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the wording.");
    const supabase = await createClient();
    for (const row of parsed.data) {
      const { error } = await supabase.from("client_status_catalog").update({ client_label: row.client_label, candidate_label: row.candidate_label }).eq("key", row.key);
      if (error) return fail(rpcErrorMessage(error));
    }
    refresh();
    return { ok: true };
  });
}

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Name the document type.").max(80),
  guide: z.string().trim().max(400),
  sensitive: z.boolean(),
  in_report: z.boolean(),
  is_active: z.boolean(),
});

const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "d_$1")
    .slice(0, 48) || "document";

export async function saveDocumentCategory(input: z.input<typeof categorySchema>): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "check_types.manage" });
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details.");
    const { id, ...v } = parsed.data;
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("document_categories").update(v).eq("id", id);
      if (error) return fail(rpcErrorMessage(error));
    } else {
      const { error } = await supabase.from("document_categories").insert({ ...v, key: keyFrom(v.name), org_id: viewer.orgId, sort: 500 });
      if (error) return fail(error.code === "23505" ? "A document type with that name already exists." : rpcErrorMessage(error));
    }
    refresh();
    return { ok: true };
  });
}
