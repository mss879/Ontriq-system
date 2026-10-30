# Final reports

Migration: `supabase/migrations/0012_reports.sql`  
Depends on: 0006, 0007, 0011 (calls 0009 at run time)

- Staff generate a draft at the report stage (`request_report_draft`). The `report.render` job compiles a snapshot of the case (`src/domain/reports/compile-core.ts`): cover details, a summary of every check, one section per check with the fields marked for the report, results and remarks, the evidence list, QC and approval. Incomplete checks are printed as "Not completed", never as verified.
- The PDF (`src/jobs/report/build-body.tsx`) carries a DRAFT watermark on drafts. `src/jobs/report/assemble.ts` appends each evidence file behind a cover sheet with its fingerprint (images scaled to A4, PDFs copied page by page) and the Global Sanction report untouched. Caps: 60 evidence pages, 150 MB.
- Approval (`approve_report`, `reports.approve`) needs the latest ready draft and the snapshot's hash recompiled now: if the case changed after the draft, approval is refused. A green result needs every counted check completed and clear. Approval renders the final (no watermark, QR to `/verify/<id>`, SHA-256).
- Release (`release_report`, `reports.release`) needs a ready final and a different person from the approver (Super Admin excepted), records recipients, moves the case to released, notifies the client's users and, for per-case billing, queues the invoice draft.
- Revisions (`revise_report`) reopen the report stage with a reason; the released version stays available to the client until the revision is released, then it is superseded. Versions are never overwritten.
- Downloads go through `/api/reports/<id>` (`report_download` decides and logs). `/verify/<id>` shows whether a report is genuine (reference, issuer, client, candidate initials, date, fingerprint), never the result.
- Tests: `supabase/tests/0012_reports_money.test.sql`, `tests/unit/report.test.ts`.
