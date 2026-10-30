import { describe, expect, it } from "vitest";
import { paletteFilter } from "@/components/command/palette-filter";

describe("paletteFilter", () => {
  it("does not let keywords fuzzily match unrelated items", () => {
    expect(paletteFilter("Settings", "sign out", ["branding", "organisation", "security"])).toBe(0);
    expect(paletteFilter("Sign out", "sign out", ["log out"])).toBe(1);
  });
  it("matches keywords and ranks titles first", () => {
    expect(paletteFilter("Team", "invite", ["staff", "invite"])).toBe(0.5);
    expect(paletteFilter("Invite a team member", "invite")).toBe(1);
    expect(paletteFilter("Dark theme", "theme")).toBe(0.9);
  });
  it("shows everything for an empty query", () => {
    expect(paletteFilter("Dashboard", "  ")).toBe(1);
  });
});
