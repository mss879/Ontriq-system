# Local development

This Mac has no Docker, so the project ships its own Supabase-compatible stack built from Homebrew Postgres 16 and PostgREST plus a small auth emulator.

## This folder syncs to iCloud

The project lives in `~/Documents`, which iCloud Drive syncs. When the disk gets close to full, macOS removes local copies of files to free space, and that stopped the project running once. Keep at least 20 GB free. `node_modules` and `.next` are marked so iCloud skips them. Deleting either folder drops the mark, so set it again:

```bash
xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules
xattr -w 'com.apple.fileprovider.ignore#P' 1 .next
```

If a build fails on a missing file, check `df -h ~` and `find . -path ./node_modules -prune -o -flags +dataless -print`, which lists files iCloud has taken off the disk.

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

## Showing the system

One command starts the database stack, the built app and the job worker, and keeps the Mac awake:

```bash
npm run demo
```

It runs at `http://localhost:3100`. Keep the terminal window open: Ctrl+C stops everything, and a restart of the Mac stops it too. To start again from clean demo data, which takes about five minutes:

```bash
npm run demo -- --reset
```

The reset wipes the local database, builds the demo data through the app's own rules, writes every role's sign-in to `demo-logins.local.md` and turns two-step sign-in off for the demo. Run `npm run build` first after any code change.

The AI key in `.env.local` is live in this mode, so documents uploaded during a demo are read by the real model. Email and SMS are not sent locally: they stay in the outbox, so a candidate's link has to be opened from the case page.

## What the emulator covers

Password sign-in, refresh, sign-out, email links (`invite`, `recovery`, `magiclink`) through `/auth/v1/verify`, user updates, TOTP factors (enrol, challenge, verify, unenrol) and the admin endpoints the app uses (`generate_link`, users). Tokens are ES256-signed and published at `/auth/v1/.well-known/jwks.json`, and PostgREST verifies the same keys, so row-level security behaves as it does on Supabase.

Storage is emulated too (`scripts/local-stack/storage-emulator.ts`, files under `~/.ontriq/local-stack/storage`): signed upload URLs from the browser, signed downloads, service uploads, exists, info, list, remove and public reads, with each bucket's size limit and allowed file types taken from `storage.buckets`. Realtime is not emulated, so the stack sets `NEXT_PUBLIC_REALTIME=off` and screens skip live refresh locally; reload to see other people's changes.

The hosted project has every migration through 0049. `npm run simulate` checks a backend end to end (see the runbook).

To run everything against the local stack:

```bash
ANTHROPIC_API_KEY= npx tsx scripts/simulate.ts --env .env.local --app http://localhost:3100 --report /tmp/sim.md
```

Leave the AI key empty for these runs, because a drained queue calls the real model. Set `CRON_SECRET` and `JOBS_WORKER_SECRET` in `.env.local`, with any local values, or the scheduler checks fail. On this stack the simulation passes 153 of 155 checks: live updates need the Realtime service, and the password rule is hosted Auth's.

`scripts/dev/final-walkthrough.ts` takes a demo case from draft to release through the real screens, each step signed in as the right role, and saves a screenshot of each. It needs the demo data, from `scripts/seed-demo.ts`. Run `npm run worker:local` after seeding: the seed leaves its notification emails in the queue, and a simulation's jobs wait behind them. They come due over a few minutes, and no worker runs by itself on this stack, so run it again just before a walkthrough, or a report draft waits behind them.

## Two-step verification locally

Scan the QR code with a real authenticator app, or read the current code from the database:

```bash
npx tsx -e "import pg from 'pg'; import { totp } from './scripts/local-stack/totp'; const c = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:55433/ontriq' }); await c.connect(); const r = await c.query(\"select secret from auth.mfa_factors order by created_at desc limit 1\"); console.log(totp(r.rows[0].secret)); await c.end();"
```

## Email locally

Without `RESEND_API_KEY`, emails are recorded in `email_outbox` with status `skipped` and printed by the worker. In development the invite and reset screens show the link directly.

## Database checks

`npm run db:verify` builds a throwaway database, applies every migration, loads the seed and runs `supabase/tests/*.test.sql`. Each test impersonates real users through JWT claims, exactly as PostgREST does.
