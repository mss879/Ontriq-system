# Audit trail, system events, rate limiting

Migration: `supabase/migrations/0002_audit.sql`  
Depends on: 0001

- Insert-only `audit_log` filled by a generic trigger that records who changed what, the changed fields, before and after.
- `select public.attach_audit('public.my_table')` opts any table in.
- `system_events` for operational alerts, de-duplicated by fingerprint.
- `rate_limit_check()` shared by every server instance.
