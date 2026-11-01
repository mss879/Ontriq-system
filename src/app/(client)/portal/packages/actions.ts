"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { portalClientProfile } from "@/lib/server/portal/queries";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";

/**
 * Client-built packages (plan §5). The client names a package and picks checks
 * from the ones Ontriq enabled for them; prices always come from Ontriq (the
 * package_items_price_guard trigger replaces whatever is sent). When Ontriq
 * asks to approve client packages first, a new package waits inactive.
 */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const manager = () => requireViewer({ kind: "client", permission: "portal.packages.manage" });

const packageSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(3, "Give the package a name of at least 3 characters.").max(80),
  description: z.string().trim().max(400).default(""),
  checkTypeIds: z.array(z.uuid()).min(1, "Pick at least one check.").max(20),
});

export type PackageInput = z.input<typeof packageSchema>;

function slug(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
}

/** Create or edit one of the company's own packages. */
export async function saveClientPackage(input: PackageInput): Promise<ActionResult<{ id: string; pendingApproval: boolean }>> {
  return guarded(async () => {
    const viewer = await manager();
    const parsed = packageSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();

    const [client, { data: allowed }] = await Promise.all([portalClientProfile(), supabase.rpc("portal_price_list")]);
    const portal = client?.portal;
    if (portal?.client_packages === false) return fail("Building your own packages isn't switched on for your company. Ask Ontriq to turn it on.");
    const allowedIds = new Set((allowed ?? []).map((r) => r.check_type_id));
    if (v.checkTypeIds.some((id) => !allowedIds.has(id))) return fail("One of these checks isn't available to your company.");
    const needsApproval = portal?.client_packages_need_approval === true;

    let id = v.id;
    let pendingApproval = needsApproval;
    if (id) {
      const { data: existing } = await supabase.from("packages").select("id, owner_scope, needs_approval").eq("id", id).maybeSingle();
      if (!existing || existing.owner_scope !== "client") return fail("That package can't be edited here.");
      // Changing a package goes back to Ontriq when Ontriq approves them (public.package_items_client_review).
      pendingApproval = existing.needs_approval || needsApproval;
      const { error } = await supabase.from("packages").update({ name: v.name, description: v.description }).eq("id", id);
      if (error) return fail(friendlyDbError(error));
      const { error: delError } = await supabase.from("package_items").delete().eq("package_id", id);
      if (delError) return fail(friendlyDbError(delError));
    } else {
      const code = `${client?.code ?? "CLIENT"}-${slug(v.name) || "PACKAGE"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const { data, error } = await supabase
        .from("packages")
        .insert({
          org_id: viewer.orgId,
          owner_scope: "client",
          client_id: viewer.clientId,
          name: v.name,
          code,
          description: v.description,
          is_active: !needsApproval,
          needs_approval: needsApproval,
          created_by: viewer.userId,
        })
        .select("id")
        .single();
      if (error || !data) return fail(friendlyDbError(error));
      id = data.id;
    }

    // Ontriq's price is filled in by the database for each check.
    const { error: itemsError } = await supabase
      .from("package_items")
      .insert(v.checkTypeIds.map((checkTypeId, i) => ({ org_id: viewer.orgId, package_id: id!, check_type_id: checkTypeId, unit_price: 0, sort: (i + 1) * 10 })));
    if (itemsError) return fail(friendlyDbError(itemsError));
    refresh();
    return { ok: true, id: id!, pendingApproval };
  });
}

/** Retire a package (it stays on past requests) or bring it back. */
export async function setClientPackageActive(id: string, active: boolean): Promise<ActionResult> {
  return guarded(async () => {
    await manager();
    if (!z.uuid().safeParse(id).success) return fail("Package not found.");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("packages").select("owner_scope, needs_approval").eq("id", id).maybeSingle();
    if (!existing || existing.owner_scope !== "client") return fail("That package can't be changed here.");
    if (active && existing.needs_approval) return fail("Ontriq still needs to approve this package.");
    const { error } = await supabase.from("packages").update({ is_active: active }).eq("id", id);
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true };
  });
}
