/**
 * Turnaround maths in Sri Lanka time. Due dates count working days (Monday to
 * Friday) and land at 17:30 Asia/Colombo. Mirrors public.add_working_days()
 * in 0006_cases.sql, which sets the stored due date; this copy is for
 * previews and countdowns. Public holidays are a later setting. Pure module.
 */
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const TZ = "Asia/Colombo";
const CLOSE_HOUR = 17;
const CLOSE_MINUTE = 30;

/** The close of business `days` working days after `from`. */
export function addWorkingDays(from: Date, days: number): Date {
  const local = toZonedTime(from, TZ);
  const d = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  // A case received on a weekend with 0 days lands on the next working day.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(CLOSE_HOUR, CLOSE_MINUTE, 0, 0);
  return fromZonedTime(d, TZ);
}

export type SlaStatus = "on_track" | "at_risk" | "overdue" | "done";

/** At risk with less than a working day left, or 80% of the time used. */
export function slaStatus(start: Date, due: Date, now: Date, completed = false): SlaStatus {
  if (completed) return "done";
  const total = due.getTime() - start.getTime();
  const left = due.getTime() - now.getTime();
  if (left <= 0) return "overdue";
  if (left < 24 * 3600_000 || (total > 0 && (total - left) / total >= 0.8)) return "at_risk";
  return "on_track";
}

/** "2 days left", "5 hours left", "overdue by 3 days". */
export function timeLeft(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const hours = Math.round(abs / 3600_000);
  const days = Math.round(abs / (24 * 3600_000));
  const span = hours < 36 ? `${Math.max(1, hours)} ${hours === 1 ? "hour" : "hours"}` : `${days} ${days === 1 ? "day" : "days"}`;
  return ms >= 0 ? `${span} left` : `overdue by ${span}`;
}
