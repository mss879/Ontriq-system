"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";

/**
 * Workflow settings (spec 6.2, 10): status wording, Ontriq's own statuses, QC
 * checklists, the order checks run in, and document types. Writes go straight
 * to the tables under row level security, or through save_custom_status
 * (settings.manage for statuses and rules, check_types.manage for document types).
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
  key: z.string().regex(/^[a-z0-9_]+$/),
  internal_label: z.string().trim().min(1, "Every status needs a name for your team.").max(60, "Keep each status under 60 characters."),
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
      const { error } = await supabase.from("client_status_catalog").update({ internal_label: row.internal_label, client_label: row.client_label, candidate_label: row.candidate_label }).eq("key", row.key);
      if (error) return fail(rpcErrorMessage(error));
    }
    refresh();
    return { ok: true };
  });
}

const ownStatusSchema = z.object({
  key: z.string().regex(/^custom_[a-z0-9_]+$/).optional(),
  internal_label: z.string().trim().min(2, "Name the status.").max(60),
  client_label: z.string().trim().max(60).default(""),
  candidate_label: z.string().trim().max(60).default(""),
  is_active: z.boolean().default(true),
});

/** A status of Ontriq's own, set by hand on a case (spec 6.2: "configured according to our workflow"). */
export async function saveOwnStatus(input: z.input<typeof ownStatusSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "settings.manage" });
    const parsed = ownStatusSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the status.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_custom_status", { p: parsed.data });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const rulesSchema = z.object({
  pre: z.string().max(4000),
  post: z.string().max(4000),
  enforceCheckOrder: z.boolean(),
});

/** QC checklists and the order checks run in, kept in orgs.settings.workflow. */
export async function saveWorkflowRules(input: z.input<typeof rulesSchema>): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "settings.manage" });
    const parsed = rulesSchema.safeParse(input);
    if (!parsed.success) return fail("Check the checklists.");
    const pre = lines(parsed.data.pre);
    const post = lines(parsed.data.post);
    if (!pre.length || !post.length) return fail("Each QC review needs at least one item.");
    if ([...pre, ...post].some((l) => l.length > 160)) return fail("Keep each checklist item under 160 characters.");
    const supabase = await createClient();
    const { data: org } = await supabase.from("orgs").select("settings").eq("id", viewer.orgId).single();
    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>), workflow: { qc_checklists: { pre, post }, enforce_check_order: parsed.data.enforceCheckOrder } };
    const { error } = await supabase.from("orgs").update({ settings: settings as never }).eq("id", viewer.orgId);
    if (error) return fail(rpcErrorMessage(error));
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
  needs_original: z.boolean().default(false),
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
