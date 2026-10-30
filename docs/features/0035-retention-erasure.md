# Retention and erasure

Migration: `supabase/migrations/0035_retention_erasure.sql`  
Depends on: 0002, 0003, 0006, 0007, 0008, 0010, 0011, 0012, 0013, 0018

- Each client has a retention period (`clients.retention_months`, 6–120, default 24), set on the client form. Once a released or cancelled case is older than that, the nightly `retention.purge` job erases the candidate's personal data.
- The Super Admin (with two-step verification) can also erase a closed case on request, giving a reason and typing the case reference (`eraseCaseData`). Cases still in progress must be cancelled first.
- `erase_case(case, reason)` scrubs check values and report remarks, OCR text and AI suggestions, the report snapshot, request answers, messages, consent signatures and IP addresses, timeline notes, QC remarks, stage reasons, emails and SMS about the case, and the case's names and references. The candidate record is anonymised unless another live case still needs it. Audit entries for those rows keep who did what and when, with the data replaced by `{"redacted": true}`. It returns the stored files (evidence, report PDFs, consent PDFs), which the caller deletes from Storage.
- Kept: the reference, client, package, dates, stages and results (so reporting stays right), and every quote, invoice, payment and credit note (statutory retention).
- The report verification page shows "personal data erased" for an erased case instead of the candidate's initials.
- Erasures are recorded in `system_events` (`data.erased`) and on the case timeline.
- Tests: `supabase/tests/0035_retention.test.sql`.
