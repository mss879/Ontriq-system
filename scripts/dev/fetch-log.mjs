/**
 * Preload for `next start`: one line per Supabase call, for nav-timing.ts to
 * count database calls per click. Set FETCH_LOG to the file. Timing runs only;
 * the `next-start-timing` launch config turns it on.
 */
import { appendFileSync } from "node:fs";

const file = process.env.FETCH_LOG;
const realFetch = globalThis.fetch;

if (file && realFetch) {
  globalThis.fetch = async function loggedFetch(input, init) {
    const url = String(input?.url ?? input);
    if (!/\/(rest|auth|storage)\/v1\//.test(url)) return realFetch.call(this, input, init);
    const started = performance.now();
    const response = await realFetch.call(this, input, init);
    const { pathname, search } = new URL(url);
    appendFileSync(file, `${Math.round(performance.now() - started)} ${init?.method ?? "GET"} ${pathname}${search.slice(0, 90)}\n`);
    return response;
  };
}
