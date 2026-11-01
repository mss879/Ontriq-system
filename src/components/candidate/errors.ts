import type { CandidateDict } from "@/domain/candidate/i18n";

/** The database refusals a candidate can meet, in their language. */
const REFUSALS: [RegExp, (t: CandidateDict) => string][] = [
  [/no longer takes uploads/i, (t) => t.documents.closed],
  [/verification is closed/i, (t) => t.expired.closed],
  [/consent has already been accepted/i, (t) => t.errors.consentAccepted],
  [/answer has already been accepted/i, (t) => t.errors.answerAccepted],
  [/answer is too long/i, (t) => t.errors.answerTooLong],
  [/write an answer first/i, (t) => t.errors.answerNeeded],
  [/write a message first/i, (t) => t.errors.messageNeeded],
  [/full name to sign/i, (t) => t.errors.nameNeeded],
  [/upload a pdf or a photo/i, (t) => t.errors.fileType],
  [/files must be under/i, (t) => t.errors.fileSize],
  [/too many uploads/i, (t) => t.errors.tooMany],
];

/**
 * Candidate actions return either a key of the page's error strings or a
 * readable English message from the database; show the right one.
 */
export function errorText(t: CandidateDict, error: string): string {
  if (error === "session") return t.expired.session;
  const known = (t.errors as Record<string, string>)[error];
  if (known) return known;
  return REFUSALS.find(([match]) => match.test(error))?.[1](t) ?? error;
}
