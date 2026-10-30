"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { TEMPLATE_KEYS } from "@/domain/documents/model";
import type { Permission } from "@/domain/permissions";

/**
 * Document settings: bank details printed on invoices (orgs.branding.bank),
 * the default design (document_templates, 0013) and numbering series
 * (document_series). Company details and colours stay on Settings → Organisation.
 */

async function guarded<T extends object>(permission: Permission, run: (viewer: Viewer) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run(await requireViewer({ kind: "staff", permission }));
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const bankSchema = z
  .object({
    bank: z.string().trim().max(120),
    branch: z.string().trim().max(120),
    account_name: z.string().trim().max(160),
    account_no: z.string().trim().max(40).regex(/^[0-9A-Za-z -]*$/, "Use digits, letters, spaces or dashes."),
    swift: z.string().trim().max(11).regex(/^([A-Za-z0-9]{8}|[A-Za-z0-9]{11})?$/, "A SWIFT code has 8 or 11 characters."),
  })
  .superRefine((v, ctx) => {
    if (v.account_no && !v.bank) ctx.addIssue({ code: "custom", path: ["bank"], message: "Enter the bank's name." });
    if (v.account_no && !v.account_name) ctx.addIssue({ code: "custom", path: ["account_name"], message: "Enter the account name." });
  });

export async function saveBankDetails(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return guarded("settings.manage", async (viewer) => {
    const parsed = bankSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: org } = await supabase.from("orgs").select("branding").eq("id", viewer.orgId).single();
    const branding = { ...((org?.branding as Record<string, unknown>) ?? {}) };
    if (v.account_no) branding.bank = { bank: v.bank, branch: v.branch || undefined, account_name: v.account_name, account_no: v.account_no, swift: v.swift.toUpperCase() || undefined };
    else delete branding.bank;
    const { error } = await supabase.from("orgs").update({ branding: branding as never }).eq("id", viewer.orgId);
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true };
  });
}

export async function setDefaultTemplate(key: string): Promise<ActionResult> {
  return guarded("templates.manage", async (viewer) => {
    if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) return fail("Choose a design.");
    const supabase = await createClient();
    // One default per organisation (unique index): clear the old one first.
    const off = await supabase.from("document_templates").update({ is_default: false }).eq("org_id", viewer.orgId).neq("key", key).eq("is_default", true);
    if (off.error) return fail(friendlyDbError(off.error));
    const on = await supabase.from("document_templates").update({ is_default: true }).eq("org_id", viewer.orgId).eq("key", key).select("key");
    if (on.error) return fail(friendlyDbError(on.error));
    if (!on.data?.length) return fail("You don't have permission to do that.");
    refresh();
    return { ok: true };
  });
}

const seriesSchema = z.object({
  kind: z.string().min(1).max(40),
  prefix: z.string().trim().min(1, "Enter a prefix.").max(8).regex(/^[A-Z0-9]+$/, "Use capital letters and digits only."),
  padding: z.number().int().min(3, "At least 3 digits.").max(8, "At most 8 digits."),
  yearly_reset: z.boolean(),
});

export async function saveNumberingSeries(input: z.input<typeof seriesSchema>): Promise<ActionResult> {
  return guarded("settings.manage", async (viewer) => {
    const parsed = seriesSchema.safeParse({ ...input, prefix: String(input.prefix ?? "").toUpperCase() });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the numbering.");
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("document_series")
      .update({ prefix: v.prefix, padding: v.padding, yearly_reset: v.yearly_reset })
      .eq("org_id", viewer.orgId)
      .eq("kind", v.kind)
      .select("kind");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("That numbering series doesn't exist.");
    refresh();
    return { ok: true };
  });
}
