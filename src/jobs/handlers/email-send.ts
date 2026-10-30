import { Resend } from "resend";
import { NonRetryableError, type JobHandler } from "../types";

let resend: Resend | undefined;

/** Deliver one email_outbox row. The outbox id is the Resend idempotency key. */
export const emailSend: JobHandler = async (job, { admin }) => {
  const outboxId = (job.payload as { outbox_id?: string } | null)?.outbox_id;
  if (!outboxId) throw new NonRetryableError("email.send job without outbox_id");

  const { data: email, error } = await admin.from("email_outbox").select("*").eq("id", outboxId).single();
  if (error || !email) throw new NonRetryableError(`outbox row ${outboxId} not found`);
  if (email.status === "sent" || email.status === "delivered") return { already: email.status };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    await admin
      .from("email_outbox")
      .update({ status: "skipped", last_error: "RESEND_API_KEY not configured", attempts: email.attempts + 1 })
      .eq("id", outboxId);
    console.info(`[email skipped] to=${email.to_emails.join(",")} subject="${email.subject}"\n${email.text_body ?? ""}`);
    return { skipped: true };
  }

  await admin.from("email_outbox").update({ status: "sending", attempts: email.attempts + 1 }).eq("id", outboxId);
  resend ??= new Resend(apiKey);
  const from = process.env.EMAIL_FROM ?? "Ontriq <onboarding@resend.dev>";
  const { data, error: sendError } = await resend.emails.send(
    {
      from,
      to: email.to_emails,
      cc: email.cc_emails.length ? email.cc_emails : undefined,
      replyTo: email.reply_to ?? undefined,
      subject: email.subject,
      html: email.html,
      text: email.text_body ?? undefined,
      tags: email.template_key ? [{ name: "template", value: email.template_key.replace(/[^a-zA-Z0-9_-]/g, "_") }] : undefined,
    },
    { idempotencyKey: `outbox-${outboxId}` },
  );

  if (sendError) {
    await admin.from("email_outbox").update({ status: "failed", last_error: sendError.message }).eq("id", outboxId);
    // 4xx validation errors will not succeed on retry.
    const name = (sendError as { name?: string }).name ?? "";
    if (/validation|invalid|missing_required/i.test(name)) throw new NonRetryableError(sendError.message);
    throw new Error(sendError.message);
  }

  await admin
    .from("email_outbox")
    .update({ status: "sent", provider_id: data?.id ?? null, sent_at: new Date().toISOString(), last_error: null })
    .eq("id", outboxId);
  return { provider_id: data?.id ?? null };
};
