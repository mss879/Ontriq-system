"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { brandingSchema } from "@/domain/branding";

export async function saveBranding(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let viewer;
  try {
    viewer = await requireViewer({ kind: "staff", permission: "settings.manage" });
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
  const parsed = brandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("branding").eq("id", viewer.orgId).single();
  const branding = { ...((org?.branding as object) ?? {}), ...parsed.data };
  const { error } = await supabase.from("orgs").update({ branding }).eq("id", viewer.orgId);
  if (error) return fail(friendlyDbError(error));
  refresh();
  return { ok: true };
}

export async function setStaffMfaRequired(required: boolean): Promise<ActionResult> {
  let viewer;
  try {
    viewer = await requireViewer({ kind: "staff" });
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
  if (viewer.roleKey !== "super_admin") return fail("Only a Super Admin can change this.");
  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update({ mfa_required_for_staff: required }).eq("id", viewer.orgId);
  if (error) return fail(friendlyDbError(error));
  refresh();
  return { ok: true };
}
