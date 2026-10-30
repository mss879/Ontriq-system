-- =============================================================================
-- 0002_audit.sql
-- Feature: audit trail, system events, rate limiting.
-- Depends on: 0001_foundation.
--
-- audit_log is insert-only: no update/delete grants and no policies for them.
-- Any table opts in with: select public.attach_audit('public.my_table');
-- =============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs (id) on delete cascade,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  actor_kind text not null default 'system',
  changed_keys text[] not null default '{}',
  before jsonb,
  after jsonb,
  ip text,
  at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, at desc);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

-- Who is acting: the signed-in user, or the worker/script that set app.actor_id.
create or replace function public.current_actor_id() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid)
$$;

create or replace function public.current_actor_kind() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is not null then coalesce(
      (select m.kind::text from public.memberships m where m.user_id = auth.uid() limit 1), 'user')
    else coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system')
  end
$$;

create or replace function public.request_ip() returns text
language sql stable set search_path = '' as $$
  select nullif(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), '')
$$;

-- Generic change capture. TG_ARGV[0] lists the key columns (default "id").
create or replace function public.log_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_keys text[] := string_to_array(coalesce(nullif(tg_argv[0], ''), 'id'), ',');
  v_row_id text;
  v_changed text[] := '{}';
  v_org uuid;
  k text;
begin
  select string_agg(coalesce(v_row ->> trim(x), ''), ':') into v_row_id from unnest(v_keys) as x;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_changed := array_append(v_changed, k);
      end if;
    end loop;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  v_org := case when tg_table_name = 'orgs' then (v_row ->> 'id')::uuid
                else nullif(v_row ->> 'org_id', '')::uuid end;
  v_org := coalesce(v_org, public.auth_org_id(), public.default_org_id());

  insert into public.audit_log (org_id, table_name, row_id, op, actor_id, actor_kind, changed_keys, before, after, ip)
  values (v_org, tg_table_name, coalesce(v_row_id, ''), tg_op, public.current_actor_id(),
          public.current_actor_kind(), v_changed, v_old, v_new, public.request_ip());
  return null;
end $$;

create or replace function public.attach_audit(p_table regclass, p_keys text default 'id') returns void
language plpgsql set search_path = '' as $$
begin
  execute format('drop trigger if exists zz_audit on %s', p_table);
  execute format(
    'create trigger zz_audit after insert or update or delete on %s for each row execute function public.log_row_change(%L)',
    p_table, p_keys);
end $$;
revoke execute on function public.attach_audit(regclass, text) from public, anon, authenticated;

select public.attach_audit('public.orgs');
select public.attach_audit('public.roles');
select public.attach_audit('public.role_permissions', 'role_id,permission');
select public.attach_audit('public.memberships');
select public.attach_audit('public.invitations');

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('audit.read')));
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- System events: operational log (job failures, budget alerts, integrations)
-- ---------------------------------------------------------------------------
create table public.system_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs (id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  fingerprint text,
  occurrences int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create unique index system_events_fingerprint_uq on public.system_events (org_id, fingerprint) where fingerprint is not null;
create index system_events_org_last_idx on public.system_events (org_id, last_at desc);

alter table public.system_events enable row level security;
create policy system_events_select on public.system_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('jobs.read')) or (select public.has_permission('settings.manage'))));
revoke insert, update, delete, truncate on public.system_events from anon, authenticated;

-- Record (or count again) an event. Repeats with the same fingerprint bump the counter.
create or replace function public.log_system_event(
  p_kind text, p_message text, p_severity text default 'info',
  p_context jsonb default '{}'::jsonb, p_fingerprint text default null, p_org uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.default_org_id());
begin
  if p_fingerprint is null then
    insert into public.system_events (org_id, kind, severity, message, context)
    values (v_org, p_kind, p_severity, p_message, p_context);
  else
    insert into public.system_events (org_id, kind, severity, message, context, fingerprint)
    values (v_org, p_kind, p_severity, p_message, p_context, p_fingerprint)
    on conflict (org_id, fingerprint) where fingerprint is not null
    do update set occurrences = public.system_events.occurrences + 1, last_at = now(),
                  message = excluded.message, context = excluded.context, severity = excluded.severity;
  end if;
end $$;
revoke execute on function public.log_system_event(text, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.log_system_event(text, text, text, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Rate limiting shared by every server instance (candidate links, login,
-- verify page, quote acceptance, transcription)
-- ---------------------------------------------------------------------------
create table public.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Returns true when the call is allowed. Old windows are pruned opportunistically.
create or replace function public.rate_limit_check(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limit_hits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;
revoke execute on function public.rate_limit_check(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_check(text, int, int) to service_role;
