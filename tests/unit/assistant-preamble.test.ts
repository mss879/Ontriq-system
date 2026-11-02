import { describe, expect, it } from "vitest";
import { preambleFilter } from "@/lib/ai/assistant/preamble";

describe("preambleFilter", () => {
  it("drops planning written before a tool call", () => {
    const f = preambleFilter();
    expect(f.text("Run the report per month.")).toBe("");
    f.toolCall();
    expect(f.end()).toBe("");
  });

  it("releases a short reply when it ends", () => {
    const f = preambleFilter();
    expect(f.text("All ")).toBe("");
    expect(f.text("done.")).toBe("");
    expect(f.end()).toBe("All done.");
  });

  it("streams a long reply once it reaches the limit", () => {
    const f = preambleFilter(10);
    expect(f.text("12345")).toBe("");
    expect(f.text("67890")).toBe("1234567890");
    expect(f.text(" more")).toBe(" more");
    expect(f.end()).toBe("");
  });
});
