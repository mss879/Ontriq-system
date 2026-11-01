import { describe, expect, it } from "vitest";
import { generatePassword, passwordSchema } from "@/domain/password";

describe("passwords", () => {
  it("makes passwords that always pass the rules", () => {
    const made = Array.from({ length: 500 }, generatePassword);
    for (const password of made) {
      expect(passwordSchema.safeParse(password).success).toBe(true);
      expect(password).toHaveLength(14);
      expect(password).not.toMatch(/[01OIl]/);
    }
    expect(new Set(made).size).toBe(500);
  });

  it("refuses short or simple passwords", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlylettershere").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890123").success).toBe(false);
  });
});
