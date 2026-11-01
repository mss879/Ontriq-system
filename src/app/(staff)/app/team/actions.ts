"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin, serviceRoleKey } from "@/lib/env";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, friendlyDbError } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { inviteEmail } from "@/domain/email/templates";
import { passwordSchema } from "@/domain/password";
import { emailBrand } from "@/lib/server/email-brand";

type InviteResult = ActionResult<{ devLink?: string }>;

async function guard(): Promise<Viewer | ActionResult> {
  try {
    return await requireViewer({ kind: "staff", permission: "users.manage" });
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

function confirmUrl(tokenHash: string, type: "invite" | "magiclink") {
  return `${appOrigin()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&next=/accept-invite`;
}

/** Create (or reuse) the auth user and return a one-time setup link. */
async function setupLink(email: string, fullName: string) {
  const admin = createAdminClient();
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName } } });
  if (!invite.error) return { userId: invite.data.user.id, url: confirmUrl(invite.data.properties.hashed_token, "invite") };
  const magic = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (magic.error) throw new Error(magic.error.message);
  return { userId: magic.data.user.id, url: confirmUrl(magic.data.properties.hashed_token, "magiclink") };
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(2, "Enter their full name.").max(120),
  roleId: z.uuid("Choose a designation."),
});

export async function inviteMember(_prev: InviteResult | null, formData: FormData): Promise<InviteResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  if (!serviceRoleKey()) return fail("Invitations need the Supabase service key. Add SUPABASE_SECRET_KEY to the environment.");

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { email, fullName, roleId } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, key, name, kind").eq("id", roleId).maybeSingle();
  if (!role || role.kind !== "staff") return fail("Choose a staff designation.", { roleId: ["Choose a staff designation."] });
  if (role.key === "super_admin" && viewer.roleKey !== "super_admin") return fail("Only a Super Admin can invite another Super Admin.");

  const { data: existingProfile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingProfile) {
    const { data: existingMembership } = await supabase.from("memberships").select("id").eq("user_id", existingProfile.id).maybeSingle();
    if (existingMembership) return fail("That person is already on the team.", { email: ["Already a member."] });
  }

  let link: { userId: string; url: string };
  try {
    link = await setupLink(email, fullName);
  } catch {
    return fail("We couldn't create the invitation. Check the email address and try again.");
  }

  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(link.userId, { app_metadata: { kind: "staff", org_id: viewer.orgId } });
  await admin.from("profiles").update({ full_name: fullName }).eq("id", link.userId);

  const { error: membershipError } = await supabase.from("memberships").insert({
    org_id: viewer.orgId,
    user_id: link.userId,
    kind: "staff",
    role_id: role.id,
    status: "invited",
    invited_by: viewer.userId,
    invited_at: new Date().toISOString(),
  });
  if (membershipError) return fail(friendlyDbError(membershipError));

  await supabase.from("invitations").insert({
    org_id: viewer.orgId,
    email,
    full_name: fullName,
    kind: "staff",
    role_id: role.id,
    auth_user_id: link.userId,
    invited_by: viewer.userId,
    sent_count: 1,
    last_sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });

  const mail = inviteEmail({ fullName, inviterName: viewer.fullName || viewer.orgName, orgName: viewer.orgName, roleName: role.name, actionUrl: link.url, kind: "staff" }, emailBrand());
  await queueEmail({ to: [email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.invite", entityType: "membership", createdBy: viewer.userId, orgId: viewer.orgId });

  refresh();
  const devLink = process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? link.url : undefined;
  return { ok: true, devLink };
}

export async function resendInvite(membershipId: string): Promise<InviteResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("id, user_id, status, kind, role:roles(name)")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership || membership.status !== "invited") return fail("Only pending invitations can be resent.");

  const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("id", membership.user_id).maybeSingle();
  if (!profile?.email) return fail("We couldn't find this person's email.");

  let link: { userId: string; url: string };
  try {
    link = await setupLink(profile.email, profile.full_name);
  } catch {
    return fail("We couldn't create a new link. Try again in a moment.");
  }

  const roleName = (membership.role as { name: string } | null)?.name ?? "team member";
  const mail = inviteEmail({ fullName: profile.full_name, inviterName: viewer.fullName || viewer.orgName, orgName: viewer.orgName, roleName, actionUrl: link.url, kind: "staff" }, emailBrand());
  await queueEmail({ to: [profile.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.invite", entityType: "membership", entityId: membership.id, createdBy: viewer.userId, orgId: viewer.orgId });

  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, sent_count")
    .eq("auth_user_id", membership.user_id)
    .eq("status", "pending")
    .maybeSingle();
  if (invitation) {
    await supabase
      .from("invitations")
      .update({ sent_count: invitation.sent_count + 1, last_sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() })
      .eq("id", invitation.id);
  }

  refresh();
  const devLink = process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? link.url : undefined;
  return { ok: true, devLink };
}

const createMemberSchema = inviteSchema.extend({ password: passwordSchema });

/** A working login on the spot, for someone already confirmed: no invitation, no email. */
export async function createMember(input: z.input<typeof createMemberSchema>): Promise<ActionResult<{ email: string }>> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer as ActionResult<{ email: string }>;
  if (!serviceRoleKey()) return fail("Creating logins needs the Supabase service key. Add SUPABASE_SECRET_KEY to the environment.");

  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { email, fullName, roleId, password } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, key, kind").eq("id", roleId).maybeSingle();
  if (!role || role.kind !== "staff") return fail("Choose a staff designation.", { roleId: ["Choose a staff designation."] });
  if (role.key === "super_admin" && viewer.roleKey !== "super_admin") return fail("Only a Super Admin can add another Super Admin.");

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { kind: "staff", org_id: viewer.orgId },
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists") return fail("Check the highlighted fields.", { email: ["That email already has an account."] });
    if (created.error?.code === "weak_password") return fail("Check the highlighted fields.", { password: ["Choose a stronger password."] });
    return fail("We couldn't create this login. Check the details and try again.");
  }
  const userId = created.data.user.id;
  await admin.from("profiles").update({ full_name: fullName }).eq("id", userId);

  // As the signed-in admin, so the role rules and the audit log apply. No half-made account is left behind.
  const { error: membershipError } = await supabase.from("memberships").insert({
    org_id: viewer.orgId,
    user_id: userId,
    kind: "staff",
    role_id: role.id,
    status: "active",
    invited_by: viewer.userId,
  });
  if (membershipError) {
    await admin.auth.admin.deleteUser(userId);
    return fail(friendlyDbError(membershipError));
  }

  refresh();
  return { ok: true, email };
}

const roleChangeSchema = z.object({ membershipId: z.uuid(), roleId: z.uuid() });

export async function changeRole(input: { membershipId: string; roleId: string }): Promise<ActionResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").update({ role_id: parsed.data.roleId }).eq("id", parsed.data.membershipId);
  if (error) return fail(friendlyDbError(error));
  refresh();
  return { ok: true };
}

const statusSchema = z.object({ membershipId: z.uuid(), status: z.enum(["active", "suspended"]) });

export async function setMemberStatus(input: { membershipId: string; status: "active" | "suspended" }): Promise<ActionResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createClient();

  const { data: membership } = await supabase.from("memberships").select("id, user_id, status").eq("id", parsed.data.membershipId).maybeSingle();
  if (!membership) return fail("Member not found.");
  if (membership.user_id === viewer.userId) return fail("You can't change your own access.");

  const { error } = await supabase.from("memberships").update({ status: parsed.data.status }).eq("id", membership.id);
  if (error) return fail(friendlyDbError(error));
  if (membership.status === "invited" && parsed.data.status === "suspended") {
    await supabase.from("invitations").update({ status: "revoked" }).eq("auth_user_id", membership.user_id).eq("status", "pending");
  }
  refresh();
  return { ok: true };
}
