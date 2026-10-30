/**
 * When to remind a candidate who still owes documents, answers or consent.
 * Default cadence: day 1, 3 and 5 after the link was first sent, in office
 * hours (Monday to Saturday, 08:00–18:00 Asia/Colombo), then one escalation
 * to the case owner two days after the last reminder, then a reminder every
 * seven days until the link expires. The reminder.candidate job applies this
 * to public.candidate_reminder_candidates(). Pure module.
 */
import { toZonedTime } from "date-fns-tz";
import { TZ } from "../sla-core";

export const DEFAULT_CADENCE_DAYS = [1, 3, 5] as const;
export const ESCALATE_AFTER_DAYS = 2;
export const REPEAT_EVERY_DAYS = 7;
const DAY = 24 * 3600_000;

export type ReminderState = {
  sentAt: Date;
  remindersSent: number;
  lastRemindedAt: Date | null;
  escalatedAt: Date | null;
  expiresAt: Date;
  missingDocuments: number;
  openRequests: number;
  consentMissing: boolean;
};

export type ReminderDecision = { kind: "remind"; step: number } | { kind: "escalate" } | { kind: "none"; reason: string };

/** Office hours in Sri Lanka: Monday to Saturday, 08:00 to 18:00. */
export function inOfficeHours(now: Date): boolean {
  const local = toZonedTime(now, TZ);
  const hour = local.getHours();
  return local.getDay() !== 0 && hour >= 8 && hour < 18;
}

export function decideReminder(s: ReminderState, now: Date, cadence: readonly number[] = DEFAULT_CADENCE_DAYS): ReminderDecision {
  if (s.missingDocuments + s.openRequests === 0 && !s.consentMissing) return { kind: "none", reason: "nothing outstanding" };
  if (s.expiresAt.getTime() <= now.getTime()) return { kind: "none", reason: "link expired" };
  if (!inOfficeHours(now)) return { kind: "none", reason: "outside office hours" };

  const next = s.remindersSent + 1;
  if (next <= cadence.length) {
    const due = s.sentAt.getTime() + cadence[next - 1] * DAY;
    // Never two reminders within 20 hours, even when catching up.
    const rested = !s.lastRemindedAt || now.getTime() - s.lastRemindedAt.getTime() >= 20 * 3600_000;
    return now.getTime() >= due && rested ? { kind: "remind", step: next } : { kind: "none", reason: "not due yet" };
  }
  const last = s.lastRemindedAt ?? new Date(s.sentAt.getTime() + cadence[cadence.length - 1] * DAY);
  if (s.escalatedAt) return now.getTime() - last.getTime() >= REPEAT_EVERY_DAYS * DAY ? { kind: "remind", step: next } : { kind: "none", reason: "waiting for the next weekly reminder" };
  return now.getTime() - last.getTime() >= ESCALATE_AFTER_DAYS * DAY ? { kind: "escalate" } : { kind: "none", reason: "waiting after the last reminder" };
}
