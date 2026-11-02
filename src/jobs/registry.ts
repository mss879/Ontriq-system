import type { JobHandler } from "./types";
import { emailSend } from "./handlers/email-send";
import { smsSend } from "./handlers/sms-send";
import { assignAuto } from "./handlers/assign-auto";
import { reminderCandidate } from "./handlers/reminder-candidate";
import { notifyEmail } from "./handlers/notify-email";
import { reportRender } from "./handlers/report-render";
import { documentRender } from "./handlers/document-render";
import { businessReportRender } from "./handlers/business-report";
import { aiSlipRead, invoiceDraft, invoiceReminders } from "./handlers/invoice-jobs";
import {
  aiClassify,
  aiConsistency,
  aiExtract,
  aiNarrative,
  aiOutreach,
  aiPostqc,
  aiPreqc,
  aiResponse,
  dailyBriefing,
  nudgeAuto,
  performanceRollup,
  retentionPurge,
  slaScan,
} from "./handlers/ai-jobs";
import { aiCandidateReport } from "./handlers/candidate-report";
import { sttTranscribe } from "./handlers/stt-transcribe";

/** Job kind → handler. Kinds and their concurrency live in job_kind_limits (0009_jobs.sql). */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "email.send": emailSend,
  "sms.send": smsSend,
  "assign.auto": assignAuto,
  "reminder.candidate": reminderCandidate,
  "notify.email": notifyEmail,
  "report.render": reportRender,
  "document.render": documentRender,
  "invoice.draft": invoiceDraft,
  "invoice.reminders": invoiceReminders,
  "ai.slip_read": aiSlipRead,
  "ai.classify_document": aiClassify,
  "ai.extract_fields": aiExtract,
  "ai.consistency": aiConsistency,
  "ai.preqc_copilot": aiPreqc,
  "ai.postqc": aiPostqc,
  "ai.narrative": aiNarrative,
  "ai.outreach_draft": aiOutreach,
  "ai.response_capture": aiResponse,
  "ai.candidate_report": aiCandidateReport,
  "sla.scan": slaScan,
  "briefing.daily": dailyBriefing,
  "performance.rollup": performanceRollup,
  "nudge.auto": nudgeAuto,
  "retention.purge": retentionPurge,
  "stt.transcribe": sttTranscribe,
  "assistant.report": businessReportRender,
};
