/**
 * The live site's host (Netlify) refuses any Server Action request whose body
 * contains "_response", in any case (see src/lib/wire.ts). A local server
 * accepts it, so the browser scripts watch for it: every action request the
 * live site would refuse is recorded with the page it came from.
 */
import type { BrowserContext } from "@playwright/test";

const REFUSED = /.{0,40}_response.{0,20}/i;

/** Requests that would get a 403 on the live site. */
export const refusedOnLive: string[] = [];

export function watchServerActions(ctx: BrowserContext) {
  ctx.on("request", (r) => {
    if (r.method() !== "POST" || !r.headers()["next-action"]) return;
    const hit = r.postDataBuffer()?.toString("utf8").match(REFUSED);
    if (hit) refusedOnLive.push(`${new URL(r.url()).pathname} · …${hit[0]}…`);
  });
}

/** Print what was caught and fail the run. Call once at the end. */
export function reportRefused() {
  if (!refusedOnLive.length) return;
  console.log(`\nFAIL  ${refusedOnLive.length} action request(s) would be refused on the live site (body contains "_response"; pack it with toWire):`);
  for (const line of refusedOnLive) console.log(`      ${line}`);
  process.exitCode = 1;
}
