-- =============================================================================
-- 0016_assignment.sql
-- Feature: auto-assignment (plan §7). Staff skills, capacity, regions and
-- leave; the org's assignment rules; a log of every assignment with its
-- explanation; a live load snapshot; manual assignment; and the function the
-- assign.auto job uses to store the decision made by
-- src/domain/assignment/assignment-core.ts. Auto-assignment never overrides a
-- person's manual choice.
-- Depends on: 0006_cases, 0010_notifications_comms.
-- =============================================================================

create table public.staff_skills (
  user_id uuid not null references auth.users (id) on delete cascade,
  check_type_id uuid not null references public.check_types (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  level text not null default 'qualified' check (level in ('learning', 'qualified', 'expert')),
  primary key (user_id, check_type_id)
);
create index staff_skills_type_idx on public.staff_skills (check_type_id);
create index staff_skills_org_idx on public.staff_skills (org_id);
create trigger a_set_org_id before insert on public.staff_skills
  for each row execute function public.set_org_id();

create table public.staff_capacity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  auto_assign boolean not null default true,
  max_open_cases int not null default 25 check (max_open_cases between 0 and 1000),
  max_open_checks int not null default 60 check (max_open_checks between 0 and 5000),
  regions text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index staff_capacity_org_idx on public.staff_capacity (org_id);
create trigger a_set_org_id before insert on public.staff_capacity
  for each row execute function public.set_org_id();
create trigger staff_capacity_updated_at before update on public.staff_capacity
  for each row execute function public.set_updated_at();

create table public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  kind text not null default 'leave' check (kind in ('leave', 'training', 'other')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index staff_availability_org_idx on public.staff_availability (org_id);
create index staff_availability_user_idx on public.staff_availability (user_id, starts_on);
create index staff_availability_created_by_idx on public.staff_availability (created_by);
create trigger a_set_org_id before insert on public.staff_availability
  for each row execute function public.set_org_id();

create table public.assignment_rules (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  strategy text not null default 'least_loaded' check (strategy in ('least_loaded', 'round_robin', 'manual')),
  weights jsonb not null default '{"load": 0.6, "overdue": 0.25, "recent": 0.15, "newcomer": 0.05}'::jsonb,
  consider_skills boolean not null default true,
  consider_regions boolean not null default true,
  assign_checks boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger assignment_rules_updated_at before update on public.assignment_rules
  for each row execute function public.set_updated_at();

create table public.assignment_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete cascade,
  assigned_to uuid references auth.users (id) on delete set null,
  previous_assignee uuid references auth.users (id) on delete set null,
  assigned_by uuid references auth.users (id) on delete set null,
  mode text not null check (mode in ('auto', 'manual', 'queue')),
  strategy text,
  score_breakdown jsonb not null default '{}'::jsonb,
  explanation text,
  reason text,
  at timestamptz not null default now()
);
create index assignment_events_org_idx on public.assignment_events (org_id, at desc);
create index assignment_events_case_idx on public.assignment_events (case_id, at desc);
create index assignment_events_check_idx on public.assignment_events (case_check_id);
create index assignment_events_assignee_idx on public.assignment_events (assigned_to, at desc);
create index assignment_events_previous_idx on public.assignment_events (previous_assignee);
create index assignment_events_by_idx on public.assignment_events (assigned_by);

-- Is this person active staff in the org?
create or replace function public.is_active_staff(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id = p_org and m.kind = 'staff' and m.status = 'active')
$$;
revoke execute on function public.is_active_staff(uuid, uuid) from public, anon, authenticated;

-- Everyone's live workload, for the assignment job and the Assignment settings page.
create or replace function public.staff_load_snapshot(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.auth_org_id(), public.default_org_id());
  v_out jsonb;
begin
  if auth.uid() is not null then
    if not (public.is_staff() and (public.has_permission('assignment.configure') or public.has_permission('cases.assign')
            or public.has_permission('staff.performance.read'))) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_org := public.auth_org_id();
  end if;

  with staff as (
    select m.user_id, m.activated_at, r.key as role_key, p.full_name,
           coalesce((select array_agg(rp.permission) from public.role_permissions rp where rp.role_id = r.id), '{}') as permissions
      from public.memberships m
      join public.roles r on r.id = m.role_id
      left join public.profiles p on p.id = m.user_id
     where m.org_id = v_org and m.kind = 'staff' and m.status = 'active'
  ), open_checks as (
    select k.assigned_to as user_id,
           count(*) as n,
           sum(case when k.state = 'awaiting_response' then 0.3
                    when c.stage = 'verification' then 1.0
                    when c.stage = 'data_entry' then 0.5 else 0.3 end) as weighted,
           count(*) filter (where k.due_at < now()) as overdue
      from public.case_checks k join public.cases c on c.id = k.case_id
     where k.org_id = v_org and k.assigned_to is not null and not c.on_hold
       and k.state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived')
       and c.stage not in ('released', 'cancelled')
     group by k.assigned_to
  ), open_cases as (
    select assigned_to as user_id, count(*) as n, count(*) filter (where due_at < now()) as overdue
      from public.cases
     where org_id = v_org and assigned_to is not null and stage not in ('released', 'cancelled', 'report', 'approval')
     group by assigned_to
  ), done as (
    select assigned_to as user_id, count(*) as n from public.case_checks
     where org_id = v_org and assigned_to is not null and completed_at > now() - interval '7 days'
       and state in ('completed', 'discrepancy', 'unable_to_verify')
     group by assigned_to
  ), last_assigned as (
    select assigned_to as user_id, max(at) as at from public.assignment_events where org_id = v_org and assigned_to is not null group by assigned_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', s.user_id,
           'name', coalesce(nullif(s.full_name, ''), 'Unnamed'),
           'role_key', s.role_key,
           'permissions', to_jsonb(s.permissions),
           'auto_assign', coalesce(sc.auto_assign, s.role_key not in ('super_admin', 'admin', 'operations_manager', 'client_relations', 'viewer')),
           'has_settings', sc.user_id is not null,
           'on_leave', exists (select 1 from public.staff_availability a where a.user_id = s.user_id
                                and (now() at time zone 'Asia/Colombo')::date between a.starts_on and a.ends_on),
           'skills', coalesce((select jsonb_agg(sk.check_type_id) from public.staff_skills sk where sk.user_id = s.user_id), '[]'::jsonb),
           'regions', to_jsonb(coalesce(sc.regions, '{}')),
           'max_open_cases', coalesce(sc.max_open_cases, 25),
           'max_open_checks', coalesce(sc.max_open_checks, 60),
           'open_cases', coalesce(oc.n, 0),
           'open_checks', coalesce(ok.n, 0),
           'weighted_load', coalesce(ok.weighted, 0),
           'overdue', coalesce(ok.overdue, 0) + coalesce(oc.overdue, 0),
           'completed_7d', coalesce(d.n, 0),
           'last_assigned_at', la.at,
           'is_new', s.activated_at > now() - interval '30 days'
         ) order by s.full_name), '[]'::jsonb)
    into v_out
    from staff s
    left join public.staff_capacity sc on sc.user_id = s.user_id
    left join open_checks ok on ok.user_id = s.user_id
    left join open_cases oc on oc.user_id = s.user_id
    left join done d on d.user_id = s.user_id
    left join last_assigned la on la.user_id = s.user_id;
  return v_out;
end $$;
revoke execute on function public.staff_load_snapshot(uuid) from public, anon;
grant execute on function public.staff_load_snapshot(uuid) to authenticated, service_role;

-- Manual assignment of a case owner (and, optionally, its unassigned checks).
create or replace function public.assign_case(p_case uuid, p_user uuid, p_reason text default null, p_include_checks boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_checks int := 0;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if p_user is not null and not public.is_active_staff(p_user, c.org_id) then raise exception 'choose an active team member' using errcode = '22023'; end if;
  if p_user is not distinct from c.assigned_to and not p_include_checks then return; end if;

  update public.cases set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end where id = p_case;
  insert into public.assignment_events (org_id, case_id, assigned_to, previous_assignee, assigned_by, mode, reason, explanation)
  values (c.org_id, c.id, p_user, c.assigned_to, auth.uid(), case when p_user is null then 'queue' else 'manual' end, p_reason,
          case when p_user is null then 'Moved to the manager queue.' else 'Assigned by hand.' end);
  if p_include_checks and p_user is not null then
    update public.case_checks set assigned_to = p_user, assigned_at = now()
     where case_id = p_case and assigned_to is null and state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived');
    get diagnostics v_checks = row_count;
  end if;
  perform public.log_case_event(p_case, null, 'assigned',
    case when p_user is null then 'Moved to the manager queue'
         else 'Assigned to ' || coalesce((select full_name from public.profiles where id = p_user), 'a team member') end,
    p_reason, jsonb_build_object('user_id', p_user, 'checks', v_checks, 'mode', 'manual'), false, false);
  if p_user is not null and p_user is distinct from auth.uid() then
    perform public.notify_users(array[p_user], 'case.assigned', c.reference || ' is yours', c.candidate_name || ' · assigned by hand',
      '/app/cases/' || c.id, true, 'case', c.id, c.org_id);
  end if;
end $$;
revoke execute on function public.assign_case(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.assign_case(uuid, uuid, text, boolean) to authenticated, service_role;

create or replace function public.assign_check(p_check uuid, p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  if auth.uid() is not null and not public.has_permission('cases.assign') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user is not null and not public.is_active_staff(p_user, k.org_id) then raise exception 'choose an active team member' using errcode = '22023'; end if;
  update public.case_checks set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end where id = p_check;
  insert into public.assignment_events (org_id, case_id, case_check_id, assigned_to, previous_assignee, assigned_by, mode, reason, explanation)
  values (k.org_id, k.case_id, k.id, p_user, k.assigned_to, auth.uid(), case when p_user is null then 'queue' else 'manual' end, p_reason, 'Assigned by hand.');
  perform public.log_case_event(k.case_id, k.id, 'assigned',
    k.label || case when p_user is null then ' unassigned' else ' assigned to ' || coalesce((select full_name from public.profiles where id = p_user), 'a team member') end,
    p_reason, jsonb_build_object('user_id', p_user, 'mode', 'manual'), false, false);
  if p_user is not null and p_user is distinct from auth.uid() then
    perform public.notify_users(array[p_user], 'check.assigned', k.label || ' check on ' || c.reference, c.candidate_name,
      '/app/cases/' || c.id, false, 'case', c.id, c.org_id);
  end if;
end $$;
revoke execute on function public.assign_check(uuid, uuid, text) from public, anon;
grant execute on function public.assign_check(uuid, uuid, text) to authenticated, service_role;

-- Store an auto-assignment decision. Service role only (the assign.auto job).
-- p_plan: { strategy, owner: { user_id, explanation, breakdown } | null, reason,
--           checks: [ { check_id, user_id, explanation, breakdown } ] }
create or replace function public.apply_auto_assignment(p_case uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_owner uuid := nullif(p_plan #>> '{owner,user_id}', '')::uuid;
  v_item jsonb;
  v_user uuid;
  v_assigned int := 0;
  v_people uuid[] := '{}';
  v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null then raise exception 'case not found' using errcode = 'P0002'; end if;
  if c.stage in ('released', 'cancelled') then return jsonb_build_object('skipped', 'closed'); end if;

  if c.assigned_to is null then
    if v_owner is not null and public.is_active_staff(v_owner, c.org_id) then
      update public.cases set assigned_to = v_owner, assigned_at = now() where id = p_case;
      insert into public.assignment_events (org_id, case_id, assigned_to, mode, strategy, score_breakdown, explanation)
      values (c.org_id, c.id, v_owner, 'auto', p_plan ->> 'strategy', coalesce(p_plan #> '{owner,breakdown}', '{}'::jsonb), p_plan #>> '{owner,explanation}');
      v_people := v_people || v_owner;
      select full_name into v_name from public.profiles where id = v_owner;
      perform public.log_case_event(p_case, null, 'assigned', 'Assigned to ' || coalesce(v_name, 'a team member'),
        p_plan #>> '{owner,explanation}', jsonb_build_object('user_id', v_owner, 'mode', 'auto'), false, false);
    else
      insert into public.assignment_events (org_id, case_id, mode, strategy, explanation)
      values (c.org_id, c.id, 'queue', p_plan ->> 'strategy', coalesce(p_plan ->> 'reason', 'Nobody qualified has capacity right now.'));
      perform public.log_case_event(p_case, null, 'assigned', 'Waiting in the manager queue', p_plan ->> 'reason', '{}'::jsonb, false, false);
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'checks', '[]'::jsonb)) loop
    v_user := nullif(v_item ->> 'user_id', '')::uuid;
    continue when v_user is null or not public.is_active_staff(v_user, c.org_id);
    update public.case_checks set assigned_to = v_user, assigned_at = now()
     where id = (v_item ->> 'check_id')::uuid and case_id = p_case and assigned_to is null;
    if found then
      v_assigned := v_assigned + 1;
      insert into public.assignment_events (org_id, case_id, case_check_id, assigned_to, mode, strategy, score_breakdown, explanation)
      values (c.org_id, c.id, (v_item ->> 'check_id')::uuid, v_user, 'auto', p_plan ->> 'strategy', coalesce(v_item -> 'breakdown', '{}'::jsonb), v_item ->> 'explanation');
      if not v_user = any (v_people) then v_people := v_people || v_user; end if;
    end if;
  end loop;

  if cardinality(v_people) > 0 then
    perform public.notify_users(v_people, 'case.assigned', 'New case ' || c.reference || ' assigned to you', c.candidate_name,
      '/app/cases/' || c.id, true, 'case', c.id, c.org_id);
  end if;
  return jsonb_build_object('owner', v_owner, 'checks_assigned', v_assigned);
end $$;
revoke execute on function public.apply_auto_assignment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_auto_assignment(uuid, jsonb) to service_role;

select public.attach_audit('public.staff_skills', 'user_id,check_type_id');
select public.attach_audit('public.staff_capacity', 'user_id');
select public.attach_audit('public.staff_availability');
select public.attach_audit('public.assignment_rules', 'org_id');

alter table public.staff_skills enable row level security;
alter table public.staff_capacity enable row level security;
alter table public.staff_availability enable row level security;
alter table public.assignment_rules enable row level security;
alter table public.assignment_events enable row level security;

create policy staff_skills_select on public.staff_skills for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy staff_skills_insert on public.staff_skills for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('assignment.configure')));
create policy staff_skills_delete on public.staff_skills for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('assignment.configure')));

create policy staff_capacity_select on public.staff_capacity for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy staff_capacity_insert on public.staff_capacity for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('assignment.configure')));
create policy staff_capacity_update on public.staff_capacity for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('assignment.configure')))
  with check (org_id = (select public.auth_org_id()));

create policy staff_availability_select on public.staff_availability for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy staff_availability_insert on public.staff_availability for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff())
              and ((select public.has_permission('assignment.configure')) or user_id = (select auth.uid())));
create policy staff_availability_delete on public.staff_availability for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('assignment.configure')) or user_id = (select auth.uid())));

create policy assignment_rules_select on public.assignment_rules for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy assignment_rules_update on public.assignment_rules for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('assignment.configure')))
  with check (org_id = (select public.auth_org_id()));

create policy assignment_events_select on public.assignment_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
revoke insert, update, delete, truncate on public.assignment_events from anon, authenticated;
revoke insert, delete, truncate on public.assignment_rules from anon, authenticated;
