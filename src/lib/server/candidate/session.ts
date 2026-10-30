import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { CANDIDATE_COOKIE, signCandidateSession, verifyCandidateSession, type CandidateSession } from "@/lib/crypto/candidate-token";
import type { CandidateView } from "@/domain/candidate/view";

/**
 * The candidate's session. Candidates never touch row level security: the
 * server verifies the signed cookie, then every read and write goes through
 * the candidate_* functions (0008) with the service role. Those functions
 * re-check the link on every call, so revoking a link ends the session at once.
 * Only src/lib/server/candidate/* and the /c routes may use this.
 */

export class CandidateSessionError extends Error {
  constructor(public reason: "missing" | "expired") {
    super(reason);
    this.name = "CandidateSessionError";
  }
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/c",
  maxAge,
});

/** Read the session from the cookie (Server Components, actions, route handlers). */
export async function readCandidateSession(): Promise<CandidateSession | null> {
  const store = await cookies();
  return verifyCandidateSession(store.get(CANDIDATE_COOKIE)?.value);
}

/** Start or renew the session. Server Actions and Route Handlers only. */
export async function writeCandidateSession(linkId: string) {
  const store = await cookies();
  const { value, maxAge } = signCandidateSession(linkId);
  store.set(CANDIDATE_COOKIE, value, cookieOptions(maxAge));
}

export async function endCandidateSession() {
  const store = await cookies();
  store.set(CANDIDATE_COOKIE, "", cookieOptions(0));
}

/** For actions: the session's link, renewed; throws when there is none. */
export async function requireCandidateSession(): Promise<CandidateSession> {
  const session = await readCandidateSession();
  if (!session) throw new CandidateSessionError("missing");
  await writeCandidateSession(session.linkId);
  return session;
}

/** The candidate's page data, or null when the link is no longer valid. */
export async function loadCandidateView(linkId: string): Promise<CandidateView | null> {
  const { data, error } = await createAdminClient().rpc("candidate_link_view", { p_link: linkId });
  if (error) {
    if (error.code === "P0002") return null;
    throw new Error(`candidate_link_view: ${error.message}`);
  }
  return data as unknown as CandidateView;
}

/** Is a database error the "link no longer valid" signal? */
export const isLinkExpired = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "P0002" && (error.message ?? "").includes("link_expired");
