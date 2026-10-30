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

The core is built: both workflows, all stages, all seven check types, Pre-QC and Post-QC, approval and release, the client portal and the audit trail. Many Partial rows restate the same issue, because sections 10 and 11 of the client's document repeat earlier sections. They came down to 21 distinct gaps; the first three are fixed.

Neither client document mentions AI, OCR, Sinhala, translation or autofill. That requirement came from the client directly and is now covered by [Reading documents into checks](../features/0039-document-reading.md). Billing, SLAs, reminders, roles and consent also aren't in these documents, so they were not audited here.

## Fixed since this audit

All three urgent gaps are closed by [Evidence and data entry rules](../features/0040-evidence-and-entry-rules.md). The counts above are as audited and do not include these fixes.

1. **The Global Sanction annexure could be left out silently.** It now goes in without marking, and the case can't reach Post-QC or a draft without it. Requirements 63, 126, 133, 161.
2. **Evidence reached clients too early.** "In the report" no longer opens a file in the portal, sensitive files need a deliberate share, HR contacts stay hidden, and candidate NIC, email and phone are off unless Ontriq turns them on. Requirements 117, 159.
3. **Data Entry needed results that didn't exist yet.** Results and "verified by" are now recorded during verification. Requirement 8.

## Other gaps

4. **One education record per case, and checks can't be added later.** The flowchart lists O/L, A/L and degree or diploma. Education has flat fields rather than repeating rows, and an open case can't gain a check. Requirements 66, 174.
5. **Some documents have no route in.** The client can't provide the Grama Niladhari certificate on a Type 1 case, and neither client nor candidate can provide a police report. Requirements 5, 178, 179.
6. **Evidence can't be tied to one employer or referee.** Documents link to the check, not the record. There is no per-referee contact log, and the `communications` table is unused. Requirements 36, 60.
7. **Clients aren't told about general status changes.** Only four events notify them: documents needed, document rejected, request accepted, report released. Requirements 112, 158.
8. **Status list gaps.** "Document Review in Progress" and "Report Completed" can never appear. "Pending Information" only appears at the documents stage. "Returned for Correction" shows clients "Under review". There is no screen for status wording. Requirements 91, 96, 98, 101, 104.
9. **Some required fields don't print.** Referee contact details and police and GN contacts are staff-only, so they never reach the report. Ontriq should confirm what it wants. Requirement 130.
10. **A discrepancy can print with no explanation.** Report remarks come only from an optional client note. The required discrepancy text is internal and never prints. Requirement 131.
11. **Not all evidence reaches the report.** HEIC and WebP files can't be embedded, and a PDF crossing the 60-page cap is cut with no warning. Requirements 125, 132.
12. **Follow-ups don't reliably reach people.** Document "Request" and "Reject" don't alert the candidate, reminders stop after day 5, and a Pre-QC return is internal only. Requirements 16, 185, 186.
13. **Candidates can't enter reference details in a form.** Referee and employer details can only be free-text answers or staff entry. Requirement 176.
14. **"Information needed" from clients means documents only.** Staff can't put a question to the client, and later-stage requests don't appear in "Needs your action". Requirements 85, 86, 110.
15. **Choosing report recipients doesn't limit access.** Choices are stored, but every portal user at the company can download. Requirement 12.
16. **Ontriq's control over the portal is incomplete.** No screen for client status wording, for hiding a case, or for candidate personal data. Requirement 118.
17. **Workflow isn't configurable.** Check types and fields are. Stages and document categories need a developer. Requirement 165.
18. **No record of calls to candidates.** Only internal notes. Requirement 169.
19. **Copy-or-original isn't on the Pre-QC checklist.** Requirement 183.
20. **Date format.** The spec says DD/MM/YY. The form uses native date inputs and the report prints "12 Mar 2024". A current job or address can't be left open-ended. Requirement 32.
21. **Clients lose the report during a revision.** The current report disappears from the portal while a new version is prepared. Requirement 164.

## Questions for Ontriq

| # | Spec wording | Today | Question |
|---|---|---|---|
| 28 | §4.1 "Primary / Secondary" | One record with a Level dropdown | School levels, or two separate education records? |
| 145 | §9 Amber: "One or more checks remain pending" | Post-QC is blocked until every check closes | May a report be issued while a check is still open? |
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
