import { describe, expect, it } from "vitest";
import { csvCell, csvFilename, toCsv } from "@/domain/analytics/csv";
import { addDays, colomboToday, parsePeriod, periodQuery, rangeLabel } from "@/domain/analytics/period";
import { compactNumber, formatHours, formatPct, onTimePct, operationsCsv, revenueCsv, shares, stageDurations, stagePipeline } from "@/domain/analytics/shape";
import type { OperationsData, RevenueData } from "@/domain/analytics/types";

describe("csv", () => {
  it("quotes, escapes and guards against formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+94771234567")).toBe("'+94771234567");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("කමල්")).toBe("කමල්");
  });
  it("starts with a byte order mark and ends lines with CRLF", () => {
    const out = toCsv([["a", "b"], [1, 2]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe("a,b\r\n1,2\r\n");
    expect(csvFilename("cases", "2026-10-01", "to", "2026-10-30")).toBe("cases-2026-10-01-to-2026-10-30.csv");
    expect(csvFilename("Hemas Holdings / ops")).toBe("hemas-holdings-ops.csv");
  });
});

describe("period", () => {
  const now = new Date("2026-10-30T20:00:00Z"); // 31 Oct 01:30 in Colombo
  it("uses Colombo's date", () => {
    expect(colomboToday(now)).toBe("2026-10-31");
  });
  it("reads presets and falls back to the last 30 days", () => {
    expect(parsePeriod({}, now)).toMatchObject({ preset: "30d", from: "2026-10-02", to: "2026-10-31" });
    expect(parsePeriod({ period: "quarter" }, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriod({ period: "year" }, now)).toMatchObject({ from: "2026-01-01" });
    expect(parsePeriod({ period: "bogus" }, now).preset).toBe("30d");
  });
  it("accepts a sensible custom range and clamps the end to today", () => {
    expect(parsePeriod({ period: "custom", from: "2026-09-01", to: "2026-12-31" }, now)).toMatchObject({ preset: "custom", from: "2026-09-01", to: "2026-10-31" });
    expect(parsePeriod({ period: "custom", from: "2026-10-10", to: "2026-10-01" }, now).preset).toBe("30d");
    expect(parsePeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, now).preset).toBe("30d");
    expect(parsePeriod({ period: "custom", from: "2020-01-01", to: "2026-10-01" }, now).preset).toBe("30d");
  });
  it("writes the query back without defaults", () => {
    expect(periodQuery({ preset: "30d", from: "x", to: "y" })).toBe("");
    expect(periodQuery({ preset: "custom", from: "2026-09-01", to: "2026-09-30" }, { client: "c1", tab: null })).toBe("period=custom&from=2026-09-01&to=2026-09-30&client=c1");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(rangeLabel("2025-12-15", "2026-01-10")).toBe("15 Dec 2025 – 10 Jan 2026");
  });
});

describe("shaping", () => {
  it("formats durations, shares and percentages", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(30)).toBe("30 h");
    expect(formatHours("96")).toBe("4.0 days");
    expect(onTimePct(3, 1)).toBe(75);
    expect(onTimePct(0, 0)).toBeNull();
    expect(formatPct(null)).toBe("—");
    expect(formatPct(66.7)).toBe("66.7%");
    expect(compactNumber(1_250_000)).toBe("1.3M");
    expect(compactNumber(950)).toBe("950");
    const s = shares([{ value: 1 }, { value: 1 }, { value: 1 }]);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBe(100);
    expect(shares([{ value: 0 }]).map((x) => x.pct)).toEqual([0]);
  });
  it("puts stages in workflow order with zeros", () => {
    const p = stagePipeline([{ stage: "verification", count: "2", on_hold: 1 }]);
    expect(p[0]).toMatchObject({ stage: "intake", count: 0 });
    expect(p.find((x) => x.stage === "verification")).toMatchObject({ count: 2, onHold: 1 });
    expect(p.some((x) => x.stage === "released")).toBe(false);
    expect(stageDurations([{ stage: "post_qc", avg_hours: 2, median_hours: 1, samples: 1 }, { stage: "documents", avg_hours: 10, median_hours: 8, samples: 3 }]).map((r) => r.stage)).toEqual(["documents", "post_qc"]);
  });
  it("builds CSV sections from the summaries", () => {
    const ops = {
      period: { from: "2026-10-01", to: "2026-10-30" },
      summary: { received: 2, released: 1, cancelled: 0, open_now: 1, overdue_now: 1, on_hold_now: 0, avg_tat_hours: "96.0", median_tat_hours: "96.0", sla_met: 1, sla_missed: 0 },
      weekly: [{ week: "2026-09-28", received: 2, released: 1 }],
      by_stage: [],
      stage_hours: [],
      tat_by_package: [{ package: "Standard", released: 1, avg_hours: 96, median_hours: 96, sla_met: 1, sla_missed: 0 }],
      result_mix: [{ result: "green", count: 1 }],
      officers: [],
      top_clients: [],
    } satisfies OperationsData;
    const rows = operationsCsv(ops);
    expect(rows).toContainEqual(["Average turnaround (hours)", 96]);
    expect(rows).toContainEqual(["On time %", 100]);
    expect(rows).toContainEqual(["Green (clear)", 1]);
    const rev = {
      period: { from: "2026-10-01", to: "2026-10-30" },
      currency: "LKR",
      other_currency_invoices: 0,
      summary: { invoiced: "15000.00", invoice_count: 2, collected: 9000, payment_count: 2, credited: 250, outstanding: 6000, overdue: 6000, open_invoices: 1 },
      aging: [{ bucket: "31-60", amount: 6000, invoices: 1 }],
      monthly: [],
      top_billed: [],
      top_outstanding: [],
    } satisfies RevenueData;
    expect(revenueCsv(rev)).toContainEqual(["Invoiced", 15000]);
    expect(revenueCsv(rev)).toContainEqual(["31–60 days late", 6000, 1]);
  });
});
