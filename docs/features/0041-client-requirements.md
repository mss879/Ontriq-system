# Client requirements

`0041_client_requirements.sql`. Closes the rest of the [requirements audit](../verification/requirements-audit-2026-10-30.md): gaps 4 to 21, and the question about reports with pending checks.

| Gap | What changed |
|---|---|
| 4. One education record, no late checks | **Add a check** on the case page, until verification ends. The same check type can be added again under its own name, such as "Education: A/L". A new kind of check joins the case's billing snapshot at list price. |
| 5. Documents with no route in | Clients can send the Grama Niladhari certificate, police report, transcript and resignation letters. Candidates can send the police report and reference forms. The sanction report and field records stay with Ontriq. |
| 6. Evidence tied to one record | A file can belong to one employer or referee (`documents.record_key`), chosen on upload or on the check page. The report names it. |
| 7. Status updates | Clients get an email and portal alert when a case changes stage or goes on hold. "Get status updates" on the client's page turns it off. |
| 8. Status list | Document Review in Progress, Report Completed, On Hold and Pending Information at any stage now appear. Clients read the spec's own wording by default. |
| 9. Required fields in the report | Referee contact details and the police and Grama Niladhari contacts print. HR contacts stay staff-only, because the spec doesn't list them. |
| 10. Findings | A discrepancy or "unable to verify" needs a finding for the report. The database refuses without one. |
| 11. Evidence in the report | HEIC and WebP photos are converted and embedded. A PDF cut at the page limit says so on its cover, and on the report version. |
| 12. Follow-ups | Requesting a document, or rejecting a candidate's file, alerts the candidate. Reminders continue weekly after day 5 until the link expires, and cover every stage up to verification. A Pre-QC return can carry a message to the client or candidate. |
| 13. Candidate forms | Staff can ask a candidate for rows, such as referees or employers. Using the answer merges the rows into the check. |
| 14. Questions to the client | **Questions for the client** on the case page. The client answers in the portal. Open questions and documents at any stage count as "Action needed". |
| 15. Report recipients | When people are chosen at release, only they can open the report and only they are told. |
| 16. Portal control | Hide or show a case from its details card. Status wording is in Settings, Workflow. |
| 17. Configurable workflow | Settings, Workflow edits status wording and document types. Stages themselves stay fixed. |
| 18. Calls | **Contact log** on the case and check pages, staff only, using the `communications` table. |
| 19. Copy or original | On the Pre-QC checklist. |
| 20. Dates | Dates are typed DD/MM/YYYY and print as DD/MM/YY in check details. "Still here" leaves a period open-ended. |
| 21. Revisions | The client keeps the released report, marked "Being revised", until the new version is released. |
| Question 145 | A manager can send a case to Post-QC with checks still open, with a reason. Those checks print as Pending and the result can't be Clear. |

## Assumptions to confirm with Ontriq

- **Primary and secondary education** are separate Education checks, each with its own record and result.
- **"BGV form"** in the flowchart means the consent form.
- **"Global sanctions screening details"** means the candidate details already on the case.
- **"Reference form"** means staff record the referee's answers and any form they return. Referees don't get their own link.
- **Flowchart steps 2 to 8** can run in any order. The system doesn't force the sequence.
- **Referee contact details print in the report**, which the client receives. The spec's section 8 asks for each check's required fields, but Ontriq may prefer to keep these private. Untick "Printed in the report" on the field to change that.

## Notes

The check type changes are published as new versions, so cases keep the version they started on. `tests/unit/check-types.test.ts` keeps `builtin.ts` in step with 0024, 0040 and 0041.

Tests: `supabase/tests/0041_client_requirements.test.sql` and the unit tests for check types, reports, workflow, candidates and date entry.
