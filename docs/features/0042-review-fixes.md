# Fixes from the independent re-audit

`0042_review_fixes.sql`. A second reader went through the client's documents against the code, without seeing the first audit. Each finding was checked, then fixed.

| Finding | Fix |
|---|---|
| No way back from the report stage. An error found at approval couldn't be corrected, and a check sent on pending could never be finished. | **Back to verification** on the report panel. It reopens the checks you tick, keeps pending ones open, and the case goes through Post-QC again. |
| Evidence reached the report only if someone marked each file, and sharing a file with the client took it out. | Evidence types go in by default, and "Goes in the report" is set per type in Settings, Workflow. "Internal only" keeps a file out. The report panel warns when a finished check has no evidence in it. The annexure page limit went from 60 to 300. |
| The client's Activity feed showed other people's file names and rejection reasons, and staff evidence uploads. | The feed lists only the client's own files. |
| Reports with pending checks printed "Verification completed". | That line no longer prints while a check is pending. |
| "Pending review" could be recorded as completed and print as Verified. | The database refuses it. |
| "Sanctions found: Yes" could come out Clear. | The database refuses it. |
| A waived check printed "Not required" with no reason. | The reason prints in the remarks. The waive dialog says so. |
| Report recipients limited the PDF but not the results. | People not chosen see progress only: no results, notes or fields. |
| Returns sent no notification, and a Pre-QC return could reach "Returned for Correction" with no explanation. | Returns notify the client, and a Pre-QC return needs a message. |
| One letter could cover several employers, and deleting a row mislabelled files. | The check page lists rows with no file tied to them. File and contact links follow their row when rows move. |
| No "BGV form" on client-supplied cases, and consent wasn't enforced without a candidate link. | Client-supplied cases get a required "BGV form and signed consent" slot, which can be waived. Candidate-collected cases need consent before Pre-QC. |
| "Documents Pending" came back once every file was accepted. | The status stays on Document Review in Progress until the case goes to Pre-QC. |
| Hidden check types still showed in slots, questions, files and the feed. | They're hidden everywhere in the portal. |
| "The clock stops" on hold wasn't true. | Resuming moves the case's and open checks' due dates on by the time held. |
| New email alerts couldn't be turned off. | Status changes and questions are in the client's email preferences. |

The referee table had nine columns, too many for a page, so groups with more than five columns print as blocks.

Stages stay fixed. Adding a stage needs a developer.

Tests: `supabase/tests/0042_review_fixes.test.sql`, `tests/unit/check-types.test.ts`, `tests/unit/report.test.ts`.
