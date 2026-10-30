"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";

/** The company's own request templates: one click fills a whole request (plan §5). */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const manager = () => requireViewer({ kind: "client", permission: "portal.templates.manage" });

const text = (max: number) => z.string().trim().max(max).default("");

const templateSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(3, "Give the template a name of at least 3 characters.").max(80),
  description: text(300),
  packageId: z.uuid("Choose a package."),
  processType: z.enum(["client_supplied", "candidate_collected"]),
  priority: z.enum(["normal", "high", "urgent"]),
  positionTitle: text(120),
  department: text(120),
  instructions: text(2000),
  isFavourite: z.boolean().default(false),
});

export type TemplateInput = z.input<typeof templateSchema>;

export async function saveTemplate(input: TemplateInput): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const viewer = await manager();
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: usable } = await supabase.rpc("client_can_use_package", { p_package: v.packageId, p_client: viewer.clientId ?? "" });
    if (!usable) return fail("That package isn't available to your company.", { packageId: ["Choose another package."] });

    const defaults = Object.fromEntries(
      Object.entries({ position_title: v.positionTitle, department: v.department, instructions: v.instructions }).filter(([, value]) => value),
    );
    const row = { name: v.name, description: v.description, package_id: v.packageId, process_type: v.processType, priority: v.priority, defaults, is_favourite: v.isFavourite };
    if (v.id) {
      const { error } = await supabase.from("request_templates").update(row).eq("id", v.id).eq("owner_scope", "client");
      if (error) return fail(friendlyDbError(error));
      refresh();
      return { ok: true, id: v.id };
    }
    const { data, error } = await supabase
      .from("request_templates")
      .insert({ ...row, org_id: viewer.orgId, owner_scope: "client", client_id: viewer.clientId, created_by: viewer.userId })
      .select("id")
      .single();
    if (error || !data) return fail(friendlyDbError(error));
    refresh();
    return { ok: true, id: data.id };
  });
}

export async function setTemplateFlags(id: string, flags: { isFavourite?: boolean; isActive?: boolean }): Promise<ActionResult> {
  return guarded(async () => {
    await manager();
    if (!z.uuid().safeParse(id).success) return fail("Template not found.");
    const patch: { is_favourite?: boolean; is_active?: boolean } = {};
    if (flags.isFavourite !== undefined) patch.is_favourite = flags.isFavourite;
    if (flags.isActive !== undefined) patch.is_active = flags.isActive;
    const supabase = await createClient();
    const { error } = await supabase.from("request_templates").update(patch).eq("id", id).eq("owner_scope", "client");
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true };
  });
}
