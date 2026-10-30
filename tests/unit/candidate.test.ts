import { beforeAll, describe, expect, it } from "vitest";
import { candidateOutstanding, candidateProgress, candidateStep, portalStep } from "@/domain/candidate/steps";
import { decideReminder, inOfficeHours, type ReminderState } from "@/domain/candidate/reminders-core";
import { candidateLinkEmail, candidateReminderEmail } from "@/domain/email/candidate-templates";
import {
  candidateLinkUrl,
  hashLinkSecret,
  looksLikeLinkSecret,
  newLinkSecret,
  openLinkSecret,
  sealLinkSecret,
  signCandidateSession,
  verifyCandidateSession,
} from "@/lib/crypto/candidate-token";

beforeAll(() => {
  process.env.CANDIDATE_SESSION_SECRET = "unit-test-secret-that-is-long-enough";
});

describe("candidate steps", () => {
  it("hides internal stages behind five plain steps", () => {
    expect(candidateStep("intake")).toBe("received");
    expect(candidateStep("documents")).toBe("documents");
    expect(candidateStep("pre_qc")).toBe("review");
    expect(candidateStep("data_entry")).toBe("review");
    expect(candidateStep("post_qc")).toBe("verification");
    expect(candidateStep("approval")).toBe("report");
    expect(portalStep("approval")).toBe("report");
    expect(portalStep("released")).toBe("released");
  });

  it("counts what the candidate still owes", () => {
    const view = {
      requirements: [
        { status: "pending", min_count: 1, received_count: 0 },
        { status: "received", min_count: 1, received_count: 1 },
        { status: "optional", min_count: 0, received_count: 0 },
      ],
      requests: [{ status: "open" }, { status: "accepted" }],
      consent: { status: "pending" },
    };
    expect(candidateOutstanding(view)).toEqual({ documents: 1, requests: 1, consent: true });
    // 2 required slots + 2 requests + consent = 5 items, 2 done.
    expect(candidateProgress(view)).toBe(40);
    expect(candidateProgress({ ...view, requirements: [], requests: [], consent: { status: "submitted" } })).toBe(100);
  });
});

describe("candidate reminders", () => {
  // Tuesday 3 November 2026, 10:00 in Colombo.
  const tueMorning = new Date("2026-11-03T10:00:00+05:30");
  const base: ReminderState = {
    sentAt: new Date("2026-11-02T09:00:00+05:30"),
    remindersSent: 0,
    lastRemindedAt: null,
    escalatedAt: null,
    expiresAt: new Date("2026-11-16T09:00:00+05:30"),
    missingDocuments: 2,
    openRequests: 0,
    consentMissing: true,
  };

  it("keeps to office hours in Sri Lanka", () => {
    expect(inOfficeHours(tueMorning)).toBe(true);
    expect(inOfficeHours(new Date("2026-11-03T19:30:00+05:30"))).toBe(false);
    expect(inOfficeHours(new Date("2026-11-08T10:00:00+05:30"))).toBe(false); // Sunday
  });

  it("sends day 1, 3 and 5 reminders, then escalates once", () => {
    expect(decideReminder(base, tueMorning)).toEqual({ kind: "remind", step: 1 });
    expect(decideReminder({ ...base, remindersSent: 1, lastRemindedAt: tueMorning }, new Date("2026-11-04T10:00:00+05:30")).kind).toBe("none");
    expect(decideReminder({ ...base, remindersSent: 1, lastRemindedAt: tueMorning }, new Date("2026-11-05T10:00:00+05:30"))).toEqual({ kind: "remind", step: 2 });
    const afterThird = { ...base, remindersSent: 3, lastRemindedAt: new Date("2026-11-07T10:00:00+05:30") };
    expect(decideReminder(afterThird, new Date("2026-11-08T10:00:00+05:30")).kind).toBe("none");
    expect(decideReminder(afterThird, new Date("2026-11-09T10:30:00+05:30"))).toEqual({ kind: "escalate" });
    expect(decideReminder({ ...afterThird, escalatedAt: new Date() }, new Date("2026-11-10T10:30:00+05:30")).kind).toBe("none");
  });

  it("stops when nothing is owed or the link expired", () => {
    expect(decideReminder({ ...base, missingDocuments: 0, consentMissing: false }, tueMorning)).toEqual({ kind: "none", reason: "nothing outstanding" });
    expect(decideReminder({ ...base, expiresAt: new Date("2026-11-03T09:00:00+05:30") }, tueMorning).kind).toBe("none");
  });
});

describe("link secrets and sessions", () => {
  it("makes unguessable secrets and stores only a hash and a sealed copy", () => {
    const a = newLinkSecret();
    expect(looksLikeLinkSecret(a)).toBe(true);
    expect(a).not.toBe(newLinkSecret());
    expect(hashLinkSecret(a)).toMatch(/^[0-9a-f]{64}$/);
    const sealed = sealLinkSecret(a);
    expect(sealed).not.toContain(a);
    expect(openLinkSecret(sealed)).toBe(a);
    expect(openLinkSecret(sealed.slice(0, -2) + "AA")).toBeNull();
    expect(candidateLinkUrl("https://crm.ontriq.lk/", a)).toBe(`https://crm.ontriq.lk/c/${a}`);
  });

  it("signs sessions that expire and can't be forged", () => {
    const id = "3f1c3c1e-1111-4111-8111-111111111111";
    const now = Date.UTC(2026, 10, 3, 4, 0);
    const { value } = signCandidateSession(id, now);
    expect(verifyCandidateSession(value, now + 1000)).toMatchObject({ linkId: id });
    expect(verifyCandidateSession(value, now + 61 * 60_000)).toBeNull();
    const [body, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ linkId: "3f1c3c1e-2222-4222-8222-222222222222", exp: 9e9 })).toString("base64url");
    expect(verifyCandidateSession(`${forged}.${mac}`, now)).toBeNull();
    expect(verifyCandidateSession(`${body}.x`, now)).toBeNull();
  });
});

describe("candidate emails", () => {
  const input = { candidateName: "Kasun Silva", clientName: "Hemas", position: "Accountant", orgName: "Ontriq", contact: "info@ontriq.com", url: "https://x.test/c/abc", expiresAt: "2026-11-16T03:30:00Z" };

  it("speaks the candidate's language", () => {
    expect(candidateLinkEmail({ ...input, language: "en" }).html).toContain("Hello Kasun,");
    expect(candidateLinkEmail({ ...input, language: "si" }).html).toContain("ආයුබෝවන් Kasun");
    expect(candidateLinkEmail({ ...input, language: "ta" }).html).toContain("வணக்கம் Kasun");
    expect(candidateLinkEmail({ ...input, language: "en" }).text).toContain("16 November 2026");
  });

  it("lists what is still owed in a reminder", () => {
    const r = candidateReminderEmail({ ...input, language: "en", outstanding: { documents: 2, requests: 1, consent: true } });
    expect(r.text).toContain("2 documents, 1 question and your signed consent.");
  });
});
