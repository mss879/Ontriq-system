/**
 * After `next build`: every staff and portal route must carry the static-shell
 * flag in its prefetch tree. Without it each link prefetch runs on a function,
 * which is what made menu clicks wait, so a session read that slips above
 * `prefetch()` in src/lib/server/viewer.ts fails here instead of on live.
 *
 *   npx tsx scripts/dev/check-static-shells.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// PrefetchHint.ShouldAttemptStaticShell in next/dist/shared/lib/app-router-types.
const STATIC_SHELL = 16384;
const appDir = path.resolve(".next/server/app");

function trees(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) return [];
    const tree = path.join(full, "_tree.segment.rsc");
    return [...(name.endsWith(".segments") && existsSync(tree) ? [tree] : []), ...(name.endsWith(".segments") ? [] : trees(full))];
  });
}

const routes = ["app", "portal"].flatMap((area) => {
  const own = path.join(appDir, `${area}.segments`, "_tree.segment.rsc");
  return [...(existsSync(own) ? [own] : []), ...trees(path.join(appDir, area))];
});

const missing = routes.filter((file) => {
  const hints = [...readFileSync(file, "utf8").matchAll(/"h":(\d+)/g)].map((m) => Number(m[1]));
  return !hints.length || !hints.every((h) => h & STATIC_SHELL);
});

const label = (file: string) => `/${path.relative(appDir, file).replace(/\.segments.*$/, "")}`;
console.info(`${routes.length - missing.length} of ${routes.length} staff and portal routes have a static shell`);
for (const file of missing) console.info(`  no static shell: ${label(file)}`);
if (!routes.length || missing.length) process.exitCode = 1;
