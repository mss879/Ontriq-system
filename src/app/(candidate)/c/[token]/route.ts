import { connection, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeCandidateSession } from "@/lib/server/candidate/session";
import { clientIp, rateLimit } from "@/lib/server/request-meta";
import { hashLinkSecret, isCandidateSecretConfigured, looksLikeLinkSecret } from "@/lib/crypto/candidate-token";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

/**
 * The link in the candidate's email or SMS. Swaps the secret in the URL for a
 * short signed cookie (src/lib/server/candidate/session.ts) and sends the
 * browser on to /c/session, so the secret leaves the address bar and history.
 * Visits are counted and rate limited per address.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[token]">) {
  await connection();
  const { token } = await ctx.params;
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), { status: 303, headers: HEADERS });

  if (!(await rateLimit(`candidate-open:${await clientIp()}`, 600, 30))) return go("/c/expired?reason=busy");
  if (!looksLikeLinkSecret(token)) return go("/c/expired?reason=unknown");
  if (!isCandidateSecretConfigured()) return go("/c/expired?reason=unavailable");

  const { data, error } = await createAdminClient().rpc("candidate_open_link", { p_token_hash: hashLinkSecret(token) });
  const result = data as { ok: boolean; reason?: string; link_id?: string } | null;
  if (error || !result) return go("/c/expired?reason=unavailable");
  if (!result.ok || !result.link_id) {
    const reason = ["revoked", "expired", "closed"].includes(result.reason ?? "") ? result.reason : "unknown";
    return go(`/c/expired?reason=${reason}`);
  }

  await writeCandidateSession(result.link_id);
  return go("/c/session");
}
