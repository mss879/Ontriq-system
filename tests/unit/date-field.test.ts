import { describe, expect, it } from "vitest";
import { maskDate, parseDate } from "@/components/forms/date-field";

describe("date entry", () => {
  it("formats digits as DD/MM/YYYY while typing", () => {
    expect(maskDate("1")).toBe("1");
    expect(maskDate("1203")).toBe("12/03");
    expect(maskDate("12032024")).toBe("12/03/2024");
    expect(maskDate("12/03/2024999")).toBe("12/03/2024");
  });

  it("reads full and two-digit years", () => {
    expect(parseDate("12/03/2024", false)).toBe("2024-03-12");
    expect(parseDate("12/03/24", false)).toBeNull();
    expect(parseDate("12/03/24", true)).toBe("2024-03-12");
    expect(parseDate("12/03/85", true)).toBe("1985-03-12");
  });

  it("refuses dates that don't exist", () => {
    expect(parseDate("31/02/2024", true)).toBeNull();
    expect(parseDate("12/13/2024", true)).toBeNull();
    expect(parseDate("12/03", true)).toBeNull();
  });
});
