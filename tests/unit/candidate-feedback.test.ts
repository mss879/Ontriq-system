import { describe, expect, it } from "vitest";
import { candidateFeedback } from "@/jobs/handlers/ai-jobs";

describe("candidate upload feedback", () => {
  it("uses fixed wording, never the model's text", () => {
    expect(candidateFeedback({ readable: true, matches_expected: false, quality_issues: [] })).toMatch(/doesn't look like the document this slot asks for/);
    expect(candidateFeedback({ readable: true, matches_expected: true, quality_issues: ["blurred", "glare", "made_up"] })).toBe(
      "We couldn't read this file clearly (it looks blurred, there is glare on it). Please upload a sharper photo or scan.",
    );
    expect(candidateFeedback({ readable: false, matches_expected: true, quality_issues: [] })).toBe("We couldn't read this file clearly. Please upload a sharper photo or scan.");
    expect(candidateFeedback({ readable: true, matches_expected: true, quality_issues: [] })).toBeNull();
  });
});
