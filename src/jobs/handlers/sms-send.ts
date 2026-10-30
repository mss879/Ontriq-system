import { NonRetryableError, type JobHandler } from "../types";

/** Deliver one sms_outbox row through Notify.lk. */
export const smsSend: JobHandler = async (job, { admin }) => {
  const outboxId = (job.payload as { outbox_id?: string } | null)?.outbox_id;
  if (!outboxId) throw new NonRetryableError("sms.send job without outbox_id");

  const { data: sms, error } = await admin.from("sms_outbox").select("*").eq("id", outboxId).single();
  if (error || !sms) throw new NonRetryableError(`sms outbox row ${outboxId} not found`);
  if (sms.status === "sent") return { already: true };

  const userId = process.env.NOTIFYLK_USER_ID;
  const apiKey = process.env.NOTIFYLK_API_KEY;
  const senderId = process.env.NOTIFYLK_SENDER_ID ?? "NotifyDEMO";
  if (!userId || !apiKey) {
    await admin.from("sms_outbox").update({ status: "skipped", last_error: "Notify.lk not configured" }).eq("id", outboxId);
    console.info(`[sms skipped] to=${sms.to_phone} body="${sms.body}"`);
    return { skipped: true };
  }

  // Notify.lk expects 94XXXXXXXXX without "+".
  const to = sms.to_phone.replace(/[^0-9]/g, "").replace(/^0/, "94");
  const params = new URLSearchParams({ user_id: userId, api_key: apiKey, sender_id: senderId, to, message: sms.body });
  await admin.from("sms_outbox").update({ status: "sending", attempts: sms.attempts + 1 }).eq("id", outboxId);
  const res = await fetch(`https://app.notify.lk/api/v1/send?${params.toString()}`, { method: "GET", signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { status?: string; data?: unknown; errors?: unknown };
  if (!res.ok || body.status !== "success") {
    const message = `Notify.lk ${res.status}: ${JSON.stringify(body).slice(0, 300)}`;
    await admin.from("sms_outbox").update({ status: "failed", last_error: message }).eq("id", outboxId);
    if (res.status >= 400 && res.status < 500) throw new NonRetryableError(message);
    throw new Error(message);
  }
  await admin.from("sms_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", outboxId);
  return { ok: true };
};
