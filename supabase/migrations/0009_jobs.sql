-- =============================================================================
-- 0009_jobs.sql
-- Feature: background jobs (AI processing, PDF rendering, email, reminders).
-- Depends on: 0001_foundation, 0002_audit.
--
-- Postgres owns the queue. A Netlify Background Function claims jobs with
-- FOR UPDATE SKIP LOCKED under a lease; a 1-minute scheduled sweeper enqueues
-- recurring work and recovers expired leases. All job RPCs are service-role only.
-- =============================================================================

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  status public.job_status not null default 'queued',
  priority smallint not null default 100,         -- lower runs first
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  claims int not null default 0,                  -- claims since the last committed progress
  locked_by text,
  locked_at timestamptz,
  locked_until timestamptz,
  progress jsonb,
  result jsonb,
  last_error text,
  entity_type text,
  entity_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index jobs_idempotency_uq on public.jobs (org_id, kind, idempotency_key) where idempotency_key is not null;
create index jobs_claimable_idx on public.jobs (priority, run_after) where status in ('queued', 'running');
create index jobs_entity_idx on public.jobs (entity_type, entity_id, created_at desc);
create index jobs_status_idx on public.jobs (status, updated_at desc);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.job_kind_limits (
  kind text primary key,
  max_running int not null default 2 check (max_running between 1 and 50),
  default_max_attempts int not null default 5 check (default_max_attempts between 1 and 20),
  default_priority smallint not null default 100,
  description text not null default ''
);

create table public.job_failures (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  attempt int not null,
  error text not null,
  at timestamptz not null default now()
);
create index job_failures_job_idx on public.job_failures (job_id, at desc);

create table public.job_workers (
  worker_id text primary key,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  jobs_done int not null default 0
);

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('email.send', 4, 8, 50, 'Deliver one queued email through Resend'),
  ('sms.send', 4, 6, 50, 'Deliver one queued SMS through Notify.lk'),
  ('document.render', 2, 3, 80, 'Render a quotation, invoice, statement or consent PDF'),
  ('report.render', 1, 3, 80, 'Render a final verification report with annexures'),
  ('ai.classify_document', 4, 3, 60, 'Classify an upload, check quality and read its text'),
  ('ai.extract_fields', 3, 3, 70, 'Extract check fields from documents'),
  ('ai.consistency', 2, 3, 90, 'Compare documents within a case'),
  ('ai.preqc_copilot', 2, 3, 90, 'Draft the Pre-QC checklist and requests'),
  ('ai.outreach_draft', 2, 3, 90, 'Draft verification outreach'),
  ('ai.response_capture', 2, 3, 70, 'Turn a verifier response into a proposed result'),
  ('ai.postqc', 1, 3, 90, 'Cross-check a case before reporting'),
  ('ai.narrative', 2, 3, 90, 'Draft report findings and summary'),
  ('ai.slip_read', 2, 3, 60, 'Read a payment slip'),
  ('ai.consent_check', 2, 3, 60, 'Check a photographed consent form'),
  ('stt.transcribe', 2, 3, 40, 'Transcribe a voice note'),
  ('assistant.task', 2, 2, 40, 'Finish an assistant request in the background'),
  ('assign.auto', 2, 3, 30, 'Auto-assign a new case and its checks'),
  ('assign.rebalance', 1, 2, 90, 'Propose workload rebalancing'),
  ('invoice.draft', 1, 3, 90, 'Draft an invoice'),
  ('invoice.reminders', 1, 1, 120, 'Send due invoice reminders'),
  ('reminder.candidate', 2, 3, 100, 'Send candidate reminders'),
  ('sla.scan', 1, 1, 120, 'Scan for SLA risks'),
  ('briefing.daily', 1, 2, 120, 'Write the daily manager briefing'),
  ('performance.rollup', 1, 2, 150, 'Roll up staff performance'),
  ('nudge.auto', 1, 2, 120, 'Apply the auto-nudge rule'),
  ('ai.budget_check', 1, 1, 120, 'Check AI spend against budgets'),
  ('retention.purge', 1, 1, 200, 'Purge data past its retention period')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- RPCs (service role only)
-- ---------------------------------------------------------------------------

-- Insert a job, or return the existing one with the same idempotency key.
create or replace function public.enqueue_job(
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_run_after timestamptz default now(),
  p_priority smallint default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_max_attempts int default null,
  p_org uuid default null,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.default_org_id());
  v_limits public.job_kind_limits;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'enqueue_job needs an org' using errcode = '23502';
  end if;
  select * into v_limits from public.job_kind_limits where kind = p_kind;

  insert into public.jobs (org_id, kind, payload, idempotency_key, run_after, priority,
                           entity_type, entity_id, max_attempts, created_by)
  values (v_org, p_kind, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, coalesce(p_run_after, now()),
          coalesce(p_priority, v_limits.default_priority, 100),
          p_entity_type, p_entity_id, coalesce(p_max_attempts, v_limits.default_max_attempts, 5), p_created_by)
  on conflict (org_id, kind, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.jobs
     where org_id = v_org and kind = p_kind and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end $$;

-- Claim up to p_limit runnable jobs, respecting per-kind concurrency.
-- Expired leases (a worker died) are claimable again.
create or replace function public.claim_jobs(p_worker text, p_limit int default 1, p_lease_seconds int default 600)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidate as (
    select j.id
      from public.jobs j
      left join public.job_kind_limits k on k.kind = j.kind
     where ((j.status = 'queued' and j.run_after <= now())
         or (j.status = 'running' and j.locked_until < now()))
       and j.attempts < j.max_attempts
       and j.claims < 3
       and (select count(*) from public.jobs r
             where r.kind = j.kind and r.status = 'running' and r.locked_until >= now())
           < coalesce(k.max_running, 2)
     order by j.priority, j.run_after
     limit greatest(p_limit, 1)
     for update of j skip locked
  )
  update public.jobs j
     set status = 'running',
         locked_by = p_worker,
         locked_at = now(),
         locked_until = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         claims = j.claims + 1
    from candidate c
   where j.id = c.id
  returning j.*;
end $$;

-- Prove liveness during long steps; resets the claim counter.
create or replace function public.heartbeat_job(p_id uuid, p_worker text, p_lease_seconds int default 600, p_progress jsonb default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs
     set locked_until = now() + make_interval(secs => p_lease_seconds),
         claims = 0,
         progress = coalesce(p_progress, progress)
   where id = p_id and locked_by = p_worker and status = 'running';
  return found;
end $$;

create or replace function public.complete_job(p_id uuid, p_worker text, p_result jsonb default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_done boolean;
begin
  update public.jobs
     set status = 'succeeded', result = p_result, finished_at = now(), claims = 0,
         locked_by = null, locked_until = null, last_error = null
   where id = p_id and locked_by = p_worker and status = 'running';
  v_done := found;
  if v_done then
    update public.job_workers set jobs_done = jobs_done + 1, heartbeat_at = now() where worker_id = p_worker;
  end if;
  return v_done;
end $$;

-- Retry with exponential backoff and jitter, or dead-letter the job.
create or replace function public.fail_job(p_id uuid, p_worker text, p_error text, p_retryable boolean default true)
returns public.job_status
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_status public.job_status;
begin
  select * into j from public.jobs where id = p_id and locked_by = p_worker for update;
  if not found then
    return null;
  end if;
  insert into public.job_failures (job_id, attempt, error) values (j.id, j.attempts, left(coalesce(p_error, 'unknown error'), 4000));

  if not p_retryable or j.attempts >= j.max_attempts then
    v_status := 'dead';
    update public.jobs
       set status = 'dead', last_error = left(p_error, 4000), finished_at = now(),
           locked_by = null, locked_until = null
     where id = j.id;
    perform public.log_system_event('job.dead', format('Job %s (%s) gave up after %s attempts', j.id, j.kind, j.attempts),
      'error', jsonb_build_object('job_id', j.id, 'kind', j.kind, 'error', left(p_error, 500)),
      'job.dead:' || j.kind, j.org_id);
  else
    v_status := 'queued';
    update public.jobs
       set status = 'queued', last_error = left(p_error, 4000), locked_by = null, locked_until = null,
           claims = 0,
           run_after = now() + make_interval(secs => least(1800, 30 * power(2, j.attempts - 1)) * (0.8 + random() * 0.4))
     where id = j.id;
  end if;
  return v_status;
end $$;

-- Recover jobs whose worker died. Jobs that were claimed repeatedly without
-- progress, or ran out of attempts, are dead-lettered instead of re-run, so a
-- killed worker can never loop on a paid AI call.
create or replace function public.sweep_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dead int;
  v_requeued int;
begin
  with dead as (
    update public.jobs
       set status = 'dead', finished_at = now(), locked_by = null, locked_until = null,
           last_error = coalesce(last_error, 'lease expired without progress')
     where status = 'running' and locked_until < now()
       and (attempts >= max_attempts or claims >= 3)
    returning id, kind, org_id
  )
  select count(*) into v_dead from dead;

  with requeued as (
    update public.jobs
       set status = 'queued', locked_by = null, locked_until = null, run_after = now()
     where status = 'running' and locked_until < now()
    returning id
  )
  select count(*) into v_requeued from requeued;

  delete from public.job_workers where heartbeat_at < now() - interval '20 minutes';

  if v_dead > 0 then
    perform public.log_system_event('job.dead', format('%s job(s) dead-lettered after expired leases', v_dead), 'error',
      jsonb_build_object('count', v_dead), 'job.sweep.dead', null);
  end if;
  return jsonb_build_object('dead', v_dead, 'requeued', v_requeued);
end $$;

-- Manual retry from Settings → Jobs.
create or replace function public.retry_job(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not ((select public.is_staff()) and (select public.has_permission('jobs.read'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.jobs
     set status = 'queued', attempts = 0, claims = 0, run_after = now(), finished_at = null, last_error = null
   where id = p_id and status in ('dead', 'failed', 'cancelled')
     and (auth.uid() is null or org_id = public.auth_org_id());
  return found;
end $$;

create or replace function public.queue_depth() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued' and run_after <= now()),
    'scheduled', count(*) filter (where status = 'queued' and run_after > now()),
    'running', count(*) filter (where status = 'running'),
    'dead', count(*) filter (where status = 'dead'),
    'live_workers', (select count(*) from public.job_workers where heartbeat_at > now() - interval '90 seconds')
  )
  from public.jobs
  where org_id = coalesce(public.auth_org_id(), public.default_org_id())
$$;

revoke execute on function public.enqueue_job(text, jsonb, text, timestamptz, smallint, text, uuid, int, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_jobs(text, int, int) from public, anon, authenticated;
revoke execute on function public.heartbeat_job(uuid, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.sweep_jobs() from public, anon, authenticated;
revoke execute on function public.retry_job(uuid) from public, anon;
revoke execute on function public.queue_depth() from public, anon;
grant execute on function public.enqueue_job(text, jsonb, text, timestamptz, smallint, text, uuid, int, uuid, uuid),
  public.claim_jobs(text, int, int), public.heartbeat_job(uuid, text, int, jsonb), public.complete_job(uuid, text, jsonb),
  public.fail_job(uuid, text, text, boolean), public.sweep_jobs() to service_role;
grant execute on function public.retry_job(uuid), public.queue_depth() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: staff with jobs.read may watch; nobody writes directly.
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_kind_limits enable row level security;
alter table public.job_failures enable row level security;
alter table public.job_workers enable row level security;

create policy jobs_select on public.jobs for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('jobs.read')) or created_by = (select auth.uid())));
create policy job_kind_limits_select on public.job_kind_limits for select to authenticated
  using ((select public.is_staff()));
create policy job_failures_select on public.job_failures for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_failures.job_id
                 and j.org_id = (select public.auth_org_id())
                 and (select public.is_staff()) and (select public.has_permission('jobs.read'))));
revoke insert, update, delete, truncate on public.jobs, public.job_failures, public.job_workers from anon, authenticated;
revoke insert, update, delete, truncate on public.job_kind_limits from anon, authenticated;

alter publication supabase_realtime add table public.jobs;
