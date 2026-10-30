import type { CandidateDict } from "@/domain/candidate/i18n";

/**
 * Candidate actions return either a key of the page's error strings or a
 * readable English message from the database; show the right one.
 */
export function errorText(t: CandidateDict, error: string): string {
  if (error === "session") return t.expired.session;
  const known = (t.errors as Record<string, string>)[error];
  return known ?? error;
}
