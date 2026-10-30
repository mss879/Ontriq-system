import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin, serviceRoleKey } from "@/lib/env";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { emailBrand } from "@/lib/server/email-brand";
import { fail, type ActionResult } from "@/lib/server/action-result";
import type { Viewer } from "@/lib/server/viewer";
import { inviteEmail } from "@/domain/email/templates";

/**
 * Portal access for a client company's people, given by Ontriq staff with
 * clients.manage (Client Relations onboards clients but doesn't manage the
 * staff team, so these writes use the service role after the caller was
 * authorised). Same flow as team invites: a one-time setup link, an invited
 * membership, then the person sets a password and lands in /portal.
 */

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

const devLinkFor = (url: string) => (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY ? url : undefined);

async function sendInvite(viewer: Viewer, input: { email: string; fullName: string; roleName: string; clientName: string; url: string; membershipId?: string }) {
  const mail = inviteEmail(
    { fullName: input.fullName, inviterName: viewer.fullName || viewer.orgName, orgName: viewer.orgName, roleName: input.roleName, actionUrl: input.url, kind: "client", clientName: input.clientName },
    emailBrand(),
  );
  await queueEmail({ to: [input.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "auth.invite", entityType: "membership", entityId: input.membershipId, createdBy: viewer.userId, orgId: viewer.orgId });
}

export async function invitePortalPerson(
  viewer: Viewer,
  input: { clientId: string; email: string; fullName: string; roleId?: string; roleKey?: string },
): Promise<ActionResult<{ devLink?: string }>> {
  if (!serviceRoleKey()) return fail("Portal invitations need the Supabase service key. Add SUPABASE_SECRET_KEY to the environment.");
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("id, name, org_id, status").eq("id", input.clientId).maybeSingle();
  if (!client || client.org_id !== viewer.orgId) return fail("That client no longer exists.");

  let roleQuery = admin.from("roles").select("id, key, name, kind").eq("org_id", viewer.orgId).eq("kind", "client");
  roleQuery = input.roleId ? roleQuery.eq("id", input.roleId) : roleQuery.eq("key", input.roleKey ?? "client_admin");
  const { data: role } = await roleQuery.maybeSingle();
  if (!role) return fail("Choose a portal role.", { roleId: ["Choose a portal role."] });

  const { data: existing } = await admin.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (existing) {
    const { data: membership } = await admin.from("memberships").select("id, kind, client_id").eq("user_id", existing.id).maybeSingle();
    if (membership) {
      const where = membership.kind === "staff" ? "on the Ontriq team" : membership.client_id === client.id ? "on this client's portal" : "on another client's portal";
      return fail(`That person already has access ${where}.`, { email: [`Already ${where}.`] });
    }
  }

  let link: { userId: string; url: string };
  try {
    link = await setupLink(input.email, input.fullName);
  } catch {
    return fail("We couldn't create the invitation. Check the email address and try again.", { email: ["Check this address."] });
  }

  await admin.auth.admin.updateUserById(link.userId, { app_metadata: { kind: "client", org_id: viewer.orgId } });
  await admin.from("profiles").update({ full_name: input.fullName }).eq("id", link.userId);
  const now = new Date().toISOString();
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .insert({ org_id: viewer.orgId, user_id: link.userId, kind: "client", client_id: client.id, role_id: role.id, status: "invited", invited_by: viewer.userId, invited_at: now })
    .select("id")
    .single();
  if (membershipError || !membership) return fail("We couldn't give them portal access. Try again in a moment.");
  await admin.from("invitations").insert({
    org_id: viewer.orgId,
    email: input.email,
    full_name: input.fullName,
    kind: "client",
    client_id: client.id,
    role_id: role.id,
    auth_user_id: link.userId,
    invited_by: viewer.userId,
    sent_count: 1,
    last_sent_at: now,
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });

  await sendInvite(viewer, { email: input.email, fullName: input.fullName, roleName: role.name, clientName: client.name, url: link.url, membershipId: membership.id });
  return { ok: true, devLink: devLinkFor(link.url) };
}

export async function resendPortalInvite(viewer: Viewer, membershipId: string): Promise<ActionResult<{ devLink?: string }>> {
  const admin = createAdminClient();
  const { data: m } = await admin.from("memberships").select("id, user_id, status, kind, org_id, client_id, role:roles(name)").eq("id", membershipId).maybeSingle();
  if (!m || m.org_id !== viewer.orgId || m.kind !== "client" || !m.client_id) return fail("That portal user no longer exists.");
  if (m.status !== "invited") return fail("Only pending invitations can be sent again.");
  const [{ data: profile }, { data: client }] = await Promise.all([
    admin.from("profiles").select("email, full_name").eq("id", m.user_id).maybeSingle(),
    admin.from("clients").select("name").eq("id", m.client_id).maybeSingle(),
  ]);
  if (!profile?.email) return fail("We couldn't find this person's email.");
  let link: { userId: string; url: string };
  try {
    link = await setupLink(profile.email, profile.full_name);
  } catch {
    return fail("We couldn't create a new link. Try again in a moment.");
  }
  await sendInvite(viewer, {
    email: profile.email,
    fullName: profile.full_name,
    roleName: (m.role as { name: string } | null)?.name ?? "portal user",
    clientName: client?.name ?? "",
    url: link.url,
    membershipId: m.id,
  });
  const { data: invitation } = await admin.from("invitations").select("id, sent_count").eq("auth_user_id", m.user_id).eq("status", "pending").maybeSingle();
  if (invitation) {
    await admin
      .from("invitations")
      .update({ sent_count: invitation.sent_count + 1, last_sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() })
      .eq("id", invitation.id);
  }
  return { ok: true, devLink: devLinkFor(link.url) };
}

/** Suspend or restore portal access, or change the portal role. */
export async function updatePortalMembership(
  viewer: Viewer,
  membershipId: string,
  change: { status?: "active" | "suspended"; roleId?: string },
): Promise<ActionResult> {
  const admin = createAdminClient();
  const { data: m } = await admin.from("memberships").select("id, user_id, status, kind, org_id, activated_at").eq("id", membershipId).maybeSingle();
  if (!m || m.org_id !== viewer.orgId || m.kind !== "client") return fail("That portal user no longer exists.");
  const update: { status?: "active" | "invited" | "suspended"; role_id?: string } = {};
  if (change.status) {
    // Restoring someone who never accepted puts them back to "invited", not straight in.
    update.status = change.status === "active" && m.status === "suspended" && !m.activated_at ? "invited" : change.status;
  }
  if (change.roleId) {
    const { data: role } = await admin.from("roles").select("id").eq("id", change.roleId).eq("kind", "client").eq("org_id", viewer.orgId).maybeSingle();
    if (!role) return fail("Choose a portal role.");
    update.role_id = role.id;
  }
  const { error } = await admin.from("memberships").update(update).eq("id", m.id);
  if (error) return fail("We couldn't change their access. Try again in a moment.");
  if (change.status === "suspended" && m.status === "invited") {
    await admin.from("invitations").update({ status: "revoked" }).eq("auth_user_id", m.user_id).eq("status", "pending");
  }
  return { ok: true };
}
