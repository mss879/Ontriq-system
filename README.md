# Ontriq

Background verification CRM for Ontriq (Pvt) Ltd: case intake, document collection, Pre-QC, per-check verification, Post-QC, approved PDF reports, a client portal and a candidate upload link, with AI doing the reading and drafting and people making the decisions.

Built with Next.js 16 (App Router, Cache Components), Supabase (Postgres, Auth, Storage, Realtime), Claude (Anthropic) and Netlify.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation: sign-in with two-step verification, roles and designations, team invitations, settings and branding, audit trail, background jobs, email outbox, cost model | Done |
| 1 | Case engine: check types, packages, request templates, cases and checks, documents, Pre-QC/Post-QC, auto-assignment, search | Done |
| 2 | Client portal and candidate link | Done |
| 3 | Reports with QR verification, quotations, invoicing, payments and slips, statements, branding | Done |
| 4 | AI layer (document reading, extraction, consistency, Pre-QC/Post-QC copilots, outreach, reply capture, narrative), Ask Ontriq and the Super Admin command assistant with voice, performance and nudges | Done (live AI checks wait for `ANTHROPIC_API_KEY`) |
| 5 | Analytics, CSV exports, bulk import, keyboard shortcuts, retention and erasure, security review, browser smoke tests | Done (UAT with Ontriq and measured AI costs still to come) |

The full plan, cost model and feature list live in `docs/`.

**Hosted backend:** Supabase project `ontriq-system` (ref `shceiblsjtvwlnkjhkof`, Tokyo) with invitation-only auth (see `docs/verification/` for which migrations are live). Keys live in the git-ignored `.env.hosted`. The latest end-to-end run is in `docs/verification/`. See `docs/runbook.md` for deploying.

## Quick start (no Docker needed)

```bash
npm install
npm run stack:local            # Postgres + PostgREST + local auth emulator; writes .env.local.stack
cp .env.local.stack .env.local
npm run bootstrap:admin -- --email you@ontriq.lk --name "Your Name"   # prints a one-time setup link
npm run dev
```

Open the printed link, set a password and enrol an authenticator app. See `docs/local-development.md` for details, including how to read the TOTP code locally.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Generates route types, then `tsc` |
| `npm test` | Unit tests (Vitest) |
| `npm run db:verify` | Applies every migration to a throwaway Postgres with a Supabase shim, then runs the SQL access-control tests |
| `npm run db:types:local` | Regenerates `src/lib/supabase/database.types.ts` from the migrations |
| `npm run db:types` | Regenerates types from the linked Supabase project |
| `npm run db:push` | Applies migrations to the linked Supabase project |
| `npm run stack:local` | Local Supabase-compatible stack (add `-- --reset` to rebuild) |
| `npm run bootstrap:admin` | Creates or re-invites the first Super Admin |
| `npm run worker:local` | Runs queued background jobs once (`-- --watch` to keep going) |
| `npm run docs:cost` | Rebuilds the Cost and Feasibility PDF from the cost model |
| `npm run simulate` | End-to-end check against the hosted project (`.env.hosted`): every designation's access, sign-in and MFA, invites, recovery, jobs, storage, live updates, audit. Add `-- --app <url>` to drive a running build too, `-- --report <file>` to write a report. Cleans up after itself |

## Layout

```
src/app/(auth)        sign-in, two-step verification, invitations, password reset
src/app/(staff)/app   staff workspace
src/app/(client)      client portal
src/app/api           health, job tick
src/domain            pure logic shared by app, worker and tests (no Next.js imports)
src/lib               Supabase clients, data access layer, server helpers
src/jobs              background worker (bundled by Netlify; plain Node)
netlify/functions     worker (background) and sweeper (scheduled)
supabase/migrations   one file per feature
supabase/tests        SQL access-control tests and the local Supabase shim
scripts               bootstrap, local stack, worker, cost document
docs                  architecture, runbook, features, cost model
```
