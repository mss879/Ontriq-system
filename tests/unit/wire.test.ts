import { describe, expect, it } from "vitest";
import { fromWire, toWire, type Wire } from "@/lib/wire";

describe("wire", () => {
  const values = {
    candidate_name: "Avishka Senevirathne",
    employers: [{ company: "Sri Lanka Ports Authority - Mahapola Ports & Maritime Academy", employer_response: "Dates confirmed.", period: { from: "2022-02-23", to: "2022-08-02" } }],
    state: "awaiting_response",
    category: "verification_response",
    sinhala: "සත්‍යාපන පිළිතුර",
    tamil: "சரிபார்ப்பு பதில்",
    shout: "_RESPONSE",
  };

  it("gives back exactly what was packed", () => {
    expect(fromWire(toWire(values))).toEqual(values);
    expect(fromWire(toWire("awaiting_response"))).toBe("awaiting_response");
    expect(fromWire(toWire(null))).toBeNull();
    expect(fromWire(toWire(undefined))).toBeNull();
  });

  it("never sends the text Netlify refuses", () => {
    const body = JSON.stringify(["74e0b844-c295-4bda-87f2-b9bef1ce2241", toWire(values)]);
    expect(body).not.toMatch(/_response/i);
    expect(toWire(values).wire).not.toContain("_");
  });

  it("packs large values", () => {
    const big = { text: "x_response ".repeat(20_000) };
    expect(fromWire(toWire(big))).toEqual(big);
  });

  it("rejects anything that isn't a packed value", () => {
    expect(fromWire(undefined)).toBeUndefined();
    expect(fromWire(null)).toBeUndefined();
    expect(fromWire({ values: 1 } as unknown as Wire<unknown>)).toBeUndefined();
    expect(fromWire({ wire: "not base64!" })).toBeUndefined();
    expect(fromWire({ wire: btoa("{broken") })).toBeUndefined();
    expect(fromWire({ wire: btoa("\xff\xfe") })).toBeUndefined();
  });
});
