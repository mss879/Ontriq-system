/**
 * Candidate link secrets and the candidate's session cookie.
 *
 * The URL carries a random 256-bit secret. The database stores its SHA-256
 * (lookup) and an AES-256-GCM copy sealed with a key derived from
 * CANDIDATE_SESSION_SECRET (so staff can copy or re-send the link; a database
 * leak alone reveals no working links). Opening the link swaps the secret for
 * a short HMAC-signed cookie so the secret leaves the address bar.
 *
 * Plain Node (no next/*, no server-only): the reminder job uses it too.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CANDIDATE_COOKIE = "ontriq_candidate";
/** Idle lifetime of the candidate's session; every action renews it. */
export const CANDIDATE_SESSION_MINUTES = 60;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

function masterSecret(): string {
  const s = process.env.CANDIDATE_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("CANDIDATE_SESSION_SECRET is not set (any long random string).");
  return s;
}

const derive = (purpose: string) => createHash("sha256").update(`ontriq:candidate:${purpose}:`).update(masterSecret()).digest();

export function isCandidateSecretConfigured(): boolean {
  return Boolean(process.env.CANDIDATE_SESSION_SECRET && process.env.CANDIDATE_SESSION_SECRET.length >= 16);
}

/** A new secret for a link: 32 random bytes, base64url (43 characters). */
export function newLinkSecret(): string {
  return randomBytes(32).toString("base64url");
}

export const looksLikeLinkSecret = (value: string) => SECRET_RE.test(value);

export function hashLinkSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function sealLinkSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("seal"), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openLinkSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, body, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", derive("seal"), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const secret = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    return looksLikeLinkSecret(secret) ? secret : null;
  } catch {
    return null;
  }
}

export function candidateLinkUrl(origin: string, secret: string): string {
  return `${origin.replace(/\/+$/, "")}/c/${secret}`;
}

export type CandidateSession = { linkId: string; exp: number };

export function signCandidateSession(linkId: string, now = Date.now()): { value: string; maxAge: number } {
  const payload: CandidateSession = { linkId, exp: Math.floor(now / 1000) + CANDIDATE_SESSION_MINUTES * 60 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", derive("session")).update(body).digest("base64url");
  return { value: `${body}.${mac}`, maxAge: CANDIDATE_SESSION_MINUTES * 60 };
}

export function verifyCandidateSession(value: string | null | undefined, now = Date.now()): CandidateSession | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  let good: Buffer;
  try {
    good = createHmac("sha256", derive("session")).update(body).digest();
  } catch {
    return null;
  }
  const given = Buffer.from(mac, "base64url");
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CandidateSession;
    if (typeof p.linkId !== "string" || !/^[0-9a-f-]{36}$/.test(p.linkId) || typeof p.exp !== "number") return null;
    return p.exp > now / 1000 ? p : null;
  } catch {
    return null;
  }
}
