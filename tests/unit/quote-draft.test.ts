import { describe, expect, it } from "vitest";
import { defaultQuoteText } from "@/domain/pricing/quote-draft";

describe("default quotation wording", () => {
  const base = { orgName: "Ontriq", clientName: "Hemas Holdings", lines: [{ description: "NIC verification", kind: "check" as const }, { description: "Education.", kind: "check" as const }] };

  it("lists the quoted checks in the scope and never mentions money", () => {
    const t = defaultQuoteText(base);
    expect(t.scope).toContain("NIC verification and Education");
    expect(Object.values(t).join(" ")).not.toMatch(/LKR|Rs\.?|\d+%|price/i);
    expect(t.tat_text).toMatch(/^7 working days/);
  });

  it("uses the volume and turnaround it is given, and a friendlier tone on request", () => {
    const t = defaultQuoteText({ ...base, expectedMonthlyVolume: 40, tatDays: 5, tone: "friendly" });
    expect(t.intro).toContain("around 40 candidates a month");
    expect(t.intro).toMatch(/^Thank you for thinking of Ontriq/);
    expect(t.tat_text).toMatch(/^5 working days/);
  });

  it("still reads well with no lines yet", () => {
    expect(defaultQuoteText({ ...base, lines: [] }).scope).toContain("the background checks agreed with your team");
  });
});
