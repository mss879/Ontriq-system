# Deployment runbook

## 1. Supabase

Live project: **ontriq-system**, ref `shceiblsjtvwlnkjhkof`, region Northeast Asia (Tokyo), organisation "Ontriq-system". Linked on 2026-10-29 with migrations 0001–0025 applied.

1. Link the repo and push the schema (no database password needed; the CLI uses a temporary login role):
   ```bash
   supabase link --project-ref shceiblsjtvwlnkjhkof
   npm run db:push
   ```
2. Apply the auth policy kept in `supabase/config.toml` (invitation-only accounts, 10-character passwords, TOTP on). Preview first; only the declared properties change:
   ```bash
   supabase config diff
   supabase config push
   ```
   At go-live, set `site_url` and `additional_redirect_urls` there to the Netlify domain and push again.
3. API keys go in `.env.hosted` (git-ignored) and in Netlify's environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…), `SUPABASE_SECRET_KEY` (sb_secret_…, server only).
4. Check the database after every schema change:
   ```bash
   supabase db advisors --linked      # Supabase security and performance lints
   npm run simulate -- --env .env.hosted
   ```
   The simulation signs in a throwaway person for every designation, checks what each can see and do, exercises invites, recovery, MFA, jobs, storage, live updates and the audit trail, then deletes everything it created. Supabase rate-limits sign-ins per IP, so leave about five minutes between runs.
5. Upgrade to Pro ($25/month) before real candidate data arrives: daily backups, no pausing after a quiet week.
6. **Two-step verification for staff is OFF on the live project while it is being tested** (turned off on 2026-10-29 at the owner's request). Turn it back on before real data arrives: sign in as the Super Admin → Settings → Security → "Require two-step verification for staff". Everyone then enrols an authenticator app at their next sign-in.

## 2. Netlify

1. New site from the Git repository. Netlify detects Next.js and applies its adapter.
2. Plan: a paid plan (Personal or Pro). The free plan stops the site when its monthly credits run out, which a business system cannot accept.
3. Environment variables: everything in `.env.example`. Generate secrets with `openssl rand -base64 32`. `CANDIDATE_SESSION_SECRET` seals candidate link secrets and signs candidate sessions: set it once and never change it, or every link already emailed to a candidate stops working (staff can issue new ones).
4. Deploy. Functions created from `netlify/functions`: `jobs-worker-background` (background, 15 min) and `jobs-sweeper` (every minute).
5. Point the domain (for example `crm.ontriq.lk`) and set `APP_ORIGIN` to it.

## 3. First Super Admin

```bash
APP_ORIGIN=https://crm.ontriq.lk npm run bootstrap:admin -- --email owner@ontriq.lk --name "Full Name"
```

Run it with the production `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment. Open the printed link, set a password, enrol the authenticator.

## 4. Email

Verify the sending domain in Resend, then set `RESEND_API_KEY` and `EMAIL_FROM`.

## 5. Candidate links and the client portal

- Candidate links go out by email (Resend) and, when a phone number is on file, by SMS (Notify.lk: `NOTIFYLK_USER_ID`, `NOTIFYLK_API_KEY`, `NOTIFYLK_SENDER_ID`). Without Notify.lk, SMS rows are recorded and skipped.
- Reminders run hourly from the scheduler (`reminder.candidate`): days 1, 3 and 5 after the link was sent, Monday to Saturday 08:00–18:00 Sri Lanka time, then one alert to the case owner.
- Client users get an email copy of portal notifications (`notify.email`) unless they turn it off under Portal → Settings.
- Before launch, have Ontriq review the Sinhala and Tamil wording (candidate page and emails) and the consent form text.

## 6. AI

- Set `ANTHROPIC_API_KEY` in Netlify. Every model, effort level, token limit and on/off switch is in Settings → AI, with daily and monthly budgets (a "pause" budget stops non-essential AI calls once reached) and the spend so far. The seeded budget pauses the command assistant at $5 a day and $60 a month.
- Without the key nothing breaks: uploads, cases and reports work as before, AI jobs finish as skipped, and the AI panels say AI isn't set up.
- Voice notes for the command assistant: `STT_PROVIDER=openai` and `STT_API_KEY` (optional `STT_MODEL`, `STT_COST_PER_MINUTE`). Without them the mic uses the browser's own dictation where the browser supports it, and recorded notes are not transcribed.
- Everything the AI produces is a suggestion a person accepts or rejects; the assistant's changes are confirm cards.

## 7. Data protection

- Each client's retention period (default 24 months after a case closes) is on the client form. The nightly `retention.purge` job erases the candidate's personal data and files for cases past it; quotes, invoices and payments are kept.
- An erasure request: cancel the case if it is still open, then the Super Admin opens the case and uses Erase personal data (two-step verification required; type the reference to confirm). Every erasure is in the audit trail and `system_events`.
- Two-step verification for staff: Settings → Organisation → Security → "Require two-step verification". It must be on before real candidate data is loaded (it was switched off while the system was being tested).
- Sign-in, password reset, candidate links, report verification, quotation answers and the assistant are rate limited (`rate_limit_check`). Two-step codes are limited by Supabase Auth itself.

## 8. Checks after deploy

- `GET /api/health` returns `ok: true` (database reachable, scheduler ticked in the last 5 minutes).
- `npm run simulate -- --env .env.hosted --app https://crm.ontriq.lk` passes (it also drives the live site's routes and pages).
- Dashboard → Set up Ontriq shows every item done.
- Invite a test staff member and confirm the email arrives.

## Adding a feature later

Each feature is one migration file. If you add one with a lower number than migrations already applied, push with `npm run db:push` (it passes `--include-all`).

Every migration follows the rules in `0025_hardening.sql`, and `supabase/tests/0025_hardening.test.sql` fails CI when one is broken:
- revoke `execute` from `public, anon` on every new function, and from `authenticated` too on trigger functions;
- security definer RPCs that signed-in users may call check the caller inside;
- every foreign key gets an index, every table has row level security.
