import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, readBranding } from "@/domain/branding";

describe("readBranding", () => {
  it("fills defaults and keeps valid values", () => {
    const b = readBranding({ display_name: "Ontriq", phone: "+94 11 234 5678" });
    expect(b.phone).toBe("+94 11 234 5678");
    expect(b.primary_color).toBe(DEFAULT_BRANDING.primary_color);
  });
  it("falls back when stored values are invalid", () => {
    expect(readBranding({ primary_color: "navy" })).toEqual(DEFAULT_BRANDING);
    expect(readBranding(null)).toEqual(DEFAULT_BRANDING);
  });
});
