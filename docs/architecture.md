# Architecture

## Rendering

Next.js 16 with Cache Components and Partial Prefetching. Every route has a static shell (layout, navigation frame, skeletons) and streams its personalised parts behind Suspense. Rules followed everywhere:

- Layouts and pages are synchronous; request data (cookies, params, search params) is read inside Suspense boundaries.
- `src/lib/server/viewer.ts` is the data access layer. `getViewer()` (Server Components, `use cache: private`) redirects people who are signed out, invited, or missing two-step verification. `requireViewer()` (Server Actions, Route Handlers) throws instead. Every action calls it, even when the page already checked.
- Business data is never cached with `use cache`; mutations call `refresh()`. Catalog data (later phases) uses `use cache` with org-scoped tags.
- Code that compares against the current time runs after `await connection()`.
- `src/proxy.ts` only refreshes the session cookie and routes people between `/app` and `/portal`; it never reads the database.

## Access control

- `memberships` (user → org, staff or client, role, status) is the single source of truth; the JWT's `app_metadata.kind` only helps the proxy route.
- Roles are rows; permissions come from a fixed catalog (`0001_foundation.sql`, mirrored in `src/domain/permissions.ts`, kept in sync by a test). Admins create custom designations; the command-assistant permission and the Super Admin role cannot be granted or edited by anyone else.
- Row-level security on every table through helper functions (`auth_org_id`, `is_staff`, `is_client`, `client_id_of_user`, `has_permission`). Staff need an MFA (aal2) session when the organisation requires it, or they see nothing.
- Guards in the database stop people changing their own access, promoting anyone to Super Admin unless they are one, and editing the Super Admin role.
- Every change to people, roles, clients, templates, settings and AI configuration is written to the insert-only `audit_log` by trigger.

## Background work

Postgres owns the queue (`jobs`). The app enqueues and wakes a Netlify Background Function, which claims jobs with `FOR UPDATE SKIP LOCKED` under a lease and runs them for up to 13 minutes. A scheduled function calls `/api/jobs/tick` every minute to recover expired leases and enqueue recurring work. Retries back off exponentially; a job claimed three times without progress is dead-lettered so a killed worker can never loop on a paid AI call. Locally, the app drains jobs in-process after each response.

Email is two steps: a row in `email_outbox` and an `email.send` job, delivered through Resend with the outbox id as the idempotency key.

## AI

Every model call will be recorded in `ai_runs` and priced by trigger from `ai_cost_rates`, so spend is reportable per client, case and capability and comparable with the cost document. Capability routing (model, effort, budget) lives in `ai_capabilities` and is editable in Settings.
