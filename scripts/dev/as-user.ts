/**
 * Development helper: open app pages as a throwaway local user of any role and
 * report what came back, without ever printing a password or session.
 *
 *   npx tsx --env-file=.env.local scripts/dev/as-user.ts --role admin /app/quotes /app/invoices
 *   npx tsx --env-file=.env.local scripts/dev/as-user.ts --role client_admin --client <client-id> /portal/quotes
 *   ... --expect "Quotations" --save out-dir   (fail unless the text appears; save each page's HTML)
 *
 * Local stack only. The user is created once per role/client and reused; its
 * random password lives in ~/.ontiq/local-stack/dev-users.json (mode 600).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cookieHeader } from "./dev-session";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const role = flag("role") ?? "admin";
const clientId = flag("client");
const expect = flag("expect");
const saveDir = flag("save");
const base = (flag("base") ?? "http://localhost:3000").replace(/\/+$/, "");
const paths = args.length ? args : ["/app"];

async function main() {
  const cookie = await cookieHeader(role, clientId);
  let failed = 0;
  for (const p of paths) {
    const res = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
    const html = res.status === 200 ? await res.text() : "";
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    const redirect = res.headers.get("location") ?? (html.includes("NEXT_REDIRECT") ? /NEXT_REDIRECT;[^;]*;([^;"]*)/.exec(html)?.[1] ?? "streamed" : "");
    const errorish = /Application error|Unhandled Runtime Error|digest":"/.test(html);
    const ok = res.status === 200 && !redirect && !errorish && (!expect || html.includes(expect));
    if (!ok) failed++;
    console.log(`${ok ? "ok " : "BAD"} ${res.status} ${p}${title ? ` · ${title}` : ""}${redirect ? ` → ${redirect}` : ""}${errorish ? " · error page" : ""}${expect && !html.includes(expect) ? ` · missing "${expect}"` : ""}`);
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      writeFileSync(path.join(saveDir, `${p.replace(/[^a-z0-9]+/gi, "_")}.html`), html);
    }
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
