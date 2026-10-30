# Security review fixes

Migration: `supabase/migrations/0038_security_fixes.sql`  
Depends on: 0006, 0007, 0012, 0013, 0014, 0015, 0017, 0018, 0019, 0029, 0030, 0035, 0037

Found by an independent review of Phases 3–5; each fix has a test that replays the attack (`supabase/tests/0038_security.test.sql`).

- **AI suggestions follow case access.** `ai_suggestion_visible(entity_type, entity_id)` limits suggestions to staff who can see the case, check or document they are about (org briefings to managers with `staff.performance.read` or `analytics.read`, invoice and slip readings to finance). Before, any staff member could read every suggestion, including details extracted from candidates' documents.
- **"No owner" never passes an ownership test.** `set_check_state`, `submit_report`, `request_report_draft` and `set_check_remarks` compared `assigned_to = auth.uid()` inside a NOT, which let the check through when nobody owned the case or check. They now use `coalesce(…, false)`.
- **Report remarks:** an officer may word only the checks (or case) they own; Post-QC and stage managers may word any. Not while the case is on hold.
- **AI readings and OCR text are staff only.** Clients could read the AI's tamper notes about files they could see.
- **Generated PDFs by kind:** quotes to people who read quotes, invoices, receipts, credit notes and statements to finance, case documents to staff on the case.
- **Real upload sizes:** when an upload finishes, its size is read from Storage, and files over 25 MB are refused. Files over 10 MB are never sent to the AI (`MAX_AI_FILE_BYTES`).
- **AI cost guards:** at most 40 AI document readings per case a day (`ai.case_cap` in `system_events` when reached); pause budgets for `document.classify` ($5 a day, $80 a month) and `document.extract` ($15 a day, $250 a month), editable in Settings → AI; on-demand outreach drafts, reply capture, re-runs and push drafts are limited to 20 per person per 10 minutes; statement PDFs to 30 per person per 10 minutes.
- **Erasure:** files get unique tombstone paths (erasing a case with several files used to fail), copies of the candidate's name in notifications, notification emails, pushes and assistant conversations are scrubbed, and queued verifier replies are dropped. The nightly job records a `retention.failed` event and fails when an erasure fails.
- **Model output:** candidates see fixed wording about a problem upload (not the model's text); automatic pushes send the model case references, never candidate names.
- **CSV:** the invoice and statement exports use the formula-safe CSV writer.
