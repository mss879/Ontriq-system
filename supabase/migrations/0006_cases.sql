-- =============================================================================
-- 0006_cases.sql
-- Feature: the case engine. Candidates (matched by NIC), cases with their own
-- reference numbers, one row per check, document requirements, stage history,
-- the case timeline and the status catalogue. Every write goes through a
-- security definer function that checks permission and the workflow rules
-- (mirrored for the UI in src/domain/workflow/*); the tables themselves are
-- read-only to signed-in users.
-- Depends on: 0001, 0002, 0003, 0004_check_types, 0005_packages_templates,
--             0009_jobs (assign.auto), 0010_notifications_comms.
-- =============================================================================

create type public.case_stage as enum
  ('intake', 'documents', 'pre_qc', 'data_entry', 'verification', 'post_qc', 'report', 'approval', 'released', 'cancelled');
create type public.check_state as enum
  ('not_started', 'in_progress', 'awaiting_response', 'pending_info', 'returned', 'completed', 'discrepancy', 'unable_to_verify', 'waived');

-- ---------------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  full_name text not null,
  nic text,                 -- as written on the card
  nic_canonical text,       -- 12-digit form, same for old and new cards (src/domain/nic-core.ts)
  date_of_birth date,
  gender text check (gender in ('male', 'female')),
  email text,
  phone text,
  address text,
  district text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'si', 'ta')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index candidates_org_nic_key on public.candidates (org_id, nic_canonical) where nic_canonical is not null;
create index candidates_org_name_idx on public.candidates (org_id, lower(full_name));
create index candidates_created_by_idx on public.candidates (created_by);
create trigger a_set_org_id before insert on public.candidates
  for each row execute function public.set_org_id();
create trigger candidates_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------
create table public.case_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  year int not null,
  value int not null default 0,
  primary key (org_id, year)
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  reference text not null,
  client_id uuid not null references public.clients (id) on delete restrict,
  candidate_id uuid not null references public.candidates (id) on delete restrict,
  package_id uuid references public.packages (id) on delete set null,
  package_snapshot jsonb not null default '{}'::jsonb,
  process_type public.process_type not null default 'client_supplied',
  stage public.case_stage not null default 'documents',
  status_key text not null default 'documents_pending',
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  on_hold boolean not null default false,
  hold_reason text,
  held_at timestamptz,
  returned_at timestamptz,        -- set by a QC return until the case moves forward again
  return_note text,
  proposed_result text check (proposed_result in ('green', 'amber', 'red')),
  final_result text check (final_result in ('green', 'amber', 'red')),
  checks_total int not null default 0,
  checks_done int not null default 0,
  assigned_to uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,
  position_title text,
  department text,
  client_reference text,
  instructions text,
  candidate_name text not null,   -- snapshot for lists and search
  client_visible boolean not null default true,
  created_via text not null default 'staff' check (created_via in ('staff', 'portal', 'import', 'assistant')),
  received_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, reference)
);
create index cases_org_stage_idx on public.cases (org_id, stage, received_at desc);
create index cases_client_idx on public.cases (client_id, received_at desc);
create index cases_candidate_idx on public.cases (candidate_id);
create index cases_package_idx on public.cases (package_id);
create index cases_assigned_idx on public.cases (assigned_to, stage);
create index cases_created_by_idx on public.cases (created_by);
create index cases_due_idx on public.cases (org_id, due_at) where stage not in ('released', 'cancelled');
create trigger a_set_org_id before insert on public.cases
  for each row execute function public.set_org_id();
create trigger cases_updated_at before update on public.cases
  for each row execute function public.set_updated_at();

create table public.case_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  check_type_id uuid not null references public.check_types (id) on delete restrict,
  check_type_version_id uuid not null references public.check_type_versions (id) on delete restrict,
  label text not null,
  sort int not null default 100,
  state public.check_state not null default 'not_started',
  result text,
  result_tone text check (result_tone in ('green', 'amber', 'red')),
  values jsonb not null default '{}'::jsonb,
  values_valid boolean not null default false,
  client_note text,               -- a short, client-safe summary of the outcome
  assigned_to uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index case_checks_org_idx on public.case_checks (org_id, state);
create index case_checks_case_idx on public.case_checks (case_id, sort);
create index case_checks_type_idx on public.case_checks (check_type_id);
create index case_checks_version_idx on public.case_checks (check_type_version_id);
create index case_checks_assigned_idx on public.case_checks (assigned_to, state);
create index case_checks_updated_by_idx on public.case_checks (updated_by);
create trigger a_set_org_id before insert on public.case_checks
  for each row execute function public.set_org_id();
create trigger case_checks_updated_at before update on public.case_checks
  for each row execute function public.set_updated_at();

create table public.case_check_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete cascade,
  category text not null,
  label text not null,
  description text,
  min_count int not null default 1 check (min_count >= 0),
  received_count int not null default 0,
  stage text not null default 'documents' check (stage in ('documents', 'verification')),
  client_visible boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'received', 'waived', 'optional')),
  requested_note text,
  requested_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  waived_reason text,
  waived_by uuid references auth.users (id) on delete set null,
  waived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index case_check_requirements_org_idx on public.case_check_requirements (org_id);
create index case_check_requirements_case_idx on public.case_check_requirements (case_id, status);
create index case_check_requirements_check_idx on public.case_check_requirements (case_check_id);
create index case_check_requirements_requested_by_idx on public.case_check_requirements (requested_by);
create index case_check_requirements_waived_by_idx on public.case_check_requirements (waived_by);
create trigger a_set_org_id before insert on public.case_check_requirements
  for each row execute function public.set_org_id();
create trigger case_check_requirements_updated_at before update on public.case_check_requirements
  for each row execute function public.set_updated_at();

create table public.stage_history (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  from_stage public.case_stage,
  to_stage public.case_stage not null,
  event text not null,
  reason text,
  actor_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index stage_history_org_idx on public.stage_history (org_id, at desc);
create index stage_history_case_idx on public.stage_history (case_id, at);
create index stage_history_actor_idx on public.stage_history (actor_id);

-- The case timeline. visible_to_client / visible_to_candidate decide what the
-- portal (Phase 2) and the candidate link may show.
create table public.case_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  visible_to_client boolean not null default false,
  visible_to_candidate boolean not null default false,
  actor_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index case_events_org_idx on public.case_events (org_id, at desc);
create index case_events_case_idx on public.case_events (case_id, at desc);
create index case_events_check_idx on public.case_events (case_check_id);
create index case_events_actor_idx on public.case_events (actor_id);

-- Configurable status wording (requirements §1.4): internal, client and candidate labels.
create table public.client_status_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null,
  stage public.case_stage not null,
  internal_label text not null,
  client_label text not null,
  candidate_label text not null,
  sort int not null default 100,
  unique (org_id, key)
);
create trigger a_set_org_id before insert on public.client_status_catalog
  for each row execute function public.set_org_id();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Close of business (17:30 Asia/Colombo) p_days working days after p_from.
-- Mirrors addWorkingDays() in src/domain/sla-core.ts.
create or replace function public.add_working_days(p_from timestamptz, p_days int) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  d date := (p_from at time zone 'Asia/Colombo')::date;
  left_ int := greatest(coalesce(p_days, 0), 0);
begin
  while left_ > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 then left_ := left_ - 1; end if;
  end loop;
  while extract(isodow from d) >= 6 loop d := d + 1; end loop;
  return (d + time '17:30') at time zone 'Asia/Colombo';
end $$;
revoke execute on function public.add_working_days(timestamptz, int) from public, anon;
grant execute on function public.add_working_days(timestamptz, int) to authenticated, service_role;

-- ONT-2026-000123, gapless per org and year.
create or replace function public.next_case_number(p_org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from now() at time zone 'Asia/Colombo')::int;
  v_value int;
begin
  insert into public.case_counters (org_id, year, value) values (p_org, v_year, 1)
  on conflict (org_id, year) do update set value = public.case_counters.value + 1
  returning value into v_value;
  return 'ONT-' || v_year || '-' || lpad(v_value::text, 6, '0');
end $$;
revoke execute on function public.next_case_number(uuid) from public, anon, authenticated;

-- Can the caller see this case? Staff with cases.read see all; others see the
-- cases they own or hold a check on, and data entry officers see the data entry queue.
create or replace function public.case_visible(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cases c
     where c.id = p_case
       and c.org_id = public.auth_org_id()
       and public.is_staff()
       and (public.has_permission('cases.read')
            or c.assigned_to = auth.uid()
            or (public.has_permission('checks.data_entry') and c.stage = 'data_entry')
            or exists (select 1 from public.case_checks cc where cc.case_id = c.id and cc.assigned_to = auth.uid()))
  )
$$;
revoke execute on function public.case_visible(uuid) from public, anon;
grant execute on function public.case_visible(uuid) to authenticated, service_role;

create or replace function public.log_case_event(
  p_case uuid, p_check uuid, p_kind text, p_title text, p_body text default null, p_data jsonb default '{}'::jsonb,
  p_client boolean default false, p_candidate boolean default false
) returns void
language sql security definer set search_path = '' as $$
  insert into public.case_events (org_id, case_id, case_check_id, kind, title, body, data, visible_to_client, visible_to_candidate, actor_id)
  select c.org_id, c.id, p_check, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_client, p_candidate, auth.uid()
    from public.cases c where c.id = p_case
$$;
revoke execute on function public.log_case_event(uuid, uuid, text, text, text, jsonb, boolean, boolean) from public, anon, authenticated;

-- Roll-ups: counts, proposed result and working status. Mirrors rollup-core.ts.
create or replace function public.recompute_case(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_total int;
  v_done int;
  v_red boolean;
  v_green boolean;
  v_pending_info boolean;
  v_status text;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return; end if;
  select count(*) filter (where state <> 'waived'),
         count(*) filter (where state in ('completed', 'discrepancy', 'unable_to_verify')),
         bool_or(state = 'discrepancy' or result_tone = 'red'),
         coalesce(bool_and(state = 'completed' and result_tone = 'green') filter (where state <> 'waived'), false)
    into v_total, v_done, v_red, v_green
    from public.case_checks where case_id = p_case;
  select exists (select 1 from public.case_check_requirements r
                  where r.case_id = p_case and r.status = 'pending' and r.requested_at is not null)
    into v_pending_info;

  v_status := case c.stage
    when 'intake' then 'case_received'
    when 'documents' then case when c.returned_at is not null then 'returned_for_correction'
                               when v_pending_info then 'pending_information' else 'documents_pending' end
    when 'pre_qc' then 'pre_qc_in_progress'
    when 'data_entry' then 'data_entry_in_progress'
    when 'verification' then case when c.returned_at is not null then 'returned_for_correction'
                                  when v_done > 0 and v_done < v_total then 'partially_completed'
                                  else 'verification_in_progress' end
    when 'post_qc' then 'pending_post_qc'
    when 'report' then 'final_report_in_progress'
    when 'approval' then 'pending_final_approval'
    when 'released' then 'report_released'
    else 'cancelled' end;

  update public.cases
     set checks_total = v_total,
         checks_done = v_done,
         proposed_result = case when coalesce(v_red, false) then 'red' when v_total > 0 and v_green then 'green' else 'amber' end,
         status_key = v_status
   where id = p_case
     and (checks_total, checks_done, coalesce(proposed_result, ''), status_key)
         is distinct from (v_total, v_done, case when coalesce(v_red, false) then 'red' when v_total > 0 and v_green then 'green' else 'amber' end, v_status);
end $$;
revoke execute on function public.recompute_case(uuid) from public, anon, authenticated;

-- Required documents not yet in for a stage.
create or replace function public.case_outstanding_requirements(p_case uuid, p_stage text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.case_check_requirements r
   where r.case_id = p_case and r.status = 'pending' and r.min_count > r.received_count
     and (p_stage = 'verification' or r.stage = p_stage)
$$;
revoke execute on function public.case_outstanding_requirements(uuid, text) from public, anon;
grant execute on function public.case_outstanding_requirements(uuid, text) to authenticated, service_role;

-- Wording for the timeline (matches src/domain/workflow/stages.ts).
create or replace function public.stage_label(p public.case_stage) returns text
language sql immutable set search_path = '' as $$
  select case p when 'intake' then 'Case received' when 'documents' then 'Document collection' when 'pre_qc' then 'Pre-QC'
    when 'data_entry' then 'Data entry' when 'verification' then 'Verification' when 'post_qc' then 'Post-QC'
    when 'report' then 'Final report' when 'approval' then 'Final approval' when 'released' then 'Report released' else 'Cancelled' end
$$;
create or replace function public.check_state_label(p public.check_state) returns text
language sql immutable set search_path = '' as $$
  select case p when 'not_started' then 'Not started' when 'in_progress' then 'In progress' when 'awaiting_response' then 'Awaiting response'
    when 'pending_info' then 'Pending information' when 'returned' then 'Returned by QC' when 'completed' then 'Completed'
    when 'discrepancy' then 'Discrepancy' when 'unable_to_verify' then 'Unable to verify' else 'Waived' end
$$;
revoke execute on function public.stage_label(public.case_stage), public.check_state_label(public.check_state) from public, anon;
grant execute on function public.stage_label(public.case_stage), public.check_state_label(public.check_state) to authenticated, service_role;

-- Move a case and record it. Internal: callers check permission and guards first.
create or replace function public.move_case(p_case uuid, p_to public.case_stage, p_event text, p_reason text default null, p_returned boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_label text;
begin
  select * into c from public.cases where id = p_case for update;
  update public.cases
     set stage = p_to,
         returned_at = case when p_returned then now() else null end,
         return_note = case when p_returned then p_reason else null end,
         completed_at = case when p_to = 'report' then coalesce(completed_at, now()) else completed_at end
   where id = p_case;
  insert into public.stage_history (org_id, case_id, from_stage, to_stage, event, reason, actor_id)
  values (c.org_id, c.id, c.stage, p_to, p_event, p_reason, auth.uid());
  v_label := public.stage_label(p_to);
  perform public.log_case_event(p_case, null, case when p_returned then 'returned' else 'stage_changed' end,
    case when p_returned then 'Returned for correction' else 'Moved to ' || v_label end,
    p_reason, jsonb_build_object('from', c.stage, 'to', p_to, 'event', p_event), true, p_to in ('pre_qc', 'verification', 'report'));
  perform public.recompute_case(p_case);
  if p_returned and c.assigned_to is not null and c.assigned_to is distinct from auth.uid() then
    perform public.notify_users(array[c.assigned_to], 'case.returned', c.reference || ' was returned', coalesce(p_reason, ''),
      '/app/cases/' || c.id, true, 'case', c.id, c.org_id);
  end if;
end $$;
revoke execute on function public.move_case(uuid, public.case_stage, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create a case
-- ---------------------------------------------------------------------------
-- p: { client_id, package_id | check_type_ids[], process_type, priority,
--      position_title, department, client_reference, instructions, template_id,
--      created_via, candidate: { id | full_name, nic, nic_canonical,
--      date_of_birth, gender, email, phone, address, district, preferred_language } }
create or replace function public.create_case(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_client public.clients;
  v_is_client boolean := false;
  v_package public.packages;
  v_snapshot jsonb;
  v_types uuid[];
  v_type record;
  v_cand jsonb := coalesce(p -> 'candidate', '{}'::jsonb);
  v_candidate_id uuid;
  v_reused boolean := false;
  v_case_id uuid;
  v_reference text;
  v_tat int;
  v_due timestamptz;
  v_stage public.case_stage;
  v_via text := coalesce(nullif(p ->> 'created_via', ''), 'staff');
  v_check_id uuid;
  v_doc jsonb;
  v_sort int := 0;
begin
  -- Who may create: staff with cases.create, or a client user with portal.cases.create for their own company.
  if v_uid is not null then
    if public.is_staff() and public.has_permission('cases.create') then
      v_org := public.auth_org_id();
    elsif public.is_client() and public.has_permission('portal.cases.create') then
      v_org := public.auth_org_id();
      v_is_client := true;
      v_via := 'portal';
    else
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;

  select * into v_client from public.clients where id = (p ->> 'client_id')::uuid;
  if v_client.id is null or (v_org is not null and v_client.org_id <> v_org) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  if v_is_client and v_client.id <> public.client_id_of_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_client.status not in ('active', 'prospect') then
    raise exception 'this client is %; activate it before creating cases', v_client.status using errcode = '22023';
  end if;
  v_org := v_client.org_id;

  -- Checks: from a package, or a custom list.
  if nullif(p ->> 'package_id', '') is not null then
    select * into v_package from public.packages where id = (p ->> 'package_id')::uuid and org_id = v_org and is_active;
    if v_package.id is null then raise exception 'package not found' using errcode = 'P0002'; end if;
    if v_package.owner_scope = 'client' and v_package.client_id <> v_client.id then
      raise exception 'this package belongs to another client' using errcode = '42501';
    end if;
    if v_is_client and not public.client_can_use_package(v_package.id, v_client.id) then
      raise exception 'this package is not available to you' using errcode = '42501';
    end if;
    select array_agg(pi.check_type_id order by pi.sort, ct.sort) into v_types
      from public.package_items pi join public.check_types ct on ct.id = pi.check_type_id
     where pi.package_id = v_package.id;
    v_tat := v_package.tat_days;
  else
    select array_agg(ct.id order by ct.sort) into v_types
      from public.check_types ct
     where ct.org_id = v_org and ct.id in (select (jsonb_array_elements_text(coalesce(p -> 'check_type_ids', '[]'::jsonb)))::uuid);
    v_tat := v_client.sla_days;
  end if;
  if v_types is null or cardinality(v_types) = 0 then
    raise exception 'choose at least one check' using errcode = '22023';
  end if;
  if exists (select 1 from public.client_check_type_access a where a.client_id = v_client.id and a.check_type_id = any (v_types) and not a.enabled) then
    raise exception 'one of these checks is turned off for this client' using errcode = '42501';
  end if;
  if exists (select 1 from public.check_types ct where ct.id = any (v_types) and (ct.current_version_id is null or ct.archived_at is not null)) then
    raise exception 'one of these checks has no published version' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'package_id', v_package.id, 'name', coalesce(v_package.name, 'Custom selection'), 'code', v_package.code,
           'pricing_mode', coalesce(v_package.pricing_mode, 'sum'), 'fixed_price', v_package.fixed_price,
           'currency', coalesce(v_package.currency, 'LKR'), 'tat_days', v_tat,
           'items', coalesce(jsonb_agg(jsonb_build_object(
             'check_type_id', ct.id, 'key', ct.key, 'name', ct.name, 'version_id', ct.current_version_id,
             'unit_price', coalesce((select pi.unit_price from public.package_items pi where pi.package_id = v_package.id and pi.check_type_id = ct.id), 0))
             order by array_position(v_types, ct.id)), '[]'::jsonb))
    into v_snapshot
    from public.check_types ct where ct.id = any (v_types);

  -- Candidate: reuse by id or NIC, otherwise create.
  if nullif(v_cand ->> 'id', '') is not null then
    select id into v_candidate_id from public.candidates where id = (v_cand ->> 'id')::uuid and org_id = v_org;
    if v_candidate_id is null then raise exception 'candidate not found' using errcode = 'P0002'; end if;
    v_reused := true;
  elsif nullif(v_cand ->> 'nic_canonical', '') is not null then
    select id into v_candidate_id from public.candidates where org_id = v_org and nic_canonical = v_cand ->> 'nic_canonical';
    v_reused := v_candidate_id is not null;
  end if;
  if v_candidate_id is null then
    if coalesce(trim(v_cand ->> 'full_name'), '') = '' then
      raise exception 'enter the candidate''s name' using errcode = '22023';
    end if;
    insert into public.candidates (org_id, full_name, nic, nic_canonical, date_of_birth, gender, email, phone, address, district, preferred_language, created_by)
    values (v_org, trim(v_cand ->> 'full_name'), nullif(trim(v_cand ->> 'nic'), ''), nullif(v_cand ->> 'nic_canonical', ''),
            nullif(v_cand ->> 'date_of_birth', '')::date, nullif(v_cand ->> 'gender', ''), nullif(lower(trim(v_cand ->> 'email')), ''),
            nullif(trim(v_cand ->> 'phone'), ''), nullif(trim(v_cand ->> 'address'), ''), nullif(v_cand ->> 'district', ''),
            coalesce(nullif(v_cand ->> 'preferred_language', ''), 'en'), v_uid)
    returning id into v_candidate_id;
  end if;

  v_reference := public.next_case_number(v_org);
  v_due := public.add_working_days(now(), v_tat);
  v_stage := case when v_via = 'portal' then 'intake'::public.case_stage else 'documents'::public.case_stage end;

  insert into public.cases (org_id, reference, client_id, candidate_id, package_id, package_snapshot, process_type, stage, status_key, priority,
                            position_title, department, client_reference, instructions, candidate_name, created_via, due_at, created_by)
  select v_org, v_reference, v_client.id, v_candidate_id, v_package.id, v_snapshot,
         coalesce(nullif(p ->> 'process_type', ''), coalesce(v_package.default_process_type::text, 'client_supplied'))::public.process_type,
         v_stage, case when v_stage = 'intake' then 'case_received' else 'documents_pending' end,
         coalesce(nullif(p ->> 'priority', ''), 'normal'),
         nullif(trim(p ->> 'position_title'), ''), nullif(trim(p ->> 'department'), ''), nullif(trim(p ->> 'client_reference'), ''),
         nullif(trim(p ->> 'instructions'), ''), cd.full_name, v_via, v_due, v_uid
    from public.candidates cd where cd.id = v_candidate_id
  returning id into v_case_id;

  for v_type in
    select ct.id, ct.name, ct.current_version_id, v.schema
      from unnest(v_types) with ordinality as t(id, ord)
      join public.check_types ct on ct.id = t.id
      join public.check_type_versions v on v.id = ct.current_version_id
     order by t.ord
  loop
    v_sort := v_sort + 10;
    insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort, due_at)
    values (v_org, v_case_id, v_type.id, v_type.current_version_id, v_type.name, v_sort,
            least(v_due, public.add_working_days(now(), coalesce((v_type.schema ->> 'sla_days')::int, v_tat))))
    returning id into v_check_id;
    for v_doc in select * from jsonb_array_elements(coalesce(v_type.schema -> 'documents', '[]'::jsonb)) loop
      insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, description, min_count, stage, client_visible, status)
      values (v_org, v_case_id, v_check_id, v_doc ->> 'category', v_doc ->> 'label', v_doc ->> 'description',
              coalesce((v_doc ->> 'min')::int, 1), coalesce(v_doc ->> 'stage', 'documents'),
              coalesce((v_doc ->> 'client_visible')::boolean, false),
              case when coalesce((v_doc ->> 'min')::int, 1) = 0 then 'optional' else 'pending' end);
    end loop;
  end loop;

  insert into public.stage_history (org_id, case_id, from_stage, to_stage, event, actor_id)
  values (v_org, v_case_id, null, v_stage, 'created', v_uid);
  perform public.log_case_event(v_case_id, null, 'created', 'Case received',
    case when v_reused then 'Linked to an existing candidate record.' else null end,
    jsonb_build_object('via', v_via, 'checks', cardinality(v_types)), true, true);
  perform public.recompute_case(v_case_id);

  if nullif(p ->> 'template_id', '') is not null then
    update public.request_templates set usage_count = usage_count + 1, last_used_at = now()
     where id = (p ->> 'template_id')::uuid and org_id = v_org;
  end if;

  perform public.enqueue_job('assign.auto', jsonb_build_object('case_id', v_case_id), 'assign.auto:' || v_case_id,
                             now(), null, 'case', v_case_id, null, v_org, v_uid);

  return jsonb_build_object('case_id', v_case_id, 'reference', v_reference, 'candidate_id', v_candidate_id, 'candidate_reused', v_reused);
end $$;
revoke execute on function public.create_case(jsonb) from public, anon;
grant execute on function public.create_case(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Move a case through the workflow (QC decisions use record_qc_review, 0011)
-- ---------------------------------------------------------------------------
create or replace function public.case_transition(p_case uuid, p_event text, p_reason text default null) returns public.case_stage
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_mover boolean;
  v_n int;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then
    raise exception 'case not found' using errcode = 'P0002';
  end if;
  if c.on_hold then raise exception 'this case is on hold; resume it first' using errcode = '22023'; end if;
  v_mover := auth.uid() is null or public.has_permission('cases.stage.change')
             or (c.assigned_to = auth.uid() and public.has_permission('cases.update'));

  case p_event
    when 'accept_request' then
      if c.stage <> 'intake' then raise exception 'the case is not waiting to be accepted' using errcode = '22023'; end if;
      if not (auth.uid() is null or public.has_permission('cases.update')) then raise exception 'not allowed' using errcode = '42501'; end if;
      perform public.move_case(p_case, 'documents', p_event, p_reason);
      return 'documents';
    when 'submit_pre_qc' then
      if c.stage <> 'documents' then raise exception 'the case is not collecting documents' using errcode = '22023'; end if;
      if not v_mover then raise exception 'not allowed' using errcode = '42501'; end if;
      v_n := public.case_outstanding_requirements(p_case, 'documents');
      if v_n > 0 then raise exception '% required document(s) still missing; upload or waive them first', v_n using errcode = '22023'; end if;
      perform public.move_case(p_case, 'pre_qc', p_event, p_reason);
      return 'pre_qc';
    when 'start_verification' then
      if c.stage <> 'data_entry' then raise exception 'the case is not in data entry' using errcode = '22023'; end if;
      if not (auth.uid() is null or public.has_permission('checks.data_entry') or public.has_permission('cases.stage.change')) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      select count(*) into v_n from public.case_checks where case_id = p_case and state <> 'waived' and not values_valid;
      if v_n > 0 then raise exception '% check(s) still have missing or invalid details', v_n using errcode = '22023'; end if;
      update public.case_checks set state = 'in_progress', started_at = coalesce(started_at, now())
       where case_id = p_case and state = 'not_started';
      perform public.move_case(p_case, 'verification', p_event, p_reason);
      return 'verification';
    when 'submit_post_qc' then
      if c.stage <> 'verification' then raise exception 'the case is not in verification' using errcode = '22023'; end if;
      if not v_mover then raise exception 'not allowed' using errcode = '42501'; end if;
      select count(*) into v_n from public.case_checks
       where case_id = p_case and state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived');
      if v_n > 0 then raise exception '% check(s) still open', v_n using errcode = '22023'; end if;
      v_n := public.case_outstanding_requirements(p_case, 'verification');
      if v_n > 0 then raise exception '% required document(s) still missing', v_n using errcode = '22023'; end if;
      perform public.move_case(p_case, 'post_qc', p_event, p_reason);
      return 'post_qc';
    when 'return_to_documents' then
      if c.stage not in ('data_entry', 'verification') then raise exception 'the case cannot go back to documents from here' using errcode = '22023'; end if;
      if not (auth.uid() is null or public.has_permission('cases.stage.change')) then raise exception 'not allowed' using errcode = '42501'; end if;
      if coalesce(trim(p_reason), '') = '' then raise exception 'say why the case goes back' using errcode = '22023'; end if;
      perform public.move_case(p_case, 'documents', p_event, p_reason, true);
      return 'documents';
    else
      raise exception 'unknown case event %', p_event using errcode = '22023';
  end case;
end $$;
revoke execute on function public.case_transition(uuid, text, text) from public, anon;
grant execute on function public.case_transition(uuid, text, text) to authenticated, service_role;

create or replace function public.set_case_hold(p_case uuid, p_hold boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.hold') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if p_hold = c.on_hold then return; end if;
  if p_hold and coalesce(trim(p_reason), '') = '' then raise exception 'say why the case is on hold' using errcode = '22023'; end if;
  update public.cases set on_hold = p_hold, hold_reason = case when p_hold then p_reason end, held_at = case when p_hold then now() end
   where id = p_case;
  perform public.log_case_event(p_case, null, case when p_hold then 'hold' else 'resumed' end,
    case when p_hold then 'Put on hold' else 'Resumed' end, p_reason, '{}'::jsonb, true, false);
end $$;
revoke execute on function public.set_case_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_case_hold(uuid, boolean, text) to authenticated, service_role;

create or replace function public.cancel_case(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.cancel') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is already closed' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the case is cancelled' using errcode = '22023'; end if;
  update public.cases set cancelled_at = now(), cancel_reason = p_reason, on_hold = false where id = p_case;
  perform public.move_case(p_case, 'cancelled', 'cancel', p_reason);
end $$;
revoke execute on function public.cancel_case(uuid, text) from public, anon;
grant execute on function public.cancel_case(uuid, text) to authenticated, service_role;

-- Case details that don't affect the workflow.
create or replace function public.update_case_details(p_case uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.cases set
    priority = coalesce(nullif(p ->> 'priority', ''), priority),
    position_title = case when p ? 'position_title' then nullif(trim(p ->> 'position_title'), '') else position_title end,
    department = case when p ? 'department' then nullif(trim(p ->> 'department'), '') else department end,
    client_reference = case when p ? 'client_reference' then nullif(trim(p ->> 'client_reference'), '') else client_reference end,
    instructions = case when p ? 'instructions' then nullif(trim(p ->> 'instructions'), '') else instructions end,
    due_at = case when p ? 'due_at' and public.has_permission('cases.assign') then (p ->> 'due_at')::timestamptz else due_at end
  where id = p_case;
  perform public.log_case_event(p_case, null, 'details_updated', 'Case details updated', null,
    (select jsonb_object_agg(k, true) from jsonb_object_keys(p) k), false, false);
end $$;
revoke execute on function public.update_case_details(uuid, jsonb) from public, anon;
grant execute on function public.update_case_details(uuid, jsonb) to authenticated, service_role;

create or replace function public.update_candidate(p_candidate uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not (public.is_staff() and (public.has_permission('candidates.manage')
       or (public.has_permission('cases.update') and exists (select 1 from public.cases c where c.candidate_id = p_candidate and public.case_visible(c.id))))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.candidates set
    full_name = coalesce(nullif(trim(p ->> 'full_name'), ''), full_name),
    nic = case when p ? 'nic' then nullif(trim(p ->> 'nic'), '') else nic end,
    nic_canonical = case when p ? 'nic_canonical' then nullif(p ->> 'nic_canonical', '') else nic_canonical end,
    date_of_birth = case when p ? 'date_of_birth' then nullif(p ->> 'date_of_birth', '')::date else date_of_birth end,
    gender = case when p ? 'gender' then nullif(p ->> 'gender', '') else gender end,
    email = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else email end,
    phone = case when p ? 'phone' then nullif(trim(p ->> 'phone'), '') else phone end,
    address = case when p ? 'address' then nullif(trim(p ->> 'address'), '') else address end,
    district = case when p ? 'district' then nullif(p ->> 'district', '') else district end,
    preferred_language = coalesce(nullif(p ->> 'preferred_language', ''), preferred_language)
  where id = p_candidate and (auth.uid() is null or org_id = public.auth_org_id());
  if not found then raise exception 'candidate not found' using errcode = 'P0002'; end if;
  update public.cases set candidate_name = (select full_name from public.candidates where id = p_candidate)
   where candidate_id = p_candidate and stage not in ('released', 'cancelled');
end $$;
revoke execute on function public.update_candidate(uuid, jsonb) from public, anon;
grant execute on function public.update_candidate(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
-- Values come from the server action, which validated them against the
-- check's schema (src/domain/check-types/validate.ts) and passes p_valid.
create or replace function public.save_check_values(p_check uuid, p_values jsonb, p_valid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check for update;
  select * into c from public.cases where id = k.case_id;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') and (public.has_permission('checks.data_entry') or public.has_permission('checks.verify'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if c.stage not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'details are locked once the case reaches Post-QC' using errcode = '22023';
  end if;
  if k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then
    raise exception 'reopen the check before editing its details' using errcode = '22023';
  end if;
  update public.case_checks
     set values = coalesce(p_values, '{}'::jsonb), values_valid = coalesce(p_valid, false), updated_by = auth.uid(),
         state = case when state = 'not_started' then 'in_progress'::public.check_state else state end,
         started_at = coalesce(started_at, now())
   where id = p_check;
end $$;
revoke execute on function public.save_check_values(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_check_values(uuid, jsonb, boolean) to authenticated, service_role;

create or replace function public.set_check_state(p_check uuid, p_state public.check_state, p_result text default null, p_note text default null, p_client_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
  v_schema jsonb;
  v_result text := nullif(p_result, '');
  v_tone text;
  v_label text;
  v_manager boolean;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  v_manager := auth.uid() is null or public.has_permission('cases.stage.change') or public.has_permission('cases.assign');
  if auth.uid() is not null and not (public.has_permission('checks.verify') and (k.assigned_to = auth.uid() or c.assigned_to = auth.uid() or v_manager)) then
    raise exception 'only the officer on this check or a manager can change its status' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;

  if p_state in ('completed', 'discrepancy', 'unable_to_verify') then
    if c.stage <> 'verification' then raise exception 'results are recorded during verification' using errcode = '22023'; end if;
    if p_state = 'discrepancy' then v_result := coalesce(v_result, 'discrepancy'); end if;
    if p_state = 'unable_to_verify' then v_result := coalesce(v_result, 'unable_to_verify'); end if;
    if v_result is null then raise exception 'choose a result' using errcode = '22023'; end if;
    select schema into v_schema from public.check_type_versions where id = k.check_type_version_id;
    select o ->> 'tone', o ->> 'label' into v_tone, v_label
      from jsonb_array_elements(coalesce(v_schema -> 'result' -> 'options', '[]'::jsonb)) o where o ->> 'key' = v_result;
    if v_tone is null then raise exception 'that result is not an option for this check' using errcode = '22023'; end if;
    if p_state = 'completed' and v_tone = 'red' then raise exception 'record a red result as a discrepancy' using errcode = '22023'; end if;
    if not k.values_valid then raise exception 'complete the check''s details first' using errcode = '22023'; end if;
  elsif p_state = 'waived' then
    if not v_manager and not public.has_permission('qc.post') then raise exception 'only a manager can waive a check' using errcode = '42501'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'say why the check is waived' using errcode = '22023'; end if;
    v_result := null;
  else
    v_result := null;
  end if;

  update public.case_checks
     set state = p_state,
         result = v_result,
         result_tone = v_tone,
         client_note = case when p_client_note is not null then nullif(trim(p_client_note), '') else client_note end,
         completed_at = case when p_state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then now() else null end,
         started_at = coalesce(started_at, now()),
         updated_by = auth.uid()
   where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'check_state',
    k.label || ': ' || public.check_state_label(p_state) || coalesce(' (' || v_label || ')', ''),
    nullif(trim(p_note), ''), jsonb_build_object('from', k.state, 'to', p_state, 'result', v_result), p_state in ('completed', 'waived'), false);
  perform public.recompute_case(k.case_id);
end $$;
revoke execute on function public.set_check_state(uuid, public.check_state, text, text, text) from public, anon;
grant execute on function public.set_check_state(uuid, public.check_state, text, text, text) to authenticated, service_role;

create or replace function public.add_case_note(p_case uuid, p_check uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'write a note first' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  perform public.log_case_event(p_case, p_check, 'note', 'Note', left(trim(p_body), 4000), '{}'::jsonb, false, false);
end $$;
revoke execute on function public.add_case_note(uuid, uuid, text) from public, anon;
grant execute on function public.add_case_note(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Document requirements
-- ---------------------------------------------------------------------------
create or replace function public.request_case_document(p_case uuid, p_check uuid, p_category text, p_label text, p_note text default null, p_min int default 1)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if not exists (select 1 from public.document_categories d where d.org_id = c.org_id and d.key = p_category) then
    raise exception 'unknown document category' using errcode = '22023';
  end if;
  select id into v_id from public.case_check_requirements
   where case_id = p_case and category = p_category and case_check_id is not distinct from p_check;
  if v_id is not null then
    update public.case_check_requirements
       set status = 'pending', min_count = greatest(min_count, received_count + greatest(p_min, 1)),
           requested_note = p_note, requested_at = now(), requested_by = auth.uid(), waived_reason = null, waived_by = null, waived_at = null
     where id = v_id;
  else
    insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, min_count, status, client_visible, requested_note, requested_at, requested_by)
    values (c.org_id, p_case, p_check, p_category, coalesce(nullif(trim(p_label), ''), p_category), greatest(p_min, 1), 'pending', true, p_note, now(), auth.uid())
    returning id into v_id;
  end if;
  perform public.log_case_event(p_case, p_check, 'document_requested', 'Document requested: ' || coalesce(nullif(trim(p_label), ''), p_category),
    p_note, jsonb_build_object('category', p_category), true, true);
  perform public.recompute_case(p_case);
  return v_id;
end $$;
revoke execute on function public.request_case_document(uuid, uuid, text, text, text, int) from public, anon;
grant execute on function public.request_case_document(uuid, uuid, text, text, text, int) to authenticated, service_role;

create or replace function public.waive_requirement(p_requirement uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.case_check_requirements;
begin
  select * into r from public.case_check_requirements where id = p_requirement for update;
  if r.id is null or (auth.uid() is not null and not public.case_visible(r.case_id)) then raise exception 'requirement not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.stage.change') or public.has_permission('qc.pre')) then
    raise exception 'only a manager or QC officer can waive a document' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the document is waived' using errcode = '22023'; end if;
  update public.case_check_requirements set status = 'waived', waived_reason = p_reason, waived_by = auth.uid(), waived_at = now() where id = p_requirement;
  perform public.log_case_event(r.case_id, r.case_check_id, 'requirement_waived', 'Document waived: ' || r.label, p_reason, '{}'::jsonb, false, false);
  perform public.recompute_case(r.case_id);
end $$;
revoke execute on function public.waive_requirement(uuid, text) from public, anon;
grant execute on function public.waive_requirement(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit, row level security
-- ---------------------------------------------------------------------------
select public.attach_audit('public.candidates');
select public.attach_audit('public.cases');
select public.attach_audit('public.case_checks');
select public.attach_audit('public.case_check_requirements');
select public.attach_audit('public.client_status_catalog');

alter table public.candidates enable row level security;
alter table public.case_counters enable row level security;
alter table public.cases enable row level security;
alter table public.case_checks enable row level security;
alter table public.case_check_requirements enable row level security;
alter table public.stage_history enable row level security;
alter table public.case_events enable row level security;
alter table public.client_status_catalog enable row level security;

create policy candidates_select on public.candidates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (
    (select public.has_permission('cases.read')) or (select public.has_permission('candidates.manage'))
    or exists (select 1 from public.cases c where c.candidate_id = candidates.id and public.case_visible(c.id))
  ));
create policy cases_select on public.cases for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.has_permission('cases.read')) and (select public.is_staff()) or public.case_visible(id)));
create policy case_checks_select on public.case_checks for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
create policy case_check_requirements_select on public.case_check_requirements for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
create policy stage_history_select on public.stage_history for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
create policy case_events_select on public.case_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
create policy client_status_catalog_select on public.client_status_catalog for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_staff()) or (select public.is_client())));
create policy client_status_catalog_update on public.client_status_catalog for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('settings.manage')))
  with check (org_id = (select public.auth_org_id()));

-- Writes happen only through the functions above.
revoke insert, update, delete, truncate on public.candidates, public.case_counters, public.cases, public.case_checks,
  public.case_check_requirements, public.stage_history, public.case_events from anon, authenticated;
revoke insert, delete, truncate on public.client_status_catalog from anon, authenticated;
comment on table public.case_counters is 'Deny-all to API roles by design: only next_case_number() reads and writes it.';
