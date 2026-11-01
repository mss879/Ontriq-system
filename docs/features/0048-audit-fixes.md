# Requirements check fixes

`0048_audit_fixes.sql`. A third reader checked the build against the client's two documents on 31 October 2026, without seeing the earlier audits. This page lists what changed. The requirement-by-requirement result is in [the audit](../verification/requirements-audit-2026-10-31.md). The owner then asked for every partial item to be built rather than documented, so the open questions below are answered by covering either reading.

## Confidentiality (spec 6.4)

| Finding | Fix |
|---|---|
| Staff "Instructions for the team" reached the portal as "Your instructions". | `cases.internal_notes` holds what staff write. `instructions` is what the client asked for. Existing text from non-portal cases moved across. A client can't write a staff note. |
| A client user could read Ontriq's internal notes on their company, its billing policy and AI settings through the API. | `clients` and `client_settings` are staff-only. Client users read `portal_client_profile()`, which returns only name, contact details, document template and portal options. |
| A discrepancy could be inferred before release: it listed as "Completed" but had no line in the Activity feed. | Every finished check writes the same feed line. Old events were updated to match. |
| A client admin could move a colleague to another company through the API. | `memberships_guard` refuses it. |
| Clients could read which staff member matched a combined file. | `requirement_files` is staff-only. |
| A check hidden from a client still sent notifications. | `case_events_notify_client` stays quiet for hidden checks. |

## Candidate answers (spec 2.2)

| Finding | Fix |
|---|---|
| A choice, yes/no or multiple-choice answer could never be used. | The page sends the option's value. `src/domain/candidate/answers.ts` also reads answers stored the old way. |
| A date range was turned into nothing, wiped what staff had entered, and was marked accepted. | It's sent as a range, with "Still here". An empty answer is refused instead of saved. |
| Two employers from a candidate became one. | `mergeRows` matches on the group's first text field in schema order. Postgres doesn't keep key order. |

## Workflow (spec 3, 5, 10)

| Finding | Fix |
|---|---|
| A held case could be released or sent back through the API. | `move_case` refuses any move while on hold. |
| Checks could change after verification ended. | `set_check_state` locks them from Post-QC, and a finished check changes only during verification. |
| `save_check_values` took the app's word that details were complete. | `check_values_complete` counts what is missing, in the database. |
| Pre-QC could approve with a rejected file, or with items unticked and no reason. | Both refused. An unticked item needs a reason in the remarks. |
| Post-QC could only return to verification. | It can return to Data Entry, which reads Returned for Correction. |
| Only a manager could send a case back to documents. | The case owner can too. |
| Internal returns told the client "returned for correction". | Only returns the client can act on notify them. The status itself still shows. |
| A failed amendment request was silent. | The reviewer sees a warning. |
| QC decisions weren't in the audit log, and it couldn't be searched by case. | `qc_reviews` is audited, more areas can be filtered, and a case reference finds everything on that case. Candidates are named as the actor. Erasure blanks the new rows. |

## Evidence and the report (spec 4, 7, 8)

| Finding | Fix |
|---|---|
| One letter could verify several employers. | A check with `per_record` on a document needs a file tied to each row before it can be verified. A confirmed combined file or a manager's waiver excuses it. |
| Replies from sources went under "Other", which stayed out of the report. | New `verification_response` document type, in the report by default, with a slot on each check that contacts a source. |
| Copy or original was one tick for the whole case. | `documents.original_kind`, set per file. The Pre-QC dialog counts files not yet marked, and the AI's photocopy reading shows as a hint. |
| The sanction report's format survived only as copied pages. | The original file is also attached inside the PDF, unchanged. |
| A protected PDF stopped the report. | It's kept as an attachment, the cover says so, and the report panel warns. |
| File fingerprints came from the browser. | The worker hashes what is in storage, prints that, and flags a file that changed since upload. |
| Evidence past 300 pages or 150 MB was left out. | It continues in further PDFs of the same report (`report_versions.parts`), with the same access rules. Erasure removes them. |
| Evidence could be taken out of the report with only a warning. | `submit_report` refuses. A document type switched off in Settings isn't owed. |
| A permanent false warning for the sanction check. | The fixed annexure isn't counted as missing evidence. |
| "2,015" printed for a year. | Numbers print plainly. |
| A purged report still offered Download. | The portal and archive say it was removed under the retention policy. |

## Open questions, now covered either way

| Question | What the build does |
|---|---|
| Primary / Secondary education | Primary and Secondary are levels, and a second Education check can be added when the case is created, by staff or the client. |
| "BGV form" | Client-supplied cases keep the form slot. Candidate-collected cases get a BGV form on the candidate's page: one card per check, filled from what each check lets a candidate fill in. Staff press Use answer. |
| "Global sanctions screening details" | The check now holds the name, date of birth, NIC or passport and nationality to screen, and candidates can supply them. |
| "Reference form" | Each referee has "Details confirmed" and "Spoken to on". |
| Steps 2 to 8 in order | Settings, Workflow has a switch. Off by default. |

## Configuration (spec 6.2, 10)

Settings, Workflow now edits what staff read as well as clients and candidates, adds statuses of Ontriq's own (set on a case, cleared when it moves stage), edits both QC checklists, and sets the check order. Staff lists show the full status. Stages stay fixed.

## Other

- Type 2 needs an email or phone number in the wizard and bulk import. The case page warns until the candidate has been contacted, and the formal email lists the documents needed.
- Clients hear about Document Review, Partially Completed and Report Completed, not only stage moves.
- Contacts marked "Receives verification reports" get a notice on release, unless recipients were chosen. Nothing personal goes in the email.
- The report names the client's address.
- A check warns when its NIC isn't the candidate's, or doesn't match the date of birth.
- The check type builder no longer offers options that did nothing, and won't publish a sanction check without its result field or annexure.
- The portal shows the status beside "Action needed".

## Keep

- `pdf-lib`'s `EncryptedPDFError` fails `instanceof` because of how the library is built. `assemble.ts` matches the message.
- `cases_status_notify` compares with `is not distinct from`. A plain `=` on a null manual status lets every status change through.
- `case_unreported_evidence` must count files uploaded to the whole case, as `sync_requirement_counts` does. They fill the slot.

Tests: `supabase/tests/0048_audit_fixes.test.sql` replays each finding. `tests/unit/candidate-answers.test.ts`, `report.test.ts`, `workflow.test.ts`, `nic.test.ts` and `check-types.test.ts` cover the logic. `scripts/dev/audit-walkthrough.ts` drives the screens.
