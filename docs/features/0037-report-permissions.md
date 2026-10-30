# Report draft permissions

Migration: `supabase/migrations/0037_report_permissions.sql`  
Depends on: 0012

- Generating a report draft (`request_report_draft`) needs `reports.preview` plus one of: owning the case, `cases.stage.change` or `reports.approve`, the same rule as sending a draft for approval. The read-only Viewer role can still open reports but can no longer generate them; the report panel hides the buttons to match.
- Tests: `supabase/tests/0037_report_permissions.test.sql`.
