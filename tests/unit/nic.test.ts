import { describe, expect, it } from "vitest";
import { canonicalNic, parseNic } from "@/domain/nic-core";

const today = new Date("2026-10-29T00:00:00Z");

describe("Sri Lankan NIC numbers", () => {
  it("reads an old-format number", () => {
    const r = parseNic("853400937V", today);
    expect(r).toMatchObject({ valid: true, format: "old", birthDate: "1985-12-05", gender: "male", canonical: "198534000937" });
  });

  it("reads women's day codes (plus 500)", () => {
    expect(parseNic("856400937v", today)).toMatchObject({ valid: true, birthDate: "1985-05-19", gender: "female" });
  });

  it("reads a new-format number", () => {
    expect(parseNic("199012300456", today)).toMatchObject({ valid: true, format: "new", birthDate: "1990-05-02", gender: "male" });
  });

  it("counts February as 29 days, and rejects 29 February in a non-leap year", () => {
    expect(parseNic("200006000123", today)).toMatchObject({ valid: true, birthDate: "2000-02-29" });
    expect(parseNic("199006000123", today).valid).toBe(false);
    expect(parseNic("199006100123", today)).toMatchObject({ valid: true, birthDate: "1990-03-01" });
  });

  it("rejects malformed numbers", () => {
    expect(parseNic("12345", today).valid).toBe(false);
    expect(parseNic("85340093V", today).valid).toBe(false);
    expect(parseNic("198536700937", today).valid).toBe(false); // day 367
    expect(parseNic("203012300456", today).valid).toBe(false); // born in the future
  });

  it("matches the same person across old and new cards", () => {
    expect(canonicalNic(" 853400937v ")).toBe(canonicalNic("198534000937"));
    expect(canonicalNic("not a nic")).toBeNull();
  });
});
