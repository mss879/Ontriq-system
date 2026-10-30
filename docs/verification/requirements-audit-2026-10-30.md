# Client requirements audit

Date: 30 October 2026. Compared `Ontriq CRM Requirements.pdf` (11 pages) and `BGV -Outflow.pdf` (the flowchart) with the code, line by line. This was a read of the code, not a live test, and the hosted database was not queried. Line references are to the `ui-refresh` branch and may drift.

## Verdict

The client's documents contain 200 distinct requirements.

| Status | Count |
|---|---|
| Done | 155 |
| Partial | 36 |
| Missing | 3 |
| Unclear, needs Ontriq's answer | 6 |

The core is built: both workflows, all stages, all seven check types, Pre-QC and Post-QC, approval and release, the client portal and the audit trail. Many Partial rows restate the same issue, because sections 10 and 11 of the client's document repeat earlier sections. They came down to 21 distinct gaps, all since fixed.

Neither client document mentions AI, OCR, Sinhala, translation or autofill. That requirement came from the client directly and is now covered by [Reading documents into checks](../features/0039-document-reading.md). Billing, SLAs, reminders, roles and consent also aren't in these documents, so they were not audited here.

## Fixed since this audit

All three urgent gaps are closed by [Evidence and data entry rules](../features/0040-evidence-and-entry-rules.md). The counts above are as audited and do not include these fixes.

1. **The Global Sanction annexure could be left out silently.** It now goes in without marking, and the case can't reach Post-QC or a draft without it. Requirements 63, 126, 133, 161.
2. **Evidence reached clients too early.** "In the report" no longer opens a file in the portal, sensitive files need a deliberate share, HR contacts stay hidden, and candidate NIC, email and phone are off unless Ontriq turns them on. Requirements 117, 159.
3. **Data Entry needed results that didn't exist yet.** Results and "verified by" are now recorded during verification. Requirement 8.

## Other gaps

Gaps 4 to 21 are closed by [Client requirements](../features/0041-client-requirements.md), which lists each one. Stages themselves stay fixed: status wording and document types are configurable, but adding a stage needs a developer.

## Questions for Ontriq

Each has a working assumption in [Client requirements](../features/0041-client-requirements.md). Question 145 is now built.

| # | Spec wording | Today | Question |
|---|---|---|---|
| 28 | §4.1 "Primary / Secondary" | One record with a Level dropdown | School levels, or two separate education records? |
| 145 | §9 Amber: "One or more checks remain pending" | A manager can send a case on with a reason | Is that the rule Ontriq wants? |
| 172 | Flowchart "BGV form" | Consent form only | Is it the consent form, or a separate application form? |
| 177 | Flowchart "Global sanctions screening details" | Nothing is requested | What is collected here? |
| 196 | Flowchart "reference form" | A category and a feedback field | Should referees receive a form? |
| 200 | Flowchart steps 2 to 8 are sequential | Checks run independently | Is the order mandatory? |

## Built, needs setup

- **Email:** Resend key, sender address and a verified domain. Without them, candidate and client emails are skipped.
- **SMS:** Notify.lk keys.
- **Job worker:** report rendering, reminders and all AI run in the background. They need a deployed worker, and no Netlify site exists yet.
- **Candidate links:** `CANDIDATE_SESSION_SECRET`.
- **App address:** `APP_ORIGIN`, for email links and the report QR code.
- **AI:** `ANTHROPIC_API_KEY`.
