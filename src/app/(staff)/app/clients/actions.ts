"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { invitePortalPerson, resendPortalInvite, updatePortalMembership } from "@/lib/server/admin/portal-invites";
import { DEFAULT_PORTAL_VISIBILITY } from "@/domain/portal/types";

/** Client directory actions. Writes go through row level security as the signed-in person (clients.manage). */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const phone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => v || null)
  .refine((v) => !v || isValidPhoneNumber(v, "LK"), "Enter a valid phone number.");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(160)
  .optional()
  .transform((v) => v || null)
  .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email address.");

const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter the company name.").max(160),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, "Use 2–24 capital letters, digits or dashes."),
  legalName: optional(200),
  registrationNo: optional(60),
  vatNo: optional(60),
  industry: optional(120),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || z.url().safeParse(v).success, "Enter a full address, e.g. https://example.lk"),
  email,
  phone,
  address: optional(400),
  slaDays: z.coerce.number().int().min(1, "At least 1 day.").max(120, "At most 120 days."),
  paymentTermsDays: z.coerce.number().int().min(0).max(180, "At most 180 days."),
  status: z.enum(["prospect", "active", "suspended", "archived"]),
  notes: optional(2000),
});

export type ClientInput = z.input<typeof clientSchema>;

const portalAdminSchema = z
  .object({
    fullName: z.string().trim().max(120).optional().default(""),
    email: z.string().trim().toLowerCase().max(160).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (!v.fullName && !v.email) return;
    if (v.fullName.length < 2) ctx.addIssue({ code: "custom", path: ["fullName"], message: "Enter their full name." });
    if (!z.email().safeParse(v.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email address." });
  });

export type PortalAdminInput = z.input<typeof portalAdminSchema>;

function row(v: z.output<typeof clientSchema>) {
  return {
    name: v.name,
    code: v.code,
    legal_name: v.legalName,
    registration_no: v.registrationNo,
    vat_no: v.vatNo,
    industry: v.industry,
    website: v.website,
    email: v.email,
    phone: v.phone,
    address: v.address ? { text: v.address } : {},
    sla_days: v.slaDays,
    payment_terms_days: v.paymentTermsDays,
    status: v.status,
    notes: v.notes,
  };
}

export async function suggestClientCode(name: string): Promise<ActionResult<{ code: string }>> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "clients.manage" });
    if (name.trim().length < 2) return { ok: true, code: "" };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("suggest_client_code", { p_name: name });
    if (error) return fail(rpcErrorMessage(error));
    return { ok: true, code: (data as string) ?? "" };
  });
}

/**
 * Create a client and, when a portal admin is given, invite them as the
 * company's first Client Admin. A failed invite doesn't undo the client: the
 * result says so and the invite can be sent again from the client page.
 */
export async function createClientRecord(
  input: ClientInput,
  portalAdmin?: PortalAdminInput,
): Promise<ActionResult<{ id: string; invite?: { ok: true; devLink?: string } | { ok: false; error: string } }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    const parsed = clientSchema.safeParse(input);
    const admin = portalAdminSchema.safeParse(portalAdmin ?? {});
    if (!parsed.success || !admin.success) {
      const issues = [...(parsed.success ? [] : parsed.error.issues), ...(admin.success ? [] : admin.error.issues.map((i) => ({ ...i, path: ["portalAdmin", ...i.path] })))];
      return fail("Check the highlighted fields.", zodFieldErrors(issues));
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .insert({ ...row(parsed.data), org_id: viewer.orgId, created_by: viewer.userId })
      .select("id")
      .single();
    if (error?.code === "23505") return fail("Check the highlighted fields.", { code: ["Another client already uses this code."] });
    if (error || !data) return fail(rpcErrorMessage(error));
    let invite: { ok: true; devLink?: string } | { ok: false; error: string } | undefined;
    if (admin.data.email) {
      const r = await invitePortalPerson(viewer, { clientId: data.id, email: admin.data.email, fullName: admin.data.fullName, roleKey: "client_admin" });
      invite = r.ok ? { ok: true, devLink: r.devLink } : { ok: false, error: r.error };
    }
    refresh();
    return { ok: true, id: data.id, invite };
  });
}

export async function updateClientRecord(id: string, input: ClientInput): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "clients.manage" });
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data, error } = await supabase.from("clients").update(row(parsed.data)).eq("id", id).select("id");
    if (error?.code === "23505") return fail("Check the highlighted fields.", { code: ["Another client already uses this code."] });
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to change this client.");
    refresh();
    return { ok: true };
  });
}

const contactSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter their name.").max(160),
  title: optional(120),
  email,
  phone,
  isPrimary: z.boolean().default(false),
  receivesReports: z.boolean().default(true),
  receivesInvoices: z.boolean().default(false),
});

export type ContactInput = z.input<typeof contactSchema>;

export async function saveContact(clientId: string, input: ContactInput): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    const parsed = contactSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const supabase = await createClient();
    // One primary contact per client: clear the old one first.
    if (v.isPrimary) {
      let clear = supabase.from("client_contacts").update({ is_primary: false }).eq("client_id", clientId).eq("is_primary", true);
      if (v.id) clear = clear.neq("id", v.id);
      const { error } = await clear;
      if (error) return fail(rpcErrorMessage(error));
    }
    const fields = {
      name: v.name,
      title: v.title,
      email: v.email,
      phone: v.phone,
      is_primary: v.isPrimary,
      receives_reports: v.receivesReports,
      receives_invoices: v.receivesInvoices,
    };
    const { error } = v.id
      ? await supabase.from("client_contacts").update(fields).eq("id", v.id).eq("client_id", clientId)
      : await supabase.from("client_contacts").insert({ ...fields, client_id: clientId, org_id: viewer.orgId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "clients.manage" });
    const supabase = await createClient();
    const { data, error } = await supabase.from("client_contacts").delete().eq("id", contactId).select("id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("That contact no longer exists.");
    refresh();
    return { ok: true };
  });
}

/** Turn one check on or off for a client. No row means "allowed". */
export async function setCheckAccess(clientId: string, checkTypeId: string, enabled: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    const supabase = await createClient();
    const { error } = await supabase
      .from("client_check_type_access")
      .upsert({ client_id: clientId, check_type_id: checkTypeId, org_id: viewer.orgId, enabled }, { onConflict: "client_id,check_type_id" });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- portal

const portalInviteSchema = z.object({
  fullName: z.string().trim().min(2, "Enter their full name.").max(120),
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  roleId: z.uuid("Choose a portal role."),
});

export async function invitePortalUser(clientId: string, input: z.input<typeof portalInviteSchema>): Promise<ActionResult<{ devLink?: string }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    const parsed = portalInviteSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const r = await invitePortalPerson(viewer, { clientId, ...parsed.data });
    if (r.ok) refresh();
    return r;
  });
}

export async function resendPortalUserInvite(membershipId: string): Promise<ActionResult<{ devLink?: string }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    if (!z.uuid().safeParse(membershipId).success) return fail("Unknown portal user.");
    const r = await resendPortalInvite(viewer, membershipId);
    if (r.ok) refresh();
    return r;
  });
}

export async function setPortalUserAccess(membershipId: string, change: { status?: "active" | "suspended"; roleId?: string }): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "clients.manage" });
    if (!z.uuid().safeParse(membershipId).success) return fail("Unknown portal user.");
    if (change.status && !["active", "suspended"].includes(change.status)) return fail("Unknown status.");
    if (change.roleId && !z.uuid().safeParse(change.roleId).success) return fail("Choose a portal role.");
    const r = await updatePortalMembership(viewer, membershipId, change);
    if (r.ok) refresh();
    return r;
  });
}

const visibilitySchema = z.object({
  show_check_progress: z.boolean(),
  show_timeline: z.boolean(),
  show_documents: z.boolean(),
  show_results_before_release: z.boolean(),
  show_candidate_progress: z.boolean(),
  hidden_check_types: z.array(z.uuid()).max(50),
});

/** What the client's portal shows (applied by portal_case_detail in 0021). */
export async function savePortalVisibility(clientId: string, input: Partial<z.input<typeof visibilitySchema>>): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "clients.manage" });
    const supabase = await createClient();
    const { data: current } = await supabase.from("client_settings").select("visibility").eq("client_id", clientId).maybeSingle();
    if (!current) return fail("That client no longer exists, or you don't have access to it.");
    const parsed = visibilitySchema.safeParse({ ...DEFAULT_PORTAL_VISIBILITY, ...((current.visibility ?? {}) as object), ...input });
    if (!parsed.success) return fail("Those visibility settings aren't valid.");
    const { data, error } = await supabase.from("client_settings").update({ visibility: parsed.data }).eq("client_id", clientId).select("client_id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to change this client.");
    refresh();
    return { ok: true };
  });
}

const portalOptionsSchema = z.object({ bulk_upload: z.boolean(), client_packages: z.boolean(), client_packages_need_approval: z.boolean() });

export async function savePortalOptions(clientId: string, input: Partial<z.input<typeof portalOptionsSchema>>): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "clients.manage" });
    const supabase = await createClient();
    const { data: current } = await supabase.from("client_settings").select("portal").eq("client_id", clientId).maybeSingle();
    if (!current) return fail("That client no longer exists, or you don't have access to it.");
    const merged = { bulk_upload: true, client_packages: true, client_packages_need_approval: false, ...((current.portal ?? {}) as object), ...input };
    const parsed = portalOptionsSchema.safeParse(merged);
    if (!parsed.success) return fail("Those portal options aren't valid.");
    // Keep any other keys a later feature stored alongside.
    const { data, error } = await supabase.from("client_settings").update({ portal: { ...(current.portal as object), ...parsed.data } }).eq("client_id", clientId).select("client_id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("You don't have permission to change this client.");
    refresh();
    return { ok: true };
  });
}

/** Approve a package the client built (when approval is required), or switch one off or on again. */
export async function setClientPackageStatus(packageId: string, action: "approve" | "deactivate" | "reactivate"): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "packages.manage" });
    if (!z.uuid().safeParse(packageId).success || !["approve", "deactivate", "reactivate"].includes(action)) return fail("Unknown package.");
    const supabase = await createClient();
    const change = action === "deactivate" ? { is_active: false } : { is_active: true, needs_approval: false };
    const { data, error } = await supabase.from("packages").update(change).eq("id", packageId).eq("owner_scope", "client").select("id");
    if (error) return fail(rpcErrorMessage(error));
    if (!data?.length) return fail("That package no longer exists, or you don't have permission to change it.");
    refresh();
    return { ok: true };
  });
}
