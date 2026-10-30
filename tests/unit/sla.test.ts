import { describe, expect, it } from "vitest";
import { addWorkingDays, slaStatus, timeLeft } from "@/domain/sla-core";

describe("SLA maths in Colombo time", () => {
  it("skips weekends and lands at 17:30 Colombo", () => {
    // Friday 30 October 2026, 10:00 in Colombo (04:30 UTC) + 1 working day = Monday 2 November 17:30 Colombo.
    expect(addWorkingDays(new Date("2026-10-30T04:30:00Z"), 1).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    // + 5 working days from Monday = next Monday.
    expect(addWorkingDays(new Date("2026-11-02T04:30:00Z"), 5).toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });

  it("uses the Colombo date, not UTC, near midnight", () => {
    // 23:00 Thursday UTC is already Friday 04:30 in Colombo: + 1 working day = Monday, not Friday.
    expect(addWorkingDays(new Date("2026-10-29T23:00:00Z"), 1).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    // Received on a Saturday: the next working day is Monday.
    expect(addWorkingDays(new Date("2026-10-31T04:30:00Z"), 1).toISOString()).toBe("2026-11-02T12:00:00.000Z");
  });

  it("classifies on track, at risk and overdue", () => {
    const start = new Date("2026-11-02T04:30:00Z");
    const due = new Date("2026-11-09T12:00:00Z");
    expect(slaStatus(start, due, new Date("2026-11-03T04:30:00Z"))).toBe("on_track");
    expect(slaStatus(start, due, new Date("2026-11-09T00:00:00Z"))).toBe("at_risk");
    expect(slaStatus(start, due, new Date("2026-11-10T00:00:00Z"))).toBe("overdue");
    expect(slaStatus(start, due, new Date("2026-11-10T00:00:00Z"), true)).toBe("done");
  });

  it("describes time left", () => {
    const due = new Date("2026-11-09T12:00:00Z");
    expect(timeLeft(due, new Date("2026-11-09T07:00:00Z"))).toBe("5 hours left");
    expect(timeLeft(due, new Date("2026-11-04T12:00:00Z"))).toBe("5 days left");
    expect(timeLeft(due, new Date("2026-11-12T12:00:00Z"))).toBe("overdue by 3 days");
  });
});
