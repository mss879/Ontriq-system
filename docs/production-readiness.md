# Production readiness

State on 1 November 2026, after the client requirements audit and the independent audits of the finished build.

**Verdict:** every requirement in the client's two documents is built and tested. The line-by-line result is in [the requirements audit](verification/requirements-audit-2026-10-31.md). Migrations 0044 to 0049 are on the hosted database as of 1 November 2026. They were rehearsed on the hosted data first, but they still need a hosted simulation before UAT. It is not yet ready for real candidate data: the items under "Before real data" come first. The AI features have run against the real models, on invented documents: see `docs/verification/ai-evaluation-2026-10-31.md`.

## What was verified

Numbers come from the final run, recorded in `docs/verification/simulation-2026-11-01-local.md` and the audit below.

| Check | Result |
|---|---|
| Unit tests | 301 of 301 |
| Database suites on a clean Postgres, every migration applied | All passed, including a suite that replays each audit finding |
| Type check, lint, production build | Clean |
| Full simulation against the production build, every role, on the local stack | 153 of 155. The other two need hosted: live updates and the password rule |
| Browser smoke test, 11 roles, desktop, phone and dark mode | 139 of 139 page views clean, 6 of 6 interactions passed |
| Walkthrough of the real screens, each step signed in as the right role | 47 of 47 steps, screenshots reviewed |
| Demo data seeded through the app's own functions on the final rules | 65 cases at every stage, 21 released |
| A released report read page by page | Sinhala and Tamil print correctly |
| AI evaluation on invented documents | 2,158 of 2,166, before this work. See `ai-evaluation-2026-10-31.md` |
| Independent security review before the requirements work | 10 findings, all fixed in `0038_security_fixes.sql` |
| Independent re-audit against the client's documents | 12 findings, all fixed in `0042_review_fixes.sql` |
| Independent audits of the finished build, four readers, then two readers of the fixes | No requirement missing. Every finding fixed in `0049_final_audit_fixes.sql`, or recorded as a decision, with a test that replays it |

The hosted run on record predates migrations 0044 to 0049. The local stack has no live-update service, and its password check is looser than hosted Auth, so those two simulation checks wait for a hosted run.

## Before real data

| Item | Who | Notes |
|---|---|---|
| Run the hosted simulation | Developer | The hosted project has every migration through 0049. `npm run simulate -- --app … --report docs/verification/simulation-<date>.md` proves live updates and the password rule, which the local stack can't. |
| Make the GitHub repository private | Owner | It is public. It holds no keys, but it does hold the project reference, the cost document and how the system works. |
| Remove the demo data | Developer | `npx tsx scripts/seed-demo.ts --env .env.hosted --clean`, then delete `demo-logins.local.md`. Removes the sample clients, cases, sign-ins and prices, and resets numbering. |
| Turn two-step verification on for staff | Super Admin | Settings → Organisation → Security. It is off so the system could be tested and demonstrated. |
| Add `ANTHROPIC_API_KEY` to the host, and test the AI on real documents | Developer and Ontriq | The AI passed on invented documents only. Run 30 to 50 real, consented documents first, especially handwritten Sinhala and Tamil. |
| Deploy to Netlify on a paid plan | Developer | No site exists yet; background jobs need a paid plan. Until then nothing runs jobs automatically (reports, invoices, reminders, AI). Set every variable in `.env.example`. See the [runbook](runbook.md). |
| Verify the sending domain in Resend; set up Notify.lk | Ontriq and developer | Without them, email and SMS are recorded but not sent. |
| Push the 24-hour email link setting | Developer | `otp_expiry` in `supabase/config.toml` is not live yet; links last one hour. |
| Consider Supabase Pro | Ontriq | Daily backups and leaked-password protection, which the advisors flag. Recommended before real personal data. |

## Ontriq to confirm

The working assumptions in [Client requirements](features/0041-client-requirements.md): what "BGV form", "reference form" and "Global sanctions screening details" mean, whether referee contact details should print, whether steps must run in order, whether the police report should hold up Pre-QC, whether clients should see Post-QC returns, and whether the second-person release rule and the 24-month retention default are wanted. Also: Real prices (package prices are empty once demo data is removed), VAT and SSCL rules, bank details on invoices, the consent form wording, Sinhala and Tamil wording on the candidate page, default retention period, and who may see revenue figures (currently finance roles only: Admin, Client Relations, Super Admin).

## Known limits

- Assistant answers stop at a 22-second budget. The plan's hand-off to a background job was left out because a job can't run under the person's own permissions; it says so and asks for a narrower question.
- Rebalance uses rules, not AI.
- Bulk import creates cases a few at a time, so case references may not follow the file's row order.
- Report PDFs carry the date they were generated.
- Sending a request from the Pre-QC copilot doesn't mark that one item as sent, so the same request can be sent twice.
- Realtime live updates were tested on the hosted project at the database level, not in a browser. Voice recording and dictation have not been tried in a real browser with a microphone.
- Supabase's advisors list signed-in users being able to call server functions, which is by design: each function checks permissions inside. Two tables intentionally have separate staff and client read rules.
