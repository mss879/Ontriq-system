import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/domain/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/app/team", "/app/team"],
    ["/portal?x=1", "/portal?x=1"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/app\u0000", "/"],
    [undefined, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input as string | undefined)).toBe(expected);
  });
});
