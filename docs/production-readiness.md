# Production readiness

State on 30 October 2026, after Phases 0 to 5 and an independent security review.

**Verdict:** the system is built and works end to end for every role on the hosted database. It is ready for a client demonstration and for UAT. It is not yet ready for real candidate data: the items under "Before real data" must be done first, and the AI features have not yet run against a real model.

## What was verified

| Check | Result |
|---|---|
| Hosted simulation: every role, through all five phases, on the live Supabase project | 156 of 156 passed, nothing left behind ([report](verification/simulation-2026-10-30-phases3-5.md)) |
| Browser smoke test on the production build: 11 roles, desktop, phone and dark mode | 135 of 135 page views clean, 6 of 6 interactions passed |
| Unit tests | 151 passed |
| Database suites (permissions, row level security, workflow, money, retention, attacks from the review) | All 14 passed |
| Type check, lint, production build | Clean |
| Supabase advisors | Only expected items (see below) |
| Independent security review of the new code | 10 findings, all fixed in `0038_security_fixes.sql`, each with a test that replays the attack |

The three serious review findings were: AI suggestions readable by any staff member; ownership checks that passed when a case had no owner; and erasure failing for cases with several files. All are fixed and live.

## Before real data

| Item | Who | Notes |
|---|---|---|
| Remove the demo data | Developer | `npx tsx scripts/seed-demo.ts --env .env.hosted --clean`, then delete `demo-logins.local.md`. Removes the sample clients, cases, sign-ins and prices, and resets numbering. |
| Turn two-step verification on for staff | Super Admin | Settings → Organisation → Security. It is off so the system could be tested and demonstrated. |
| Add `ANTHROPIC_API_KEY` and run the AI live | Developer | No AI feature has run against a real model yet. They work without a key by saying so. Run the document set through it, check accuracy, then refresh the cost document with measured numbers. |
| Deploy to Netlify on a paid plan | Developer | No site exists yet; background jobs need a paid plan. Until then nothing runs jobs automatically (reports, invoices, reminders, AI). Set every variable in `.env.example`. See the [runbook](runbook.md). |
| Verify the sending domain in Resend; set up Notify.lk | Ontriq and developer | Without them, email and SMS are recorded but not sent. |
| Push the 24-hour email link setting | Developer | `otp_expiry` in `supabase/config.toml` is not live yet; links last one hour. |
| Consider Supabase Pro | Ontriq | Daily backups and leaked-password protection, which the advisors flag. Recommended before real personal data. |

## Ontriq to confirm

Real prices (package prices are empty once demo data is removed), VAT and SSCL rules, bank details on invoices, the consent form wording, Sinhala and Tamil wording on the candidate page, default retention period, and who may see revenue figures (currently finance roles only: Admin, Client Relations, Super Admin).

## Known limits

- Assistant answers stop at a 22-second budget. The plan's hand-off to a background job was left out because a job can't run under the person's own permissions; it says so and asks for a narrower question.
- Rebalance uses rules, not AI.
- Bulk import creates cases a few at a time, so case references may not follow the file's row order.
- Report PDFs carry the date they were generated.
- Sending a request from the Pre-QC copilot doesn't mark that one item as sent, so the same request can be sent twice.
- Realtime live updates were tested on the hosted project at the database level, not in a browser. Voice recording and dictation have not been tried in a real browser with a microphone.
- Supabase's advisors list signed-in users being able to call server functions, which is by design: each function checks permissions inside. Two tables intentionally have separate staff and client read rules.
