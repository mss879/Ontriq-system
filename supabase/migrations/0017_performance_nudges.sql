-- =============================================================================
-- 0017_performance_nudges.sql
-- Feature: staff performance and nudges. A nightly roll-up stores each
-- person's day (checks completed, cases closed, turnaround, SLA met, QC
-- returns, first action, overdue at end of day, nudges received). The
-- leaderboard scores throughput, timeliness, quality and responsiveness with
-- weights Ontriq sets. Managers with staff.nudge "Push" someone who is behind:
-- an urgent in-app message (and email/SMS) listing their overdue and at-risk
-- items, which they acknowledge and can reply to. An optional automatic rule
-- nudges after N overdue items for H hours and escalates a second breach.
-- Depends on: 0006, 0010, 0011, 0016. Calls 0009 at run time.
-- =============================================================================

alter table public.assignment_rules
  add column if not exists performance_weights jsonb not null default '{"throughput": 0.4, "timeliness": 0.3, "quality": 0.2, "responsiveness": 0.1}'::jsonb,
  add column if not exists auto_nudge jsonb not null default '{"enabled": false, "overdue_items": 3, "hours": 24}'::jsonb;

create table public.staff_performance_daily (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  checks_completed int not null default 0,
  cases_closed int not null default 0,
  avg_tat_hours numeric(10, 2),
  sla_met int not null default 0,
  sla_missed int not null default 0,
  qc_returns int not null default 0,
  first_action_minutes numeric(10, 2),
  overdue_eod int not null default 0,
  nudges_received int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index staff_performance_daily_org_idx on public.staff_performance_daily (org_id, day desc);

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  from_user uuid references auth.users (id) on delete set null,
  to_user uuid not null references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb,          -- [{ kind: case|check, id, case_id, reference, label, due_at, overdue }]
  message text not null check (length(message) between 1 and 2000),
  channels text[] not null default '{in_app}',
  auto boolean not null default false,
  escalation boolean not null default false,
  acknowledged_at timestamptz,
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index nudges_org_idx on public.nudges (org_id, created_at desc);
create index nudges_to_idx on public.nudges (to_user, created_at desc);
create index nudges_from_idx on public.nudges (from_user);
create trigger a_set_org_id before insert on public.nudges
  for each row execute function public.set_org_id();

-- ---------------------------------------------------------------------------
-- What someone has on their plate now (for nudges and the drill-down)
-- ---------------------------------------------------------------------------
create or replace function public.staff_open_items(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'due_at' nulls last), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'check', 'id', k.id, 'case_id', c.id, 'reference', c.reference, 'label', k.label || ' · ' || c.candidate_name,
                              'due_at', k.due_at, 'overdue', k.due_at < now(), 'at_risk', k.due_at >= now() and k.due_at < now() + interval '1 day') x
      from public.case_checks k join public.cases c on c.id = k.case_id
     where k.assigned_to = p_user and k.state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived')
       and c.stage not in ('released', 'cancelled') and not c.on_hold
    union all
    select jsonb_build_object('kind', 'case', 'id', c.id, 'case_id', c.id, 'reference', c.reference, 'label', 'Case · ' || c.candidate_name,
                              'due_at', c.due_at, 'overdue', c.due_at < now(), 'at_risk', c.due_at >= now() and c.due_at < now() + interval '1 day')
      from public.cases c
     where c.assigned_to = p_user and c.stage not in ('released', 'cancelled') and not c.on_hold
  ) items
$$;
revoke execute on function public.staff_open_items(uuid) from public, anon, authenticated;

create or replace function public.can_see_performance(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (p_user = auth.uid() or public.has_permission('staff.performance.read'))
     and exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id = public.auth_org_id() and m.kind = 'staff')
$$;
revoke execute on function public.can_see_performance(uuid) from public, anon;
grant execute on function public.can_see_performance(uuid) to authenticated, service_role;

-- One person's open items (themselves, or a manager with staff.performance.read).
create or replace function public.my_open_items(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if not public.can_see_performance(v_user) then raise exception 'not allowed' using errcode = '42501'; end if;
  return public.staff_open_items(v_user);
end $$;
revoke execute on function public.my_open_items(uuid) from public, anon;
grant execute on function public.my_open_items(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nightly roll-up (performance.rollup job, 00:30 Colombo, for the day before)
-- ---------------------------------------------------------------------------
create or replace function public.performance_rollup(p_day date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_day::timestamp at time zone 'Asia/Colombo');
  v_to timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Colombo');
  v_n int;
begin
  insert into public.staff_performance_daily (org_id, user_id, day, checks_completed, cases_closed, avg_tat_hours, sla_met, sla_missed,
                                              qc_returns, first_action_minutes, overdue_eod, nudges_received)
  select m.org_id, m.user_id, p_day,
         (select count(*) from public.case_checks k where k.assigned_to = m.user_id and k.completed_at >= v_from and k.completed_at < v_to
            and k.state in ('completed', 'discrepancy', 'unable_to_verify')),
         (select count(*) from public.cases c where c.assigned_to = m.user_id and c.released_at >= v_from and c.released_at < v_to),
         (select round(avg(extract(epoch from k.completed_at - coalesce(k.started_at, k.assigned_at, k.created_at)) / 3600)::numeric, 2)
            from public.case_checks k where k.assigned_to = m.user_id and k.completed_at >= v_from and k.completed_at < v_to),
         (select count(*) from public.case_checks k where k.assigned_to = m.user_id and k.completed_at >= v_from and k.completed_at < v_to
            and k.due_at is not null and k.completed_at <= k.due_at),
         (select count(*) from public.case_checks k where k.assigned_to = m.user_id and k.completed_at >= v_from and k.completed_at < v_to
            and k.due_at is not null and k.completed_at > k.due_at),
         (select count(*) from public.qc_reviews q join public.case_checks k on k.id = any (q.returned_check_ids)
           where q.decision = 'returned' and q.created_at >= v_from and q.created_at < v_to and k.assigned_to = m.user_id),
         (select round(avg(extract(epoch from k.started_at - k.assigned_at) / 60)::numeric, 2)
            from public.case_checks k where k.assigned_to = m.user_id and k.started_at >= v_from and k.started_at < v_to and k.assigned_at is not null
              and k.started_at >= k.assigned_at),
         (select count(*) from public.case_checks k join public.cases c on c.id = k.case_id
           where k.assigned_to = m.user_id and k.due_at < v_to and (k.completed_at is null or k.completed_at >= v_to)
             and k.state not in ('waived') and c.stage not in ('cancelled') and k.created_at < v_to),
         (select count(*) from public.nudges n where n.to_user = m.user_id and n.created_at >= v_from and n.created_at < v_to)
    from public.memberships m
   where m.kind = 'staff' and m.status = 'active'
  on conflict (user_id, day) do update set
    checks_completed = excluded.checks_completed, cases_closed = excluded.cases_closed, avg_tat_hours = excluded.avg_tat_hours,
    sla_met = excluded.sla_met, sla_missed = excluded.sla_missed, qc_returns = excluded.qc_returns,
    first_action_minutes = excluded.first_action_minutes, overdue_eod = excluded.overdue_eod, nudges_received = excluded.nudges_received,
    updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.performance_rollup(date) from public, anon, authenticated;

-- The leaderboard for a period: raw totals per person (the app scores them,
-- src/domain/performance/score-core.ts), with live open/overdue counts.
create or replace function public.performance_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_staff() and public.has_permission('staff.performance.read')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'name', coalesce(p.full_name, p.email), 'role', r.name,
             'checks_completed', coalesce(s.checks_completed, 0), 'cases_closed', coalesce(s.cases_closed, 0),
             'avg_tat_hours', s.avg_tat_hours, 'sla_met', coalesce(s.sla_met, 0), 'sla_missed', coalesce(s.sla_missed, 0),
             'qc_returns', coalesce(s.qc_returns, 0), 'first_action_minutes', s.first_action_minutes,
             'nudges_received', coalesce(s.nudges_received, 0), 'days', coalesce(s.days, '[]'::jsonb),
             'open', (select count(*) from jsonb_array_elements(public.staff_open_items(m.user_id))),
             'overdue', (select count(*) from jsonb_array_elements(public.staff_open_items(m.user_id)) x where (x ->> 'overdue')::boolean),
             'at_risk', (select count(*) from jsonb_array_elements(public.staff_open_items(m.user_id)) x where (x ->> 'at_risk')::boolean))
           order by coalesce(p.full_name, p.email))
      from public.memberships m
      join public.roles r on r.id = m.role_id
      left join public.profiles p on p.id = m.user_id
      left join lateral (
        select sum(d.checks_completed)::int as checks_completed, sum(d.cases_closed)::int as cases_closed,
               round(avg(d.avg_tat_hours), 2) as avg_tat_hours, sum(d.sla_met)::int as sla_met, sum(d.sla_missed)::int as sla_missed,
               sum(d.qc_returns)::int as qc_returns, round(avg(d.first_action_minutes), 2) as first_action_minutes,
               sum(d.nudges_received)::int as nudges_received,
               jsonb_agg(jsonb_build_object('day', d.day, 'checks', d.checks_completed, 'overdue', d.overdue_eod) order by d.day) as days
          from public.staff_performance_daily d where d.user_id = m.user_id and d.day between p_from and p_to) s on true
     where m.org_id = public.auth_org_id() and m.kind = 'staff' and m.status = 'active'
       and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission in ('checks.verify', 'checks.data_entry', 'qc.pre', 'qc.post', '*'))
  ), '[]'::jsonb);
end $$;
revoke execute on function public.performance_board(date, date) from public, anon;
grant execute on function public.performance_board(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nudges
-- ---------------------------------------------------------------------------
create or replace function public.send_nudge(p_to uuid, p_message text, p_channels text[] default '{in_app}', p_items jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_items jsonb;
  v_id uuid;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('staff.nudge')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to = auth.uid() then raise exception 'you can''t push yourself' using errcode = '22023'; end if;
  if auth.uid() is not null and not exists (select 1 from public.memberships m where m.user_id = p_to and m.org_id = v_org and m.kind = 'staff' and m.status = 'active') then
    raise exception 'that person is not on the team' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'write a message' using errcode = '22023'; end if;
  v_items := coalesce(p_items, (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(public.staff_open_items(p_to)) x
                                 where (x ->> 'overdue')::boolean or (x ->> 'at_risk')::boolean));
  insert into public.nudges (org_id, from_user, to_user, items, message, channels, auto)
  select coalesce(v_org, m.org_id), auth.uid(), p_to, v_items, left(trim(p_message), 2000),
         (select coalesce(array_agg(distinct c), '{in_app}') from unnest(coalesce(p_channels, '{in_app}') || '{in_app}'::text[]) c
           where c in ('in_app', 'email', 'sms')),
         auth.uid() is null
    from public.memberships m where m.user_id = p_to and m.kind = 'staff' limit 1
  returning id into v_id;
  -- Urgent: shows as a banner and bypasses quiet hours.
  perform public.notify_users(array[p_to], 'nudge', 'You''re behind on ' || jsonb_array_length(v_items) || ' item' ||
    case when jsonb_array_length(v_items) = 1 then '' else 's' end, left(trim(p_message), 300), '/app/queues?nudge=' || v_id, true, 'nudge', v_id,
    (select org_id from public.nudges where id = v_id));
  return v_id;
end $$;
revoke execute on function public.send_nudge(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.send_nudge(uuid, text, text[], jsonb) to authenticated, service_role;

create or replace function public.acknowledge_nudge(p_nudge uuid, p_reply text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.nudges;
begin
  select * into n from public.nudges where id = p_nudge and to_user = auth.uid() for update;
  if n.id is null then raise exception 'nudge not found' using errcode = 'P0002'; end if;
  update public.nudges set acknowledged_at = coalesce(acknowledged_at, now()),
         reply = coalesce(nullif(trim(p_reply), ''), reply), replied_at = case when nullif(trim(p_reply), '') is not null then now() else replied_at end
   where id = n.id;
  if nullif(trim(p_reply), '') is not null and n.from_user is not null then
    perform public.notify_users(array[n.from_user], 'nudge.reply',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'A team member') || ' replied to your push', left(trim(p_reply), 300),
      '/app/team/performance', false, 'nudge', n.id, n.org_id);
  end if;
end $$;
revoke execute on function public.acknowledge_nudge(uuid, text) from public, anon;
grant execute on function public.acknowledge_nudge(uuid, text) to authenticated, service_role;

-- People the automatic rule should push now (nudge.auto job): over the overdue
-- threshold, not pushed automatically in the last day. A second automatic
-- push within a week escalates to their managers.
create or replace function public.auto_nudge_candidates() returns table (org_id uuid, user_id uuid, name text, overdue int, escalate boolean)
language sql stable security definer set search_path = '' as $$
  select m.org_id, m.user_id, coalesce(p.full_name, p.email),
         (select count(*)::int from jsonb_array_elements(public.staff_open_items(m.user_id)) x where (x ->> 'overdue')::boolean),
         exists (select 1 from public.nudges n where n.to_user = m.user_id and n.auto and n.created_at > now() - interval '7 days')
    from public.memberships m
    join public.assignment_rules ar on ar.org_id = m.org_id
    left join public.profiles p on p.id = m.user_id
   where m.kind = 'staff' and m.status = 'active' and coalesce((ar.auto_nudge ->> 'enabled')::boolean, false)
     and (select count(*) from jsonb_array_elements(public.staff_open_items(m.user_id)) x
           where (x ->> 'overdue')::boolean and (x ->> 'due_at')::timestamptz < now() - make_interval(hours => coalesce((ar.auto_nudge ->> 'hours')::int, 24)))
         >= coalesce((ar.auto_nudge ->> 'overdue_items')::int, 3)
     and not exists (select 1 from public.nudges n where n.to_user = m.user_id and n.auto and n.created_at > now() - interval '1 day')
$$;
revoke execute on function public.auto_nudge_candidates() from public, anon, authenticated;

create or replace function public.escalate_nudge(p_user uuid, p_overdue int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (select org_id from public.memberships where user_id = p_user and kind = 'staff' limit 1);
begin
  update public.nudges set escalation = true where id = (select id from public.nudges where to_user = p_user and auto order by created_at desc limit 1);
  perform public.notify_users(
    (select array_agg(m.user_id) from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
      where m.org_id = v_org and m.kind = 'staff' and m.status = 'active' and rp.permission in ('staff.nudge', '*') and m.user_id <> p_user),
    'nudge.escalated', coalesce((select full_name from public.profiles where id = p_user), 'A team member') || ' is still behind (' || p_overdue || ' overdue)',
    'They were pushed automatically this week and the overdue items remain.', '/app/team/performance', true, 'user', p_user, v_org);
end $$;
revoke execute on function public.escalate_nudge(uuid, int) from public, anon, authenticated;

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('performance.rollup', 1, 2, 150, 'Roll up staff performance'),
  ('nudge.auto', 1, 2, 120, 'Apply the auto-nudge rule')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.staff_performance_daily enable row level security;
alter table public.nudges enable row level security;

create policy staff_performance_daily_select on public.staff_performance_daily for select to authenticated
  using (org_id = (select public.auth_org_id()) and (user_id = (select auth.uid()) or ((select public.is_staff()) and (select public.has_permission('staff.performance.read')))));
create policy nudges_select on public.nudges for select to authenticated
  using (org_id = (select public.auth_org_id()) and (to_user = (select auth.uid()) or from_user = (select auth.uid())
         or ((select public.is_staff()) and (select public.has_permission('staff.performance.read')))));
revoke insert, update, delete, truncate on public.staff_performance_daily, public.nudges from anon, authenticated;

alter publication supabase_realtime add table public.nudges;
