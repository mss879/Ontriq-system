import { describe, expect, it } from "vitest";
import { allowedShortcuts, matchKey, SHORTCUTS } from "@/domain/shortcuts";

describe("keyboard shortcuts", () => {
  it("hides shortcuts the person can't use", () => {
    const officer = allowedShortcuts(["cases.read_assigned", "checks.verify"]).map((s) => s.label);
    expect(officer).toContain("Cases");
    expect(officer).not.toContain("New case");
    expect(officer).not.toContain("Invoices");
    expect(allowedShortcuts(["*"])).toHaveLength(SHORTCUTS.length);
  });

  it("matches single keys and two-key jumps", () => {
    expect(matchKey(SHORTCUTS, [], "c").match?.href).toBe("/app/cases/new");
    const first = matchKey(SHORTCUTS, [], "g");
    expect(first).toEqual({ match: null, pending: ["g"] });
    expect(matchKey(SHORTCUTS, first.pending, "i").match?.href).toBe("/app/invoices");
  });

  it("starts over on a key that doesn't continue the sequence", () => {
    expect(matchKey(SHORTCUTS, ["g"], "c").match?.label).toBe("Cases");
    expect(matchKey(SHORTCUTS, ["g"], "z")).toEqual({ match: null, pending: [] });
    expect(matchKey(SHORTCUTS, ["g"], "?").match?.action).toBe("help");
    expect(matchKey(SHORTCUTS, [], "x")).toEqual({ match: null, pending: [] });
  });
});
