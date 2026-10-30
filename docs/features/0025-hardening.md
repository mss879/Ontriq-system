# Platform hardening — `0025_hardening.sql`

Added after the first push to the hosted project, from the Supabase security and performance advisors (2026-10-29). Depends on 0001, 0002, 0003, 0009, 0010, 0013 and 0018.

## What it changes

- **Trigger functions** (`set_org_id`, `log_row_change`, the guards and others) can no longer be called over the REST API by anyone. Triggers still fire: Postgres checks `execute` only when a trigger is created.
- **Audit helpers** and **AI pricing** are callable only by the database owner and the service role.
- **Document numbers** can only be drawn by server code and by the definer functions that confirm a document. A staff member calling the RPC directly would burn a number and leave a gap in a gapless series.
- **`suggest_client_code`** answers only staff who can see clients. Before, a client user could probe it to learn which other companies Ontriq serves.
- **`queue_depth`** answers staff only, not client users.
- **30 foreign keys** gained covering indexes.
- The three deny-all tables (`document_counters`, `job_workers`, `rate_limit_hits`) are commented as deliberate.

## Advisor findings left as designed

- *Authenticated users can execute security definer functions*: the RLS helpers (`is_staff`, `has_permission`, `auth_org_id` and friends) must be callable by signed-in users for policies to work, and each user-facing RPC checks its caller inside. Each helper only reveals facts about the caller.
- *RLS enabled, no policy* on the three deny-all tables.
- *Unused index*: expected on a new database.

## Tests

`supabase/tests/0025_hardening.test.sql` enforces the rules for every future migration (no anon-executable function, no API-callable trigger function, no unindexed foreign key, RLS on every table) and checks the tightened RPCs per role.
