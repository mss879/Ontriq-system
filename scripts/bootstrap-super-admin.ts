/**
 * Create (or re-invite) the first Super Admin.
 *   npm run bootstrap:admin -- --email you@ontriq.lk --name "Your Name"
 * Prints a one-time setup link. If Resend is configured it is also emailed.
 */
import { createServiceClient } from "../src/jobs/admin-client";
import { inviteEmail } from "../src/domain/email/templates";
import { DEFAULT_BRAND } from "../src/domain/email/layout";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function requireEmail(): string {
  const value = arg("email")?.trim().toLowerCase();
  if (!value || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    console.error('Usage: npm run bootstrap:admin -- --email you@ontriq.lk --name "Your Name"');
    process.exit(1);
  }
  return value;
}

async function main() {
  const email = requireEmail();
  const fullName = arg("name")?.trim() ?? "";
  const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const admin = createServiceClient();

  const { data: role, error: roleError } = await admin.from("roles").select("id, name").eq("org_id", ORG_ID).eq("key", "super_admin").single();
  if (roleError || !role) throw new Error(`super_admin role missing — have the migrations been applied? ${roleError?.message ?? ""}`);

  // Existing user? Use a magic link; otherwise an invite link creates the user.
  let userId: string | undefined;
  let tokenHash: string | undefined;
  let linkType: "invite" | "magiclink" = "invite";

  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName } } });
  if (invite.error) {
    const magic = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (magic.error) throw new Error(`could not create a link: ${invite.error.message} / ${magic.error.message}`);
    userId = magic.data.user.id;
    tokenHash = magic.data.properties.hashed_token;
    linkType = "magiclink";
  } else {
    userId = invite.data.user.id;
    tokenHash = invite.data.properties.hashed_token;
  }

  await admin.auth.admin.updateUserById(userId, { app_metadata: { kind: "staff", org_id: ORG_ID } });
  if (fullName) await admin.from("profiles").update({ full_name: fullName }).eq("id", userId);

  const { data: existing } = await admin.from("memberships").select("id, status").eq("org_id", ORG_ID).eq("user_id", userId).maybeSingle();
  if (existing) {
    await admin.from("memberships").update({ role_id: role.id, kind: "staff", client_id: null }).eq("id", existing.id);
  } else {
    const { error } = await admin
      .from("memberships")
      .insert({ org_id: ORG_ID, user_id: userId, kind: "staff", role_id: role.id, status: "invited", invited_at: new Date().toISOString() });
    if (error) throw new Error(`membership insert failed: ${error.message}`);
  }

  const actionUrl = `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${linkType}&next=/accept-invite`;

  if (process.env.RESEND_API_KEY) {
    const mail = inviteEmail({ fullName, inviterName: "Ontriq", orgName: "Ontriq", roleName: role.name, actionUrl, kind: "staff" }, { ...DEFAULT_BRAND, logoUrl: `${origin}/brand/ontriq-logo.png` });
    await admin.rpc("queue_email", { p_to: [email], p_subject: mail.subject, p_html: mail.html, p_text: mail.text, p_template_key: "auth.invite", p_org: ORG_ID });
    console.info("Invitation email queued (run `npm run worker:local` locally, or the Netlify worker will send it).");
  }

  console.info(`\nSuper Admin ${email} is ready.\nOne-time setup link (expires in 24 hours):\n\n  ${actionUrl}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
