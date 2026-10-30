# Client portal

Migration: `supabase/migrations/0021_portal_views.sql`  
Depends on: 0003, 0006, 0007, 0008 (calls 0010 at run time only)

- Client users have no row level access to cases, checks, requirements or the timeline. They read projections from `portal_dashboard`, `portal_cases` (search, status filter, sort, paging) and `portal_case_detail`, which keep to their own company and to cases marked client-visible.
- What a client sees per case: progress in client wording, client-safe check states, the document slots Ontriq shared with them, documents Ontriq shared plus their own uploads, the candidate's progress (invited, opened, consent), a rewritten timeline (no notes, no QC returns, no reasons for holds) and the report status. Results, client notes and client-visible fields appear only after release.
- Ontriq controls the rest per client in `client_settings.visibility`: check progress, timeline, documents, candidate progress, candidate personal details (off by default, [0040](0040-evidence-and-entry-rules.md)), results before release, and check types to hide.
- Uploads: `portal_begin_upload` / `portal_finalize_upload` into a shared slot, or a CV / other file; needs `portal.cases.create` (client viewers cannot upload).
- Downloads: a client policy on `documents` lets `/api/files/<id>` serve shared documents and their own uploads (and nothing when Ontriq hides documents).
- `portal_price_list` (check types the client may build packages from, at Ontriq's list price) runs as the caller, so it matches the price guard on `package_items`. `portal_team` lists the company's portal users.
- Notifications: a trigger on the timeline tells the client's users when Ontriq needs documents (client-supplied cases), rejects a client upload, accepts a portal request or releases a report. A trigger on `notifications` queues an email copy (`notify.email` job) for portal notifications by default, and for staff who switch email on; the email is skipped if the notification was read within a minute.
- Tests: `supabase/tests/0008_candidate_portal.test.sql`; hosted checks in `scripts/simulate.ts`.
