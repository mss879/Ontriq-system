# Local development

This Mac has no Docker, so the project ships its own Supabase-compatible stack built from Homebrew Postgres 16 and PostgREST plus a small auth emulator.

## Start

```bash
npm run stack:local            # first run creates ~/.ontriq/local-stack and applies every migration
cp .env.local.stack .env.local
npm run bootstrap:admin -- --email you@ontriq.lk --name "Your Name"
npm run dev
```

- Gateway (acts as the Supabase URL): `http://127.0.0.1:54321`
- PostgREST: `http://127.0.0.1:54322`
- Postgres: `postgresql://postgres@127.0.0.1:55433/ontriq`
- Data lives in `~/.ontriq/local-stack` (outside the repo, so the dev server's file watcher ignores it). Override with `STACK_DIR`.
- New migration files are applied automatically on the next `npm run stack:local`. Use `-- --reset` to start from scratch.

## What the emulator covers

Password sign-in, refresh, sign-out, email links (`invite`, `recovery`, `magiclink`) through `/auth/v1/verify`, user updates, TOTP factors (enrol, challenge, verify, unenrol) and the admin endpoints the app uses (`generate_link`, users). Tokens are ES256-signed and published at `/auth/v1/.well-known/jwks.json`, and PostgREST verifies the same keys, so row-level security behaves as it does on Supabase.

Storage is emulated too (`scripts/local-stack/storage-emulator.ts`, files under `~/.ontriq/local-stack/storage`): signed upload URLs from the browser, signed downloads, service uploads, exists, info, list, remove and public reads, with each bucket's size limit and allowed file types taken from `storage.buckets`. Realtime is not emulated, so the stack sets `NEXT_PUBLIC_REALTIME=off` and screens skip live refresh locally; reload to see other people's changes.

The hosted project has everything; `npm run simulate` checks it end to end (see the runbook).

## Two-step verification locally

Scan the QR code with a real authenticator app, or read the current code from the database:

```bash
npx tsx -e "import pg from 'pg'; import { totp } from './scripts/local-stack/totp'; const c = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:55433/ontriq' }); await c.connect(); const r = await c.query(\"select secret from auth.mfa_factors order by created_at desc limit 1\"); console.log(totp(r.rows[0].secret)); await c.end();"
```

## Email locally

Without `RESEND_API_KEY`, emails are recorded in `email_outbox` with status `skipped` and printed by the worker. In development the invite and reset screens show the link directly.

## Database checks

`npm run db:verify` builds a throwaway database, applies every migration, loads the seed and runs `supabase/tests/*.test.sql`. Each test impersonates real users through JWT claims, exactly as PostgREST does.
