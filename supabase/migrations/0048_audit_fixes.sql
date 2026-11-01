-- =============================================================================
-- 0048_audit_fixes.sql
-- Everything an independent check of the build against the client's two
-- documents found, on 31 October 2026. See docs/features/0048-audit-fixes.md
-- and docs/verification/requirements-audit-2026-10-31.md.
--   Confidentiality (spec 6.4): staff notes are separate from client
--   instructions, client users can't read Ontriq's record of their company, and
--   the portal's feed no longer gives away an adverse result.
--   Workflow (spec 3, 5): holds and stages are enforced in the database, Post-QC
--   can return to Data Entry, and internal returns stay internal.
--   Evidence (spec 4, 7, 8): a file per employer, copy or original per document,
--   reports in parts rather than cut short, screening details and BGV forms.
--   Configuration (spec 6.2, 10): your own statuses and the flowchart's order.
-- Depends on: 0001, 0002, 0003, 0006, 0007, 0008, 0011, 0012, 0021, 0038, 0040,
-- 0041, 0042, 0046, 0047.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Staff notes aren't client instructions (spec 6.4)
-- ---------------------------------------------------------------------------
-- One column served both, and the portal printed it as "Your instructions".
-- What staff typed moves to the new column. Requests from the portal stay put.
alter table public.cases add column internal_notes text;
comment on column public.cases.internal_notes is 'Ontriq''s own notes on the case. Never sent to the portal, unlike instructions.';
update public.cases set internal_notes = instructions, instructions = null
 where created_via <> 'portal' and instructions is not null;

-- ---------------------------------------------------------------------------
-- Statuses of your own (spec 6.2, 10)
-- ---------------------------------------------------------------------------
-- The built-in statuses follow the workflow. These are set by hand on a case,
-- and last until the case moves stage.
alter table public.client_status_catalog
  add column is_custom boolean not null default false,
  add column is_active boolean not null default true;
alter table public.cases add column manual_status_key text;

create or replace function public.save_custom_status(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_key text := nullif(p ->> 'key', '');
  v_label text := nullif(trim(p ->> 'internal_label'), '');
begin
  if not public.has_permission('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_label is null then raise exception 'name the status' using errcode = '22023'; end if;
  if v_key is null then
    v_key := 'custom_' || left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 40) || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.client_status_catalog (org_id, key, stage, internal_label, client_label, candidate_label, sort, is_custom)
    values (v_org, v_key, 'verification', left(v_label, 60), left(coalesce(nullif(trim(p ->> 'client_label'), ''), v_label), 60),
            left(coalesce(nullif(trim(p ->> 'candidate_label'), ''), 'Verification in progress'), 60), 200, true);
  else
    update public.client_status_catalog
       set internal_label = left(v_label, 60),
           client_label = left(coalesce(nullif(trim(p ->> 'client_label'), ''), client_label), 60),
           candidate_label = left(coalesce(nullif(trim(p ->> 'candidate_label'), ''), candidate_label), 60),
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where org_id = v_org and key = v_key and is_custom;
    if not found then raise exception 'status not found' using errcode = 'P0002'; end if;
  end if;
  return v_key;
end $$;
revoke execute on function public.save_custom_status(jsonb) from public, anon;
grant execute on function public.save_custom_status(jsonb) to authenticated, service_role;

create or replace function public.set_case_status(p_case uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_label text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if nullif(p_key, '') is not null then
    select internal_label into v_label from public.client_status_catalog
     where org_id = c.org_id and key = p_key and is_custom and is_active;
    if v_label is null then raise exception 'status not found' using errcode = 'P0002'; end if;
  end if;
  update public.cases set manual_status_key = nullif(p_key, '') where id = p_case;
  perform public.log_case_event(p_case, null, 'status_set', coalesce('Status set to ' || v_label, 'Status back to automatic'), null,
    jsonb_build_object('status', nullif(p_key, '')), false, false);
  perform public.recompute_case(p_case);
end $$;
revoke execute on function public.set_case_status(uuid, text) from public, anon;
grant execute on function public.set_case_status(uuid, text) to authenticated, service_role;

-- Settings, Workflow: the flowchart's steps 2 to 8. Off by default: null means any order.
create or replace function public.workflow_check_order(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select case when coalesce((o.settings #>> '{workflow,enforce_check_order}')::boolean, false)
              then array['education', 'employment', 'nic', 'sanction', 'reference', 'address', 'police'] end
    from public.orgs o where o.id = p_org
$$;
revoke execute on function public.workflow_check_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating and editing cases
-- ---------------------------------------------------------------------------
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
                            position_title, department, client_reference, instructions, internal_notes, candidate_name, created_via, due_at, created_by)
  select v_org, v_reference, v_client.id, v_candidate_id, v_package.id, v_snapshot,
         coalesce(nullif(p ->> 'process_type', ''), coalesce(v_package.default_process_type::text, 'client_supplied'))::public.process_type,
         v_stage, case when v_stage = 'intake' then 'case_received' else 'documents_pending' end,
         coalesce(nullif(p ->> 'priority', ''), 'normal'),
         nullif(trim(p ->> 'position_title'), ''), nullif(trim(p ->> 'department'), ''), nullif(trim(p ->> 'client_reference'), ''),
         nullif(trim(p ->> 'instructions'), ''),
         case when v_is_client then null else nullif(trim(p ->> 'internal_notes'), '') end,
         cd.full_name, v_via, v_due, v_uid
    from public.candidates cd where cd.id = v_candidate_id
  returning id into v_case_id;

  for v_type in
    -- Each check once, then any second records asked for (spec 4.1: "Education: Secondary").
    select ct.id, coalesce(t.label, ct.name) as name, ct.current_version_id, v.schema
      from (select u.id, 0::bigint as ord, null::text as label from unnest(v_types) as u(id)
            union all
            select (x.value ->> 'check_type_id')::uuid, x.ord, left(trim(x.value ->> 'label'), 120)
              from jsonb_array_elements(coalesce(p -> 'extra_checks', '[]'::jsonb)) with ordinality as x(value, ord)
             where (x.value ->> 'check_type_id')::uuid = any (v_types) and nullif(trim(x.value ->> 'label'), '') is not null) t
      join public.check_types ct on ct.id = t.id
      join public.check_type_versions v on v.id = ct.current_version_id
     order by array_position(v_types, t.id), t.ord
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

  if exists (select 1 from public.case_checks where case_id = v_case_id group by lower(label) having count(*) > 1) then
    raise exception 'two checks on a case can''t share a name' using errcode = '22023';
  end if;

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
    internal_notes = case when p ? 'internal_notes' then nullif(trim(p ->> 'internal_notes'), '') else internal_notes end,
    due_at = case when p ? 'due_at' and public.has_permission('cases.assign') then (p ->> 'due_at')::timestamptz else due_at end
  where id = p_case;
  perform public.log_case_event(p_case, null, 'details_updated', 'Case details updated', null,
    (select jsonb_object_agg(k, true) from jsonb_object_keys(p) k), false, false);
end $$;

-- ---------------------------------------------------------------------------
-- Client users read their company through this, not the tables (spec 6.4)
-- ---------------------------------------------------------------------------
-- The clients table holds Ontriq's internal notes, billing policy and AI
-- settings, and a row level policy can't hide columns.
create or replace function public.portal_client_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code, 'address', c.address, 'email', c.email, 'phone', c.phone,
                            'default_template', c.default_template,
                            'portal', jsonb_build_object('bulk_upload', coalesce((s.portal ->> 'bulk_upload')::boolean, true),
                                                         'client_packages', coalesce((s.portal ->> 'client_packages')::boolean, true),
                                                         'client_packages_need_approval', coalesce((s.portal ->> 'client_packages_need_approval')::boolean, false)))
    from public.clients c
    left join public.client_settings s on s.client_id = c.id
   where c.id = public.client_id_of_user()
$$;
revoke execute on function public.portal_client_profile() from public, anon;
grant execute on function public.portal_client_profile() to authenticated, service_role;

drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('clients.read')) or (select public.has_permission('clients.manage')) or (select public.has_permission('cases.read'))));
drop policy client_settings_select on public.client_settings;
create policy client_settings_select on public.client_settings for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('clients.read')) or (select public.has_permission('clients.manage'))));

-- Which staff member matched a combined file isn't the client's business.
drop policy requirement_files_select on public.requirement_files;
create policy requirement_files_select on public.requirement_files for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and exists (select 1 from public.documents d where d.id = document_id));

create or replace function public.memberships_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = new.role_id;
  if v_role.id is null then
    raise exception 'role not found' using errcode = '23503';
  end if;
  if v_role.kind <> new.kind or v_role.org_id <> new.org_id then
    raise exception 'role % does not apply to this membership', v_role.key using errcode = '42501';
  end if;

  -- Service role (no auth.uid()) and the bootstrap script are trusted.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' and v_role.key = 'super_admin' and not public.is_super_admin() then
    raise exception 'only a super admin can grant super admin' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- An invited person accepting their own invitation: status only, nothing else.
    if new.user_id = auth.uid() and old.status = 'invited' and new.status = 'active'
       and new.role_id = old.role_id and new.kind = old.kind
       and new.client_id is not distinct from old.client_id and new.org_id = old.org_id then
      return new;
    end if;
    -- A client admin manages their own company's people. They can't move anyone out of it.
    if public.is_client() and (new.client_id is distinct from old.client_id or new.kind is distinct from old.kind) then
      raise exception 'you cannot move someone to another company' using errcode = '42501';
    end if;
    if new.role_id is distinct from old.role_id and v_role.key = 'super_admin' and not public.is_super_admin() then
      raise exception 'only a super admin can grant super admin' using errcode = '42501';
    end if;
    if new.user_id = auth.uid()
       and (new.role_id is distinct from old.role_id
            or new.status is distinct from old.status
            or new.kind is distinct from old.kind
            or new.client_id is distinct from old.client_id) then
      raise exception 'you cannot change your own access' using errcode = '42501';
    end if;
    if exists (select 1 from public.roles r where r.id = old.role_id and r.key = 'super_admin')
       and not public.is_super_admin() then
      raise exception 'only a super admin can change a super admin' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- What Verification owes (mirrors "submit" mode in src/domain/check-types/validate.ts)
-- ---------------------------------------------------------------------------
create or replace function public.check_values_complete(p_schema jsonb, p_values jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  s jsonb;
  v jsonb;
  item jsonb;
  items jsonb;
begin
  for f in select * from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    v := p_values -> (f ->> 'key');
    if f ->> 'type' = 'repeatable_group' then
      items := case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
      if jsonb_array_length(items) < coalesce((f #>> '{group,min}')::int, case when coalesce((f ->> 'required')::boolean, false) then 1 else 0 end) then
        return false;
      end if;
      for item in select * from jsonb_array_elements(items) loop
        for s in select * from jsonb_array_elements(coalesce(f -> 'fields', '[]'::jsonb)) loop
          continue when not coalesce((s ->> 'required')::boolean, false);
          if public.field_blank(item -> (s ->> 'key')) then return false; end if;
          if s ->> 'type' = 'date_range' and not public.range_complete(item -> (s ->> 'key')) then return false; end if;
        end loop;
      end loop;
    elsif coalesce((f ->> 'required')::boolean, false) then
      if public.field_blank(v) then return false; end if;
      if f ->> 'type' = 'date_range' and not public.range_complete(v) then return false; end if;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.check_values_complete(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.save_check_values(p_check uuid, p_values jsonb, p_valid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
  v_schema jsonb;
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
  select schema into v_schema from public.check_type_versions where id = k.check_type_version_id;
  update public.case_checks
     set values = coalesce(p_values, '{}'::jsonb),
         -- The app checks formats. The database won't take its word that nothing is missing.
         values_valid = coalesce(p_valid, false) and public.check_values_complete(v_schema, coalesce(p_values, '{}'::jsonb)),
         updated_by = auth.uid(),
         state = case when state = 'not_started' then 'in_progress'::public.check_state else state end,
         started_at = coalesce(started_at, now())
   where id = p_check;
end $$;

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
  v_order text[];
  v_key text;
  v_blocked text;
  v_doc jsonb;
  v_group text;
  v_rows jsonb;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  v_manager := auth.uid() is null or public.has_permission('cases.stage.change') or public.has_permission('cases.assign');
  if auth.uid() is not null and not (public.has_permission('checks.verify') and (coalesce(k.assigned_to = auth.uid(), false) or coalesce(c.assigned_to = auth.uid(), false) or v_manager)) then
    raise exception 'only the officer on this check or a manager can change its status' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  -- Checks change up to the end of verification. After that, the case is sent back.
  if c.stage not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'this check is locked at this stage; send the case back to change it' using errcode = '22023';
  end if;
  if k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') and c.stage <> 'verification' then
    raise exception 'a finished check can be changed only during verification' using errcode = '22023';
  end if;

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
    -- Spec 8: an unfinished result must never print as verified.
    if p_state = 'completed' and v_result in ('pending', 'unable_to_verify') then
      raise exception 'that result means the check isn''t finished; leave it open or record it as unable to verify' using errcode = '22023';
    end if;
    -- A hit on the screening list can't come out as clear.
    if k.values ->> 'sanctions_found' = 'yes' and v_tone = 'green' then
      raise exception 'sanctions were found, so this can''t be clear' using errcode = '22023';
    end if;
    if not k.values_valid then raise exception 'complete the check''s details first' using errcode = '22023'; end if;
    -- Spec 8: the report states the finding. The note for the client is what prints.
    if p_state in ('discrepancy', 'unable_to_verify') and coalesce(trim(coalesce(p_client_note, k.client_note)), '') = '' then
      raise exception 'write the finding for the report' using errcode = '22023';
    end if;
    -- Settings, Workflow: the flowchart's steps 2 to 8, in order.
    v_order := public.workflow_check_order(c.org_id);
    if v_order is not null then
      select t.key into v_key from public.check_types t where t.id = k.check_type_id;
      select string_agg(o.label, ', ' order by o.sort) into v_blocked
        from public.case_checks o join public.check_types t on t.id = o.check_type_id
       where o.case_id = k.case_id and o.id <> k.id and o.state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived')
         and array_position(v_order, t.key) < array_position(v_order, v_key);
      if v_blocked is not null then
        raise exception 'checks run in order here: finish % first', v_blocked using errcode = '22023';
      end if;
    end if;
    -- Spec 4.2: evidence for each record. One file can't verify several employers,
    -- unless a person confirmed a combined file or a manager waived the slot.
    if p_state = 'completed' then
      for v_doc in select d from jsonb_array_elements(coalesce(v_schema -> 'documents', '[]'::jsonb)) d where d ? 'per_record' loop
        v_group := v_doc ->> 'per_record';
        v_rows := case when jsonb_typeof(k.values -> v_group) = 'array' then k.values -> v_group else '[]'::jsonb end;
        continue when jsonb_array_length(v_rows) < 2;
        continue when exists (select 1 from public.case_check_requirements r
                               where r.case_check_id = k.id and r.category = v_doc ->> 'category'
                                 and (r.status = 'waived' or exists (select 1 from public.requirement_files f where f.requirement_id = r.id)));
        if exists (select 1 from generate_series(0, jsonb_array_length(v_rows) - 1) i
                    where not exists (select 1 from public.documents d
                                       where d.case_id = k.case_id and (d.case_check_id = k.id or d.case_check_id is null)
                                         and d.status in ('uploaded', 'accepted') and d.record_key = v_group || '.' || i)) then
          raise exception 'tie a document to each row first, or have a manager waive it: %', v_doc ->> 'label' using errcode = '22023';
        end if;
      end loop;
    end if;
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
         -- A waived check prints "Not required" with the reason.
         client_note = case when p_state = 'waived' then nullif(trim(coalesce(p_client_note, p_note)), '')
                            when p_client_note is not null then nullif(trim(p_client_note), '') else client_note end,
         completed_at = case when p_state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then now() else null end,
         started_at = coalesce(started_at, now()),
         updated_by = auth.uid()
   where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'check_state',
    k.label || ': ' || public.check_state_label(p_state) || coalesce(' (' || v_label || ')', ''),
    nullif(trim(p_note), ''), jsonb_build_object('from', k.state, 'to', p_state, 'result', v_result),
    -- Every finished check reaches the client's feed in the same words, so its absence says nothing.
    p_state in ('completed', 'discrepancy', 'unable_to_verify', 'waived'), false);
  perform public.recompute_case(k.case_id);
end $$;

-- ---------------------------------------------------------------------------
-- Moving a case (spec 3, 5)
-- ---------------------------------------------------------------------------
create or replace function public.move_case(p_case uuid, p_to public.case_stage, p_event text, p_reason text default null, p_returned boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_label text;
begin
  select * into c from public.cases where id = p_case for update;
  -- Held work stays put, whichever function asked. Cancelling clears the hold first.
  if c.on_hold then raise exception 'this case is on hold; resume it first' using errcode = '22023'; end if;
  update public.cases
     set stage = p_to,
         manual_status_key = null,
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

create or replace function public.case_transition(p_case uuid, p_event text, p_reason text default null) returns public.case_stage
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_mover boolean;
  v_n int;
  v_missing text[];
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then
    raise exception 'case not found' using errcode = 'P0002';
  end if;
  if c.on_hold then raise exception 'this case is on hold; resume it first' using errcode = '22023'; end if;
  v_mover := auth.uid() is null or public.has_permission('cases.stage.change')
             or (coalesce(c.assigned_to = auth.uid(), false) and public.has_permission('cases.update'));

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
      -- Only what Data Entry owes: results and "verified by" wait for verification.
      select count(*) into v_n from public.case_checks k
        join public.check_type_versions v on v.id = k.check_type_version_id
       where k.case_id = p_case and k.state <> 'waived' and not k.values_valid and not public.check_entry_complete(v.schema, k.values);
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
      -- Spec 9 and the flowchart: amber covers "one or more checks pending". A
      -- manager may send the case on with a reason; the check prints as pending
      -- and approve_report refuses a green result.
      if v_n > 0 and not ((auth.uid() is null or public.has_permission('cases.stage.change')) and coalesce(trim(p_reason), '') <> '') then
        raise exception '% check(s) still open', v_n using errcode = '22023';
      end if;
      -- Documents for a check that is still open or was waived don't hold the case back.
      select count(*) into v_n from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
       where r.case_id = p_case and r.status = 'pending' and r.min_count > r.received_count
         and (k.id is null or k.state in ('completed', 'discrepancy', 'unable_to_verify'));
      if v_n > 0 then raise exception '% required document(s) still missing', v_n using errcode = '22023'; end if;
      -- A waived slot doesn't excuse the fixed annexure on a check that reached a result.
      v_missing := public.case_missing_annexures(p_case);
      if cardinality(v_missing) > 0 then
        raise exception '% has no report attached; upload it first', array_to_string(v_missing, ', ') using errcode = '22023';
      end if;
      perform public.move_case(p_case, 'post_qc', p_event, p_reason);
      return 'post_qc';
    when 'return_to_documents' then
      if c.stage not in ('data_entry', 'verification') then raise exception 'the case cannot go back to documents from here' using errcode = '22023'; end if;
      -- Spec 3: whoever finds the gap can return the case, not only a manager.
      if not v_mover then raise exception 'not allowed' using errcode = '42501'; end if;
      if coalesce(trim(p_reason), '') = '' then raise exception 'say why the case goes back' using errcode = '22023'; end if;
      perform public.move_case(p_case, 'documents', p_event, p_reason, true);
      return 'documents';
    else
      raise exception 'unknown case event %', p_event using errcode = '22023';
  end case;
end $$;

drop function public.record_qc_review(uuid, text, text, jsonb, text, uuid[]);
create function public.record_qc_review(
  p_case uuid, p_kind text, p_decision text, p_checklist jsonb default '[]'::jsonb, p_remarks text default null, p_return_checks uuid[] default '{}', p_return_to text default 'verification'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
  v_n int;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if p_kind not in ('pre', 'post') or p_decision not in ('approved', 'returned') then raise exception 'unknown QC decision' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.has_permission(case when p_kind = 'pre' then 'qc.pre' else 'qc.post' end) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if c.stage <> (case when p_kind = 'pre' then 'pre_qc' else 'post_qc' end)::public.case_stage then
    raise exception 'the case is not waiting for %-QC', initcap(p_kind) using errcode = '22023';
  end if;
  if p_decision = 'returned' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'say what needs correcting' using errcode = '22023';
  end if;
  if p_return_to not in ('verification', 'data_entry') then raise exception 'unknown return stage' using errcode = '22023'; end if;
  -- A review records what was checked. Skipping an item takes a reason.
  if p_decision = 'approved' and coalesce(trim(p_remarks), '') = ''
     and exists (select 1 from jsonb_array_elements(coalesce(p_checklist, '[]'::jsonb)) i where not coalesce((i ->> 'ok')::boolean, false)) then
    raise exception 'say in the remarks why you are approving with items unticked' using errcode = '22023';
  end if;
  -- A file rejected during Pre-QC leaves its slot short again.
  if p_kind = 'pre' and p_decision = 'approved' then
    v_n := public.case_outstanding_requirements(p_case, 'documents');
    if v_n > 0 then
      raise exception '% required document(s) are missing or were rejected; return the case for correction', v_n using errcode = '22023';
    end if;
  end if;
  if p_kind = 'post' and p_decision = 'returned' and coalesce(cardinality(p_return_checks), 0) = 0 then
    raise exception 'choose the checks that need more work' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_return_checks, '{}')) x where not exists (select 1 from public.case_checks k where k.id = x and k.case_id = p_case)) then
    raise exception 'a returned check is not part of this case' using errcode = '22023';
  end if;

  insert into public.qc_reviews (org_id, case_id, kind, decision, checklist, remarks, returned_check_ids, reviewer_id)
  values (c.org_id, p_case, p_kind, p_decision, coalesce(p_checklist, '[]'::jsonb), nullif(trim(p_remarks), ''), coalesce(p_return_checks, '{}'), auth.uid())
  returning id into v_id;

  if p_kind = 'post' and p_decision = 'returned' then
    update public.case_checks set state = 'returned', result = null, result_tone = null, completed_at = null
     where case_id = p_case and id = any (p_return_checks);
  end if;

  perform public.log_case_event(p_case, null, 'qc_' || p_kind,
    case p_kind when 'pre' then 'Pre-QC ' else 'Post-QC ' end || case p_decision when 'approved' then 'approved' else 'returned the case' end,
    nullif(trim(p_remarks), ''), jsonb_build_object('review_id', v_id, 'checks', p_return_checks), false, false);

  perform public.move_case(p_case,
    case when p_kind = 'pre' and p_decision = 'approved' then 'data_entry'
         when p_kind = 'pre' then 'documents'
         when p_decision = 'approved' then 'report'
         else p_return_to end::public.case_stage,
    case when p_kind = 'pre' then 'pre_qc_' else 'post_qc_' end || case when p_decision = 'approved' then 'approve' else 'return' end,
    nullif(trim(p_remarks), ''), p_decision = 'returned');
  return v_id;
end $$;
revoke execute on function public.record_qc_review(uuid, text, text, jsonb, text, uuid[], text) from public, anon;
grant execute on function public.record_qc_review(uuid, text, text, jsonb, text, uuid[], text) to authenticated, service_role;

-- Spec 10: QC decisions belong in the audit trail with everything else.
select public.attach_audit('public.qc_reviews');

-- ---------------------------------------------------------------------------
-- Status and notifications (spec 6.2, 6.3)
-- ---------------------------------------------------------------------------
alter table public.candidate_requests add column form boolean not null default false;

create or replace function public.recompute_case(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_total int;
  v_done int;
  v_red boolean;
  v_green boolean;
  v_pending_info boolean;
  v_missing int;
  v_has_files boolean;
  v_final_ready boolean;
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
      or exists (select 1 from public.case_checks k where k.case_id = p_case and k.state = 'pending_info')
      or exists (select 1 from public.client_requests q where q.case_id = p_case and q.status = 'open')
      -- The BGV form is document collection. Anything else asked of the candidate is a pending item.
      or exists (select 1 from public.candidate_requests q where q.case_id = p_case and q.status = 'open' and q.kind <> 'document' and not q.form)
    into v_pending_info;
  v_missing := public.case_outstanding_requirements(p_case, 'documents');
  select exists (select 1 from public.documents d where d.case_id = p_case and d.status in ('uploaded', 'accepted')) into v_has_files;
  select exists (select 1 from public.report_versions v where v.case_id = p_case and v.kind = 'final' and v.status = 'ready') into v_final_ready;

  v_status := case when c.on_hold then 'on_hold'
                   when c.manual_status_key is not null and c.stage not in ('released', 'cancelled') then c.manual_status_key
                   else case c.stage
    when 'intake' then 'case_received'
    when 'documents' then case when c.returned_at is not null then 'returned_for_correction'
                               when v_pending_info then 'pending_information'
                               when v_missing = 0 and v_has_files then 'document_review'
                               else 'documents_pending' end
    when 'pre_qc' then 'pre_qc_in_progress'
    when 'data_entry' then case when c.returned_at is not null then 'returned_for_correction'
                                when v_pending_info then 'pending_information'
                                else 'data_entry_in_progress' end
    when 'verification' then case when c.returned_at is not null then 'returned_for_correction'
                                  when v_pending_info then 'pending_information'
                                  when v_done > 0 and v_done < v_total then 'partially_completed'
                                  else 'verification_in_progress' end
    when 'post_qc' then 'pending_post_qc'
    when 'report' then 'final_report_in_progress'
    when 'approval' then case when v_final_ready then 'report_completed' else 'pending_final_approval' end
    when 'released' then 'report_released'
    else 'cancelled' end end;

  update public.cases
     set checks_total = v_total,
         checks_done = v_done,
         proposed_result = case when coalesce(v_red, false) then 'red' when v_total > 0 and v_green then 'green' else 'amber' end,
         status_key = v_status
   where id = p_case
     and (checks_total, checks_done, coalesce(proposed_result, ''), status_key)
         is distinct from (v_total, v_done, case when coalesce(v_red, false) then 'red' when v_total > 0 and v_green then 'green' else 'amber' end, v_status);
end $$;

create trigger candidate_requests_status_refresh after insert or update of status on public.candidate_requests
  for each row execute function public.case_status_refresh();

create or replace function public.case_events_notify_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_users uuid[];
begin
  if not new.visible_to_client then return null; end if;
  select * into c from public.cases where id = new.case_id;
  if c.id is null then return null; end if;
  -- A check hidden from this client stays quiet too.
  if new.case_check_id is not null and public.portal_check_hidden(c.client_id, (select k.check_type_id from public.case_checks k where k.id = new.case_check_id)) then
    return null;
  end if;
  if new.kind = 'document_requested' and c.process_type = 'client_supplied' then
    perform public.notify_client_users(c.id, 'portal.documents_needed', c.reference || ': ' || new.title, coalesce(new.body, ''));
  elsif new.kind = 'document_rejected' and coalesce(new.data ->> 'by', '') <> 'candidate'
        and exists (select 1 from public.documents d where d.id = (new.data ->> 'document_id')::uuid and d.uploaded_by_kind = 'client') then
    perform public.notify_client_users(c.id, 'portal.document_rejected', c.reference || ': a document needs replacing', coalesce(new.body, ''));
  elsif new.kind = 'stage_changed' and new.data ->> 'to' = 'documents' and new.data ->> 'from' = 'intake' then
    perform public.notify_client_users(c.id, 'portal.case_accepted', c.reference || ' accepted', 'Ontriq has started work on ' || c.candidate_name || '.');
  elsif new.kind = 'stage_changed' and new.data ->> 'to' = 'released' then
    -- The people chosen at release, when any were.
    select array_agg(r.user_id) into v_users
      from public.report_recipients r
      join public.report_versions v on v.id = r.report_version_id
     where v.case_id = c.id and v.status = 'released' and r.user_id is not null;
    if coalesce(cardinality(v_users), 0) > 0 and c.client_visible then
      perform public.notify_users(v_users, 'portal.report_released', c.reference || ': report available', c.candidate_name,
                                  '/portal/cases/' || c.id, false, 'case', c.id, c.org_id);
    else
      perform public.notify_client_users(c.id, 'portal.report_released', c.reference || ': report available', c.candidate_name);
    end if;
  elsif new.kind in ('stage_changed', 'hold', 'resumed', 'returned')
        -- Returns inside Ontriq (Post-QC, the approver) need nothing from the client.
        and not (new.kind = 'returned' and coalesce(new.data ->> 'event', '') not in ('pre_qc_return', 'return_to_documents'))
        -- A Pre-QC return on a client-supplied case already reached them as a question.
        and not (new.kind = 'returned' and new.data ->> 'event' = 'pre_qc_return' and c.process_type = 'client_supplied')
        and coalesce((select (s.portal ->> 'status_updates')::boolean from public.client_settings s where s.client_id = c.client_id), true) then
    perform public.notify_client_users(c.id, 'portal.case_status',
      c.reference || ': ' || case new.kind when 'hold' then 'on hold' when 'resumed' then 'resumed' when 'returned' then 'returned for correction'
                                           else lower(public.portal_stage_label((new.data ->> 'to')::public.case_stage)) end,
      c.candidate_name);
  end if;
  return null;
end $$;

-- Stage moves already notify. These change inside a stage.
create or replace function public.cases_status_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
begin
  if not (new.status_key in ('document_review', 'partially_completed', 'report_completed') or new.status_key is not distinct from new.manual_status_key) then return null; end if;
  if not coalesce((select (s.portal ->> 'status_updates')::boolean from public.client_settings s where s.client_id = new.client_id), true) then return null; end if;
  select client_label into v_label from public.client_status_catalog where org_id = new.org_id and key = new.status_key;
  perform public.notify_client_users(new.id, 'portal.case_status', new.reference || ': ' || lower(coalesce(v_label, new.status_key)), new.candidate_name);
  return null;
end $$;
revoke execute on function public.cases_status_notify() from public, anon, authenticated;
create trigger cases_status_notify after update of status_key on public.cases
  for each row when (old.status_key is distinct from new.status_key and old.stage = new.stage)
  execute function public.cases_status_notify();

-- Rows that say nothing to a client, on a feed that now shows every finished check.
update public.case_events set visible_to_client = true
 where kind = 'check_state' and data ->> 'to' in ('discrepancy', 'unable_to_verify');

-- ---------------------------------------------------------------------------
-- Documents (flowchart Pre-QC, spec 4.2, 7)
-- ---------------------------------------------------------------------------
alter table public.documents add column original_kind text not null default 'unknown'
  check (original_kind in ('unknown', 'original', 'certified_copy', 'copy'));

create or replace function public.set_document_original(p_document uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or not public.case_visible(d.case_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('qc.pre') or public.has_permission('cases.update')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('unknown', 'original', 'certified_copy', 'copy') then raise exception 'unknown document kind' using errcode = '22023'; end if;
  update public.documents set original_kind = p_kind where id = p_document;
end $$;
revoke execute on function public.set_document_original(uuid, text) from public, anon;
grant execute on function public.set_document_original(uuid, text) to authenticated, service_role;

create or replace function public.set_document_record(p_document uuid, p_record text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  v_key text := nullif(trim(p_record), '');
  v_rows jsonb;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_key is not null then
    select k.values -> split_part(v_key, '.', 1) into v_rows
      from public.case_checks k
     where k.case_id = d.case_id and (k.id = d.case_check_id or d.case_check_id is null)
       and jsonb_typeof(k.values -> split_part(v_key, '.', 1)) = 'array'
       and jsonb_array_length(k.values -> split_part(v_key, '.', 1)) > split_part(v_key, '.', 2)::int
     limit 1;
    if v_rows is null then raise exception 'that row is not on this check' using errcode = '22023'; end if;
  end if;
  update public.documents set record_key = v_key where id = p_document;
end $$;

-- Replies from sources are evidence, and go in the report like any other.
insert into public.document_categories (org_id, key, name, guide, sensitive, in_report, sort)
select o.id, 'verification_response', 'Verification response',
       'The reply from the institution, employer, Grama Niladhari or official source, or a screenshot of the portal result (Ontriq staff).', false, true, 115
  from public.orgs o
on conflict (org_id, key) do nothing;

create or replace function public.candidate_providable(p_category text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_category not in ('field_verification', 'sanction_report', 'consent_form', 'verification_response')
$$;

-- ---------------------------------------------------------------------------
-- The report (spec 7, 8)
-- ---------------------------------------------------------------------------
-- Evidence past the size limit goes in further files of the same package, so
-- nothing is left out. parts: [{ part, path, sha256, pages, size_bytes, annexures }].
alter table public.report_versions add column parts jsonb not null default '[]'::jsonb;

-- The fixed annexure goes in without anyone marking it, and a type switched
-- out of the report in Settings isn't evidence the report owes.
create or replace function public.case_unreported_evidence(p_case uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct k.label), '{}')
    from public.case_checks k
    join public.check_type_versions v on v.id = k.check_type_version_id
    join public.case_check_requirements r on r.case_check_id = k.id
    join public.document_categories dc on dc.org_id = k.org_id and dc.key = r.category and dc.in_report
   where k.case_id = p_case
     and (auth.uid() is null or (public.is_staff() and public.case_visible(p_case)))
     and k.state in ('completed', 'discrepancy') and r.status <> 'waived' and r.min_count > 0
     and r.category is distinct from v.schema #>> '{fixed_annexure,category}'
     -- A file uploaded to the whole case fills the slot too (sync_requirement_counts, 0046).
     and not exists (select 1 from public.documents d
                      where d.case_id = k.case_id and d.status in ('uploaded', 'accepted') and d.visibility in ('report', 'client')
                        and (((d.case_check_id = k.id or d.case_check_id is null) and d.category = r.category)
                             or exists (select 1 from public.requirement_files f where f.requirement_id = r.id and f.document_id = d.id)))
$$;

create or replace function public.submit_report(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_unreported text[];
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('reports.preview') and (public.has_permission('cases.stage.change') or coalesce(c.assigned_to = auth.uid(), false))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage <> 'report' then raise exception 'the case is not at the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if not exists (select 1 from public.report_versions where case_id = p_case and kind = 'draft' and status = 'ready'
                  and version = (select max(version) from public.report_versions where case_id = p_case)) then
    raise exception 'generate a draft and check it before sending it for approval' using errcode = '22023';
  end if;
  -- Spec 7: evidence the report needs goes in it.
  v_unreported := public.case_unreported_evidence(p_case);
  if cardinality(v_unreported) > 0 then
    raise exception 'no evidence in the report for %; set its file to go in the report, or waive the document, then make a new draft',
      array_to_string(v_unreported, ', ') using errcode = '22023';
  end if;
  perform public.move_case(p_case, 'approval', 'submit_report');
end $$;

drop function public.report_render_done(uuid, boolean, jsonb, text, text, text, int, bigint, jsonb, text);
create function public.report_render_done(
  p_version uuid, p_ok boolean, p_snapshot jsonb default null, p_snapshot_hash text default null, p_storage_path text default null,
  p_sha256 text default null, p_pages int default null, p_size bigint default null, p_annexures jsonb default '[]'::jsonb, p_error text default null, p_parts jsonb default '[]'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
begin
  select * into v from public.report_versions where id = p_version for update;
  if v.id is null then raise exception 'report version not found' using errcode = 'P0002'; end if;
  if v.status = 'superseded' then return; end if;   -- a newer draft replaced it while rendering
  if p_ok then
    update public.report_versions
       set status = 'ready', snapshot = coalesce(p_snapshot, snapshot), snapshot_hash = coalesce(p_snapshot_hash, snapshot_hash),
           storage_path = p_storage_path, sha256 = p_sha256, page_count = p_pages, size_bytes = p_size,
           annexures = coalesce(p_annexures, '[]'::jsonb), parts = coalesce(p_parts, '[]'::jsonb), error = null
     where id = v.id;
    perform public.log_case_event(v.case_id, null, 'report_ready',
      case v.kind when 'draft' then 'Report draft ready' else 'Final report ready' end, null,
      jsonb_build_object('version_id', v.id, 'version', v.version), false, false);
    if v.requested_by is not null then
      perform public.notify_users(array[v.requested_by], 'report.ready',
        (select reference from public.cases where id = v.case_id) || case v.kind when 'draft' then ': report draft ready' else ': final report ready' end,
        '', '/app/cases/' || v.case_id, false, 'case', v.case_id, v.org_id);
    end if;
  else
    update public.report_versions set status = 'failed', error = left(coalesce(p_error, 'unknown error'), 2000) where id = v.id;
    perform public.log_case_event(v.case_id, null, 'report_failed', 'Report generation failed', left(p_error, 500),
      jsonb_build_object('version_id', v.id), false, false);
  end if;
end $$;
revoke execute on function public.report_render_done(uuid, boolean, jsonb, text, text, text, int, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.report_render_done(uuid, boolean, jsonb, text, text, text, int, bigint, jsonb, text, jsonb) to service_role;

drop function public.report_download(uuid, text);
create function public.report_download(p_version uuid, p_ip text default null, p_part int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
  c public.cases;
  v_who text;
  v_path text;
begin
  select * into v from public.report_versions where id = p_version;
  if v.id is null or v.storage_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  -- Part 1 is the report itself. Later parts hold evidence that didn't fit in it.
  v_path := case when p_part is null or p_part = 1 then v.storage_path else v.parts -> (p_part - 2) ->> 'path' end;
  if v_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = v.case_id;
  if public.is_staff() and public.has_permission('reports.preview') and public.case_visible(c.id) then
    v_who := 'staff';
  elsif public.is_client() and public.has_permission('portal.cases.read') and c.client_id = public.client_id_of_user() and c.client_visible
        and v.status = 'released' and public.report_open_to_caller(v.id) then
    v_who := 'client';
  else
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  insert into public.report_downloads (org_id, report_version_id, user_id, who, ip) values (v.org_id, v.id, auth.uid(), v_who, left(p_ip, 64));
  if v_who = 'client' then
    perform public.log_case_event(c.id, null, 'report_downloaded', 'Report downloaded', null,
      jsonb_build_object('version_id', v.id), true, false);
  end if;
  return jsonb_build_object('bucket', 'reports', 'path', v_path,
    'filename', c.reference || case v.kind when 'draft' then '-DRAFT-v' || v.version else '' end
                || case when coalesce(p_part, 1) > 1 then '-part-' || p_part else '' end || '.pdf');
end $$;
revoke execute on function public.report_download(uuid, text, int) from public, anon;
grant execute on function public.report_download(uuid, text, int) to authenticated, service_role;

create or replace function public.portal_report(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.portal_case_visible(p_case) then return null; end if;
  return (select jsonb_build_object('version_id', v.id, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256,
                                    'page_count', v.page_count, 'final_result', v.final_result,
                                    -- Retention removed the file: the case stays, the PDF doesn't.
                                    'file_removed', v.storage_path is null, 'extra_parts', jsonb_array_length(v.parts))
            from public.report_versions v where v.case_id = p_case and v.status = 'released' and public.report_open_to_caller(v.id)
           order by v.version desc limit 1);
end $$;

create or replace function public.erase_case(p_case uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_objects jsonb;
  v_checks uuid[];
  v_docs uuid[];
  v_reports uuid[];
  v_generated uuid[];
  v_requests uuid[];
  v_consents uuid[];
  v_other_cases int;
  v_name text;
  v_nic text;
  v_notes uuid[];
begin
  -- The retention job (service role) or the Super Admin with two-step verification.
  if auth.uid() is not null and not (public.is_super_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2') then
    raise exception 'only the Super Admin can erase personal data' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'give a reason for the erasure' using errcode = '22023'; end if;
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and c.org_id <> public.auth_org_id()) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if c.erased_at is not null then raise exception 'this case was already erased' using errcode = '22023'; end if;
  if c.stage not in ('released', 'cancelled') then
    raise exception 'only released or cancelled cases can be erased; cancel the case first' using errcode = '22023';
  end if;

  select coalesce(array_agg(id), '{}') into v_checks from public.case_checks where case_id = c.id;
  select coalesce(array_agg(id), '{}') into v_docs from public.documents where case_id = c.id;
  select coalesce(array_agg(id), '{}') into v_reports from public.report_versions where case_id = c.id;
  select coalesce(array_agg(id), '{}') into v_requests from public.candidate_requests where case_id = c.id;
  select coalesce(array_agg(id), '{}') into v_consents from public.consent_forms where case_id = c.id;
  select coalesce(array_agg(id), '{}') into v_generated from public.generated_documents
   where (entity_type = 'case' and entity_id = c.id) or (entity_type = 'consent_form' and entity_id = any (v_consents)) or (kind = 'consent' and entity_id = c.id);

  -- Files to remove from Storage (the caller deletes them with the service key).
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_objects from (
    select jsonb_build_object('bucket', d.storage_bucket, 'path', d.storage_path) o from public.documents d where d.id = any (v_docs) and d.storage_path not like 'erased/%'
    union all
    select jsonb_build_object('bucket', 'reports', 'path', r.storage_path) from public.report_versions r where r.id = any (v_reports) and r.storage_path is not null
    union all
    select jsonb_build_object('bucket', 'reports', 'path', p ->> 'path') from public.report_versions r, jsonb_array_elements(r.parts) p where r.id = any (v_reports)
    union all
    select jsonb_build_object('bucket', 'documents', 'path', g.storage_path) from public.generated_documents g
     where g.id = any (v_generated) and g.storage_path is not null
  ) x;

  -- Scrub.
  update public.case_checks set values = '{}'::jsonb, values_valid = false, client_note = null where id = any (v_checks);
  delete from public.document_texts where document_id = any (v_docs);
  delete from public.document_ai where document_id = any (v_docs);
  update public.documents set filename = 'erased', storage_path = 'erased/' || id where id = any (v_docs);
  update public.report_versions set snapshot = '{}'::jsonb, storage_path = null, annexures = '[]'::jsonb, parts = '[]'::jsonb where id = any (v_reports);
  update public.generated_documents set storage_path = null where id = any (v_generated);
  delete from public.ai_suggestions
   where (entity_type = 'case' and entity_id = c.id) or (entity_type = 'case_check' and entity_id = any (v_checks))
      or (entity_type = 'document' and entity_id = any (v_docs));
  update public.candidate_requests set answer = null, review_note = null, help = null where id = any (v_requests);
  update public.candidate_messages set body = '[erased]' where case_id = c.id;
  update public.candidate_links set token_enc = null, revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'erased') where case_id = c.id;
  update public.consent_forms set signed_name = null, ip = null, user_agent = null, ai_check = '{}'::jsonb, review_note = null where id = any (v_consents);
  update public.case_events set body = null, data = '{}'::jsonb where case_id = c.id;
  update public.qc_reviews set remarks = null, checklist = '[]'::jsonb where case_id = c.id;
  update public.client_requests set question = '[erased]', answer = null where case_id = c.id;
  update public.stage_history set reason = null where case_id = c.id;
  update public.communications set body = '[erased]', counterparty = null where case_id = c.id;
  update public.email_outbox set html = '<p>[erased]</p>', text_body = '[erased]', payload = '{}'::jsonb
   where entity_id = c.id or entity_id = any (v_requests) or entity_id = any (v_checks);
  update public.sms_outbox set body = '[erased]' where entity_id = c.id;
  -- Copies of the candidate's name elsewhere: notifications (and their emails), pushes, the
  -- assistant's conversations, and verifier replies waiting in the job queue.
  v_name := trim(both '"' from to_json(c.candidate_name)::text);
  v_nic := (select nic from public.candidates where id = c.candidate_id);
  select coalesce(array_agg(id), '{}') into v_notes from public.notifications
   where entity_id = c.id or entity_id = any (v_checks) or entity_id = any (v_docs) or entity_id = any (v_requests)
      or (length(c.candidate_name) >= 3 and (title like '%' || c.candidate_name || '%' or body like '%' || c.candidate_name || '%'));
  update public.notifications set title = replace(title, c.candidate_name, 'Erased candidate'), body = replace(body, c.candidate_name, 'Erased candidate')
   where id = any (v_notes);
  update public.email_outbox set html = '<p>[erased]</p>', text_body = '[erased]', payload = '{}'::jsonb
   where entity_type = 'notification' and entity_id = any (v_notes);
  update public.nudges set items = (select coalesce(jsonb_agg(case when x ->> 'case_id' = c.id::text then x || '{"label": "Erased candidate"}'::jsonb else x end), '[]'::jsonb)
                                      from jsonb_array_elements(items) x)
   where items @> jsonb_build_array(jsonb_build_object('case_id', c.id));
  if length(v_name) >= 3 then
    update public.assistant_messages set content = replace(content::text, v_name, 'Erased candidate')::jsonb where content::text like '%' || v_name || '%';
    update public.assistant_actions set preview = replace(preview::text, v_name, 'Erased candidate')::jsonb,
           input = replace(input::text, v_name, 'Erased candidate')::jsonb,
           result = replace(coalesce(result, 'null'::jsonb)::text, v_name, 'Erased candidate')::jsonb
     where preview::text like '%' || v_name || '%' or input::text like '%' || v_name || '%' or coalesce(result::text, '') like '%' || v_name || '%';
  end if;
  if length(coalesce(v_nic, '')) >= 9 then
    update public.assistant_messages set content = replace(content::text, v_nic, '[erased]')::jsonb where content::text like '%' || v_nic || '%';
  end if;
  update public.jobs set payload = payload - 'reply' where kind = 'ai.response_capture' and payload ->> 'check_id' = any (select unnest(v_checks)::text);
  update public.cases set candidate_name = 'Erased candidate', client_reference = null, position_title = null,
         hold_reason = null, return_note = null, instructions = null, internal_notes = null, manual_status_key = null, cancel_reason = null,
         erased_at = now(), erased_by = auth.uid(), erasure_reason = left(trim(p_reason), 500)
   where id = c.id;

  -- The candidate goes too unless another live case still needs them.
  select count(*) into v_other_cases from public.cases where candidate_id = c.candidate_id and id <> c.id and erased_at is null;
  if v_other_cases = 0 then
    update public.candidates set full_name = 'Erased candidate', nic = null, nic_canonical = null, date_of_birth = null, gender = null,
           email = null, phone = null, address = null, district = null, erased_at = now()
     where id = c.candidate_id;
    update public.audit_log set before = case when before is null then null else '{"redacted": true}'::jsonb end,
           after = case when after is null then null else '{"redacted": true}'::jsonb end
     where table_name = 'candidates' and row_id = c.candidate_id::text;
  end if;

  -- Audit entries for these rows keep who did what and when, not the data.
  update public.audit_log set before = case when before is null then null else '{"redacted": true}'::jsonb end,
         after = case when after is null then null else '{"redacted": true}'::jsonb end
   where (table_name = 'cases' and row_id = c.id::text)
      or (table_name = 'case_checks' and row_id = any (select unnest(v_checks)::text))
      or (table_name = 'documents' and row_id = any (select unnest(v_docs)::text))
      or (table_name = 'report_versions' and row_id = any (select unnest(v_reports)::text))
      or (table_name = 'generated_documents' and row_id = any (select unnest(v_generated)::text))
      or (table_name = 'candidate_requests' and row_id = any (select unnest(v_requests)::text))
      or (table_name = 'consent_forms' and row_id = any (select unnest(v_consents)::text))
      or (table_name = 'qc_reviews' and row_id = any (select id::text from public.qc_reviews where case_id = c.id))
      or (table_name = 'client_requests' and row_id = any (select id::text from public.client_requests where case_id = c.id));

  perform public.log_case_event(c.id, null, 'erased', 'Personal data erased', null,
    jsonb_build_object('by', case when auth.uid() is null then 'retention' else 'super_admin' end), false, false);
  insert into public.system_events (org_id, kind, severity, message, context)
  values (c.org_id, 'data.erased', 'info', 'Personal data erased for case ' || c.reference,
          jsonb_build_object('case_id', c.id, 'reference', c.reference, 'by', auth.uid(), 'files', jsonb_array_length(v_objects),
                             'source', case when auth.uid() is null then 'retention' else 'request' end));
  return jsonb_build_object('case_id', c.id, 'reference', c.reference, 'objects', v_objects);
end $$;

-- ---------------------------------------------------------------------------
-- The BGV form (flowchart: "By form", "BGV form")
-- ---------------------------------------------------------------------------
-- Everything the checks on the case let a candidate fill in, as one card per
-- check on their page: rows for employers and referees, one form for the rest.
-- Staff review the answers and use them, as with any other request.
create or replace function public.issue_bgv_form(p_case uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  k record;
  f jsonb;
  v_fields jsonb;
  v_id uuid;
  v_n int := 0;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;

  for k in select ck.id, ck.label, ck.values, v.schema
             from public.case_checks ck join public.check_type_versions v on v.id = ck.check_type_version_id
            where ck.case_id = p_case and ck.state <> 'waived' order by ck.sort loop
    for f in select x from jsonb_array_elements(coalesce(k.schema -> 'fields', '[]'::jsonb)) x
              where x ->> 'type' = 'repeatable_group' and public.field_blank(k.values -> (x ->> 'key'))
                and exists (select 1 from jsonb_array_elements(coalesce(x -> 'fields', '[]'::jsonb)) s where coalesce(s -> 'fill_by', '[]'::jsonb) ? 'candidate')
                and not exists (select 1 from public.candidate_requests q where q.case_check_id = k.id and q.field_key = x ->> 'key' and q.status <> 'cancelled') loop
      v_id := public.create_candidate_request(p_case, jsonb_build_object('kind', 'field', 'check_id', k.id, 'field_key', f ->> 'key',
                                                                         'title', k.label || ': ' || (f ->> 'label'), 'help', 'Part of your BGV form.'));
      update public.candidate_requests set form = true where id = v_id;
      v_n := v_n + 1;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('key', x ->> 'key', 'label', x ->> 'label', 'type', x ->> 'type',
                                                 'required', coalesce((x ->> 'required')::boolean, false),
                                                 'options', coalesce(x -> 'options', '[]'::jsonb)) order by n), '[]'::jsonb)
      into v_fields
      from jsonb_array_elements(coalesce(k.schema -> 'fields', '[]'::jsonb)) with ordinality as a(x, n)
     where x ->> 'type' <> 'repeatable_group' and coalesce(x -> 'fill_by', '[]'::jsonb) ? 'candidate'
       and coalesce(x ->> 'stage', 'data_entry') <> 'verification' and public.field_blank(k.values -> (x ->> 'key'));
    if jsonb_array_length(v_fields) > 0
       and not exists (select 1 from public.candidate_requests q where q.case_check_id = k.id and q.field_key = '__details' and q.status <> 'cancelled') then
      insert into public.candidate_requests (org_id, case_id, case_check_id, kind, title, help, field_key, field_type, options, form, created_by)
      values (c.org_id, p_case, k.id, 'field', left(k.label || ': your details', 200), 'Part of your BGV form.', '__details', 'check_form',
              jsonb_build_object('min', 1, 'max', 1, 'item_label', k.label, 'fields', v_fields), true, auth.uid())
      returning id into v_id;
      perform public.log_case_event(p_case, k.id, 'request_created', 'New request: ' || left(k.label || ': your details', 200), null,
        jsonb_build_object('request_id', v_id, 'kind', 'field'), false, true);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.issue_bgv_form(uuid) from public, anon;
grant execute on function public.issue_bgv_form(uuid) to authenticated, service_role;

create or replace function public.candidate_answer_request(p_link uuid, p_request uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  q public.candidate_requests;
begin
  select * into q from public.candidate_requests where id = p_request and case_id = v_case for update;
  if q.id is null or q.status = 'cancelled' then raise exception 'request not found' using errcode = 'P0002'; end if;
  if q.kind = 'document' then raise exception 'upload a file for this request' using errcode = '22023'; end if;
  if q.status = 'accepted' then raise exception 'this answer has already been accepted' using errcode = '22023'; end if;
  if q.field_type in ('repeatable_group', 'check_form') then
    if coalesce(jsonb_typeof(p_answer -> 'rows'), '') <> 'array' or jsonb_array_length(p_answer -> 'rows') = 0 then
      raise exception 'write an answer first' using errcode = '22023';
    end if;
  elsif p_answer is null or public.field_blank(p_answer -> 'value') then
    raise exception 'write an answer first' using errcode = '22023';
  end if;
  if length(p_answer::text) > 20000 then raise exception 'that answer is too long' using errcode = '22023'; end if;
  update public.candidate_requests set status = 'answered', answer = p_answer, answered_at = now() where id = q.id;
  perform public.log_case_event(v_case, q.case_check_id, 'request_answered', 'Answered: ' || q.title, null,
    jsonb_build_object('request_id', q.id), false, true);
  perform public.notify_case_owner(v_case, 'candidate.answer', 'Candidate answered: ' || q.title,
    (select reference from public.cases where id = v_case));
end $$;

create or replace function public.candidate_link_case(p_link uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_case uuid;
begin
  select l.case_id into v_case
    from public.candidate_links l join public.cases c on c.id = l.case_id
   where l.id = p_link and l.revoked_at is null and l.expires_at > now() and c.stage <> 'cancelled';
  if v_case is null then raise exception 'link_expired' using errcode = 'P0002'; end if;
  -- Every candidate action starts here, so the audit trail can say it was the candidate.
  perform set_config('app.actor_kind', 'candidate', true);
  return v_case;
end $$;

-- ---------------------------------------------------------------------------
-- New versions of the built-in check types (src/domain/check-types/builtin.ts)
-- ---------------------------------------------------------------------------
-- School levels for education, a reply-from-the-source slot on the checks that
-- contact one, a file per employer, what was confirmed with each referee, and
-- the details a sanction screening needs. Cases keep the version they started on.

do $delta$
declare
  d jsonb := $json${
  "education_levels": [
    { "value": "primary", "label": "Primary school" },
    { "value": "secondary", "label": "Secondary school" }
  ],
  "per_record": { "employment": { "service_letter": "employers" } },
  "documents": {
    "education": [{ "category": "verification_response", "label": "Reply from the institution", "description": "The institution's reply, or a screenshot of the official portal.", "min": 0, "stage": "verification", "client_visible": false }],
    "employment": [{ "category": "verification_response", "label": "Reply from the employer", "description": "HR's reply confirming dates, role and employment type.", "min": 0, "stage": "verification", "client_visible": false }],
    "address": [{ "category": "verification_response", "label": "Confirmation from the Grama Niladhari", "description": "The Grama Niladhari's or other authorised source's reply.", "min": 0, "stage": "verification", "client_visible": false }],
    "police": [{ "category": "verification_response", "label": "Confirmation from the station", "description": "The issuing station's or authorised officer's confirmation.", "min": 0, "stage": "verification", "client_visible": false }],
    "nic": [{ "category": "verification_response", "label": "Official validation result", "description": "The result from the Department for Registration of Persons or another official source.", "min": 0, "stage": "verification", "client_visible": false }]
  },
  "group_fields": {
    "reference": {
      "referees": [
        { "key": "details_confirmed", "label": "Details confirmed by the referee", "type": "select", "required": false, "stage": "verification", "options": [{ "value": "yes", "label": "Yes, all" }, { "value": "partly", "label": "Partly" }, { "value": "no", "label": "No" }], "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" },
        { "key": "confirmed_on", "label": "Spoken to on", "type": "date", "required": false, "stage": "verification", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" }
      ]
    }
  },
  "fields": {
    "sanction": [
      { "key": "screened_name", "label": "Full name to screen", "type": "text", "required": false, "stage": "data_entry", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff", "candidate"], "width": "half" },
      { "key": "date_of_birth", "label": "Date of birth", "type": "date", "required": false, "stage": "data_entry", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff", "candidate"], "width": "half" },
      { "key": "identity_number", "label": "NIC or passport number", "type": "text", "required": false, "stage": "data_entry", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff", "candidate"], "width": "half" },
      { "key": "nationality", "label": "Nationality", "type": "text", "required": false, "stage": "data_entry", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff", "candidate"], "width": "half" }
    ]
  }
}$json$::jsonb;
  t record;
  v_schema jsonb;
  v_list jsonb;
  v_id uuid;
begin
  for t in select ct.id, ct.org_id, ct.key, ct.current_version_id from public.check_types ct
            where ct.current_version_id is not null and ct.key in ('education', 'employment', 'address', 'police', 'nic', 'reference', 'sanction') loop
    select schema into v_schema from public.check_type_versions where id = t.current_version_id;

    if t.key = 'education' then
      select jsonb_agg(case when f ->> 'key' = 'qualification_level'
                            then jsonb_set(f, '{options}', (d -> 'education_levels') || (f -> 'options')) else f end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'fields') with ordinality as a(f, n);
      v_schema := jsonb_set(v_schema, '{fields}', v_list);
    end if;

    if d -> 'fields' ? t.key then
      -- Before the results: what is screened comes before what the screening found.
      v_schema := jsonb_set(v_schema, '{fields}', (d -> 'fields' -> t.key) || (v_schema -> 'fields'));
    end if;

    if d -> 'group_fields' ? t.key then
      select jsonb_agg(case when d -> 'group_fields' -> t.key ? (f ->> 'key')
                            then jsonb_set(f, '{fields}', (f -> 'fields') || (d -> 'group_fields' -> t.key -> (f ->> 'key'))) else f end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'fields') with ordinality as a(f, n);
      v_schema := jsonb_set(v_schema, '{fields}', v_list);
    end if;

    if d -> 'per_record' ? t.key then
      select jsonb_agg(case when d -> 'per_record' -> t.key ? (x ->> 'category')
                            then x || jsonb_build_object('per_record', d -> 'per_record' -> t.key ->> (x ->> 'category')) else x end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'documents') with ordinality as a(x, n);
      v_schema := jsonb_set(v_schema, '{documents}', v_list);
    end if;

    if d -> 'documents' ? t.key then
      v_schema := jsonb_set(v_schema, '{documents}', (v_schema -> 'documents') || (d -> 'documents' -> t.key));
    end if;

    insert into public.check_type_versions (org_id, check_type_id, version, schema, notes, published_at)
    values (t.org_id, t.id, (select coalesce(max(version), 0) + 1 from public.check_type_versions where check_type_id = t.id), v_schema,
            'School levels, replies from sources, a file per employer, referee confirmation, screening details', now())
    returning id into v_id;
    update public.check_types set current_version_id = v_id where id = t.id;
  end loop;
end $delta$;
