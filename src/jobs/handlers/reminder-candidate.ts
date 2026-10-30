import { decideReminder } from "../../domain/candidate/reminders-core";
import { candidateLinkSms, candidateReminderEmail } from "../../domain/email/candidate-templates";
import { DEFAULT_BRAND } from "../../domain/email/layout";
import { candidateLinkUrl, isCandidateSecretConfigured, openLinkSecret } from "../../lib/crypto/candidate-token";
import type { JobHandler } from "../types";

type Row = {
  link_id: string;
  case_id: string;
  org_id: string;
  reference: string;
  language: string;
  sent_at: string;
  reminders_sent: number;
  last_reminded_at: string | null;
  escalated_at: string | null;
  expires_at: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  client_name: string;
  missing_documents: number;
  open_requests: number;
  consent_missing: boolean;
};

/**
 * reminder.candidate (hourly from /api/jobs/tick): remind candidates who still
 * owe documents, answers or consent on the day 1/3/5 cadence in office hours,
 * then tell the case owner once (src/domain/candidate/reminders-core.ts).
 */
export const reminderCandidate: JobHandler = async (_job, { admin }) => {
  if (!isCandidateSecretConfigured()) return { skipped: "CANDIDATE_SESSION_SECRET not set" };
  const { data, error } = await admin.rpc("candidate_reminder_candidates");
  if (error) throw new Error(`candidate_reminder_candidates: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const brand = { ...DEFAULT_BRAND, logoUrl: `${origin}/brand/ontriq-logo.png` };
  const now = new Date();
  let reminded = 0;
  let escalated = 0;

  for (const r of rows) {
    const decision = decideReminder(
      {
        sentAt: new Date(r.sent_at),
        remindersSent: r.reminders_sent,
        lastRemindedAt: r.last_reminded_at ? new Date(r.last_reminded_at) : null,
        escalatedAt: r.escalated_at ? new Date(r.escalated_at) : null,
        expiresAt: new Date(r.expires_at),
        missingDocuments: r.missing_documents,
        openRequests: r.open_requests,
        consentMissing: r.consent_missing,
      },
      now,
    );
    if (decision.kind === "escalate") {
      await admin.rpc("record_candidate_reminder", { p_link: r.link_id, p_step: r.reminders_sent, p_escalated: true });
      escalated++;
      continue;
    }
    if (decision.kind !== "remind") continue;

    const { data: link } = await admin.from("candidate_links").select("token_enc").eq("id", r.link_id).single();
    const secret = openLinkSecret(link?.token_enc);
    if (!secret) continue;
    const url = candidateLinkUrl(origin, secret);
    const { data: org } = await admin.from("orgs").select("name, branding").eq("id", r.org_id).single();
    const branding = (org?.branding ?? {}) as Record<string, string>;
    const orgName = branding.display_name || org?.name || "Ontriq";

    if (r.candidate_email) {
      const mail = candidateReminderEmail(
        {
          language: r.language,
          candidateName: r.candidate_name,
          orgName,
          url,
          expiresAt: r.expires_at,
          contact: branding.email || branding.phone || "",
          outstanding: { documents: r.missing_documents, requests: r.open_requests, consent: r.consent_missing },
        },
        brand,
      );
      await admin.rpc("queue_email", {
        p_to: [r.candidate_email],
        p_subject: mail.subject,
        p_html: mail.html,
        p_text: mail.text,
        p_template_key: "candidate.reminder",
        p_entity_type: "case",
        p_entity_id: r.case_id,
        p_org: r.org_id,
      });
    }
    if (r.candidate_phone) {
      await admin.rpc("queue_sms", {
        p_to: r.candidate_phone,
        p_body: candidateLinkSms({ orgName, url, reminder: true }),
        p_template_key: "candidate.reminder",
        p_entity_type: "case",
        p_entity_id: r.case_id,
        p_org: r.org_id,
      });
    }
    if (r.candidate_email || r.candidate_phone) {
      await admin.rpc("record_candidate_reminder", { p_link: r.link_id, p_step: decision.step });
      reminded++;
    }
  }
  return { checked: rows.length, reminded, escalated };
};
