-- 0025 Platform hardening
-- Fixes raised by the Supabase security and performance advisors on the first
-- hosted push (2026-10-29). Depends on 0001, 0002, 0003, 0009, 0010, 0013, 0018.
--
-- Rules every migration keeps from here on. supabase/tests/0025_hardening.test.sql
-- enforces the first, second and fourth, so a feature file that breaks one fails CI.
--   1. No function in public is executable by anon: `revoke ... from public, anon`.
--   2. Trigger functions are never executable over the API.
--   3. Security definer RPCs that signed-in users may call check the caller inside.
--   4. Every foreign key has a covering index.

-- 1 + 2. Trigger functions. Postgres checks EXECUTE when a trigger is created,
-- not when it fires, so revoking here leaves every trigger working.
revoke execute on function
  public.set_updated_at(),
  public.handle_new_auth_user(),
  public.sync_auth_user_email(),
  public.profiles_guard(),
  public.set_org_id(),
  public.memberships_guard(),
  public.role_permissions_guard(),
  public.roles_guard(),
  public.log_row_change(),
  public.create_client_settings(),
  public.ai_runs_price()
from public, anon, authenticated;

-- Helpers only the audit trigger (security definer, runs as owner) calls.
revoke execute on function public.current_actor_id(), public.current_actor_kind(), public.request_ip()
from public, anon, authenticated;

-- AI pricing runs inside the ai_runs trigger, which only the service role fires.
revoke execute on function public.price_ai_usage(text, integer, integer, integer, integer, numeric, boolean, timestamptz)
from public, anon, authenticated;
grant execute on function public.price_ai_usage(text, integer, integer, integer, integer, numeric, boolean, timestamptz)
to service_role;

-- 3. Document numbers are drawn only by server code and by the definer functions
-- that confirm a quote, invoice or receipt. A staff member calling the RPC
-- directly would burn a number and leave a gap in a legally gapless series.
revoke execute on function public.next_document_number(text, uuid) from authenticated;
grant execute on function public.next_document_number(text, uuid) to service_role;

-- Client codes reveal which companies Ontriq works with, so only staff who can
-- see clients may probe them.
create or replace function public.suggest_client_code(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '', 'g'), 8));
  v_code text;
  n int := 1;
begin
  if auth.uid() is not null and not ((select public.is_staff())
       and ((select public.has_permission('clients.manage')) or (select public.has_permission('clients.read')))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_base = '' then v_base := 'CLIENT'; end if;
  v_code := v_base;
  while exists (select 1 from public.clients c where c.code = v_code
                and c.org_id = coalesce(public.auth_org_id(), public.default_org_id())) loop
    n := n + 1;
    v_code := v_base || '-' || n;
  end loop;
  return v_code;
end $$;

-- Queue counts are operational detail for staff, never for client users.
create or replace function public.queue_depth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not (select public.is_staff()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued' and run_after <= now()),
    'scheduled', count(*) filter (where status = 'queued' and run_after > now()),
    'running', count(*) filter (where status = 'running'),
    'dead', count(*) filter (where status = 'dead'),
    'live_workers', (select count(*) from public.job_workers where heartbeat_at > now() - interval '90 seconds')
  ) into v
  from public.jobs
  where org_id = coalesce(public.auth_org_id(), public.default_org_id());
  return v;
end $$;

-- 4. Covering indexes for foreign keys (deletes of users, roles, jobs and orgs
-- would otherwise scan these tables).
create index if not exists role_permissions_permission_idx on public.role_permissions (permission);
create index if not exists memberships_invited_by_idx on public.memberships (invited_by);
create index if not exists memberships_role_idx on public.memberships (role_id);
create index if not exists invitations_auth_user_idx on public.invitations (auth_user_id);
create index if not exists invitations_client_idx on public.invitations (client_id);
create index if not exists invitations_invited_by_idx on public.invitations (invited_by);
create index if not exists invitations_role_idx on public.invitations (role_id);
create index if not exists clients_created_by_idx on public.clients (created_by);
create index if not exists client_contacts_org_idx on public.client_contacts (org_id);
create index if not exists client_settings_org_idx on public.client_settings (org_id);
create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists notifications_org_idx on public.notifications (org_id);
create index if not exists email_outbox_created_by_idx on public.email_outbox (created_by);
create index if not exists email_outbox_org_idx on public.email_outbox (org_id);
create index if not exists sms_outbox_created_by_idx on public.sms_outbox (created_by);
create index if not exists sms_outbox_org_idx on public.sms_outbox (org_id);
create index if not exists communications_created_by_idx on public.communications (created_by);
create index if not exists communications_email_outbox_idx on public.communications (email_outbox_id);
create index if not exists communications_org_idx on public.communications (org_id);
create index if not exists communications_sms_outbox_idx on public.communications (sms_outbox_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_org_idx on public.tasks (org_id);
create index if not exists generated_documents_created_by_idx on public.generated_documents (created_by);
create index if not exists generated_documents_job_idx on public.generated_documents (job_id);
create index if not exists generated_documents_org_idx on public.generated_documents (org_id);
create index if not exists ai_runs_created_by_idx on public.ai_runs (created_by);
create index if not exists ai_runs_job_idx on public.ai_runs (job_id);
create index if not exists ai_suggestions_decided_by_idx on public.ai_suggestions (decided_by);
create index if not exists ai_suggestions_run_idx on public.ai_suggestions (run_id);
create index if not exists ai_batches_org_idx on public.ai_batches (org_id);

-- Deny-all tables. RLS is on with no policies on purpose; only security definer
-- functions and the service role touch them.
comment on table public.document_counters is 'Deny-all to API roles by design: only next_document_number() reads and writes it.';
comment on table public.job_workers is 'Deny-all to API roles by design: written by the jobs worker with the service role.';
comment on table public.rate_limit_hits is 'Deny-all to API roles by design: only rate_limit_check() touches it.';
