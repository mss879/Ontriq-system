# Evidence and data entry rules

`0040_evidence_and_entry_rules.sql`. Fixes the three urgent gaps from the [requirements audit](../verification/requirements-audit-2026-10-30.md).

## The Global Sanction annexure

Spec 4.7, 7 and 8 say the report is attached as a separate annexure in its original format.

- **It needs no marking.** The report picks up the file in the check type's `fixed_annexure` category whatever its visibility. The file shows "Always in the report" on the case. A waived check has no annexure.
- **It can't be left out.** A check marked verified or discrepancy needs the file before the case can go to Post-QC and again before a draft can be made. The check is named on the case and in the error. A waived document slot doesn't excuse it. "Unable to verify" needs no file, because there's no report to attach.
- **It can't be lost in the PDF.** The evidence size limits no longer apply to it. If the file can't be embedded (a locked PDF, HEIC, WebP), the draft fails and says what to upload. Other evidence still gets a cover page with a note.
- **People can see it worked.** Each report version lists what was attached unchanged.

`case_missing_annexures()` is the one rule. It's security definer so the answer is right for staff who can't open sensitive evidence.

## What clients see

Spec 6.4 says sensitive evidence and restricted personal information must not automatically be visible to clients.

| Before | Now |
|---|---|
| "In the report" also opened the file in the portal, before approval | "In the report" means the PDF only. Clients get those files inside the released report |
| Sensitive evidence had no extra protection | Sharing it asks for confirmation and needs "View sensitive evidence" |
| A repeating group showed whole rows, so HR contacts reached the portal after release | Only columns marked "Client sees it" are shown |
| Candidate NIC, email and phone always showed | Off by default. Turn on "Candidate personal details" on the client's page |

A file reaches the portal only if it's marked "Client can see" or the client uploaded it. The rule is in both `portal_case_detail()` and the `documents_select_client` policy, so `/api/files` follows it too.

## What Data Entry owes

Spec 2.1 puts data entry before verification, but a check needed every required field to leave Data Entry, including "Sanctions found", "Verified by" and "Validated through". Staff had to enter placeholders.

Each field now has a `stage`: `data_entry` (the default) or `verification`. A required field only holds up its own stage.

- **Starting verification** needs Data Entry's required fields. `check_entry_complete()` reads the stored values, so the rule doesn't depend on the caller.
- **Recording an outcome** still needs every required field (`values_valid`), so a check can't close without its result.
- **The form** shows later fields under "Recorded during verification", collapsed and optional. They stay editable. Once verification starts they become "Verification findings" and are required. "Still needed" and the progress on check cards follow the same rule.
- **Check types** have a "Filled in during" setting in Settings. New fields default to Data entry.

0040 adds `stage` to the stored versions of the seven built-in check types, published ones included, so open cases benefit. This is the only time published versions were edited. It's safe because `stage` changes when a field is due, not any field, value, option or report line. `tests/unit/check-types.test.ts` keeps the list in step with `builtin.ts`.

The fields filled during verification:

| Check | Fields |
|---|---|
| Education | Confirmed by, confirmation channel, confirmed on |
| Employment | Confirmed by |
| Address | Verified by, Grama Niladhari details, field visit date and notes |
| Criminal / police | Verified by, OIC name, station contact |
| NIC | Validated through |
| Reference | Feedback |
| Global sanction | Sanctions found, details, screening platform, screened on |

## Also fixed

`case_transition` treated "the case has no owner" as "you are the owner" for people with `cases.update`, the same mistake 0038 fixed elsewhere. The screens never offered the move, so nothing visible changes.

Tests: `supabase/tests/0040_evidence_entry.test.sql`, `tests/unit/check-types.test.ts`, `tests/unit/report.test.ts`, `tests/unit/workflow.test.ts`.
