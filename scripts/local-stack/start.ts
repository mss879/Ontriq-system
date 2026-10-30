/**
 * Local Supabase-compatible stack without Docker:
 *   Postgres (Homebrew) + PostgREST + a small Supabase Auth emulator + gateway.
 *
 *   npm run stack:local            start (applies new migrations)
 *   npm run stack:local -- --reset wipe and rebuild the database
 *
 * Writes .env.local.stack with the URL and keys to put in .env.local.
 * Database files live in ~/.ontriq/local-stack (override with STACK_DIR).
 * Development only: never point production at this.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeySet, Signer, type KeySet } from "./jwt";
import { startAuthEmulator } from "./auth-emulator";

// Data lives outside the project: the dev server's file watcher would treat
// every Postgres write as a code change and reload the page in a loop.
const DIR = path.resolve(process.env.STACK_DIR ?? path.join(os.homedir(), ".ontriq", "local-stack"));
const PGDATA = path.join(DIR, "pgdata");
const PG_PORT = Number(process.env.STACK_PG_PORT ?? 55433);
const REST_PORT = Number(process.env.STACK_REST_PORT ?? 54322);
const GATEWAY_PORT = Number(process.env.STACK_PORT ?? 54321);
const PUBLIC_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const ADMIN_URL = `postgresql://postgres@127.0.0.1:${PG_PORT}/ontriq`;
const env = { ...process.env, LC_ALL: "C", LANG: "C", PGOPTIONS: "-c client_min_messages=warning" };

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env });
const psqlFile = (file: string) => run("psql", [ADMIN_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-o", "/dev/null", "-f", file]);
const pgRunning = () => {
  try {
    execFileSync("pg_ctl", ["-D", PGDATA, "status"], { stdio: "ignore", env });
    return true;
  } catch {
    return false;
  }
};

if (process.argv.includes("--reset") && existsSync(DIR)) {
  if (pgRunning()) run("pg_ctl", ["-D", PGDATA, "stop", "-m", "fast"]);
  rmSync(DIR, { recursive: true, force: true });
  console.info("• reset local stack");
}
mkdirSync(DIR, { recursive: true });

// Signing keys (stable across restarts so sessions survive).
const keysPath = path.join(DIR, "keys.json");
const keys: KeySet = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : generateKeySet();
writeFileSync(keysPath, JSON.stringify(keys, null, 2));
const signer = new Signer(keys);
writeFileSync(path.join(DIR, "jwks.json"), JSON.stringify(signer.jwks()));

// Postgres
const fresh = !existsSync(PGDATA);
if (fresh) {
  run("initdb", ["-D", PGDATA, "-U", "postgres", "--auth=trust", "--no-instructions", "--encoding=UTF8", "--locale=C"]);
}
if (!pgRunning()) {
  run("pg_ctl", ["-D", PGDATA, "-o", `-p ${PG_PORT} -k ${DIR} -c listen_addresses=127.0.0.1`, "-l", path.join(DIR, "postgres.log"), "start", "-w"]);
}
if (fresh) {
  run("psql", [`postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`, "-X", "-q", "-c", "create database ontriq"]);
  psqlFile("supabase/tests/shim/supabase-shim.sql");
  console.info("• created database with Supabase shim");
}

// Migrations (apply any not yet applied, in order) and seed on first run.
const appliedPath = path.join(DIR, "applied.json");
const applied = new Set<string>(existsSync(appliedPath) ? JSON.parse(readFileSync(appliedPath, "utf8")) : []);
for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  psqlFile(path.join("supabase/migrations", file));
  applied.add(file);
  console.info(`• migrated ${file}`);
}
writeFileSync(appliedPath, JSON.stringify([...applied].sort(), null, 2));
if (fresh && existsSync("supabase/seed.sql")) {
  psqlFile("supabase/seed.sql");
  console.info("• seeded sample data");
}

// PostgREST
const confPath = path.join(DIR, "postgrest.conf");
writeFileSync(
  confPath,
  [
    `db-uri = "postgres://authenticator:authenticator@127.0.0.1:${PG_PORT}/ontriq"`,
    `db-schemas = "public"`,
    `db-anon-role = "anon"`,
    `db-extra-search-path = "public, extensions"`,
    `jwt-secret = "@${path.join(DIR, "jwks.json")}"`,
    `server-host = "127.0.0.1"`,
    `server-port = ${REST_PORT}`,
    `log-level = "warn"`,
  ].join("\n"),
);
const postgrest: ChildProcess = spawn("postgrest", [confPath], { stdio: ["ignore", "inherit", "inherit"] });

// Auth emulator + gateway
const { server, pool } = startAuthEmulator({ port: GATEWAY_PORT, postgrestPort: REST_PORT, databaseUrl: ADMIN_URL, signer, publicUrl: PUBLIC_URL, dataDir: DIR });

// Candidate link secret (stable across restarts so emailed links keep working).
const candidateSecretPath = path.join(DIR, "candidate-secret.txt");
if (!existsSync(candidateSecretPath)) writeFileSync(candidateSecretPath, randomBytes(32).toString("base64url"), { mode: 0o600 });
const candidateSecret = readFileSync(candidateSecretPath, "utf8").trim();

const tenYears = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
const anonKey = signer.sign({ iss: "ontriq-local", role: "anon", iat: Math.floor(Date.now() / 1000), exp: tenYears });
const serviceKey = signer.sign({ iss: "ontriq-local", role: "service_role", iat: Math.floor(Date.now() / 1000), exp: tenYears });
const envFile = [
  "# Generated by npm run stack:local — local development only",
  `NEXT_PUBLIC_SUPABASE_URL=${PUBLIC_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${anonKey}`,
  `SUPABASE_SECRET_KEY=${serviceKey}`,
  `SUPABASE_DB_URL=${ADMIN_URL}`,
  "APP_ORIGIN=http://localhost:3000",
  `CANDIDATE_SESSION_SECRET=${candidateSecret}`,
  "# No Realtime server locally: live refresh is switched off",
  "NEXT_PUBLIC_REALTIME=off",
  "",
].join("\n");
writeFileSync(path.join(DIR, "env.local"), envFile);
writeFileSync(".env.local.stack", envFile);

console.info(`
Local stack running
  Gateway (Supabase URL)  ${PUBLIC_URL}
  PostgREST               http://127.0.0.1:${REST_PORT}
  Postgres                ${ADMIN_URL}
Environment written to .env.local.stack (copy into .env.local). Data: ${DIR}
Press Ctrl+C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  postgrest.kill("SIGTERM");
  server.close();
  await pool.end().catch(() => undefined);
  try {
    run("pg_ctl", ["-D", PGDATA, "stop", "-m", "fast"]);
  } catch {
    // already stopped
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
