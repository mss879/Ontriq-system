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
import { emailBrand } from "@/lib/server/email-brand";

/**
 * A client admin manages their own company's portal users (portal.users.manage).
 * Row level security keeps every membership and invitation to their company;
 * the auth user and the one-time setup link come from the service key, as for
 * staff invitations (src/app/(staff)/app/team/actions.ts).
 */

type InviteResult = ActionResult<{ devLink?: string }>;

async function guard(): Promise<Viewer | ActionResult> {
  try {
    return await requireViewer({ kind: "client", permission: "portal.users.manage" });
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

function confirmUrl(tokenHash: string, type: "invite" | "magiclink") {
  return `${appOrigin()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&next=/accept-invite`;
}

async function setupLink(email: string, fullName: string) {
  const admin = createAdminClient();
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName } } });
  if (!invite.error) return { userId: invite.data.user.id, url: confirmUrl(invite.data.properties.hashed_token, "invite") };
  const magic = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (magic.error) throw new Error(magic.error.message);
  return { userId: magic.data.user.id, url: confirmUrl(magic.data.properties.hashed_token, "magiclink") };
}

const devLinkFor = (url: string) => (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? url : undefined);

async function clientRole(roleId: string) {
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, key, name, kind").eq("id", roleId).maybeSingle();
  return role && role.kind === "client" ? role : null;
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(2, "Enter their full name.").max(120),
  roleId: z.uuid("Choose an access level."),
});

export async function inviteColleague(input: z.input<typeof inviteSchema>): Promise<InviteResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  if (!serviceRoleKey()) return fail("Invitations are not available right now. Ask Ontriq to finish setting up the portal.");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { email, fullName, roleId } = parsed.data;
  const role = await clientRole(roleId);
  if (!role) return fail("Choose an access level.", { roleId: ["Choose an access level."] });

  // One person, one membership: someone already in the system (any company, or Ontriq staff) can't be added again.
  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    const { data: membership } = await admin.from("memberships").select("id").eq("user_id", existing.id).maybeSingle();
    if (membership) return fail("That person already has access to Ontriq. Ask Ontriq if they should move to your company.", { email: ["Already has access."] });
  }

  let link: { userId: string; url: string };
  try {
    link = await setupLink(email, fullName);
  } catch {
    return fail("We couldn't create the invitation. Check the email address and try again.");
  }
  await admin.auth.admin.updateUserById(link.userId, { app_metadata: { kind: "client", org_id: viewer.orgId } });
  await admin.from("profiles").update({ full_name: fullName }).eq("id", link.userId);

  const supabase = await createClient();
  const { error: membershipError } = await supabase.from("memberships").insert({
    org_id: viewer.orgId,
    user_id: link.userId,
    kind: "client",
    client_id: viewer.clientId,
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
    kind: "client",
    client_id: viewer.clientId,
    role_id: role.id,
    auth_user_id: link.userId,
    invited_by: viewer.userId,
    sent_count: 1,
    last_sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });

  const mail = inviteEmail(
    { fullName, inviterName: viewer.fullName || viewer.clientName || viewer.orgName, orgName: viewer.orgName, roleName: role.name, actionUrl: link.url, kind: "client", clientName: viewer.clientName },
    emailBrand(),
  );
  await queueEmail({ to: [email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.invite", entityType: "membership", createdBy: viewer.userId, orgId: viewer.orgId });

  refresh();
  return { ok: true, devLink: devLinkFor(link.url) };
}

async function ownMembership(membershipId: string) {
  if (!z.uuid().safeParse(membershipId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("memberships").select("id, user_id, status, kind, role:roles(name, kind)").eq("id", membershipId).eq("kind", "client").maybeSingle();
  return data;
}

export async function resendColleagueInvite(membershipId: string): Promise<InviteResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  const membership = await ownMembership(membershipId);
  if (!membership || membership.status !== "invited") return fail("Only pending invitations can be sent again.");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("email, full_name").eq("id", membership.user_id).maybeSingle();
  if (!profile?.email) return fail("We couldn't find this person's email.");

  let link: { userId: string; url: string };
  try {
    link = await setupLink(profile.email, profile.full_name);
  } catch {
    return fail("We couldn't create a new link. Try again in a moment.");
  }
  const roleName = (membership.role as { name: string } | null)?.name ?? "portal user";
  const mail = inviteEmail(
    { fullName: profile.full_name, inviterName: viewer.fullName || viewer.orgName, orgName: viewer.orgName, roleName, actionUrl: link.url, kind: "client", clientName: viewer.clientName },
    emailBrand(),
  );
  await queueEmail({ to: [profile.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.invite", entityType: "membership", entityId: membership.id, createdBy: viewer.userId, orgId: viewer.orgId });

  const supabase = await createClient();
  const { data: invitation } = await supabase.from("invitations").select("id, sent_count").eq("auth_user_id", membership.user_id).eq("status", "pending").maybeSingle();
  if (invitation) {
    await supabase
      .from("invitations")
      .update({ sent_count: invitation.sent_count + 1, last_sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() })
      .eq("id", invitation.id);
  }
  refresh();
  return { ok: true, devLink: devLinkFor(link.url) };
}

export async function changeColleagueRole(membershipId: string, roleId: string): Promise<ActionResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  const membership = await ownMembership(membershipId);
  if (!membership) return fail("That person isn't on your team.");
  if (membership.user_id === viewer.userId) return fail("You can't change your own access.");
  const role = await clientRole(roleId);
  if (!role) return fail("Choose an access level.");
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").update({ role_id: role.id }).eq("id", membership.id);
  if (error) return fail(friendlyDbError(error));
  refresh();
  return { ok: true };
}

export async function setColleagueStatus(membershipId: string, status: "active" | "suspended"): Promise<ActionResult> {
  const viewer = await guard();
  if ("ok" in viewer) return viewer;
  if (status !== "active" && status !== "suspended") return fail("Invalid request.");
  const membership = await ownMembership(membershipId);
  if (!membership) return fail("That person isn't on your team.");
  if (membership.user_id === viewer.userId) return fail("You can't change your own access.");
  if (status === "active" && membership.status === "invited") return fail("They need to accept their invitation first.");
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").update({ status }).eq("id", membership.id);
  if (error) return fail(friendlyDbError(error));
  if (membership.status === "invited" && status === "suspended") {
    await supabase.from("invitations").update({ status: "revoked" }).eq("auth_user_id", membership.user_id).eq("status", "pending");
  }
  refresh();
  return { ok: true };
}
