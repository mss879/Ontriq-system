import { notificationEmail } from "../../domain/email/candidate-templates";
import { DEFAULT_BRAND } from "../../domain/email/layout";
import { NonRetryableError, type JobHandler } from "../types";

/**
 * notify.email: the email copy of an in-app notification, for people who want
 * one (queued by the notifications trigger in 0021 a minute after the
 * notification, and skipped when it was read in the meantime).
 */
export const notifyEmail: JobHandler = async (job, { admin }) => {
  const id = (job.payload as { notification_id?: string } | null)?.notification_id;
  if (!id) throw new NonRetryableError("notify.email job without notification_id");
  const { data: n } = await admin.from("notifications").select("id, org_id, user_id, type, title, body, link, read_at").eq("id", id).maybeSingle();
  if (!n) return { skipped: "notification gone" };
  if (n.read_at) return { skipped: "already read" };
  const { data: profile } = await admin.from("profiles").select("email, full_name").eq("id", n.user_id).maybeSingle();
  if (!profile?.email) return { skipped: "no email" };
  const { data: org } = await admin.from("orgs").select("name, branding").eq("id", n.org_id).single();
  const branding = (org?.branding ?? {}) as Record<string, string>;
  const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const mail = notificationEmail(
    {
      orgName: branding.display_name || org?.name || "Ontriq",
      recipientName: profile.full_name ?? "",
      title: n.title,
      body: n.body,
      url: n.link ? `${origin}${n.link.startsWith("/") ? n.link : `/${n.link}`}` : null,
    },
    { ...DEFAULT_BRAND, logoUrl: `${origin}/brand/ontriq-logo.png` },
  );
  const { data: outboxId, error } = await admin.rpc("queue_email", {
    p_to: [profile.email],
    p_subject: mail.subject,
    p_html: mail.html,
    p_text: mail.text,
    p_template_key: `notify.${n.type}`,
    p_entity_type: "notification",
    p_entity_id: n.id,
    p_org: n.org_id,
  });
  if (error) throw new Error(`queue_email: ${error.message}`);
  return { outbox_id: outboxId };
};
