"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";

/** Ontriq packages and request templates. Writes go through row level security as the signed-in person. */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const packageSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2, "Enter a name.").max(80),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, "Use 2–32 capital letters, digits, dashes or underscores."),
    description: z.string().trim().max(300).default(""),
    pricingMode: z.enum(["sum", "fixed"]),
    fixedPrice: z.coerce.number().min(0, "Prices can't be negative.").max(10_000_000).nullable().optional(),
    tatDays: z.coerce.number().int().min(1, "At least 1 day.").max(90, "At most 90 days."),
    defaultProcessType: z.enum(["client_supplied", "candidate_collected"]),
    visibility: z.enum(["all", "selected"]),
    isActive: z.boolean(),
    items: z
      .array(z.object({ checkTypeId: z.uuid(), unitPrice: z.coerce.number().min(0, "Prices can't be negative.").max(10_000_000) }))
      .min(1, "Choose at least one check."),
    clientIds: z.array(z.uuid()).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode === "fixed" && (v.fixedPrice === null || v.fixedPrice === undefined))
      ctx.addIssue({ code: "custom", path: ["fixedPrice"], message: "Enter the package price." });
    if (v.visibility === "selected" && !v.clientIds.length) ctx.addIssue({ code: "custom", path: ["clientIds"], message: "Choose at least one client, or offer it to everyone." });
  });

export type PackageInput = z.input<typeof packageSchema>;

export async function savePackage(input: PackageInput): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "packages.manage" });
    const parsed = packageSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const fields = {
      name: v.name,
      code: v.code,
      description: v.description,
      pricing_mode: v.pricingMode,
      fixed_price: v.pricingMode === "fixed" ? (v.fixedPrice ?? 0) : null,
      tat_days: v.tatDays,
      default_process_type: v.defaultProcessType,
      visibility: v.visibility,
      is_active: v.isActive,
    };
    let id = v.id;
    if (id) {
      const { data, error } = await supabase.from("packages").update(fields).eq("id", id).eq("owner_scope", "org").select("id");
      if (error?.code === "23505") return fail("Check the highlighted fields.", { code: ["Another package already uses this code."] });
      if (error) return fail(rpcErrorMessage(error));
      if (!data?.length) return fail("That package no longer exists.");
    } else {
      const { data, error } = await supabase
        .from("packages")
        .insert({ ...fields, org_id: viewer.orgId, owner_scope: "org", created_by: viewer.userId })
        .select("id")
        .single();
      if (error?.code === "23505") return fail("Check the highlighted fields.", { code: ["Another package already uses this code."] });
      if (error || !data) return fail(rpcErrorMessage(error));
      id = data.id;
    }

    // Checks and prices: replace the list.
    const del = await supabase.from("package_items").delete().eq("package_id", id);
    if (del.error) return fail(rpcErrorMessage(del.error));
    const ins = await supabase
      .from("package_items")
      .insert(v.items.map((item, i) => ({ org_id: viewer.orgId, package_id: id!, check_type_id: item.checkTypeId, unit_price: item.unitPrice, sort: (i + 1) * 10 })));
    if (ins.error) return fail(rpcErrorMessage(ins.error));

    // Which clients see it.
    const delVis = await supabase.from("package_client_visibility").delete().eq("package_id", id);
    if (delVis.error) return fail(rpcErrorMessage(delVis.error));
    if (v.visibility === "selected") {
      const insVis = await supabase.from("package_client_visibility").insert(v.clientIds.map((clientId) => ({ package_id: id!, client_id: clientId, org_id: viewer.orgId })));
      if (insVis.error) return fail(rpcErrorMessage(insVis.error));
    }
    refresh();
    return { ok: true, id: id! };
  });
}

const templateSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter a name.").max(120),
  description: z.string().trim().max(300).default(""),
  packageId: z.uuid("Choose a package."),
  processType: z.enum(["client_supplied", "candidate_collected"]),
  priority: z.enum(["normal", "high", "urgent"]),
  positionTitle: z.string().trim().max(120).default(""),
  department: z.string().trim().max(120).default(""),
  instructions: z.string().trim().max(2000).default(""),
  isFavourite: z.boolean(),
  isActive: z.boolean(),
});

export type TemplateInput = z.input<typeof templateSchema>;

export async function saveTemplate(input: TemplateInput): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "templates.manage" });
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const defaults: Record<string, string> = {};
    if (v.positionTitle) defaults.position_title = v.positionTitle;
    if (v.department) defaults.department = v.department;
    if (v.instructions) defaults.instructions = v.instructions;
    const fields = {
      name: v.name,
      description: v.description,
      package_id: v.packageId,
      process_type: v.processType,
      priority: v.priority,
      defaults,
      is_favourite: v.isFavourite,
      is_active: v.isActive,
    };
    const supabase = await createClient();
    if (v.id) {
      const { data, error } = await supabase.from("request_templates").update(fields).eq("id", v.id).eq("owner_scope", "org").select("id");
      if (error) return fail(rpcErrorMessage(error));
      if (!data?.length) return fail("That template no longer exists.");
      refresh();
      return { ok: true, id: v.id };
    }
    const { data, error } = await supabase
      .from("request_templates")
      .insert({ ...fields, org_id: viewer.orgId, owner_scope: "org", created_by: viewer.userId })
      .select("id")
      .single();
    if (error || !data) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, id: data.id };
  });
}
