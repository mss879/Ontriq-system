import type { JobHandler } from "./types";
import { emailSend } from "./handlers/email-send";
import { smsSend } from "./handlers/sms-send";
import { assignAuto } from "./handlers/assign-auto";
import { reminderCandidate } from "./handlers/reminder-candidate";
import { notifyEmail } from "./handlers/notify-email";

/** Job kind → handler. Kinds and their concurrency live in job_kind_limits (0009_jobs.sql). */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "email.send": emailSend,
  "sms.send": smsSend,
  "assign.auto": assignAuto,
  "reminder.candidate": reminderCandidate,
  "notify.email": notifyEmail,
};
