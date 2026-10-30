import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Bearer-secret check for machine endpoints. Fails closed when the secret is unset. */
export function isAuthorizedMachine(request: Request, envName: "CRON_SECRET" | "JOBS_WORKER_SECRET" = "CRON_SECRET"): boolean {
  const secret = process.env[envName];
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
