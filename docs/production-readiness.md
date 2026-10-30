# Production readiness

State on 31 October 2026, after the client requirements audit and an independent re-audit.

**Verdict:** every requirement in the client's two documents is built and tested, and every role works end to end on the hosted database. It is ready for a client demonstration and for UAT once a host is chosen. It is not yet ready for real candidate data: the items under "Before real data" come first, and the AI features have not yet run against a real model.

## What was verified

Numbers come from the final run recorded in `docs/verification/`.

| Check | Result |
|---|---|
| Hosted simulation: every role, end to end, on the live Supabase project | All passed, nothing left behind |
| Browser smoke test on the production build: 11 roles, desktop, phone and dark mode | 135 of 135 page views clean, 6 of 6 interactions passed |
| Demo walkthrough and layout check on hosted data | Clean; all 10 pages fit at 8 widths |
| Unit tests and database suites (permissions, row level security, workflow, money, retention, client visibility) | All passed |
| Type check, lint, production build | Clean |
| Independent security review of the code before the requirements work | 10 findings, all fixed in `0038_security_fixes.sql`, each with a test that replays the attack |
| Independent re-audit against the client's documents | 12 findings, all fixed in `0042_review_fixes.sql` |

The code added after the security review (migrations 0040 to 0042, the portal questions, the contact log and the candidate rows form) has database tests, but has not had a separate security review.

## Before real data

| Item | Who | Notes |
|---|---|---|
| Make the GitHub repository private | Owner | It is public. It holds no keys, but it does hold the project reference, the cost document and how the system works. |
| Remove the demo data | Developer | `npx tsx scripts/seed-demo.ts --env .env.hosted --clean`, then delete `demo-logins.local.md`. Removes the sample clients, cases, sign-ins and prices, and resets numbering. |
| Turn two-step verification on for staff | Super Admin | Settings → Organisation → Security. It is off so the system could be tested and demonstrated. |
| Add `ANTHROPIC_API_KEY` and run the AI live | Developer | No AI feature has run against a real model yet. They work without a key by saying so. Run the document set through it, check accuracy, then refresh the cost document with measured numbers. |
| Deploy to Netlify on a paid plan | Developer | No site exists yet; background jobs need a paid plan. Until then nothing runs jobs automatically (reports, invoices, reminders, AI). Set every variable in `.env.example`. See the [runbook](runbook.md). |
| Verify the sending domain in Resend; set up Notify.lk | Ontriq and developer | Without them, email and SMS are recorded but not sent. |
| Push the 24-hour email link setting | Developer | `otp_expiry` in `supabase/config.toml` is not live yet; links last one hour. |
| Consider Supabase Pro | Ontriq | Daily backups and leaked-password protection, which the advisors flag. Recommended before real personal data. |

## Ontriq to confirm

The working assumptions in [Client requirements](features/0041-client-requirements.md): what "BGV form", "reference form" and "Global sanctions screening details" mean, whether referee contact details should print, and whether steps must run in order. Also: Real prices (package prices are empty once demo data is removed), VAT and SSCL rules, bank details on invoices, the consent form wording, Sinhala and Tamil wording on the candidate page, default retention period, and who may see revenue figures (currently finance roles only: Admin, Client Relations, Super Admin).

## Known limits

- Assistant answers stop at a 22-second budget. The plan's hand-off to a background job was left out because a job can't run under the person's own permissions; it says so and asks for a narrower question.
- Rebalance uses rules, not AI.
- Bulk import creates cases a few at a time, so case references may not follow the file's row order.
- Report PDFs carry the date they were generated.
- Sending a request from the Pre-QC copilot doesn't mark that one item as sent, so the same request can be sent twice.
- Realtime live updates were tested on the hosted project at the database level, not in a browser. Voice recording and dictation have not been tried in a real browser with a microphone.
- Supabase's advisors list signed-in users being able to call server functions, which is by design: each function checks permissions inside. Two tables intentionally have separate staff and client read rules.
