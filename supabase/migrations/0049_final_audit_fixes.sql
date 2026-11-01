-- =============================================================================
-- 0049_final_audit_fixes.sql
-- What the final blind audit of the finished system found on 31 October 2026.
-- See docs/features/0049-final-audit-fixes.md.
--   Confidentiality (spec 6.4): a request can't pull another client's candidate,
--   the feed and counts honour what a client may see, the client can't read
--   Ontriq's settings, and sensitive evidence reaches a report by a decision.
--   Erasure: nothing personal stays behind, and files are retried until gone.
--   Workflow (spec 3, 5, 9): holds stop work, closed cases stay closed, QC
--   reviews test the evidence, and the approver's outcome is explained.
--   Evidence (spec 4, 7): a check records what the source said, each employer
--   has its own file, and a report that lost a file can't go out unnoticed.
-- Depends on: everything before it, 0048 most of all.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared rules
-- ---------------------------------------------------------------------------
create or replace function public.require_case_open(c public.cases) returns void
language plpgsql stable set search_path = '' as $$
begin
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold; resume it first' using errcode = '22023'; end if;
end $$;
revoke execute on function public.require_case_open(public.cases) from public, anon, authenticated;

-- The portal and the candidate's page stop taking files when verification ends.
-- Asking then would leave someone with a request they have no way to answer.
create or replace function public.require_uploads_open(c public.cases) returns void
language plpgsql stable set search_path = '' as $$
begin
  if c.stage in ('post_qc', 'report', 'approval') then
    raise exception 'uploads closed when verification ended; send the case back to verification first, so they can send it' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.require_uploads_open(public.cases) from public, anon, authenticated;

-- Post-QC checked the evidence. After that it changes through QC, and not at all
-- once the approver has it: they send the report back.
create or replace function public.require_evidence_unlocked(c public.cases) returns void
language plpgsql stable set search_path = '' as $$
begin
  if c.stage = 'approval' then raise exception 'the report is with the approver; send it back to change the evidence' using errcode = '22023'; end if;
  if c.stage in ('post_qc', 'report') and auth.uid() is not null
     and not (public.has_permission('qc.post') or public.has_permission('cases.stage.change')) then
    raise exception 'evidence is locked after verification; a QC reviewer or manager can change it' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.require_evidence_unlocked(public.cases) from public, anon, authenticated;

-- The flowchart's steps 2 to 8. Checks list in this order; settings can also enforce it.
create or replace function public.flowchart_check_order() returns text[]
language sql immutable set search_path = '' as $$
  select array['education', 'employment', 'nic', 'sanction', 'reference', 'address', 'police']
$$;
revoke execute on function public.flowchart_check_order() from public, anon, authenticated;

create or replace function public.workflow_check_order(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select case when coalesce((o.settings #>> '{workflow,enforce_check_order}')::boolean, false)
              then public.flowchart_check_order() end
    from public.orgs o where o.id = p_org
$$;

-- ---------------------------------------------------------------------------
-- New columns and tables
-- ---------------------------------------------------------------------------
alter table public.cases
  add column intake_candidate jsonb,
  add column candidate_match_open boolean not null default false;
comment on column public.cases.intake_candidate is 'The candidate as the client typed them on a portal request. The portal shows this, never the shared record.';
comment on column public.cases.candidate_match_open is 'The NIC matched a record with a different name, and nobody has looked yet.';

alter table public.documents add column withheld_reason text check (char_length(withheld_reason) <= 500);
comment on column public.documents.withheld_reason is 'Why sensitive evidence stays out of the report, when someone decided that.';

alter table public.requirement_files add column record_keys text[] not null default '{}';
comment on column public.requirement_files.record_keys is 'The employers or referees this combined file covers: "employers.1".';

alter table public.document_categories add column needs_original boolean not null default false;
comment on column public.document_categories.needs_original is 'Pre-QC wants an original or certified copy of this kind of document (the flowchart''s copy or original step).';

alter table public.report_versions
  add column source_stamp text,
  add column result_reason text,
  add column evidence_note text;
comment on column public.report_versions.source_stamp is 'public.case_report_stamp when the draft was read. Approval and release compare it with the case as it is then.';
comment on column public.report_versions.result_reason is 'Why the approver''s result differs from what the checks propose.';
comment on column public.report_versions.evidence_note is 'Why the report may go with a file that was unreadable, altered or protected.';

alter table public.report_downloads add column part int;

-- Files an erasure still has to remove. The worker retries them until they go.
create table public.storage_deletions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid,
  bucket text not null,
  path text not null,
  is_folder boolean not null default false,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index storage_deletions_pending_idx on public.storage_deletions (created_at) where done_at is null;
create index storage_deletions_org_idx on public.storage_deletions (org_id);
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from anon, authenticated;
comment on table public.storage_deletions is 'Deny-all to API roles by design: only the worker and the erase action use it, with the service key.';

-- Candidate reports hold the candidate's files, so they need more room than a quote.
update storage.buckets set file_size_limit = 52428800 where id = 'documents' and coalesce(file_size_limit, 0) < 52428800;

-- ---------------------------------------------------------------------------
-- Statuses: an internal return isn't the client's to see (spec 6.2, 6.4)
-- ---------------------------------------------------------------------------
insert into public.client_status_catalog (org_id, key, stage, internal_label, client_label, candidate_label, sort)
select o.id, s.key, s.stage::public.case_stage, s.internal_label, s.client_label, s.candidate_label, s.sort
  from public.orgs o
 cross join (values
   ('returned_to_data_entry', 'data_entry', 'Returned to Data Entry', 'Data Entry in Progress', 'Verification in progress', 52),
   ('returned_to_verification', 'verification', 'Returned to Verification', 'Verification in Progress', 'Verification in progress', 62)
 ) as s(key, stage, internal_label, client_label, candidate_label, sort)
on conflict (org_id, key) do nothing;
update public.cases set status_key = case stage when 'data_entry' then 'returned_to_data_entry' else 'returned_to_verification' end
 where status_key = 'returned_for_correction' and stage in ('data_entry', 'verification');
create or replace function public.save_custom_status(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_key text := nullif(p ->> 'key', '');
  v_label text := nullif(trim(p ->> 'internal_label'), '');
begin
  if not public.has_permission('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_label is null then raise exception 'name the status' using errcode = '22023'; end if;
  -- The internal name is staff wording. It never reaches a client by default.
  if v_key is null and nullif(trim(p ->> 'client_label'), '') is null then
    raise exception 'say what the client sees for this status' using errcode = '22023';
  end if;
  if v_key is null then
    v_key := 'custom_' || left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 40) || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.client_status_catalog (org_id, key, stage, internal_label, client_label, candidate_label, sort, is_custom)
    values (v_org, v_key, 'verification', left(v_label, 60), left(trim(p ->> 'client_label'), 60),
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

create or replace function public.portal_stage_label(p public.case_stage) returns text
language sql immutable set search_path = '' as $$
  select case p when 'intake' then 'Request received' when 'documents' then 'Collecting documents' when 'pre_qc' then 'Documents under review'
    when 'data_entry' then 'In progress' when 'verification' then 'Verification in progress' when 'post_qc' then 'Quality review'
    when 'report' then 'Report in preparation' when 'approval' then 'Awaiting approval' when 'released' then 'Report available'
    when 'cancelled' then 'Cancelled' else 'Case updated' end
$$;

-- ---------------------------------------------------------------------------
-- A client names a candidate. They never get the record on file (spec 6.4)
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
  v_typed jsonb;
  v_differs boolean := false;
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
    if v_is_client then raise exception 'new requests are paused for your company; please contact Ontriq' using errcode = '22023'; end if;
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
    select array_agg(pi.check_type_id order by coalesce(array_position(public.flowchart_check_order(), ct.key), 100), pi.sort, ct.sort) into v_types
      from public.package_items pi join public.check_types ct on ct.id = pi.check_type_id
     where pi.package_id = v_package.id;
    v_tat := v_package.tat_days;
  else
    -- A portal request goes through a package: that is where its price comes from.
    if v_is_client then raise exception 'choose a package' using errcode = '22023'; end if;
    select array_agg(ct.id order by coalesce(array_position(public.flowchart_check_order(), ct.key), 100), ct.sort) into v_types
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
             -- Outside a package, a check is priced as add_case_check prices one: at list.
             'unit_price', coalesce((select pi.unit_price from public.package_items pi where pi.package_id = v_package.id and pi.check_type_id = ct.id),
                                    (select max(pi.unit_price) from public.package_items pi join public.packages pk on pk.id = pi.package_id
                                      where v_package.id is null and pi.check_type_id = ct.id and pk.owner_scope = 'org' and pk.is_active), 0))
             order by array_position(v_types, ct.id)), '[]'::jsonb))
    into v_snapshot
    from public.check_types ct where ct.id = any (v_types);

  -- Candidate: reuse by id or NIC, otherwise create. Clients name a person, they don't pick a record.
  if nullif(v_cand ->> 'id', '') is not null and not v_is_client then
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

  -- What the client typed stays theirs. The record on file may come from another
  -- client's case, so the portal never shows it, and a different name waits for a person.
  if v_is_client then
    if coalesce(trim(v_cand ->> 'full_name'), '') = '' then
      raise exception 'enter the candidate''s name' using errcode = '22023';
    end if;
    v_typed := jsonb_strip_nulls(jsonb_build_object(
      'full_name', trim(v_cand ->> 'full_name'), 'nic', nullif(trim(v_cand ->> 'nic'), ''),
      'email', nullif(lower(trim(v_cand ->> 'email')), ''), 'phone', nullif(trim(v_cand ->> 'phone'), ''),
      'address', nullif(trim(v_cand ->> 'address'), '')));
    if v_reused then
      select lower(regexp_replace(trim(cd.full_name), '\s+', ' ', 'g')) <> lower(regexp_replace(v_typed ->> 'full_name', '\s+', ' ', 'g'))
        into v_differs from public.candidates cd where cd.id = v_candidate_id;
    end if;
  end if;

  v_reference := public.next_case_number(v_org);
  v_due := public.add_working_days(now(), v_tat);
  v_stage := case when v_via = 'portal' then 'intake'::public.case_stage else 'documents'::public.case_stage end;

  insert into public.cases (org_id, reference, client_id, candidate_id, package_id, package_snapshot, process_type, stage, status_key, priority,
                            position_title, department, client_reference, instructions, internal_notes, candidate_name, created_via, due_at, created_by,
                            intake_candidate, candidate_match_open)
  select v_org, v_reference, v_client.id, v_candidate_id, v_package.id, v_snapshot,
         coalesce(nullif(p ->> 'process_type', ''), coalesce(v_package.default_process_type::text, 'client_supplied'))::public.process_type,
         v_stage, case when v_stage = 'intake' then 'case_received' else 'documents_pending' end,
         coalesce(nullif(p ->> 'priority', ''), 'normal'),
         nullif(trim(p ->> 'position_title'), ''), nullif(trim(p ->> 'department'), ''), nullif(trim(p ->> 'client_reference'), ''),
         nullif(trim(p ->> 'instructions'), ''),
         case when v_is_client then null else nullif(trim(p ->> 'internal_notes'), '') end,
         case when v_is_client then v_typed ->> 'full_name' else cd.full_name end, v_via, v_due, v_uid,
         v_typed, coalesce(v_differs, false)
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
    insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort, due_at, values_valid)
    values (v_org, v_case_id, v_type.id, v_type.current_version_id, v_type.name, v_sort,
            least(v_due, public.add_working_days(now(), coalesce((v_type.schema ->> 'sla_days')::int, v_tat))),
            -- A check with nothing required has nothing to wait for.
            public.check_values_complete(v_type.schema, '{}'::jsonb))
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
    case when v_reused and not v_is_client then 'Linked to an existing candidate record.' else null end,
    jsonb_build_object('via', v_via, 'checks', cardinality(v_types)), true, true);
  if v_is_client and v_reused then
    perform public.log_case_event(v_case_id, null, 'candidate_match', 'NIC matches a candidate already on file',
      case when v_differs then 'The client gave a different name. Check it before accepting the request.' end, '{}'::jsonb, false, false);
  end if;
  perform public.recompute_case(v_case_id);

  if nullif(p ->> 'template_id', '') is not null then
    update public.request_templates set usage_count = usage_count + 1, last_used_at = now()
     where id = (p ->> 'template_id')::uuid and org_id = v_org;
  end if;

  -- Spec 6.3: the client hears what Ontriq needs as soon as a case opens. An import tells them once, not row by row.
  if v_stage = 'documents' and public.portal_pending_slots(v_case_id) > 0 then
    if v_via <> 'import' then
      perform public.notify_client_users(v_case_id, 'portal.documents_needed', v_reference || ': documents needed', '');
    elsif not exists (select 1 from public.notifications n join public.memberships m on m.user_id = n.user_id
                       where m.client_id = v_client.id and n.type = 'portal.documents_needed'
                         and n.title = 'New cases need documents' and n.created_at > now() - interval '15 minutes') then
      perform public.notify_client_users(v_case_id, 'portal.documents_needed', 'New cases need documents', '');
    end if;
  end if;

  perform public.enqueue_job('assign.auto', jsonb_build_object('case_id', v_case_id), 'assign.auto:' || v_case_id,
                             now(), null, 'case', v_case_id, null, v_org, v_uid);

  if v_is_client then return jsonb_build_object('case_id', v_case_id, 'reference', v_reference); end if;
  return jsonb_build_object('case_id', v_case_id, 'reference', v_reference, 'candidate_id', v_candidate_id, 'candidate_reused', v_reused);
end $$;

-- Same person, or a NIC typed wrongly. A person decides before the request is accepted.
create or replace function public.resolve_candidate_match(p_case uuid, p_same boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_new uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not c.candidate_match_open then raise exception 'there is nothing to check on this candidate' using errcode = '22023'; end if;
  if p_same then
    update public.cases set candidate_match_open = false, candidate_name = (select full_name from public.candidates where id = c.candidate_id) where id = p_case;
  else
    -- The case gets a record of its own. The NIC stays as a note until Data Entry confirms it.
    insert into public.candidates (org_id, full_name, nic, email, phone, address, created_by)
    values (c.org_id, c.intake_candidate ->> 'full_name', c.intake_candidate ->> 'nic', c.intake_candidate ->> 'email',
            c.intake_candidate ->> 'phone', c.intake_candidate ->> 'address', auth.uid())
    returning id into v_new;
    update public.cases set candidate_id = v_new, candidate_match_open = false where id = p_case;
    update public.documents set candidate_id = v_new where case_id = p_case;
  end if;
  perform public.log_case_event(p_case, null, 'candidate_match', case when p_same then 'Confirmed as the candidate on file' else 'Kept apart from the candidate on file' end,
    null, '{}'::jsonb, false, false);
end $$;
revoke execute on function public.resolve_candidate_match(uuid, boolean) from public, anon;
grant execute on function public.resolve_candidate_match(uuid, boolean) to authenticated, service_role;
create or replace function public.update_candidate(p_candidate uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cd public.candidates;
  v_new public.candidates;
begin
  if auth.uid() is not null and not (public.is_staff() and (public.has_permission('candidates.manage')
       or (public.has_permission('cases.update') and exists (select 1 from public.cases c where c.candidate_id = p_candidate and public.case_visible(c.id))))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.candidates where id = p_candidate and erased_at is not null) then
    raise exception 'this candidate''s data was erased' using errcode = '22023';
  end if;
  select * into cd from public.candidates where id = p_candidate;
  -- What the report prints stays as the approver read it: the report goes back first.
  if (nullif(trim(p ->> 'full_name'), '') is not null and trim(p ->> 'full_name') is distinct from cd.full_name
      or (p ? 'nic' and nullif(trim(p ->> 'nic'), '') is distinct from cd.nic)
      or (p ? 'date_of_birth' and nullif(p ->> 'date_of_birth', '')::date is distinct from cd.date_of_birth))
     and exists (select 1 from public.cases c where c.candidate_id = p_candidate and c.stage = 'approval') then
    raise exception 'a report on this candidate is with the approver; send it back to change these details' using errcode = '22023';
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
  select * into v_new from public.candidates where id = p_candidate;
  update public.cases
     set candidate_name = v_new.full_name,
         -- A correction replaces what the client typed, so the link and reminders reach the right person.
         intake_candidate = case when intake_candidate is null then null else jsonb_strip_nulls(intake_candidate || jsonb_build_object('full_name', v_new.full_name)
           || case when p ? 'email' then jsonb_build_object('email', v_new.email) else '{}'::jsonb end
           || case when p ? 'phone' then jsonb_build_object('phone', v_new.phone) else '{}'::jsonb end) end
   where candidate_id = p_candidate and stage not in ('released', 'cancelled') and erased_at is null and not candidate_match_open;
end $$;
create or replace function public.update_case_details(p_case uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if c.stage = 'approval' and ((p ? 'position_title' and nullif(trim(p ->> 'position_title'), '') is distinct from c.position_title)
                               or (p ? 'department' and nullif(trim(p ->> 'department'), '') is distinct from c.department)
                               or (p ? 'client_reference' and nullif(trim(p ->> 'client_reference'), '') is distinct from c.client_reference)) then
    raise exception 'the report is with the approver; send it back to change what it prints' using errcode = '22023';
  end if;
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
-- Document slots (spec 7, the flowchart's first boxes)
-- ---------------------------------------------------------------------------
-- A file counts once for a slot. A drawn signature is consent, not a form, and
-- signing online fills the consent slot with no file at all. A file for the whole
-- case fills a slot only when there is one slot it can mean.
create or replace function public.sync_requirement_counts(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.case_check_requirements r
     set received_count = x.n,
         status = case
           when r.status = 'waived' then 'waived'
           when r.min_count = 0 then 'optional'
           when x.n >= r.min_count then 'received'
           else 'pending' end
    from (
      select r2.id,
             greatest((select count(*) from public.documents d
                        where d.case_id = r2.case_id and d.status in ('uploaded', 'accepted')
                          and not (d.category = 'consent_form' and d.mime = 'image/png' and d.filename = 'signature.png' and d.uploaded_by_kind = 'candidate')
                          and ((d.category = r2.category
                                and (r2.case_check_id is null or d.case_check_id = r2.case_check_id
                                     or (d.case_check_id is null
                                         and (select count(*) from public.case_check_requirements o where o.case_id = r2.case_id and o.category = r2.category) = 1)))
                               or exists (select 1 from public.requirement_files f where f.requirement_id = r2.id and f.document_id = d.id))),
                      case when r2.category = 'consent_form'
                            and exists (select 1 from public.consent_forms f where f.case_id = r2.case_id and f.status in ('submitted', 'accepted')) then 1 else 0 end)::int as n
        from public.case_check_requirements r2 where r2.case_id = p_case
    ) x
   where r.id = x.id and (r.received_count, r.status) is distinct from (x.n, case
           when r.status = 'waived' then 'waived' when r.min_count = 0 then 'optional'
           when x.n >= r.min_count then 'received' else 'pending' end);
  perform public.recompute_case(p_case);
end $$;

create or replace function public.consent_forms_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_requirement_counts(new.case_id);
  return null;
end $$;
revoke execute on function public.consent_forms_after_change() from public, anon, authenticated;
create trigger consent_forms_after_change after insert or update of status on public.consent_forms
  for each row execute function public.consent_forms_after_change();

-- Spec 2.1 and the flowchart's first box: a request starts from the candidate's CV.
create or replace function public.cases_consent_slot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.case_check_requirements (org_id, case_id, category, label, description, min_count, stage, client_visible, status)
  values (new.org_id, new.id, 'cv', 'CV or résumé', 'The candidate''s latest CV.', 1, 'documents', true, 'pending');
  if new.process_type = 'client_supplied' then
    insert into public.case_check_requirements (org_id, case_id, category, label, description, min_count, stage, client_visible, status)
    values (new.org_id, new.id, 'consent_form', 'BGV form and signed consent', 'The candidate''s completed BGV form with their signed consent.', 1, 'documents', true, 'pending');
  end if;
  return null;
end $$;

create or replace function public.candidate_providable(p_category text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_category not in ('field_verification', 'sanction_report', 'consent_form', 'verification_response', 'reference_form')
$$;

create or replace function public.portal_check_row_hidden(p_check uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.case_checks k join public.cases c on c.id = k.case_id
                  where k.id = p_check and public.portal_check_hidden(c.client_id, k.check_type_id))
$$;
revoke execute on function public.portal_check_row_hidden(uuid) from public, anon;
grant execute on function public.portal_check_row_hidden(uuid) to authenticated, service_role;
create or replace function public.begin_document_upload(
  p_case uuid, p_check uuid, p_category text, p_filename text, p_mime text, p_size bigint, p_parent uuid default null, p_label text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_parent public.documents;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_safe text;
  v_sensitive boolean;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('candidates.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  select sensitive into v_sensitive from public.document_categories where org_id = c.org_id and key = p_category and is_active;
  if v_sensitive is null then raise exception 'unknown document category' using errcode = '22023'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'upload a PDF, JPEG, PNG, WebP or HEIC file' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then raise exception 'files must be under 25 MB' using errcode = '22023'; end if;
  if p_parent is not null then
    select * into v_parent from public.documents where id = p_parent and case_id = p_case;
    if v_parent.id is null then raise exception 'previous version not found' using errcode = 'P0002'; end if;
  end if;

  v_safe := left(regexp_replace(lower(coalesce(p_filename, 'file')), '[^a-z0-9._-]+', '-', 'g'), 80);
  v_path := 'org/' || c.org_id || '/case/' || c.id || '/' || v_id || '/' || v_safe;
  insert into public.documents (id, org_id, case_id, case_check_id, candidate_id, client_id, category, label, storage_path, filename, mime, size_bytes,
                                version, parent_id, sensitive, visibility, withheld_reason, record_key, uploaded_by, uploaded_by_kind)
  values (v_id, c.org_id, c.id, coalesce(p_check, v_parent.case_check_id), c.candidate_id, c.client_id, p_category, nullif(trim(p_label), ''), v_path,
          coalesce(nullif(trim(p_filename), ''), 'file'), p_mime, p_size, coalesce(v_parent.version + 1, 1), v_parent.id, v_sensitive,
          -- A new version keeps its place in the report. Showing it to the client is a fresh decision.
          case when v_parent.visibility in ('report', 'client') then 'report' else 'internal' end, v_parent.withheld_reason, v_parent.record_key,
          auth.uid(), case when auth.uid() is null then 'system' else 'staff' end);
  return jsonb_build_object('id', v_id, 'bucket', 'case-files', 'path', v_path);
end $$;
create or replace function public.finalize_document_upload(p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  if auth.uid() is not null and d.uploaded_by is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  -- The same gates as starting the upload: one begun before a lock doesn't finish after it.
  if auth.uid() is not null then
    select * into c from public.cases where id = d.case_id;
    perform public.require_case_open(c);
    perform public.require_evidence_unlocked(c);
  end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = p_document;
  if d.parent_id is not null then
    update public.documents set status = 'superseded' where id = d.parent_id and status <> 'superseded';
  end if;
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_uploaded',
    coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category) || ' uploaded',
    d.filename, jsonb_build_object('document_id', d.id, 'version', d.version, 'by', 'staff'), false, false);
end $$;
create or replace function public.review_document(p_document uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if not p_accept and d.uploaded_by_kind in ('client', 'candidate') then perform public.require_uploads_open(c); end if;
  -- Consent is reviewed as consent, which tells the candidate and lets them sign again. Their page has no slot for this file.
  if not p_accept and ((d.category = 'consent_form' and d.uploaded_by_kind = 'candidate')
                       or exists (select 1 from public.consent_forms f where f.document_id = d.id)) then
    raise exception 'this is the signed consent form; review it in the Candidate section' using errcode = '22023';
  end if;
  if d.status not in ('uploaded', 'accepted', 'rejected') then raise exception 'this file cannot be reviewed now' using errcode = '22023'; end if;
  if not p_accept and coalesce(trim(p_reason), '') = '' then raise exception 'say what is wrong with the file' using errcode = '22023'; end if;
  update public.documents
     set status = case when p_accept then 'accepted' else 'rejected' end,
         rejection_reason = case when p_accept then null else p_reason end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_document;
  perform public.log_case_event(d.case_id, d.case_check_id, case when p_accept then 'document_accepted' else 'document_rejected' end,
    d.filename || case when p_accept then ' accepted' else ' needs replacing' end, p_reason,
    -- Whoever sent the file hears about it. Nobody else reads the reason.
    jsonb_build_object('document_id', d.id, 'by', d.uploaded_by_kind), not p_accept and d.uploaded_by_kind = 'client', not p_accept and d.uploaded_by_kind = 'candidate');
end $$;
create or replace function public.waive_requirement(p_requirement uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.case_check_requirements;
  c public.cases;
begin
  select * into r from public.case_check_requirements where id = p_requirement for update;
  if r.id is null or (auth.uid() is not null and not public.case_visible(r.case_id)) then raise exception 'requirement not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.stage.change') or public.has_permission('qc.pre')) then
    raise exception 'only a manager or QC officer can waive a document' using errcode = '42501';
  end if;
  select * into c from public.cases where id = r.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the document is waived' using errcode = '22023'; end if;
  update public.case_check_requirements set status = 'waived', waived_reason = p_reason, waived_by = auth.uid(), waived_at = now() where id = p_requirement;
  -- Nobody is asked for what isn't needed any more.
  update public.candidate_requests set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now() where requirement_id = p_requirement and status = 'open';
  perform public.log_case_event(r.case_id, r.case_check_id, 'requirement_waived', 'Document waived: ' || r.label, p_reason, '{}'::jsonb, false, false);
  perform public.recompute_case(r.case_id);
end $$;
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
  perform public.require_case_open(c);
  perform public.require_uploads_open(c);
  if c.process_type = 'client_supplied' and p_check is not null and public.portal_check_row_hidden(p_check) then
    raise exception 'this check is hidden from the client, so they couldn''t see the request' using errcode = '22023';
  end if;
  if c.process_type = 'candidate_collected' and not public.candidate_providable(p_category, 'documents') then
    raise exception 'the candidate can''t provide that kind of document; upload it yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.document_categories d where d.org_id = c.org_id and d.key = p_category) then
    raise exception 'unknown document category' using errcode = '22023';
  end if;
  select id into v_id from public.case_check_requirements
   where case_id = p_case and category = p_category and case_check_id is not distinct from p_check;
  if v_id is not null then
    update public.case_check_requirements
       set status = 'pending', min_count = greatest(min_count, received_count + greatest(p_min, 1)),
           stage = case when c.stage in ('intake', 'documents') then stage else 'verification' end,
           client_visible = client_visible or c.process_type = 'client_supplied',
           requested_note = p_note, requested_at = now(), requested_by = auth.uid(), waived_reason = null, waived_by = null, waived_at = null
     where id = v_id;
  else
    insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, stage, min_count, status, client_visible, requested_note, requested_at, requested_by)
    values (c.org_id, p_case, p_check, p_category, coalesce(nullif(trim(p_label), ''), p_category),
            -- Asked for during the work, it is due by the end of verification, not before Pre-QC.
            case when c.stage in ('intake', 'documents') then 'documents' else 'verification' end,
            greatest(p_min, 1), 'pending', true, p_note, now(), auth.uid())
    returning id into v_id;
  end if;
  perform public.log_case_event(p_case, p_check, 'document_requested', 'Document requested: ' || coalesce(nullif(trim(p_label), ''), p_category),
    p_note, jsonb_build_object('category', p_category), c.process_type = 'client_supplied', c.process_type = 'candidate_collected');
  perform public.recompute_case(p_case);
  return v_id;
end $$;
create or replace function public.confirm_requirement_files(p_document uuid, p_links jsonb, p_source text default 'staff') returns int
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
  r public.case_check_requirements;
  v_link jsonb;
  v_labels text[] := '{}';
  v_sensitive boolean;
  v_report boolean;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if d.status not in ('uploaded', 'accepted') then raise exception 'this file cannot fill a document slot now' using errcode = '22023'; end if;
  if p_source not in ('ai', 'staff') then raise exception 'unknown source' using errcode = '22023'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links) = 0 then raise exception 'choose at least one document' using errcode = '22023'; end if;

  for v_link in select * from jsonb_array_elements(p_links) loop
    select * into r from public.case_check_requirements where id = (v_link ->> 'requirement')::uuid and case_id = d.case_id for update;
    if r.id is null then raise exception 'requirement not found' using errcode = 'P0002'; end if;
    if r.status = 'waived' then raise exception '% was waived', r.label using errcode = '22023'; end if;
    -- The screening report is attached to the client's report untouched, so it has to stay a file of its own.
    if exists (select 1 from public.case_checks k join public.check_type_versions v on v.id = k.check_type_version_id
                where k.case_id = d.case_id and v.schema #>> '{fixed_annexure,category}' = r.category) then
      raise exception '% must be uploaded as its own file', r.label using errcode = '22023';
    end if;
    insert into public.requirement_files (org_id, case_id, requirement_id, document_id, pages, source, confirmed_by, record_keys)
    values (d.org_id, d.case_id, r.id, d.id, left(nullif(trim(v_link ->> 'pages'), ''), 40), p_source, auth.uid(),
            array(select x from jsonb_array_elements_text(coalesce(v_link -> 'records', '[]'::jsonb)) x where x ~ '^[a-z][a-z0-9_]*\.[0-9]+$'))
    on conflict (requirement_id, document_id) do update set pages = excluded.pages, source = excluded.source, confirmed_by = excluded.confirmed_by,
      record_keys = excluded.record_keys;
    v_labels := v_labels || r.label;
  end loop;

  -- The file now carries these documents, so it takes on their handling.
  select coalesce(bool_or(dc.sensitive), false), coalesce(bool_or(dc.in_report), false) into v_sensitive, v_report
    from public.requirement_files f
    join public.case_check_requirements q on q.id = f.requirement_id
    join public.document_categories dc on dc.org_id = d.org_id and dc.key = q.category
   where f.document_id = d.id;
  update public.documents
     set sensitive = sensitive or v_sensitive,
         visibility = case when visibility = 'internal' and v_report then 'report' else visibility end
   where id = d.id and ((v_sensitive and not sensitive) or (visibility = 'internal' and v_report));

  perform public.log_case_event(d.case_id, null, 'document_matched', d.filename || ' holds ' || array_to_string(v_labels, ', '), null,
    jsonb_build_object('document_id', d.id, 'source', p_source), false, false);
  return cardinality(v_labels);
end $$;
create or replace function public.remove_requirement_file(p_requirement uuid, p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
  v_label text;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  select r.label into v_label from public.case_check_requirements r
    join public.requirement_files f on f.requirement_id = r.id and f.document_id = d.id
   where r.id = p_requirement;
  if v_label is null then raise exception 'that file is not on this slot' using errcode = 'P0002'; end if;
  delete from public.requirement_files where requirement_id = p_requirement and document_id = d.id;
  -- A file that no longer holds any evidence shouldn't stay in the report because of a slip.
  if d.visibility = 'report'
     and not exists (select 1 from public.requirement_files f where f.document_id = d.id)
     and not exists (select 1 from public.document_categories dc where dc.org_id = d.org_id and dc.key = d.category and dc.in_report) then
    update public.documents set visibility = 'internal' where id = d.id;
  end if;
  perform public.log_case_event(d.case_id, null, 'document_unmatched', d.filename || ' no longer counts for ' || v_label, null,
    jsonb_build_object('document_id', d.id), false, false);
end $$;

-- A file in the wrong place moves to the right one, and the slots recount.
create or replace function public.refile_document(p_document uuid, p_check uuid, p_category text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
  v_sensitive boolean;
  v_name text;
  v_in_report boolean;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or not public.case_visible(d.case_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if d.status not in ('uploaded', 'accepted', 'rejected') then raise exception 'this file can''t be moved now' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = d.case_id) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  select sensitive, name, in_report into v_sensitive, v_name, v_in_report from public.document_categories where org_id = d.org_id and key = p_category and is_active;
  if v_sensitive is null then raise exception 'unknown document category' using errcode = '22023'; end if;
  update public.documents
     set case_check_id = p_check, category = p_category, record_key = null, sensitive = sensitive or v_sensitive,
         -- Moved into a kind of evidence the report carries, it goes in the report, as it would have on upload.
         visibility = case when visibility = 'internal' and withheld_reason is null and v_in_report then 'report' else visibility end
   where id = p_document;
  perform public.log_case_event(d.case_id, p_check, 'document_refiled', d.filename || ' moved to ' || v_name, null,
    jsonb_build_object('document_id', d.id, 'from_category', d.category, 'from_check', d.case_check_id), false, false);
end $$;
revoke execute on function public.refile_document(uuid, uuid, text) from public, anon;
grant execute on function public.refile_document(uuid, uuid, text) to authenticated, service_role;

-- Sharing is deliberate, and so is keeping sensitive evidence out of a report (spec 6.4).
drop function public.set_document_visibility(uuid, text);
create function public.set_document_visibility(p_document uuid, p_visibility text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = d.case_id;
  -- Post-QC can put evidence in the report: it is the reviewer who finds it missing.
  if auth.uid() is not null and not (public.has_permission('documents.manage_visibility')
                                     or (p_visibility = 'report' and c.stage = 'post_qc' and public.has_permission('qc.post'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_visibility not in ('internal', 'client', 'report') then raise exception 'unknown visibility' using errcode = '22023'; end if;
  if p_visibility = 'client' and d.sensitive and auth.uid() is not null and not public.has_permission('documents.read_sensitive') then
    raise exception 'only someone who can open sensitive evidence can share it' using errcode = '42501';
  end if;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  update public.documents
     set visibility = p_visibility,
         withheld_reason = case when p_visibility = 'internal' and d.sensitive then nullif(trim(p_reason), '') end
   where id = p_document;
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_visibility', d.filename || ' is now ' || p_visibility, nullif(trim(p_reason), ''),
    jsonb_build_object('document_id', d.id, 'visibility', p_visibility), false, false);
end $$;
revoke execute on function public.set_document_visibility(uuid, text, text) from public, anon;
grant execute on function public.set_document_visibility(uuid, text, text) to authenticated, service_role;
create or replace function public.set_document_record(p_document uuid, p_record text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
  v_key text := nullif(trim(p_record), '');
  v_rows jsonb;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
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
create or replace function public.set_document_original(p_document uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  c public.cases;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or not public.case_visible(d.case_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('qc.pre') or public.has_permission('cases.update')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = d.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  if p_kind not in ('unknown', 'original', 'certified_copy', 'copy') then raise exception 'unknown document kind' using errcode = '22023'; end if;
  update public.documents set original_kind = p_kind where id = p_document;
end $$;

-- ---------------------------------------------------------------------------
-- Requests stop while a case is held or closed
-- ---------------------------------------------------------------------------
create or replace function public.create_client_request(p_case uuid, p_check uuid, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_q text := trim(coalesce(p_question, ''));
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform public.require_case_open(c);
  if v_q = '' then raise exception 'write the question' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  if p_check is not null and public.portal_check_row_hidden(p_check) then
    raise exception 'this check is hidden from the client, so they couldn''t see the question; ask about the case instead' using errcode = '22023';
  end if;
  return public.post_client_question(c, p_check, v_q);
end $$;
create or replace function public.create_candidate_request(p_case uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_kind text := p ->> 'kind';
  v_check uuid := nullif(p ->> 'check_id', '')::uuid;
  v_req uuid;
  v_title text := nullif(trim(p ->> 'title'), '');
  v_field jsonb;
  v_options jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform public.require_case_open(c);
  if v_kind not in ('document', 'field', 'question') then raise exception 'choose what to ask for' using errcode = '22023'; end if;
  if v_check is not null and not exists (select 1 from public.case_checks where id = v_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;

  if v_kind = 'document' then
    perform public.require_uploads_open(c);
    if not public.candidate_providable(coalesce(p ->> 'category', ''), 'documents') then
      raise exception 'the candidate cannot provide that kind of document' using errcode = '22023';
    end if;
    v_title := coalesce(v_title, (select name from public.document_categories where org_id = c.org_id and key = p ->> 'category' and is_active));
    if v_title is null then raise exception 'unknown document category' using errcode = '22023'; end if;
    -- The same document slot request_case_document() would open, without needing cases.update.
    select id into v_req from public.case_check_requirements
     where case_id = p_case and category = p ->> 'category' and case_check_id is not distinct from v_check;
    if v_req is not null then
      update public.case_check_requirements
         -- On a client-supplied case the portal shows this slot, so a note to the candidate stays on their request.
         set status = 'pending', min_count = greatest(min_count, received_count + 1),
             stage = case when c.stage in ('intake', 'documents') then stage else 'verification' end,
             requested_note = case when c.process_type = 'candidate_collected' then nullif(trim(p ->> 'note'), '') else requested_note end,
             requested_at = now(), requested_by = auth.uid(), waived_reason = null, waived_by = null, waived_at = null
       where id = v_req;
    else
      insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, stage, min_count, status, client_visible,
                                                  requested_note, requested_at, requested_by)
      values (c.org_id, p_case, v_check, p ->> 'category', left(v_title, 200),
              case when c.stage in ('intake', 'documents') then 'documents' else 'verification' end, 1, 'pending', false,
              nullif(trim(p ->> 'note'), ''), now(), auth.uid())
      returning id into v_req;
    end if;
    perform public.log_case_event(p_case, v_check, 'document_requested', 'Document requested: ' || left(v_title, 200),
      nullif(trim(p ->> 'note'), ''), jsonb_build_object('category', p ->> 'category', 'from', 'candidate'), false, true);
    perform public.recompute_case(p_case);
  elsif v_kind = 'field' then
    if v_check is null then raise exception 'choose the check this detail belongs to' using errcode = '22023'; end if;
    select f.value into v_field
      from public.case_checks k
      join public.check_type_versions v on v.id = k.check_type_version_id,
           jsonb_array_elements(coalesce(v.schema -> 'fields', '[]'::jsonb)) as f(value)
     where k.id = v_check and f.value ->> 'key' = p ->> 'field_key';
    if v_field is null then raise exception 'that detail is not part of this check' using errcode = '22023'; end if;
    v_title := coalesce(v_title, v_field ->> 'label');
    if v_field ->> 'type' = 'repeatable_group' then
      -- Rows the candidate fills in: only the columns the check type lets them fill.
      v_options := jsonb_build_object(
        'min', coalesce((v_field #>> '{group,min}')::int, 1), 'max', coalesce((v_field #>> '{group,max}')::int, 10),
        'item_label', coalesce(v_field #>> '{group,item_label}', 'Item'),
        'fields', coalesce((
          select jsonb_agg(jsonb_build_object('key', s ->> 'key', 'label', s ->> 'label', 'type', s ->> 'type',
                                              'required', coalesce((s ->> 'required')::boolean, false) and coalesce(s ->> 'stage', 'data_entry') <> 'verification',
                                              'options', coalesce(s -> 'options', '[]'::jsonb), 'help', s ->> 'help') order by n)
            from jsonb_array_elements(coalesce(v_field -> 'fields', '[]'::jsonb)) with ordinality as x(s, n)
           where coalesce(s -> 'fill_by', '[]'::jsonb) ? 'candidate'), '[]'::jsonb));
      if jsonb_array_length(v_options -> 'fields') = 0 then raise exception 'the candidate can''t fill this in' using errcode = '22023'; end if;
    else
      v_options := coalesce(v_field -> 'options', '[]'::jsonb);
    end if;
  end if;
  if v_title is null then raise exception 'write the question' using errcode = '22023'; end if;

  insert into public.candidate_requests (org_id, case_id, case_check_id, requirement_id, kind, title, help, field_key, field_type, options, due_at, created_by)
  values (c.org_id, p_case, v_check, v_req, v_kind, left(v_title, 200),
          nullif(trim(coalesce(p ->> 'help', p ->> 'note', v_field ->> 'help')), ''),
          case when v_kind = 'field' then p ->> 'field_key' end,
          case when v_kind = 'field' then v_field ->> 'type' end,
          v_options,
          nullif(p ->> 'due_at', '')::timestamptz, auth.uid())
  returning id into v_id;
  if v_kind <> 'document' then   -- the document branch logged its own event
    perform public.log_case_event(p_case, v_check, 'request_created', 'New request: ' || left(v_title, 200),
      nullif(trim(p ->> 'help'), ''), jsonb_build_object('request_id', v_id, 'kind', v_kind), false, true);
  end if;
  return v_id;
end $$;
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
  perform public.require_case_open(c);

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
                                                 'options', coalesce(x -> 'options', '[]'::jsonb), 'help', x ->> 'help') order by n), '[]'::jsonb)
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
  perform public.recompute_case(p_case);
  return v_n;
end $$;
create or replace function public.issue_candidate_link(
  p_case uuid, p_token_hash text, p_token_enc text, p_language text default 'en', p_days int default 14
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform public.require_case_open(c);
  if c.candidate_match_open then
    raise exception 'the NIC matches a candidate with a different name; check that first' using errcode = '22023';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad link secret' using errcode = '22023'; end if;
  update public.candidate_links set revoked_at = now(), revoked_reason = 'Replaced by a new link', revoked_by = auth.uid()
   where case_id = p_case and revoked_at is null;
  insert into public.candidate_links (org_id, case_id, token_hash, token_enc, language, expires_at, created_by)
  values (c.org_id, c.id, p_token_hash, p_token_enc, coalesce(nullif(p_language, ''), 'en'),
          now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60)), auth.uid())
  returning id into v_id;
  insert into public.consent_forms (org_id, case_id) values (c.org_id, c.id) on conflict (case_id) do nothing;
  perform public.log_case_event(p_case, null, 'candidate_link', 'Candidate link created', null,
    jsonb_build_object('link_id', v_id, 'days', p_days), false, false);
  return v_id;
end $$;
create or replace function public.candidate_answer_request(p_link uuid, p_request uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  q public.candidate_requests;
  v_keys text[];
  v_rows jsonb;
begin
  -- Nobody would read it: the report is out.
  if (select stage from public.cases where id = v_case) in ('released', 'cancelled') then
    raise exception 'this verification is closed' using errcode = '22023';
  end if;
  select * into q from public.candidate_requests where id = p_request and case_id = v_case for update;
  if q.id is null or q.status = 'cancelled' then raise exception 'request not found' using errcode = 'P0002'; end if;
  if q.kind = 'document' then raise exception 'upload a file for this request' using errcode = '22023'; end if;
  if q.status = 'accepted' then raise exception 'this answer has already been accepted' using errcode = '22023'; end if;
  if q.field_type in ('repeatable_group', 'check_form') then
    if coalesce(jsonb_typeof(p_answer -> 'rows'), '') <> 'array' or jsonb_array_length(p_answer -> 'rows') = 0 then
      raise exception 'write an answer first' using errcode = '22023';
    end if;
    -- Only what the form asked for. Anything else a tampered page sends is dropped here.
    v_keys := array(select f ->> 'key' from jsonb_array_elements(coalesce(q.options -> 'fields', '[]'::jsonb)) f);
    select coalesce(jsonb_agg((select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(x.r) e where e.key = any (v_keys)) order by x.n), '[]'::jsonb)
      into v_rows from jsonb_array_elements(p_answer -> 'rows') with ordinality as x(r, n);
    p_answer := jsonb_build_object('rows', v_rows);
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
create or replace function public.portal_answer_request(p_request uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.cases.create');
  q public.client_requests;
  c public.cases;
  v_a text := trim(coalesce(p_answer, ''));
begin
  select * into q from public.client_requests where id = p_request for update;
  select * into c from public.cases where id = q.case_id and client_id = v_client and client_visible;
  if q.id is null or c.id is null or q.status = 'closed' then raise exception 'question not found' using errcode = 'P0002'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if v_a = '' then raise exception 'write an answer first' using errcode = '22023'; end if;
  update public.client_requests set status = 'answered', answer = left(v_a, 4000), answered_by = auth.uid(), answered_at = now() where id = p_request;
  perform public.log_case_event(c.id, q.case_check_id, 'information_received', 'The client answered a question', left(v_a, 500),
    jsonb_build_object('request_id', q.id), true, false);
  perform public.notify_case_owner(c.id, 'client.answer', 'The client answered your question', c.reference);
  -- The answer is in, so the next move is Ontriq's, and the case stops reading as waiting on the client.
  update public.case_checks k set state = 'in_progress'
   where k.id = q.case_check_id and k.state = 'pending_info'
     and not exists (select 1 from public.client_requests o where o.case_check_id = k.id and o.status = 'open');
  perform public.recompute_case(c.id);
end $$;
create or replace function public.candidate_link_view(p_link uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  l public.candidate_links;
  c public.cases;
  v_out jsonb;
begin
  select * into l from public.candidate_links where id = p_link;
  select * into c from public.cases where id = v_case;
  select jsonb_build_object(
    'link', jsonb_build_object('id', l.id, 'expires_at', l.expires_at, 'language', l.language, 'sent_at', l.sent_at),
    'org', (select jsonb_build_object(
              'name', coalesce(o.branding ->> 'display_name', o.name), 'legal_name', coalesce(o.branding ->> 'legal_name', o.name),
              'email', o.branding ->> 'email', 'phone', o.branding ->> 'phone', 'website', o.branding ->> 'website',
              'address', o.branding ->> 'address')
              from public.orgs o where o.id = c.org_id),
    'case', jsonb_build_object(
              'reference', c.reference, 'position_title', c.position_title, 'stage', c.stage, 'status_key', c.status_key,
              'status_label', (select s.candidate_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = c.status_key),
              'process_type', c.process_type, 'on_hold', c.on_hold, 'received_at', c.received_at,
              'client_name', (select cl.name from public.clients cl where cl.id = c.client_id)),
    'candidate', (select jsonb_build_object('full_name', cd.full_name, 'preferred_language', cd.preferred_language)
                    from public.candidates cd where cd.id = c.candidate_id),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('label', k.label, 'key', ct.key) order by k.sort)
                          from public.case_checks k join public.check_types ct on ct.id = k.check_type_id
                         where k.case_id = c.id and k.state <> 'waived'), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'category', r.category, 'label', r.label, 'description', r.description,
               'category_name', dc.name, 'guide', dc.guide, 'check_label', k.label,
               'min_count', r.min_count, 'received_count', r.received_count, 'status', r.status,
               -- On a client-supplied case the note was written to the client.
               'requested_note', case when c.process_type = 'candidate_collected' then r.requested_note end, 'requested_at', r.requested_at,
               'files', coalesce((
                  select jsonb_agg(jsonb_build_object('id', d.id, 'filename', d.filename, 'status', d.status,
                                                      'rejection_reason', d.rejection_reason, 'created_at', d.created_at) order by d.created_at)
                    from public.documents d
                   where d.case_id = c.id and d.uploaded_by_kind = 'candidate' and d.category = r.category
                     and d.case_check_id is not distinct from r.case_check_id and d.status <> 'pending_upload'), '[]'::jsonb))
             order by coalesce(k.sort, 0), dc.sort, r.created_at)
        from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
        left join public.document_categories dc on dc.org_id = r.org_id and dc.key = r.category
       where r.case_id = c.id and r.status <> 'waived' and public.candidate_providable(r.category, r.stage)), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'kind', q.kind, 'title', q.title, 'help', q.help, 'field_type', q.field_type, 'options', q.options,
               'form', q.form, 'field_key', q.field_key,
               'check_key', (select t.key from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.id = q.case_check_id),
               'requirement_id', q.requirement_id, 'due_at', q.due_at, 'status', q.status, 'answer', q.answer,
               'answered_at', q.answered_at, 'review_note', q.review_note, 'created_at', q.created_at) order by q.created_at)
        from public.candidate_requests q where q.case_id = c.id and q.status <> 'cancelled'), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.from_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
        from (select * from public.candidate_messages where case_id = c.id order by created_at desc limit 100) m), '[]'::jsonb),
    'submission', jsonb_build_object('confirmed_at', c.candidate_confirmed_at,
                                     'changed_since', c.candidate_confirmed_at is not null and public.candidate_gave_more_since(c.id, c.candidate_confirmed_at)),
    'consent', (select jsonb_build_object('status', f.status, 'method', f.method, 'signed_name', f.signed_name,
                                          'signed_at', f.signed_at, 'review_note', f.review_note)
                  from public.consent_forms f where f.case_id = c.id),
    -- Titles are rewritten so internal wording never reaches the candidate; bodies only where they help them act.
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'at', e.at,
               'title', case
                 when e.kind = 'stage_changed' then case e.data ->> 'to'
                   when 'pre_qc' then 'Your documents are being reviewed'
                   when 'verification' then 'Verification has started'
                   when 'report' then 'Verification is complete'
                   else 'Your case moved forward' end
                 when e.kind = 'created' then 'Your verification was opened'
                 when e.kind = 'returned' then 'We need something corrected'
                 else e.title end,
               'body', case when e.kind in ('document_requested', 'document_rejected', 'request_created') then e.body end,
               'data', jsonb_build_object('to', e.data ->> 'to', 'category', e.data ->> 'category'))
             order by e.at desc)
        from (select * from public.case_events x
               where x.case_id = c.id and x.visible_to_candidate
                 -- Older rows: what staff uploaded, rejected or sent back inside Ontriq isn't theirs to see.
                 and not (x.kind = 'document_uploaded' and coalesce(x.data ->> 'by', '') <> 'candidate')
                 and not (x.kind = 'document_rejected' and not exists (
                       select 1 from public.documents d where d.id = (x.data ->> 'document_id')::uuid and d.uploaded_by_kind = 'candidate'))
                 and not (x.kind = 'returned' and coalesce(x.data ->> 'to', '') <> 'documents')
               order by x.at desc limit 60) e), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- Using an answer and marking it used happen together.
create or replace function public.accept_candidate_answer(p_request uuid, p_values jsonb, p_valid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.candidate_requests;
begin
  select * into q from public.candidate_requests where id = p_request for update;
  if q.id is null or not public.can_manage_candidate(q.case_id) then raise exception 'request not found' using errcode = 'P0002'; end if;
  if q.status <> 'answered' then raise exception 'there is no answer to accept yet' using errcode = '22023'; end if;
  if q.case_check_id is null then raise exception 'this answer isn''t for a check' using errcode = '22023'; end if;
  perform public.save_check_values(q.case_check_id, p_values, p_valid);
  perform public.review_candidate_request(p_request, 'accept');
end $$;
revoke execute on function public.accept_candidate_answer(uuid, jsonb, boolean) from public, anon;
grant execute on function public.accept_candidate_answer(uuid, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the database accepts in a check (spec 4, 10)
-- ---------------------------------------------------------------------------
create or replace function public.iso_date_ok(p_text text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform p_text::date;
  return true;
exception when others then
  return false;
end $$;
revoke execute on function public.iso_date_ok(text) from public, anon, authenticated;

create or replace function public.field_value_ok(p_field jsonb, p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_type text := p_field ->> 'type';
  v_text text;
  v_num numeric;
begin
  if public.field_blank(p_value) then return true; end if;
  v_text := p_value #>> '{}';
  case v_type
    when 'select' then
      return exists (select 1 from jsonb_array_elements(coalesce(p_field -> 'options', '[]'::jsonb)) o where o ->> 'value' = v_text);
    when 'multi_select' then
      if jsonb_typeof(p_value) <> 'array' then return false; end if;
      return not exists (select 1 from jsonb_array_elements_text(p_value) x
                          where not exists (select 1 from jsonb_array_elements(coalesce(p_field -> 'options', '[]'::jsonb)) o where o ->> 'value' = x));
    when 'boolean' then
      return jsonb_typeof(p_value) = 'boolean';
    when 'number' then
      if jsonb_typeof(p_value) <> 'number' then return false; end if;
      v_num := v_text::numeric;
      if coalesce((p_field #>> '{validation,integer}')::boolean, false) and v_num <> trunc(v_num) then return false; end if;
      if p_field #>> '{validation,min}' is not null and v_num < (p_field #>> '{validation,min}')::numeric then return false; end if;
      if p_field #>> '{validation,max}' is not null and v_num > (p_field #>> '{validation,max}')::numeric then return false; end if;
      return true;
    when 'date' then
      return public.iso_date_ok(v_text);
    when 'date_range' then
      if jsonb_typeof(p_value) <> 'object' then return false; end if;
      if not public.field_blank(p_value -> 'from') and not public.iso_date_ok(p_value ->> 'from') then return false; end if;
      if not public.field_blank(p_value -> 'to') and not public.iso_date_ok(p_value ->> 'to') then return false; end if;
      return public.field_blank(p_value -> 'from') or public.field_blank(p_value -> 'to') or p_value ->> 'from' <= p_value ->> 'to';
    when 'email' then
      return v_text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    when 'phone' then
      -- The app checks the number properly, extension included. This only stops what isn't a number.
      return length(regexp_replace(v_text, '[^0-9]', '', 'g')) between 7 and 20;
    when 'nic' then
      return upper(regexp_replace(v_text, '\s', '', 'g')) ~ '^([0-9]{9}[VX]|[0-9]{12})$';
    else
      return true;
  end case;
end $$;
revoke execute on function public.field_value_ok(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.check_values_wellformed(p_schema jsonb, p_values jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  s jsonb;
  v jsonb;
  item jsonb;
begin
  for f in select * from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    v := p_values -> (f ->> 'key');
    if f ->> 'type' = 'repeatable_group' then
      continue when jsonb_typeof(v) is distinct from 'array';
      for item in select * from jsonb_array_elements(v) loop
        for s in select * from jsonb_array_elements(coalesce(f -> 'fields', '[]'::jsonb)) loop
          if not public.field_value_ok(s, item -> (s ->> 'key')) then return false; end if;
        end loop;
      end loop;
    elsif not public.field_value_ok(f, v) then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.check_values_wellformed(jsonb, jsonb) from public, anon, authenticated;
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
  -- During verification a check belongs to its officer. Data entry comes before that, from anyone on the case.
  if auth.uid() is not null and c.stage = 'verification' and k.assigned_to is not null and k.assigned_to <> auth.uid() and coalesce(c.assigned_to <> auth.uid(), true)
     and not (public.has_permission('cases.stage.change') or public.has_permission('cases.assign')) then
    raise exception 'only the officer on this check or a manager can change it' using errcode = '42501';
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
         -- The app checks first. The database won't take its word for it.
         values_valid = coalesce(p_valid, false) and public.check_values_complete(v_schema, coalesce(p_values, '{}'::jsonb))
                        and public.check_values_wellformed(v_schema, coalesce(p_values, '{}'::jsonb)),
         updated_by = auth.uid(),
         state = case when state = 'not_started' then 'in_progress'::public.check_state else state end,
         started_at = coalesce(started_at, now())
   where id = p_check;
end $$;

-- ---------------------------------------------------------------------------
-- A file for each employer, tested again before the case moves on (spec 4.2)
-- ---------------------------------------------------------------------------
create or replace function public.check_record_gaps(p_check uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.case_checks;
  v_schema jsonb;
  v_doc jsonb;
  v_group text;
  v_rows jsonb;
  v_out text[] := '{}';
begin
  select * into k from public.case_checks where id = p_check;
  select schema into v_schema from public.check_type_versions where id = k.check_type_version_id;
  for v_doc in select d from jsonb_array_elements(coalesce(v_schema -> 'documents', '[]'::jsonb)) d where d ? 'per_record' loop
    v_group := v_doc ->> 'per_record';
    v_rows := case when jsonb_typeof(k.values -> v_group) = 'array' then k.values -> v_group else '[]'::jsonb end;
    continue when jsonb_array_length(v_rows) < 2;
    continue when exists (select 1 from public.case_check_requirements r
                           where r.case_check_id = k.id and r.category = v_doc ->> 'category' and r.status = 'waived');
    if exists (select 1 from generate_series(0, jsonb_array_length(v_rows) - 1) i
                where not exists (
                  select 1 from public.documents d
                   where d.case_id = k.case_id and d.status in ('uploaded', 'accepted')
                     and (((d.case_check_id = k.id or d.case_check_id is null) and d.category = v_doc ->> 'category' and d.record_key = v_group || '.' || i)
                          -- A combined file counts for the rows a person said it covers.
                          or exists (select 1 from public.requirement_files f
                                       join public.case_check_requirements r on r.id = f.requirement_id
                                      where f.document_id = d.id and r.case_check_id = k.id and r.category = v_doc ->> 'category'
                                        and (v_group || '.' || i) = any (f.record_keys))))) then
      v_out := v_out || (v_doc ->> 'label');
    end if;
  end loop;
  return v_out;
end $$;
revoke execute on function public.check_record_gaps(uuid) from public, anon, authenticated;
grant execute on function public.check_record_gaps(uuid) to service_role;

-- What Post-QC needs in place: asked when verification ends, and again when QC signs it off.
create or replace function public.case_evidence_gaps(p_case uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_missing text[];
  v_gaps text[];
  k record;
begin
  -- Documents for a check that is still open or was waived don't hold the case back.
  select count(*) into v_n from public.case_check_requirements r
    left join public.case_checks x on x.id = r.case_check_id
   where r.case_id = p_case and r.status = 'pending' and r.min_count > r.received_count
     and (x.id is null or x.state in ('completed', 'discrepancy', 'unable_to_verify'));
  if v_n > 0 then v_out := v_out || (v_n || ' required document(s) still missing'); end if;
  -- A waived slot doesn't excuse the fixed annexure on a check that reached a result.
  v_missing := public.case_missing_annexures(p_case);
  if cardinality(v_missing) > 0 then v_out := v_out || (array_to_string(v_missing, ', ') || ' has no report attached; upload it first'); end if;
  for k in select id, label from public.case_checks where case_id = p_case and state = 'completed' order by sort loop
    v_gaps := public.check_record_gaps(k.id);
    if cardinality(v_gaps) > 0 then
      v_out := v_out || (k.label || ': tie a document to each row first, or have a manager waive it (' || array_to_string(v_gaps, ', ') || ')');
    end if;
  end loop;
  return v_out;
end $$;
revoke execute on function public.case_evidence_gaps(uuid) from public, anon, authenticated;
grant execute on function public.case_evidence_gaps(uuid) to service_role;

-- A sensitive file withheld on purpose counts as dealt with: that was a decision.
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
     and not exists (select 1 from public.documents d
                      where d.case_id = k.case_id and d.status in ('uploaded', 'accepted')
                        and (d.visibility in ('report', 'client') or (d.sensitive and d.withheld_reason is not null))
                        and (((d.case_check_id = k.id or d.case_check_id is null) and d.category = r.category)
                             or exists (select 1 from public.requirement_files f where f.requirement_id = r.id and f.document_id = d.id)))
$$;

-- ---------------------------------------------------------------------------
-- Checks (spec 3, 8, 9)
-- ---------------------------------------------------------------------------
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
  v_gaps text[];
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  v_manager := auth.uid() is null or public.has_permission('cases.stage.change') or public.has_permission('cases.assign');
  if p_state = 'waived' then
    -- Post-QC may strike out a check that isn't needed, without being its officer.
    if not v_manager and not public.has_permission('qc.post') then raise exception 'only a manager can waive a check' using errcode = '42501'; end if;
  elsif auth.uid() is not null and not (public.has_permission('checks.verify') and (coalesce(k.assigned_to = auth.uid(), false) or coalesce(c.assigned_to = auth.uid(), false) or v_manager)) then
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
    -- A custom check type may have no option for these two. They still have to be recordable.
    if v_tone is null and v_result = 'discrepancy' then v_tone := 'red'; v_label := 'Discrepancy'; end if;
    if v_tone is null and v_result = 'unable_to_verify' then v_tone := 'amber'; v_label := 'Unable to verify'; end if;
    if v_tone is null then raise exception 'that result is not an option for this check' using errcode = '22023'; end if;
    -- The state and the result have to say the same thing.
    if p_state = 'completed' and v_tone = 'red' then raise exception 'record a red result as a discrepancy' using errcode = '22023'; end if;
    if p_state = 'discrepancy' and v_tone <> 'red' then raise exception 'a discrepancy needs a red result' using errcode = '22023'; end if;
    if p_state = 'unable_to_verify' and v_tone = 'green' then raise exception 'a check that couldn''t be verified can''t come out clear' using errcode = '22023'; end if;
    -- Spec 8: an unfinished result must never print as verified.
    if p_state = 'completed' and v_result in ('pending', 'unable_to_verify') then
      raise exception 'that result means the check isn''t finished; leave it open or record it as unable to verify' using errcode = '22023';
    end if;
    -- A hit on the screening list can't come out as clear.
    if lower(trim(coalesce(k.values ->> 'sanctions_found', ''))) in ('yes', 'true') and v_tone = 'green' then
      raise exception 'sanctions were found, so this can''t be clear' using errcode = '22023';
    end if;
    -- A source that never answered has nothing to record, and the finding says so.
    if p_state = 'unable_to_verify' then
      if not k.values_valid and not public.check_entry_complete(v_schema, k.values) then raise exception 'complete the check''s details first' using errcode = '22023'; end if;
    elsif not k.values_valid then
      raise exception 'complete the check''s details first, including what the source confirmed' using errcode = '22023';
    end if;
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
    -- unless a person said a combined file covers them or a manager waived the slot.
    if p_state = 'completed' then
      v_gaps := public.check_record_gaps(k.id);
      if cardinality(v_gaps) > 0 then
        raise exception 'tie a document to each row first, or have a manager waive it: %', array_to_string(v_gaps, ', ') using errcode = '22023';
      end if;
    end if;
  elsif p_state = 'waived' then
    if coalesce(trim(p_note), '') = '' then raise exception 'say why the check is waived' using errcode = '22023'; end if;
    -- Spec 9: the result reflects the findings. A finding is corrected in the open, not struck out.
    if k.state = 'discrepancy' or k.discrepancy_at is not null or lower(trim(coalesce(k.values ->> 'sanctions_found', ''))) in ('yes', 'true') then
      raise exception 'a discrepancy was recorded on this check, so it can''t be waived; if the finding was wrong, record the corrected outcome' using errcode = '22023';
    end if;
    v_result := null;
  else
    v_result := null;
  end if;

  update public.case_checks
     set state = p_state,
         result = v_result,
         result_tone = v_tone,
         -- A waived check prints "Not required" with the reason. No note leaves the finding as it was. An empty one clears it.
         client_note = case when p_state = 'waived' then nullif(trim(coalesce(p_client_note, p_note)), '')
                            when p_client_note is null then client_note else nullif(trim(p_client_note), '') end,
         -- Reopening doesn't take a discrepancy off the record. A new outcome does.
         discrepancy_at = case when p_state = 'discrepancy' then now() when p_state in ('completed', 'unable_to_verify') then null else discrepancy_at end,
         completed_at = case when p_state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then now() else null end,
         started_at = coalesce(started_at, now()),
         updated_by = auth.uid()
   where id = p_check;
  -- A waived check asks nobody for anything. Bringing it back asks again.
  if p_state = 'waived' then
    update public.case_check_requirements set status = 'waived', waived_reason = 'The check was waived', waived_by = auth.uid(), waived_at = now()
     where case_check_id = p_check and status = 'pending';
    update public.candidate_requests set status = 'cancelled', review_note = 'The check was waived', reviewed_by = auth.uid(), reviewed_at = now()
     where case_check_id = p_check and status = 'open';
    -- A question to the client stays closed. Whoever brings the check back asks again if they still need the answer.
    update public.client_requests set status = 'closed' where case_check_id = p_check and status = 'open';
  elsif k.state = 'waived' then
    perform public.restore_waived_check(p_check);
  end if;
  perform public.log_case_event(k.case_id, k.id, 'check_state',
    k.label || ': ' || public.check_state_label(p_state) || coalesce(' (' || v_label || ')', ''),
    nullif(trim(p_note), ''), jsonb_build_object('from', k.state, 'to', p_state, 'result', v_result),
    -- Every finished check reaches the client's feed in the same words, so its absence says nothing.
    p_state in ('completed', 'discrepancy', 'unable_to_verify', 'waived'), false);
  perform public.recompute_case(k.case_id);
end $$;
create or replace function public.set_check_remarks(p_check uuid, p_remarks text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or not public.case_visible(k.case_id) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  -- Managers and Post-QC may word any check; an officer only the checks (or the case) they own.
  -- After verification the wording is QC's: an officer's change wouldn't be reviewed.
  if c.stage in ('post_qc', 'report') and not (public.has_permission('qc.post') or public.has_permission('cases.stage.change')) then
    raise exception 'findings are locked after verification; a QC reviewer or manager can reword them' using errcode = '42501';
  end if;
  if not (public.has_permission('qc.post') or public.has_permission('cases.stage.change')
          or (public.has_permission('checks.verify') and (coalesce(k.assigned_to = auth.uid(), false) or coalesce(c.assigned_to = auth.uid(), false)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if c.stage in ('approval', 'released', 'cancelled') then raise exception 'remarks are locked once the report is with the approver' using errcode = '22023'; end if;
  -- A discrepancy without its finding would print as nothing at all.
  if k.state in ('discrepancy', 'unable_to_verify') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'this check needs its finding for the report' using errcode = '22023';
  end if;
  update public.case_checks set client_note = nullif(trim(p_remarks), ''), updated_by = auth.uid() where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'remarks_updated', k.label || ': remarks updated', null, '{}'::jsonb, false, false);
end $$;

create or replace function public.add_case_note(p_case uuid, p_check uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('cases.update') or public.has_permission('checks.verify') or public.has_permission('qc.pre') or public.has_permission('qc.post')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'write a note first' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  perform public.log_case_event(p_case, p_check, 'note', 'Note', left(trim(p_body), 4000), '{}'::jsonb, false, false);
end $$;
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
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
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
create or replace function public.add_case_check(p_case uuid, p_check_type uuid, p_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  t public.check_types;
  v_schema jsonb;
  v_label text;
  v_sort int;
  v_id uuid;
  v_doc jsonb;
  v_days int;
  v_price numeric;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.stage.change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'checks can be added until verification ends' using errcode = '22023';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  select * into t from public.check_types where id = p_check_type and org_id = c.org_id and archived_at is null;
  if t.id is null or t.current_version_id is null then raise exception 'that check has no published version' using errcode = '22023'; end if;
  if exists (select 1 from public.client_check_type_access a where a.client_id = c.client_id and a.check_type_id = t.id and not a.enabled) then
    raise exception 'this check is turned off for this client' using errcode = '42501';
  end if;
  select schema into v_schema from public.check_type_versions where id = t.current_version_id;
  v_label := coalesce(nullif(trim(p_label), ''), t.name);
  if exists (select 1 from public.case_checks where case_id = p_case and lower(label) = lower(v_label)) then
    raise exception 'this case already has a check called %', v_label using errcode = '22023';
  end if;
  select coalesce(max(sort), 0) + 10 into v_sort from public.case_checks where case_id = p_case;
  v_days := coalesce((v_schema ->> 'sla_days')::int, 5);
  insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort, due_at, state, started_at, values_valid)
  values (c.org_id, p_case, t.id, t.current_version_id, left(v_label, 120), v_sort, public.add_working_days(now(), v_days),
          case when c.stage = 'verification' then 'in_progress'::public.check_state else 'not_started'::public.check_state end,
          case when c.stage = 'verification' then now() end, public.check_values_complete(v_schema, '{}'::jsonb))
  returning id into v_id;
  for v_doc in select * from jsonb_array_elements(coalesce(v_schema -> 'documents', '[]'::jsonb)) loop
    insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, description, min_count, stage, client_visible, status)
    values (c.org_id, p_case, v_id, v_doc ->> 'category', v_doc ->> 'label', v_doc ->> 'description',
            coalesce((v_doc ->> 'min')::int, 1), coalesce(v_doc ->> 'stage', 'documents'),
            coalesce((v_doc ->> 'client_visible')::boolean, false),
            case when coalesce((v_doc ->> 'min')::int, 1) = 0 then 'optional' else 'pending' end);
  end loop;
  -- Billing prices checks from the case's snapshot; a new kind of check joins it at list price.
  if not exists (select 1 from jsonb_array_elements(coalesce(c.package_snapshot -> 'items', '[]'::jsonb)) it where it ->> 'check_type_id' = t.id::text) then
    select coalesce(max(pi.unit_price), 0) into v_price
      from public.package_items pi join public.packages pk on pk.id = pi.package_id
     where pi.check_type_id = t.id and pk.owner_scope = 'org' and pk.is_active;
    update public.cases
       set package_snapshot = jsonb_set(package_snapshot, '{items}', coalesce(package_snapshot -> 'items', '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('check_type_id', t.id, 'key', t.key, 'name', t.name, 'version_id', t.current_version_id, 'unit_price', v_price, 'added', true)))
     where id = p_case;
  end if;
  perform public.log_case_event(p_case, v_id, 'check_added', left(v_label, 120) || ' added', null, jsonb_build_object('check_type', t.key), true, false);
  perform public.recompute_case(p_case);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Moving a case (spec 2, 3, 5)
-- ---------------------------------------------------------------------------
-- The flowchart's "Contact the Candidate": a call, and a formal request.
create or replace function public.candidate_contact_gap(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.candidate_links l where l.case_id = p_case and l.sent_at is not null and 'email' = any (l.sent_via))
     and not exists (select 1 from public.communications m where m.case_id = p_case and m.case_check_id is null and m.direction = 'outbound' and m.channel in ('email', 'letter'))
      then 'send the candidate their page by email, or log a formal email or letter first'
    when not exists (select 1 from public.communications m where m.case_id = p_case and m.case_check_id is null and m.channel = 'phone')
      then 'log your call to the candidate first'
  end
$$;
revoke execute on function public.candidate_contact_gap(uuid) from public, anon, authenticated;
grant execute on function public.candidate_contact_gap(uuid) to service_role;
create or replace function public.move_case(p_case uuid, p_to public.case_stage, p_event text, p_reason text default null, p_returned boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_label text;
  v_client text;
begin
  select * into c from public.cases where id = p_case for update;
  -- Held work stays put, whichever function asked. Cancelling clears the hold first.
  if c.on_hold then raise exception 'this case is on hold; resume it first' using errcode = '22023'; end if;
  update public.cases
     set stage = p_to,
         manual_status_key = null,
         returned_at = case when p_returned then now() else null end,
         return_note = case when p_returned then p_reason else null end,
         -- Verification finished when Post-QC last signed it off, not the first time.
         completed_at = case when p_event = 'post_qc_approve' then now() else completed_at end
   where id = p_case;
  -- A closed case asks nobody for anything.
  if p_to in ('released', 'cancelled') then
    update public.client_requests set status = 'closed' where case_id = p_case and status = 'open';
    update public.candidate_requests set status = 'cancelled' where case_id = p_case and status = 'open';
  end if;
  insert into public.stage_history (org_id, case_id, from_stage, to_stage, event, reason, actor_id)
  values (c.org_id, c.id, c.stage, p_to, p_event, p_reason, auth.uid());
  -- First, so the event and its notification carry the wording set in Settings.
  perform set_config('app.stage_moved', p_case::text, true);
  perform public.recompute_case(p_case);
  perform set_config('app.stage_moved', '', true);
  v_label := public.stage_label(p_to);
  select s.client_label into v_client from public.cases x join public.client_status_catalog s on s.org_id = x.org_id and s.key = x.status_key where x.id = p_case;
  perform public.log_case_event(p_case, null, case when p_returned then 'returned' else 'stage_changed' end,
    case when p_returned then 'Returned for correction' else 'Moved to ' || v_label end,
    p_reason, jsonb_build_object('from', c.stage, 'to', p_to, 'event', p_event,
                                 'label', case when p_event = 'revision_cancelled' then 'Revision stopped, the released report stands' else v_client end), true,
    -- The candidate hears when they have something to do, not about returns inside Ontriq.
    (p_to in ('pre_qc', 'verification', 'report') and not p_returned) or (p_returned and p_to = 'documents' and c.process_type = 'candidate_collected'));
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
      if c.candidate_match_open then
        raise exception 'the NIC matches a candidate with a different name; check that first' using errcode = '22023';
      end if;
      perform public.move_case(p_case, 'documents', p_event, p_reason);
      return 'documents';
    when 'submit_pre_qc' then
      if c.stage <> 'documents' then raise exception 'the case is not collecting documents' using errcode = '22023'; end if;
      if not v_mover then raise exception 'not allowed' using errcode = '42501'; end if;
      v_n := public.case_outstanding_requirements(p_case, 'documents');
      if v_n > 0 then raise exception '% required document(s) still missing; upload or waive them first', v_n using errcode = '22023'; end if;
      -- Spec 2.2: Type 2 starts by contacting the candidate.
      if c.process_type = 'candidate_collected' and public.candidate_contact_gap(p_case) is not null then
        raise exception '%', public.candidate_contact_gap(p_case) using errcode = '22023';
      end if;
      -- The flowchart collects the BGV form first. Withdrawing a part is how a case goes on without it.
      if exists (select 1 from public.candidate_requests q where q.case_id = p_case and q.form and q.status = 'open') then
        raise exception 'the candidate hasn''t finished their BGV form; wait for it, or withdraw what isn''t needed' using errcode = '22023';
      end if;
      perform public.move_case(p_case, 'pre_qc', p_event, p_reason);
      return 'pre_qc';
    when 'start_verification' then
      if c.stage <> 'data_entry' then raise exception 'the case is not in data entry' using errcode = '22023'; end if;
      if not (auth.uid() is null or public.has_permission('checks.data_entry') or public.has_permission('cases.stage.change')) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if public.case_consent_missing(p_case) then
        raise exception 'the candidate''s consent is missing or was rejected; get it signed before contacting anyone' using errcode = '22023';
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
      if public.case_consent_missing(p_case) then
        raise exception 'the candidate''s consent is missing or was rejected; get it signed before this goes further' using errcode = '22023';
      end if;
      v_missing := public.case_evidence_gaps(p_case);
      if cardinality(v_missing) > 0 then raise exception '%', v_missing[1] using errcode = '22023'; end if;
      perform public.move_case(p_case, 'post_qc', p_event, p_reason);
      return 'post_qc';
    when 'return_to_documents' then
      if c.stage not in ('data_entry', 'verification') then raise exception 'the case cannot go back to documents from here' using errcode = '22023'; end if;
      -- Spec 3: whoever finds the gap can return the case, not only a manager.
      if not (v_mover
              or (c.stage = 'data_entry' and public.has_permission('checks.data_entry'))
              or (c.stage = 'verification' and public.has_permission('checks.verify')
                  and exists (select 1 from public.case_checks k where k.case_id = p_case and k.assigned_to = auth.uid()))) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if coalesce(trim(p_reason), '') = '' then raise exception 'say why the case goes back' using errcode = '22023'; end if;
      -- What is needed goes with the case: whoever sends it back may not be able to open it afterwards.
      if c.process_type = 'candidate_collected' then
        insert into public.candidate_messages (org_id, case_id, from_kind, author_id, body)
        values (c.org_id, p_case, 'staff', auth.uid(), left(trim(p_reason), 4000));
      else
        perform public.post_client_question(c, null, trim(p_reason));
      end if;
      perform public.move_case(p_case, 'documents', p_event, p_reason, true);
      return 'documents';
    else
      raise exception 'unknown case event %', p_event using errcode = '22023';
  end case;
end $$;

create or replace function public.record_qc_review(
  p_case uuid, p_kind text, p_decision text, p_checklist jsonb default '[]'::jsonb, p_remarks text default null, p_return_checks uuid[] default '{}', p_return_to text default 'verification'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
  v_n int;
  v_items text[];
  v_gaps text[];
  v_copies text;
  v_row record;
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
  if p_decision = 'approved' then
    -- A review records what was checked, against the list in Settings. Skipping an item takes a reason.
    if jsonb_array_length(coalesce(p_checklist, '[]'::jsonb)) = 0 then raise exception 'record the checklist with the review' using errcode = '22023'; end if;
    select coalesce(array_agg(x), '{}') into v_items
      from public.orgs o, jsonb_array_elements_text(coalesce(o.settings #> array['workflow', 'qc_checklists', p_kind], '[]'::jsonb)) x
     where o.id = c.org_id;
    if exists (select 1 from unnest(v_items) i where not exists (select 1 from jsonb_array_elements(p_checklist) x where x ->> 'item' = i)) then
      raise exception 'the checklist changed in Settings; open the review again' using errcode = '22023';
    end if;
    if coalesce(trim(p_remarks), '') = ''
       and exists (select 1 from jsonb_array_elements(p_checklist) i where not coalesce((i ->> 'ok')::boolean, false)) then
      raise exception 'say in the remarks why you are approving with items unticked' using errcode = '22023';
    end if;
  end if;
  if p_kind = 'pre' and p_decision = 'approved' then
    -- A file rejected during Pre-QC leaves its slot short again.
    v_n := public.case_outstanding_requirements(p_case, 'documents');
    if v_n > 0 then
      raise exception '% required document(s) are missing or were rejected; return the case for correction', v_n using errcode = '22023';
    end if;
    if public.case_consent_missing(p_case) then
      raise exception 'the candidate''s consent is missing or was rejected; return the case for correction' using errcode = '22023';
    end if;
    -- The flowchart's copy or original step, for the kinds of document Ontriq marked.
    select string_agg(distinct dc.name, ', ') into v_copies
      from public.documents d join public.document_categories dc on dc.org_id = d.org_id and dc.key = d.category
     where d.case_id = p_case and d.status in ('uploaded', 'accepted') and dc.needs_original and d.original_kind not in ('original', 'certified_copy');
    if v_copies is not null and coalesce(trim(p_remarks), '') = '' then
      raise exception '% must be an original or certified copy; mark the file, or say in the remarks why a copy will do', v_copies using errcode = '22023';
    end if;
  end if;
  if p_kind = 'post' and p_decision = 'approved' then
    if public.case_consent_missing(p_case) then
      raise exception 'the candidate''s consent is missing or was rejected; return the case for correction' using errcode = '22023';
    end if;
    -- Spec 5.2: confirm the evidence, whatever happened since verification ended.
    v_gaps := public.case_evidence_gaps(p_case);
    if cardinality(v_gaps) > 0 then
      raise exception '%; return the case for correction', v_gaps[1] using errcode = '22023';
    end if;
    v_gaps := public.case_unreported_evidence(p_case);
    if cardinality(v_gaps) > 0 then
      raise exception 'no evidence in the report for %; set its file to In the report, or return the case for correction', array_to_string(v_gaps, ', ') using errcode = '22023';
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
    perform public.restore_waived_check(k.id) from public.case_checks k where k.case_id = p_case and k.id = any (p_return_checks) and k.state = 'waived';
    update public.case_checks set state = 'returned', result = null, result_tone = null, completed_at = null
     where case_id = p_case and id = any (p_return_checks);
    -- The officer on the check hears, not only the case owner.
    for v_row in select id, label, assigned_to from public.case_checks where case_id = p_case and id = any (p_return_checks) loop
      perform public.log_case_event(p_case, v_row.id, 'check_returned', v_row.label || ' came back from Post-QC', nullif(trim(p_remarks), ''), '{}'::jsonb, false, false);
      if v_row.assigned_to is not null and v_row.assigned_to is distinct from auth.uid() and v_row.assigned_to is distinct from c.assigned_to then
        perform public.notify_users(array[v_row.assigned_to], 'check.returned', v_row.label || ' on ' || c.reference || ' came back from Post-QC', coalesce(trim(p_remarks), ''),
          '/app/cases/' || c.id, true, 'case', c.id, c.org_id);
      end if;
    end loop;
  end if;
  -- The reviewer's sign-off covers the evidence that goes out with the report.
  if p_kind = 'post' and p_decision = 'approved' then
    update public.documents set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
     where case_id = p_case and status = 'uploaded' and visibility in ('report', 'client');
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
    -- Returns from QC are Ontriq's own. Staff see them; the client reads the stage as usual.
    when 'data_entry' then case when v_pending_info then 'pending_information'
                                when c.returned_at is not null then 'returned_to_data_entry'
                                else 'data_entry_in_progress' end
    when 'verification' then case when v_pending_info then 'pending_information'
                                  when c.returned_at is not null then 'returned_to_verification'
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
create or replace function public.cases_status_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
begin
  if not (new.status_key in ('document_review', 'partially_completed', 'report_completed') or new.status_key is not distinct from new.manual_status_key) then return null; end if;
  if not coalesce((select (s.portal ->> 'status_updates')::boolean from public.client_settings s where s.client_id = new.client_id), true) then return null; end if;
  -- A stage move tells them itself.
  if current_setting('app.stage_moved', true) = new.id::text then return null; end if;
  select client_label into v_label from public.client_status_catalog where org_id = new.org_id and key = new.status_key;
  perform public.notify_client_users(new.id, 'portal.case_status', new.reference || ': ' || lower(coalesce(v_label, new.status_key)), new.candidate_name);
  return null;
end $$;
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
    -- Spec 6.3: what Ontriq needs from them, as soon as work starts.
    if public.portal_pending_slots(c.id) > 0 then
      perform public.notify_client_users(c.id, 'portal.documents_needed', c.reference || ': documents needed', '');
    end if;
  elsif new.kind = 'stage_changed' and new.data ->> 'to' = 'released' and coalesce(new.data ->> 'event', '') <> 'revision_cancelled' then
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
  -- No "returned" here: on a client-supplied case a return reaches them as a question, which says what is
  -- needed. On a candidate-collected case the candidate has the message. Inside Ontriq it isn't theirs at all.
  elsif new.kind in ('stage_changed', 'hold', 'resumed')
        and coalesce((select (s.portal ->> 'status_updates')::boolean from public.client_settings s where s.client_id = c.client_id), true) then
    perform public.notify_client_users(c.id, 'portal.case_status',
      c.reference || ': ' || case new.kind when 'hold' then 'on hold' when 'resumed' then 'resumed'
                                           else lower(coalesce(new.data ->> 'label', public.portal_stage_label((new.data ->> 'to')::public.case_stage))) end,
      c.candidate_name);
  end if;
  return null;
end $$;

-- A revision that stops leaves the released report standing. The case didn't die.
create or replace function public.cancel_case(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_result text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.cancel') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is already closed' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the case is cancelled' using errcode = '22023'; end if;
  -- The move tells the client. Lifting a hold on the way there stays quiet.
  perform set_config('app.stage_moved', p_case::text, true);
  select v.final_result into v_result from public.report_versions v where v.case_id = p_case and v.status = 'released' order by v.version desc limit 1;
  if found then
    -- The portal reads the live checks of a released case, so what it shows must be what was approved.
    if not coalesce(public.revision_can_stop(p_case), false) then
      raise exception 'this revision has changed the case, so the released report no longer matches it; finish the revision and release a new version' using errcode = '22023';
    end if;
    update public.report_versions set status = 'superseded' where case_id = p_case and status in ('queued', 'rendering', 'ready', 'failed');
    update public.report_versions set revision_reason = null where case_id = p_case and status = 'released';
    update public.cases set on_hold = false, final_result = v_result where id = p_case;
    perform public.move_case(p_case, 'released', 'revision_cancelled', p_reason);
    return;
  end if;
  update public.cases set cancelled_at = now(), cancel_reason = p_reason, on_hold = false where id = p_case;
  perform public.move_case(p_case, 'cancelled', 'cancel', p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- The report (spec 7, 8, 9)
-- ---------------------------------------------------------------------------
-- Everything the report prints, read here rather than taken from the caller.
create or replace function public.case_report_stamp(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_object(
    'case', (select jsonb_build_object('client_reference', c.client_reference, 'position', c.position_title, 'department', c.department, 'candidate', c.candidate_name)
               from public.cases c where c.id = p_case),
    'person', (select jsonb_build_object('name', cd.full_name, 'nic', cd.nic, 'dob', cd.date_of_birth)
                 from public.cases c join public.candidates cd on cd.id = c.candidate_id where c.id = p_case),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label, 'state', k.state, 'result', k.result, 'tone', k.result_tone,
                                                            'note', k.client_note, 'values', k.values) order by k.id), '[]'::jsonb)
                 from public.case_checks k where k.case_id = p_case),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'visibility', d.visibility, 'category', d.category, 'check', d.case_check_id, 'record', d.record_key,
                                                           'sha256', d.sha256, 'original', d.original_kind, 'withheld', d.withheld_reason) order by d.id), '[]'::jsonb)
                from public.documents d where d.case_id = p_case and d.status in ('uploaded', 'accepted')),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('slot', f.requirement_id, 'file', f.document_id, 'pages', f.pages, 'records', f.record_keys) order by f.id), '[]'::jsonb)
                from public.requirement_files f where f.case_id = p_case)
  )::text)
$$;
revoke execute on function public.case_report_stamp(uuid) from public, anon, authenticated;

-- Files in this report that didn't arrive intact.
create or replace function public.report_evidence_problems(p_annexures jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(a ->> 'filename'), '{}')
    from jsonb_array_elements(coalesce(p_annexures, '[]'::jsonb)) a
   where not coalesce((a ->> 'embedded')::boolean, true) or coalesce((a ->> 'altered')::boolean, false) or coalesce((a ->> 'attached')::boolean, false)
$$;
revoke execute on function public.report_evidence_problems(jsonb) from public, anon;
grant execute on function public.report_evidence_problems(jsonb) to authenticated, service_role;

-- Sensitive evidence inside a report, which someone has to decide to send (spec 6.4).
create or replace function public.report_sensitive_files(p_snapshot jsonb) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(d.filename order by d.filename), '{}')
    from jsonb_array_elements(coalesce(p_snapshot -> 'annexures', '[]'::jsonb)) a
    join public.documents d on d.id = (a ->> 'document_id')::uuid
   where d.sensitive and (auth.uid() is null or (public.is_staff() and public.case_visible(d.case_id)))
$$;
revoke execute on function public.report_sensitive_files(jsonb) from public, anon;
grant execute on function public.report_sensitive_files(jsonb) to authenticated, service_role;

create or replace function public.report_render_started(p_version uuid) returns public.report_versions
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
begin
  update public.report_versions
     set status = 'rendering',
         -- Before the job reads anything: a change during the render makes the draft stale, not wrong.
         source_stamp = case when kind = 'draft' then public.case_report_stamp(case_id) else source_stamp end
   where id = p_version and status in ('queued', 'rendering', 'failed')
  returning * into v;
  return v;
end $$;
create or replace function public.report_render_done(
  p_version uuid, p_ok boolean, p_snapshot jsonb default null, p_snapshot_hash text default null, p_storage_path text default null,
  p_sha256 text default null, p_pages int default null, p_size bigint default null, p_annexures jsonb default '[]'::jsonb, p_error text default null, p_parts jsonb default '[]'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
begin
  select * into v from public.report_versions where id = p_version for update;
  if v.id is null then raise exception 'report version not found' using errcode = 'P0002'; end if;
  -- A newer draft replaced it while rendering, or another run of the job finished first. The first finished file stands.
  if v.status not in ('queued', 'rendering', 'failed') then return; end if;
  if p_ok then
    update public.report_versions
       set status = 'ready', snapshot = coalesce(p_snapshot, snapshot), snapshot_hash = coalesce(p_snapshot_hash, snapshot_hash),
           storage_path = p_storage_path, sha256 = p_sha256, page_count = p_pages, size_bytes = p_size,
           annexures = coalesce(p_annexures, '[]'::jsonb), parts = coalesce(p_parts, '[]'::jsonb), error = null,
           source_stamp = coalesce(source_stamp, public.case_report_stamp(case_id))
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

drop function public.submit_report(uuid);
create function public.submit_report(p_case uuid, p_evidence_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  d public.report_versions;
  v_unreported text[];
  v_problems text[];
  v_changed text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('reports.preview') and (public.has_permission('cases.stage.change') or coalesce(c.assigned_to = auth.uid(), false))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage <> 'report' then raise exception 'the case is not at the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  select * into d from public.report_versions where case_id = p_case and kind = 'draft' and status = 'ready'
     and version = (select max(version) from public.report_versions where case_id = p_case);
  if d.id is null then
    raise exception 'generate a draft and check it before sending it for approval' using errcode = '22023';
  end if;
  if d.source_stamp is not null and d.source_stamp is distinct from public.case_report_stamp(p_case) then
    raise exception 'the case changed after this draft was made; generate a new draft first' using errcode = '22023';
  end if;
  -- Spec 7: evidence the report needs goes in it.
  v_unreported := public.case_unreported_evidence(p_case);
  if cardinality(v_unreported) > 0 then
    raise exception 'no evidence in the report for %; set its file to go in the report, or waive the document, then make a new draft',
      array_to_string(v_unreported, ', ') using errcode = '22023';
  end if;
  -- Spec 4.7: the Global Sanction report goes as issued, or not at all.
  select string_agg(a ->> 'title', ', ') into v_changed from jsonb_array_elements(d.annexures) a
   where a ->> 'kind' = 'fixed' and coalesce((a ->> 'altered')::boolean, false);
  if v_changed is not null then
    raise exception '% has changed since it was uploaded; upload it again, then make a new draft', v_changed using errcode = '22023';
  end if;
  -- And what the draft really holds. Anything else that went wrong takes a decision, with the reason on record.
  v_problems := public.report_evidence_problems(d.annexures);
  if cardinality(v_problems) > 0 then
    if coalesce(trim(p_evidence_note), '') = '' then
      raise exception '% did not reach the report intact; replace the file and make a new draft, or say why it can go without it',
        array_to_string(v_problems, ', ') using errcode = '22023';
    end if;
    if not (public.has_permission('cases.stage.change') or public.has_permission('qc.post')) then
      raise exception 'only a manager can send a report with evidence problems' using errcode = '42501';
    end if;
    update public.report_versions set evidence_note = left(trim(p_evidence_note), 1000) where id = d.id;
    perform public.log_case_event(p_case, null, 'report_evidence_note', 'Report sent with evidence problems', left(trim(p_evidence_note), 1000),
      jsonb_build_object('version_id', d.id, 'files', v_problems), false, false);
  end if;
  perform public.move_case(p_case, 'approval', 'submit_report');
end $$;
revoke execute on function public.submit_report(uuid, text) from public, anon;
grant execute on function public.submit_report(uuid, text) to authenticated, service_role;

drop function public.approve_report(uuid, uuid, text, text);
create function public.approve_report(
  p_case uuid, p_draft uuid, p_final_result text, p_current_hash text,
  p_reason text default null, p_share_sensitive boolean default false, p_evidence_ack boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  d public.report_versions;
  v_id uuid;
  v_problems text[];
  v_sensitive text[];
  v_reason text := nullif(trim(p_reason), '');
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for approval' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if p_final_result not in ('green', 'amber', 'red') then raise exception 'choose the final result' using errcode = '22023'; end if;
  select * into d from public.report_versions where id = p_draft and case_id = p_case and kind = 'draft' for update;
  if d.id is null or d.status <> 'ready' then raise exception 'approve a ready draft' using errcode = '22023'; end if;
  if d.version <> (select max(version) from public.report_versions where case_id = p_case) then
    raise exception 'a newer version exists; approve the latest draft' using errcode = '22023';
  end if;
  -- The caller's hash is a courtesy. The stamp is read here, so nobody can vouch for their own draft.
  if d.snapshot_hash is null or d.snapshot_hash is distinct from p_current_hash or d.source_stamp is distinct from public.case_report_stamp(p_case) then
    raise exception 'the case changed after this draft was made; generate a new draft first' using errcode = '22023';
  end if;
  -- Incomplete checks never print as verified: a green result needs every counted check completed and clear, and at least one.
  if p_final_result = 'green' and (exists (select 1 from public.case_checks k where k.case_id = p_case and k.state <> 'waived'
                                            and not (k.state = 'completed' and k.result_tone = 'green'))
                                   or not exists (select 1 from public.case_checks k where k.case_id = p_case and k.state <> 'waived')) then
    raise exception 'a green result needs every check completed and clear' using errcode = '22023';
  end if;
  -- Spec 9: the outcome is a person's call. A different one from the checks' says why.
  if p_final_result is distinct from c.proposed_result and v_reason is null then
    raise exception 'say why the final result differs from what the checks propose' using errcode = '22023';
  end if;
  v_problems := public.report_evidence_problems(d.annexures);
  if cardinality(v_problems) > 0 and not coalesce(p_evidence_ack, false) then
    raise exception 'confirm the evidence problems first: %', array_to_string(v_problems, ', ') using errcode = '22023';
  end if;
  -- Spec 6.4: sensitive evidence doesn't reach a client by default. Approving this sends it, so it is asked.
  v_sensitive := public.report_sensitive_files(d.snapshot);
  if cardinality(v_sensitive) > 0 and not coalesce(p_share_sensitive, false) then
    raise exception 'confirm that this sensitive evidence may go to the client: %', array_to_string(v_sensitive, ', ') using errcode = '22023';
  end if;
  update public.cases set final_result = p_final_result where id = p_case;
  update public.report_versions set approved_by = auth.uid(), approved_at = now(), final_result = p_final_result, result_reason = v_reason where id = d.id;
  insert into public.report_versions (org_id, case_id, version, kind, based_on, final_result, snapshot, snapshot_hash, source_stamp, requested_by, approved_by, approved_at, revision_reason, result_reason)
  values (c.org_id, c.id, d.version + 1, 'final', d.id, p_final_result, d.snapshot, d.snapshot_hash, d.source_stamp, auth.uid(), auth.uid(), now(),
          (select revision_reason from public.report_versions where case_id = p_case and kind = 'final' and revision_reason is not null and status = 'released' order by version desc limit 1),
          v_reason)
  returning id into v_id;
  perform public.queue_report_render(v_id);
  perform public.log_case_event(p_case, null, 'report_approved', 'Report approved (' || p_final_result || ')', v_reason,
    jsonb_build_object('version_id', v_id, 'final_result', p_final_result, 'sensitive', v_sensitive, 'evidence', v_problems), false, false);
  return v_id;
end $$;
revoke execute on function public.approve_report(uuid, uuid, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.approve_report(uuid, uuid, text, text, text, boolean, boolean) to authenticated, service_role;
create or replace function public.return_report(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for approval' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say what needs changing' using errcode = '22023'; end if;
  update public.report_versions set status = 'superseded' where case_id = p_case and status in ('queued', 'rendering', 'ready', 'failed');
  -- The result was the approver's, and it went back with the report.
  update public.cases set final_result = (select v.final_result from public.report_versions v where v.case_id = p_case and v.status = 'released' order by v.version desc limit 1)
   where id = p_case;
  perform public.move_case(p_case, 'report', 'return_report', p_reason, true);
end $$;
create or replace function public.revise_report(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'released' then raise exception 'only a released report can be revised' using errcode = '22023'; end if;
  if c.erased_at is not null then raise exception 'the personal data on this case was erased' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the report is being revised' using errcode = '22023'; end if;
  update public.report_versions set revision_reason = trim(p_reason)
   where id = (select id from public.report_versions where case_id = p_case and status = 'released' order by version desc limit 1);
  perform public.move_case(p_case, 'report', 'revise_report', p_reason);
end $$;
create or replace function public.release_report(p_case uuid, p_recipients uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  f public.report_versions;
  v_policy text;
  v_lost text[];
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.release') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for release' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  select * into f from public.report_versions where case_id = p_case and kind = 'final'
   order by version desc limit 1 for update;
  if f.id is null or f.status <> 'ready' then raise exception 'the final report is not ready yet' using errcode = '22023'; end if;
  if f.approved_by = auth.uid() and not public.is_super_admin() then
    raise exception 'a different person must release the report they approved' using errcode = '42501';
  end if;
  -- What the approver saw is what goes out.
  if f.source_stamp is not null and f.source_stamp is distinct from public.case_report_stamp(p_case) then
    raise exception 'the case changed after approval; send the report back and make a new draft' using errcode = '22023';
  end if;
  select array(select unnest(public.report_evidence_problems(f.annexures))
               except select unnest(public.report_evidence_problems((select b.annexures from public.report_versions b where b.id = f.based_on)))) into v_lost;
  if cardinality(v_lost) > 0 then
    raise exception 'the final report lost evidence the draft had: %; send it back and make a new draft', array_to_string(v_lost, ', ') using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_recipients, '{}')) r
              where not exists (select 1 from public.memberships m
                                  join public.role_permissions rp on rp.role_id = m.role_id and rp.permission = 'portal.cases.read'
                                 where m.user_id = r and m.client_id = c.client_id and m.kind = 'client' and m.status = 'active')) then
    raise exception 'recipients must be portal users of this client who can read cases' using errcode = '22023';
  end if;
  -- Earlier released versions are superseded by this one.
  update public.report_versions set status = 'superseded' where case_id = p_case and status = 'released';
  update public.report_versions set status = 'released', released_by = auth.uid(), released_at = now() where id = f.id;
  insert into public.report_recipients (org_id, report_version_id, user_id)
  select c.org_id, f.id, r from unnest(coalesce(p_recipients, '{}')) r;
  update public.cases set released_at = now() where id = p_case;
  perform public.move_case(p_case, 'released', 'release_report');
  -- Per-case billing drafts the invoice now (0015).
  select billing_policy into v_policy from public.clients where id = c.client_id;
  if v_policy = 'per_case_on_release' then
    perform public.enqueue_job('invoice.draft', jsonb_build_object('case_id', p_case), 'invoice.draft:case:' || p_case,
                               now(), null, 'case', p_case, null, c.org_id, auth.uid());
  end if;
  return f.id;
end $$;

-- A named list can grow after release. An open report already reaches everyone at the client.
create or replace function public.add_report_recipients(p_case uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_version uuid;
  v_n int;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.release') then raise exception 'not allowed' using errcode = '42501'; end if;
  select v.id into v_version from public.report_versions v where v.case_id = p_case and v.status = 'released' order by v.version desc limit 1;
  if v_version is null then raise exception 'the report has not been released' using errcode = '22023'; end if;
  if not exists (select 1 from public.report_recipients r where r.report_version_id = v_version) then
    raise exception 'everyone at the client can already open this report' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_users, '{}')) r
              where not exists (select 1 from public.memberships m
                                  join public.role_permissions rp on rp.role_id = m.role_id and rp.permission = 'portal.cases.read'
                                 where m.user_id = r and m.client_id = c.client_id and m.kind = 'client' and m.status = 'active')) then
    raise exception 'recipients must be portal users of this client who can read cases' using errcode = '22023';
  end if;
  insert into public.report_recipients (org_id, report_version_id, user_id)
  select c.org_id, v_version, r from unnest(coalesce(p_users, '{}')) r
   where not exists (select 1 from public.report_recipients x where x.report_version_id = v_version and x.user_id = r);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.notify_users(p_users, 'portal.report_released', c.reference || ': report available', '', '/portal/cases/' || c.id, false, 'case', c.id, c.org_id);
    perform public.log_case_event(p_case, null, 'report_recipients', 'Report shared with ' || v_n || ' more people', null, jsonb_build_object('version_id', v_version), false, false);
  end if;
  return v_n;
end $$;
revoke execute on function public.add_report_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.add_report_recipients(uuid, uuid[]) to authenticated, service_role;

-- A recipient whose account is deleted still narrows the list: the report never opens up by accident.
create or replace function public.report_open_to_caller(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.report_recipients r where r.report_version_id = p_version)
      or exists (select 1 from public.report_recipients r where r.report_version_id = p_version and r.user_id = auth.uid())
$$;

-- Sensitive evidence opens for those allowed it, and for the people doing the work.
create or replace function public.sensitive_open_to_caller(p_case uuid, p_check uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('documents.read_sensitive')
      or exists (select 1 from public.cases c where c.id = p_case and c.assigned_to = auth.uid())
      or (p_check is not null and exists (select 1 from public.case_checks k where k.id = p_check and k.assigned_to = auth.uid()))
$$;
revoke execute on function public.sensitive_open_to_caller(uuid, uuid) from public, anon;
grant execute on function public.sensitive_open_to_caller(uuid, uuid) to authenticated, service_role;

-- Which of these reports the signed-in staff member can't open, so a list doesn't offer a link that fails.
create or replace function public.reports_closed_to_caller(p_versions uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.id), '{}')
    from public.report_versions v
   where v.id = any (p_versions) and public.is_staff() and public.case_visible(v.case_id)
     and not public.sensitive_open_to_caller(v.case_id) and cardinality(public.report_sensitive_files(v.snapshot)) > 0
$$;
revoke execute on function public.reports_closed_to_caller(uuid[]) from public, anon;
grant execute on function public.reports_closed_to_caller(uuid[]) to authenticated, service_role;

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('documents.read'))
         and (not sensitive or public.sensitive_open_to_caller(case_id, case_check_id))
         and public.case_visible(case_id));
create or replace function public.report_download(p_version uuid, p_ip text default null, p_part int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
  c public.cases;
  v_who text;
  v_path text;
  v_first boolean;
begin
  select * into v from public.report_versions where id = p_version;
  if v.id is null or v.storage_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  -- Part 1 is the report itself. Later parts hold evidence that didn't fit in it.
  v_path := case when p_part is null or p_part = 1 then v.storage_path else v.parts -> (p_part - 2) ->> 'path' end;
  if v_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = v.case_id;
  if public.is_staff() and public.has_permission('reports.preview') and public.case_visible(c.id) then
    -- The report holds the files themselves, so the rule for opening them applies to it too.
    if not public.sensitive_open_to_caller(c.id) and cardinality(public.report_sensitive_files(v.snapshot)) > 0 then
      raise exception 'this report holds sensitive evidence you can''t open' using errcode = '42501';
    end if;
    v_who := 'staff';
  elsif public.is_client() and public.has_permission('portal.cases.read') and c.client_id = public.client_id_of_user() and c.client_visible
        and v.status = 'released' and public.report_open_to_caller(v.id) then
    v_who := 'client';
  else
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  v_first := not exists (select 1 from public.report_downloads r where r.report_version_id = v.id and r.user_id = auth.uid());
  insert into public.report_downloads (org_id, report_version_id, user_id, who, ip, part) values (v.org_id, v.id, auth.uid(), v_who, left(p_ip, 64), p_part);
  if v_who = 'client' and v_first then
    perform public.log_case_event(c.id, null, 'report_downloaded', 'Report downloaded', null,
      jsonb_build_object('version_id', v.id), true, false);
  end if;
  return jsonb_build_object('bucket', 'reports', 'path', v_path,
    'filename', c.reference || case v.kind when 'draft' then '-DRAFT-v' || v.version else '' end
                || case when coalesce(p_part, 1) > 1 then '-part-' || p_part else '' end || '.pdf');
end $$;
create or replace function public.portal_report(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.portal_case_visible(p_case) then return null; end if;
  return (select jsonb_build_object('version_id', v.id, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256,
                                    'page_count', v.page_count, 'final_result', v.final_result,
                                    -- Retention removed the file: the case stays, the PDF doesn't.
                                    'file_removed', v.storage_path is null, 'extra_parts', jsonb_array_length(v.parts),
                                    'revised', v.revision_reason is not null)
            from public.report_versions v where v.case_id = p_case and v.status = 'released' and public.report_open_to_caller(v.id)
           order by v.version desc limit 1);
end $$;
create or replace function public.verify_report(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'found', true,
    'status', case when c.erased_at is not null and v.released_at is not null then 'erased' when v.status = 'released' then 'valid' when v.status = 'superseded' and v.released_at is not null then 'superseded' else 'not_released' end,
    -- The report calls itself by how many were issued, not by how many drafts came first.
    'reference', c.reference,
    'version', (select count(*) from public.report_versions x where x.case_id = v.case_id and x.kind = 'final' and x.released_at is not null and x.version <= v.version),
    'released_at', v.released_at, 'sha256', v.sha256, 'page_count', v.page_count,
    'client', cl.name,
    'candidate', case when c.erased_at is null then (select string_agg(left(w, 1) || '.', ' ') from regexp_split_to_table(c.candidate_name, '\s+') w) end,
    'issuer', coalesce(o.branding ->> 'legal_name', o.name),
    -- Further files of the same report: each has its own fingerprint.
    'parts', coalesce((select jsonb_agg(jsonb_build_object('part', p -> 'part', 'sha256', p -> 'sha256', 'page_count', p -> 'pages'))
                         from jsonb_array_elements(v.parts) p), '[]'::jsonb))
  from public.report_versions v
  join public.cases c on c.id = v.case_id
  join public.clients cl on cl.id = c.client_id
  join public.orgs o on o.id = v.org_id
  where v.id = p_version and v.kind = 'final' and v.status in ('released', 'superseded')
$$;

-- ---------------------------------------------------------------------------
-- What a client sees (spec 6.1, 6.4)
-- ---------------------------------------------------------------------------
create or replace function public.portal_report_status(c public.cases) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when c.stage = 'released' then 'released'
    when exists (select 1 from public.report_versions v where v.case_id = c.id and v.status = 'released') then 'revising'
    when c.stage = 'report' then 'preparing'
    when c.stage = 'approval' and exists (select 1 from public.report_versions v where v.case_id = c.id and v.kind = 'final' and v.status = 'ready') then 'completed'
    when c.stage = 'approval' then 'awaiting_approval'
    when c.stage = 'cancelled' then 'cancelled'
    else 'not_ready' end
$$;
revoke execute on function public.portal_report_status(public.cases) from public, anon;
grant execute on function public.portal_report_status(public.cases) to authenticated, service_role;

-- Spec 6.1: "waiting on you" means something they can do. A document nobody can
-- upload any more isn't that, and a question still is.
create or replace function public.portal_pending_slots(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from public.case_check_requirements r
            join public.cases c on c.id = r.case_id
            left join public.case_checks k on k.id = r.case_check_id
           where r.case_id = p_case and c.process_type = 'client_supplied'
             and c.stage in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification')
             and r.client_visible and r.status = 'pending' and r.min_count > r.received_count
             and not public.portal_check_hidden(c.client_id, k.check_type_id))
       + (select count(*)::int from public.client_requests q
            join public.cases c on c.id = q.case_id
            left join public.case_checks k on k.id = q.case_check_id
           where q.case_id = p_case and q.status = 'open' and not public.portal_check_hidden(c.client_id, k.check_type_id))
$$;

create or replace function public.portal_case_row(c public.cases) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_progress boolean := coalesce((public.portal_visibility(c.client_id) ->> 'show_check_progress')::boolean, true);
  v_checks jsonb := '[]'::jsonb;
  v_total int;
  v_done int;
begin
  -- Counts and the list follow the same rule as the case page: hidden checks don't exist here.
  if v_progress then
    select coalesce(jsonb_agg(jsonb_build_object(
             'label', k.label,
             'state', case when k.state in ('completed', 'discrepancy', 'unable_to_verify') then 'done'
                           when k.state = 'waived' then 'not_required'
                           -- On a candidate-collected case the candidate was asked, not the client.
                           when k.state = 'pending_info' then case when c.process_type = 'candidate_collected' then 'waiting_for_candidate' else 'needs_information' end
                           when k.state = 'not_started' then 'not_started'
                           else 'in_progress' end) order by k.sort), '[]'::jsonb),
           count(*) filter (where k.state <> 'waived'),
           count(*) filter (where k.state in ('completed', 'discrepancy', 'unable_to_verify'))
      into v_checks, v_total, v_done
      from public.case_checks k
     where k.case_id = c.id and not public.portal_check_hidden(c.client_id, k.check_type_id);
  end if;
  return jsonb_build_object(
    'id', c.id, 'reference', c.reference, 'candidate_name', c.candidate_name, 'position_title', c.position_title,
    'department', c.department, 'client_reference', c.client_reference, 'package_name', c.package_snapshot ->> 'name',
    'stage', c.stage, 'stage_label', public.portal_stage_label(c.stage),
    'status_label', coalesce((select s.client_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = c.status_key),
                             public.portal_stage_label(c.stage)),
    'priority', c.priority, 'on_hold', c.on_hold, 'checks_total', v_total, 'checks_done', v_done, 'checks', v_checks,
    'received_at', c.received_at, 'due_at', c.due_at, 'released_at', c.released_at, 'cancelled_at', c.cancelled_at,
    'process_type', c.process_type, 'created_via', c.created_via,
    'needs_documents', case when c.stage not in ('released', 'cancelled') then public.portal_pending_slots(c.id) else 0 end,
    'report_status', public.portal_report_status(c),
    'report_version_id', (select v.id from public.report_versions v
                           where v.case_id = c.id and v.status = 'released' and v.storage_path is not null and public.report_open_to_caller(v.id)
                           order by v.version desc limit 1),
    'final_result', case when c.stage = 'released' and public.portal_results_open(c.id) then c.final_result end);
end $$;
create or replace function public.portal_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  v_out jsonb;
begin
  with mine as (select * from public.cases where client_id = v_client and client_visible)
  select jsonb_build_object(
    'client', (select jsonb_build_object('id', cl.id, 'name', cl.name, 'code', cl.code, 'sla_days', cl.sla_days) from public.clients cl where cl.id = v_client),
    'counts', jsonb_build_object(
       'total', (select count(*) from mine),
       'active', (select count(*) from mine where stage not in ('released', 'cancelled')),
       'action', (select count(*) from mine where stage not in ('released', 'cancelled') and public.portal_pending_slots(id) > 0),
       'released_30d', (select count(*) from mine where stage = 'released' and released_at > now() - interval '30 days'),
       -- A revision runs on no deadline: the client already has the report.
       'overdue', (select count(*) from mine where stage not in ('released', 'cancelled') and released_at is null and due_at < now())),
    'by_stage', jsonb_build_object(
       'received', (select count(*) from mine where stage = 'intake'),
       'documents', (select count(*) from mine where stage = 'documents'),
       'in_progress', (select count(*) from mine where stage in ('pre_qc', 'data_entry', 'verification', 'post_qc')),
       'report', (select count(*) from mine where stage in ('report', 'approval')),
       'released', (select count(*) from mine where stage = 'released')),
    'avg_tat_days', (select round(avg(extract(epoch from released_at - received_at) / 86400)::numeric, 1)
                       from mine where stage = 'released' and released_at > now() - interval '90 days'),
    'needs_action', coalesce((select jsonb_agg(public.portal_case_row(c) order by c.received_at)
                                from public.cases c
                               where c.id in (select id from mine where stage not in ('released', 'cancelled') and public.portal_pending_slots(id) > 0
                                               order by received_at limit 5)), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(public.portal_case_row(c) order by c.received_at desc)
                          from public.cases c where c.id in (select id from mine order by received_at desc limit 6)), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
create or replace function public.portal_case_detail(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  c public.cases;
  v_vis jsonb;
  v_hidden uuid[];
  v_results boolean;
  v_contact boolean;
  v_progress boolean;
  v_can_upload boolean := public.has_permission('portal.cases.create');
  v_out jsonb;
begin
  select * into c from public.cases where id = p_case and client_id = v_client and client_visible;
  if c.id is null then raise exception 'case not found' using errcode = 'P0002'; end if;
  v_vis := public.portal_visibility(v_client);
  v_hidden := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_vis -> 'hidden_check_types') x), '{}');
  -- Report recipients limit the results too, not only the PDF.
  v_results := (c.stage = 'released' or coalesce((v_vis ->> 'show_results_before_release')::boolean, false)) and public.portal_results_open(c.id);
  v_contact := coalesce((v_vis ->> 'show_candidate_details')::boolean, false);
  v_progress := coalesce((v_vis ->> 'show_check_progress')::boolean, true);

  select jsonb_build_object(
    'case', public.portal_case_row(c) || jsonb_build_object(
              -- A portal request shows what the client typed, never the shared record.
              'candidate', (select jsonb_build_object('full_name', c.candidate_name,
                                                 'nic', case when v_contact then case when c.intake_candidate is not null then c.intake_candidate ->> 'nic' else cd.nic end end,
                                                 'email', case when v_contact then case when c.intake_candidate is not null then c.intake_candidate ->> 'email' else cd.email end end,
                                                 'phone', case when v_contact then case when c.intake_candidate is not null then c.intake_candidate ->> 'phone' else cd.phone end end)
                              from public.candidates cd where cd.id = c.candidate_id),
              'instructions', c.instructions,
              'package', jsonb_build_object('name', c.package_snapshot ->> 'name', 'code', c.package_snapshot ->> 'code',
                                            'tat_days', c.package_snapshot -> 'tat_days'),
              'hold_label', case when c.on_hold then coalesce((select s.client_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = 'on_hold'), 'On hold') end,
              'results_visible', v_results),
    'visibility', v_vis - 'hidden_check_types',
    'can_upload', v_can_upload and c.stage in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification'),
    'checks', case when v_progress then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', k.label, 'key', ct.key, 'icon', ct.icon,
               'state', case when k.state in ('completed', 'discrepancy', 'unable_to_verify') then 'done'
                             when k.state = 'waived' then 'not_required'
                             when k.state = 'pending_info' then case when c.process_type = 'candidate_collected' then 'waiting_for_candidate' else 'needs_information' end
                             when k.state = 'not_started' then 'not_started'
                             else 'in_progress' end,
               'completed_at', case when k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then k.completed_at end,
               'result_tone', case when v_results then k.result_tone end,
               'result_label', case when v_results then (
                   select o ->> 'label' from public.check_type_versions v, jsonb_array_elements(coalesce(v.schema -> 'result' -> 'options', '[]'::jsonb)) o
                    where v.id = k.check_type_version_id and o ->> 'key' = k.result) end,
               -- What the report prints, no more: an open check has no finding yet.
               'client_note', case when v_results and k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then k.client_note end,
               'fields', case when v_results and k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then coalesce((
                   select jsonb_agg(jsonb_build_object('label', f ->> 'label', 'value', public.portal_field_value(f, k.values -> (f ->> 'key'))) order by n)
                     from public.check_type_versions v, jsonb_array_elements(coalesce(v.schema -> 'fields', '[]'::jsonb)) with ordinality as x(f, n)
                    where v.id = k.check_type_version_id and coalesce((f -> 'visibility' ->> 'client')::boolean, false)
                      and k.values ? (f ->> 'key')), '[]'::jsonb) else '[]'::jsonb end)
             order by k.sort)
        from public.case_checks k join public.check_types ct on ct.id = k.check_type_id
       where k.case_id = c.id and not (k.check_type_id = any (v_hidden))), '[]'::jsonb) else '[]'::jsonb end,
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'category', r.category, 'label', r.label, 'description', r.description,
               'category_name', dc.name, 'guide', dc.guide, 'check_label', k.label,
               'min_count', r.min_count, 'received_count', r.received_count, 'status', r.status,
               -- On a candidate-collected case the note was written to the candidate.
               'requested_note', case when c.process_type = 'client_supplied' then r.requested_note end, 'requested_at', r.requested_at)
             order by coalesce(k.sort, 0), dc.sort, r.created_at)
        from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
        left join public.document_categories dc on dc.org_id = r.org_id and dc.key = r.category
       where r.case_id = c.id and r.client_visible and r.status <> 'waived' and not coalesce(k.check_type_id = any (v_hidden), false)), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'status', q.status, 'answer', q.answer,
                                          'check_label', k.label, 'asked_at', q.created_at, 'answered_at', q.answered_at)
             order by q.created_at)
        from public.client_requests q
        left join public.case_checks k on k.id = q.case_check_id
       where q.case_id = c.id and q.status <> 'closed' and not coalesce(k.check_type_id = any (v_hidden), false)), '[]'::jsonb),
    'can_answer', public.has_permission('portal.cases.create') and c.stage not in ('released', 'cancelled'),
    -- Erased files can't be opened, so they aren't listed.
    'documents', case when coalesce((v_vis ->> 'show_documents')::boolean, true) and c.erased_at is null then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'filename', d.filename, 'category', d.category, 'category_name', dc.name, 'label', d.label,
               'from', d.uploaded_by_kind, 'status', d.status, 'created_at', d.created_at, 'mime', d.mime, 'size', d.size_bytes,
               'rejection_reason', case when d.uploaded_by_kind = 'client' then d.rejection_reason end)
             order by d.created_at desc)
        from public.documents d
        left join public.document_categories dc on dc.org_id = d.org_id and dc.key = d.category
        left join public.case_checks k on k.id = d.case_check_id
       where d.case_id = c.id and not coalesce(k.check_type_id = any (v_hidden), false)
         and (d.visibility = 'client' and d.status in ('uploaded', 'accepted')
              or d.uploaded_by_kind = 'client' and d.status in ('uploaded', 'accepted', 'rejected'))), '[]'::jsonb) else '[]'::jsonb end,
    'candidate_progress', case when coalesce((v_vis ->> 'show_candidate_progress')::boolean, true) then (
      select jsonb_build_object('invited_at', l.sent_at, 'active', l.revoked_at is null and l.expires_at > now(),
                                'opened', l.first_opened_at is not null,
                                'consent', coalesce((select f.status in ('submitted', 'accepted') from public.consent_forms f where f.case_id = c.id), false))
        from public.candidate_links l where l.case_id = c.id and l.sent_at is not null order by l.created_at desc limit 1) end,
    'timeline', case when coalesce((v_vis ->> 'show_timeline')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.at, 'title', e.title, 'body', e.body) order by e.at desc)
        from (
          select ev.id, ev.kind, ev.at,
                 case ev.kind
                   when 'created' then 'Request received'
                   when 'stage_changed' then coalesce(ev.data ->> 'label', public.portal_stage_label((ev.data ->> 'to')::public.case_stage))
                   when 'hold' then 'Put on hold'
                   when 'resumed' then 'Resumed'
                   when 'check_state' then coalesce(k.label, 'A check') || case when ev.data ->> 'to' = 'waived' then ' is not required' else ' completed' end
                   else ev.title end as title,
                 case when ev.kind in ('document_requested', 'document_rejected') then ev.body end as body
            from public.case_events ev
            left join public.case_checks k on k.id = ev.case_check_id
           where ev.case_id = c.id and ev.visible_to_client and ev.kind <> 'returned'
             and (v_progress or ev.kind not in ('check_state', 'check_added'))
             and not coalesce(k.check_type_id = any (v_hidden), false)
             -- Their own files only: staff evidence and other people's rejections stay off the feed.
             and not (ev.kind = 'document_uploaded' and coalesce(ev.data ->> 'by', '') <> 'client')
             and not (ev.kind in ('document_accepted', 'document_rejected') and not exists (
                   select 1 from public.documents d where d.id = (ev.data ->> 'document_id')::uuid and d.uploaded_by_kind = 'client'))
           order by ev.at desc limit 80) e), '[]'::jsonb) else '[]'::jsonb end,
    'report', jsonb_build_object(
      'status', public.portal_report_status(c),
      'released_at', c.released_at)
  ) into v_out;
  return v_out;
end $$;

create or replace function public.portal_my_visibility() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_client() then public.portal_visibility(public.client_id_of_user()) - 'hidden_check_types' else '{}'::jsonb end
$$;

drop policy documents_select_client on public.documents;
create policy documents_select_client on public.documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_client())
         and client_id = (select public.client_id_of_user())
         and (visibility = 'client' and status in ('uploaded', 'accepted')
              or uploaded_by_kind = 'client' and status in ('uploaded', 'accepted', 'rejected'))
         and coalesce(((select public.portal_my_visibility()) ->> 'show_documents')::boolean, true)
         and (case_check_id is null or not public.portal_check_row_hidden(case_check_id))
         and public.portal_case_visible(case_id));

-- Ontriq's settings aren't the client's to read: QC checklists, MFA rules and the rest of the row.
drop policy orgs_select on public.orgs;
create policy orgs_select on public.orgs for select to authenticated
  using (id = (select public.auth_org_id()) and (select public.is_staff()));

create or replace function public.portal_org_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', o.name, 'branding', o.branding)
    from public.orgs o where o.id = public.auth_org_id() and public.is_client()
$$;
revoke execute on function public.portal_org_profile() from public, anon;
grant execute on function public.portal_org_profile() to authenticated, service_role;

-- Internal wording stays internal. The portal functions pick out the client's words.
drop policy client_status_catalog_select on public.client_status_catalog;
create policy client_status_catalog_select on public.client_status_catalog for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
revoke update on public.client_status_catalog from authenticated;
grant update (internal_label, client_label, candidate_label) on public.client_status_catalog to authenticated;

drop policy communications_select on public.communications;
create policy communications_select on public.communications for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (case_id is null or public.case_visible(case_id)));

drop policy request_templates_update on public.request_templates;
create policy request_templates_update on public.request_templates for update to authenticated
  using (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and (select public.has_permission('templates.manage')))
    or ((select public.is_client()) and (select public.has_permission('portal.templates.manage')) and client_id = (select public.client_id_of_user()))
  ))
  with check (org_id = (select public.auth_org_id()) and (
    (select public.is_staff()) or (owner_scope = 'client' and client_id = (select public.client_id_of_user()))
  ));

revoke execute on function public.case_outstanding_requirements(uuid, text) from public, anon, authenticated;
create or replace function public.contracted_price(p_client uuid, p_check uuid, p_package uuid, p_on date default ((now() at time zone 'Asia/Colombo')::date)) returns numeric
language sql stable security definer set search_path = '' as $$
  select p.unit_price from public.client_price_lists p
   where p.client_id = p_client
     and (auth.uid() is null or public.is_staff() or p_client = public.client_id_of_user())
     and (p.check_type_id = p_check or p.package_id = p_package)
     and p.valid_from <= p_on and (p.valid_to is null or p.valid_to >= p_on)
   order by p.valid_from desc, p.created_at desc limit 1
$$;
create or replace function public.client_can_use_package(p_package uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.packages p
     where p.id = p_package and p.is_active
       and (auth.uid() is null or public.is_staff() or p_client = public.client_id_of_user())
       and ((p.owner_scope = 'client' and p.client_id = p_client)
            or (p.owner_scope = 'org' and (p.visibility = 'all'
                or exists (select 1 from public.package_client_visibility v where v.package_id = p.id and v.client_id = p_client))))
  )
$$;
create or replace function public.packages_client_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_portal jsonb;
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  -- A change to its checks sent it back for approval (package_items_client_review).
  if tg_op = 'UPDATE' and current_setting('app.package_review', true) = new.id::text then return new; end if;
  if tg_op = 'INSERT' then
    select s.portal into v_portal from public.client_settings s where s.client_id = new.client_id;
    if coalesce((v_portal ->> 'client_packages')::boolean, true) = false then
      raise exception 'Ontriq has not turned on custom packages for your company' using errcode = '42501';
    end if;
    if coalesce((v_portal ->> 'client_packages_need_approval')::boolean, false) then
      new.needs_approval := true;
      new.is_active := false;
    else
      new.needs_approval := false;
    end if;
    new.visibility := 'all';
    -- Only Ontriq sets prices, on the way in as well as later.
    new.pricing_mode := 'sum';
    new.fixed_price := null;
    new.currency := 'LKR';
    new.tat_days := coalesce((select c.sla_days from public.clients c where c.id = new.client_id), 7);
    new.default_process_type := 'client_supplied';
    return new;
  end if;
  -- Update: approval stays with Ontriq; switching off is always allowed.
  if new.needs_approval is distinct from old.needs_approval then
    raise exception 'only Ontriq can approve a package' using errcode = '42501';
  end if;
  if new.is_active and not old.is_active and old.needs_approval then
    raise exception 'this package is waiting for Ontriq''s approval' using errcode = '42501';
  end if;
  if new.owner_scope is distinct from old.owner_scope or new.client_id is distinct from old.client_id
     or new.pricing_mode is distinct from old.pricing_mode or new.fixed_price is distinct from old.fixed_price
     or new.currency is distinct from old.currency or new.tat_days is distinct from old.tat_days
     or new.visibility is distinct from old.visibility or new.default_process_type is distinct from old.default_process_type then
    raise exception 'only Ontriq can change pricing or ownership' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace function public.log_document_access(p_document uuid, p_action text, p_ip text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.document_access_log (org_id, document_id, user_id, action, ip)
  select d.org_id, d.id, auth.uid(), coalesce(p_action, 'view'), p_ip from public.documents d
   where d.id = p_document and d.org_id = public.auth_org_id()
     and (public.case_visible(d.case_id)
          or (public.is_client() and d.client_id = public.client_id_of_user() and (d.visibility = 'client' or d.uploaded_by_kind = 'client')));
end $$;

-- ---------------------------------------------------------------------------
-- Erasure leaves nothing personal behind
-- ---------------------------------------------------------------------------
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
  v_outbox uuid[];
  v_anon uuid;
  v_sms uuid[];
begin
  -- The retention job (service role) or the Super Admin with two-step verification.
  if auth.uid() is not null and not (public.is_super_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2') then
    raise exception 'erasing personal data takes the Super Admin, signed in with two-step verification' using errcode = '42501';
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
  update public.documents set filename = 'erased', storage_path = 'erased/' || id, label = null, rejection_reason = null, sha256 = null,
         record_key = null, withheld_reason = null where id = any (v_docs);
  update public.document_access_log set ip = null where document_id = any (v_docs);
  update public.case_check_requirements set requested_note = null, waived_reason = null, description = null where case_id = c.id;
  update public.report_versions set snapshot = '{}'::jsonb, storage_path = null, annexures = '[]'::jsonb, parts = '[]'::jsonb,
         revision_reason = null, error = null, result_reason = null, evidence_note = null where id = any (v_reports);
  update public.report_downloads set ip = null where report_version_id = any (v_reports);
  update public.generated_documents set storage_path = null where id = any (v_generated);
  delete from public.ai_suggestions
   where (entity_type = 'case' and entity_id = c.id) or (entity_type = 'case_check' and entity_id = any (v_checks))
      or (entity_type = 'document' and entity_id = any (v_docs));
  update public.candidate_requests set answer = null, review_note = null, help = null where id = any (v_requests);
  update public.candidate_messages set body = '[erased]' where case_id = c.id;
  update public.candidate_links set token_enc = null, revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'erased') where case_id = c.id;
  update public.consent_forms set signed_name = null, ip = null, user_agent = null, ai_check = '{}'::jsonb, review_note = null where id = any (v_consents);
  -- Stage moves stay readable. Everything else keeps what happened, not who or which file.
  update public.case_events
     set body = null,
         data = case when kind in ('stage_changed', 'returned') then jsonb_strip_nulls(jsonb_build_object('to', data -> 'to', 'from', data -> 'from', 'event', data -> 'event', 'label', data -> 'label')) else '{}'::jsonb end,
         title = case when kind in ('created', 'stage_changed', 'returned', 'qc_pre', 'qc_post', 'report_draft', 'report_ready', 'report_failed', 'report_approved', 'hold', 'resumed', 'erased', 'check_state', 'check_added')
                      then title else initcap(replace(kind, '_', ' ')) end
   where case_id = c.id;
  update public.assignment_events set reason = null where case_id = c.id;
  update public.qc_reviews set remarks = null, checklist = '[]'::jsonb where case_id = c.id;
  update public.client_requests set question = '[erased]', answer = null where case_id = c.id;
  update public.stage_history set reason = null where case_id = c.id;
  select coalesce(array_agg(email_outbox_id) filter (where email_outbox_id is not null), '{}'), coalesce(array_agg(sms_outbox_id) filter (where sms_outbox_id is not null), '{}')
    into v_outbox, v_sms from public.communications where case_id = c.id;
  update public.communications set body = '[erased]', counterparty = null, subject = null, outcome = null where case_id = c.id;
  -- What was sent is gone, and so is where it went. Anything still queued stays unsent.
  update public.email_outbox set html = '<p>[erased]</p>', text_body = '[erased]', payload = '{}'::jsonb, to_emails = array['erased'], cc_emails = '{}', reply_to = null,
         subject = '[erased]', status = case when status in ('queued', 'sending') then 'skipped' else status end
   where entity_id = c.id or entity_id = any (v_requests) or entity_id = any (v_checks) or id = any (v_outbox);
  update public.sms_outbox set body = '[erased]', to_phone = '[erased]', status = case when status in ('queued', 'sending') then 'skipped' else status end
   where entity_id = c.id or id = any (v_sms);
  -- Copies of the candidate's name elsewhere: notifications (and their emails), pushes, the
  -- assistant's conversations, and verifier replies waiting in the job queue.
  v_name := trim(both '"' from to_json(c.candidate_name)::text);
  v_nic := (select nic from public.candidates where id = c.candidate_id);
  select coalesce(array_agg(id), '{}') into v_notes from public.notifications
   where entity_id = c.id or entity_id = any (v_checks) or entity_id = any (v_docs) or entity_id = any (v_requests)
      or (length(c.candidate_name) >= 3 and (title like '%' || c.candidate_name || '%' or body like '%' || c.candidate_name || '%'));
  update public.notifications set title = replace(title, c.candidate_name, 'Erased candidate'), body = '' where id = any (v_notes);
  update public.email_outbox set html = '<p>[erased]</p>', text_body = '[erased]', payload = '{}'::jsonb, to_emails = array['erased'], cc_emails = '{}', reply_to = null,
         subject = '[erased]', status = case when status in ('queued', 'sending') then 'skipped' else status end
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
    update public.assistant_threads set title = replace(title, c.candidate_name, 'Erased candidate') where title like '%' || c.candidate_name || '%';
    update public.assistant_memories set content = replace(content, c.candidate_name, 'Erased candidate') where content like '%' || c.candidate_name || '%';
    update public.assistant_voice_notes set transcript = replace(transcript, c.candidate_name, 'Erased candidate') where transcript like '%' || c.candidate_name || '%';
  end if;
  if length(coalesce(v_nic, '')) >= 9 then
    update public.assistant_messages set content = replace(content::text, v_nic, '[erased]')::jsonb where content::text like '%' || v_nic || '%';
  end if;
  update public.jobs set payload = payload - 'reply' where kind = 'ai.response_capture' and payload ->> 'check_id' = any (select unnest(v_checks)::text);
  update public.cases set candidate_name = 'Erased candidate', client_reference = null, position_title = null, department = null,
         hold_reason = null, return_note = null, instructions = null, internal_notes = null, manual_status_key = null, cancel_reason = null,
         intake_candidate = null, candidate_match_open = false,
         erased_at = now(), erased_by = auth.uid(), erasure_reason = left(replace(trim(p_reason), c.candidate_name, 'the candidate'), 500)
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
  else
    -- Another case still needs the person, so their record stays. This case stops pointing at it,
    -- or an erased result would still carry their name.
    insert into public.candidates (org_id, full_name, erased_at) values (c.org_id, 'Erased candidate', now()) returning id into v_anon;
    update public.cases set candidate_id = v_anon where id = c.id;
  end if;
  update public.documents set candidate_id = null where id = any (v_docs);

  -- Audit entries for these rows keep who did what and when, and on which case, not the data.
  update public.audit_log set before = case when before is null then null else jsonb_build_object('redacted', true, 'case_id', c.id) end,
         after = case when after is null then null else jsonb_build_object('redacted', true, 'case_id', c.id) end
   where (table_name = 'cases' and row_id = c.id::text)
      or (table_name = 'case_checks' and row_id = any (select unnest(v_checks)::text))
      or (table_name = 'documents' and row_id = any (select unnest(v_docs)::text))
      or (table_name = 'report_versions' and row_id = any (select unnest(v_reports)::text))
      or (table_name = 'generated_documents' and row_id = any (select unnest(v_generated)::text))
      or (table_name = 'candidate_requests' and row_id = any (select unnest(v_requests)::text))
      or (table_name = 'consent_forms' and row_id = any (select unnest(v_consents)::text))
      or (table_name = 'qc_reviews' and row_id = any (select id::text from public.qc_reviews where case_id = c.id))
      or (table_name = 'client_requests' and row_id = any (select id::text from public.client_requests where case_id = c.id))
      or (table_name = 'case_check_requirements' and row_id = any (select id::text from public.case_check_requirements where case_id = c.id))
      or (table_name = 'candidate_messages' and row_id = any (select id::text from public.candidate_messages where case_id = c.id))
      or (table_name = 'communications' and row_id = any (select id::text from public.communications where case_id = c.id))
      or (table_name = 'requirement_files' and row_id = any (select id::text from public.requirement_files where case_id = c.id));
  -- Who did what stays. Where they connected from has done its job.
  update public.audit_log set ip = null
   where (table_name = 'cases' and row_id = c.id::text) or (table_name = 'documents' and row_id = any (select unnest(v_docs)::text));

  -- Files are the worker's to remove. Written down first, so a failure can be retried and can't be lost.
  insert into public.storage_deletions (org_id, case_id, bucket, path)
  select c.org_id, c.id, o ->> 'bucket', o ->> 'path' from jsonb_array_elements(v_objects) o;
  -- A draft replaced while it rendered never reached a row. Its folder goes too.
  insert into public.storage_deletions (org_id, case_id, bucket, path, is_folder) values
    (c.org_id, c.id, 'reports', 'org/' || c.org_id || '/case/' || c.id || '/report', true),
    (c.org_id, c.id, 'documents', 'org/' || c.org_id || '/case/' || c.id || '/candidate-report', true);

  perform public.log_case_event(c.id, null, 'erased', 'Personal data erased', null,
    jsonb_build_object('by', case when auth.uid() is null then 'retention' else 'super_admin' end), false, false);
  insert into public.system_events (org_id, kind, severity, message, context)
  values (c.org_id, 'data.erased', 'info', 'Personal data erased for case ' || c.reference,
          jsonb_build_object('case_id', c.id, 'reference', c.reference, 'by', auth.uid(), 'files', jsonb_array_length(v_objects),
                             'source', case when auth.uid() is null then 'retention' else 'request' end));
  return jsonb_build_object('case_id', c.id, 'reference', c.reference, 'objects', v_objects);
end $$;

-- ---------------------------------------------------------------------------
-- New versions of the built-in check types (src/domain/check-types/builtin.ts)
-- ---------------------------------------------------------------------------
-- The flowchart asks each step to record what the source said. A check can't be
-- verified without it now, and every row of employment and references says so too.
-- Cases keep the version they started on.

do $delta$
declare
  d jsonb := $json${
  "require": {
    "education": ["confirmed_by", "confirmation_channel", "confirmed_on"],
    "sanction": ["screening_platform", "screened_on"]
  },
  "require_group": {
    "employment": { "employers": ["confirmed_by"] },
    "reference": { "referees": ["feedback", "details_confirmed", "confirmed_on"] }
  },
  "fields": {
    "address": [
      { "key": "confirmed_on", "label": "Confirmed on", "type": "date", "required": true, "stage": "verification", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" }
    ],
    "police": [
      { "key": "confirmed_on", "label": "Confirmed on", "type": "date", "required": true, "stage": "verification", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" }
    ]
  },
  "group_fields": {
    "employment": {
      "employers": [
        { "key": "confirmed_on", "label": "Confirmed on", "type": "date", "required": true, "stage": "verification", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" },
        { "key": "employer_response", "label": "What the employer confirmed", "type": "textarea", "required": true, "stage": "verification", "visibility": { "client": false, "report": true, "candidate": false }, "fill_by": ["staff"], "width": "half" }
      ]
    }
  },
  "integer": { "education": ["year_of_completion"] },
  "documents_client_visible": { "reference": ["reference_form"] },
  "documents_stage": { "police": { "police_report": "documents" } }
}$json$::jsonb;
  t record;
  v_schema jsonb;
  v_list jsonb;
  v_id uuid;
begin
  for t in select ct.id, ct.org_id, ct.key, ct.current_version_id from public.check_types ct
            where ct.current_version_id is not null and ct.key in ('education', 'employment', 'address', 'police', 'reference', 'sanction') loop
    select schema into v_schema from public.check_type_versions where id = t.current_version_id;

    select jsonb_agg(
             case
               when coalesce(d -> 'require' -> t.key, '[]'::jsonb) ? (f ->> 'key') then f || '{"required": true}'::jsonb
               when coalesce(d -> 'integer' -> t.key, '[]'::jsonb) ? (f ->> 'key') then jsonb_set(f, '{validation,integer}', 'true'::jsonb)
               when d -> 'require_group' -> t.key ? (f ->> 'key') then jsonb_set(f, '{fields}', (
                 select jsonb_agg(case when d -> 'require_group' -> t.key -> (f ->> 'key') ? (s ->> 'key') then s || '{"required": true}'::jsonb else s end order by m)
                   from jsonb_array_elements(f -> 'fields') with ordinality as b(s, m)))
               else f end order by n)
      into v_list from jsonb_array_elements(v_schema -> 'fields') with ordinality as a(f, n);
    v_schema := jsonb_set(v_schema, '{fields}', v_list);

    if d -> 'fields' ? t.key then
      v_schema := jsonb_set(v_schema, '{fields}', (v_schema -> 'fields') || (d -> 'fields' -> t.key));
    end if;

    if d -> 'group_fields' ? t.key then
      select jsonb_agg(case when d -> 'group_fields' -> t.key ? (f ->> 'key')
                            then jsonb_set(f, '{fields}', (f -> 'fields') || (d -> 'group_fields' -> t.key -> (f ->> 'key'))) else f end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'fields') with ordinality as a(f, n);
      v_schema := jsonb_set(v_schema, '{fields}', v_list);
    end if;

    if d -> 'documents_client_visible' ? t.key then
      select jsonb_agg(case when d -> 'documents_client_visible' -> t.key ? (x ->> 'category') then x || '{"client_visible": true}'::jsonb else x end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'documents') with ordinality as a(x, n);
      v_schema := jsonb_set(v_schema, '{documents}', v_list);
    end if;

    if d -> 'documents_stage' ? t.key then
      select jsonb_agg(case when d -> 'documents_stage' -> t.key ? (x ->> 'category')
                            then x || jsonb_build_object('stage', d -> 'documents_stage' -> t.key -> (x ->> 'category')) else x end order by n)
        into v_list from jsonb_array_elements(v_schema -> 'documents') with ordinality as a(x, n);
      v_schema := jsonb_set(v_schema, '{documents}', v_list);
    end if;

    insert into public.check_type_versions (org_id, check_type_id, version, schema, notes, published_at)
    values (t.org_id, t.id, (select coalesce(max(version), 0) + 1 from public.check_type_versions where check_type_id = t.id), v_schema,
            'What the source confirmed is now required, per employer and per referee', now())
    returning id into v_id;
    update public.check_types set current_version_id = v_id where id = t.id;
  end loop;
end $delta$;

-- ---------------------------------------------------------------------------
-- What the independent audits of the finished build found
-- ---------------------------------------------------------------------------
-- An upload begun before a lock doesn't finish after it (spec 5.2, 7).
create or replace function public.candidate_finalize_upload(p_link uuid, p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  d public.documents;
  v_name text;
begin
  select * into d from public.documents where id = p_document and case_id = v_case and uploaded_by_kind = 'candidate' for update;
  if d.id is null then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  if (select stage from public.cases where id = v_case) not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'your verification no longer takes uploads' using errcode = '22023';
  end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = d.id;
  if d.category = 'consent_form' then return; end if;   -- candidate_submit_consent records it
  v_name := coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category);
  -- A document request is answered once its slot has a file.
  update public.candidate_requests q set status = 'answered', answered_at = now(), answer = jsonb_build_object('document_id', d.id)
   where q.case_id = v_case and q.kind = 'document' and q.status = 'open'
     and q.requirement_id in (select r.id from public.case_check_requirements r
                               where r.case_id = v_case and r.category = d.category and r.case_check_id is not distinct from d.case_check_id);
  perform public.log_case_event(v_case, d.case_check_id, 'document_uploaded', v_name || ' received from the candidate', d.filename,
    jsonb_build_object('document_id', d.id, 'category', d.category, 'by', 'candidate'), true, true);
  perform public.notify_case_owner(v_case, 'candidate.upload', 'Candidate uploaded ' || v_name,
    (select reference from public.cases where id = v_case));
end $$;
create or replace function public.portal_finalize_upload(p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.cases.create');
  d public.documents;
  v_name text;
begin
  select * into d from public.documents where id = p_document and client_id = v_client and uploaded_by_kind = 'client' for update;
  if d.id is null or d.uploaded_by is distinct from auth.uid() then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  if (select stage from public.cases where id = d.case_id) not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'this case no longer takes uploads' using errcode = '22023';
  end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = d.id;
  v_name := coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category);
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_uploaded', v_name || ' uploaded by the client', d.filename,
    jsonb_build_object('document_id', d.id, 'category', d.category, 'by', 'client'), true, false);
  perform public.notify_case_owner(d.case_id, 'client.upload', 'Client uploaded ' || v_name,
    (select reference from public.cases where id = d.case_id));
end $$;

-- A new version keeps its place: evidence doesn't fall out of the report by being replaced (spec 7).
create or replace function public.documents_report_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'internal' and new.parent_id is null and new.withheld_reason is null
     and exists (select 1 from public.document_categories dc where dc.org_id = new.org_id and dc.key = new.category and dc.in_report) then
    new.visibility := 'report';
  end if;
  return new;
end $$;

-- Consent: what was rejected stops the case, not only what was never given (spec 2.2).
create or replace function public.case_consent_missing(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  -- A client-supplied case carries its consent among the documents, so an unused link stops nothing there. A rejected form does.
  select not exists (select 1 from public.consent_forms f where f.case_id = c.id and f.status in ('submitted', 'accepted'))
     and (c.process_type = 'candidate_collected' or exists (select 1 from public.consent_forms f where f.case_id = c.id and f.status = 'rejected'))
    from public.cases c where c.id = p_case
$$;
revoke execute on function public.case_consent_missing(uuid) from public, anon, authenticated;
create or replace function public.candidate_submit_consent(
  p_link uuid, p_method text, p_signed_name text, p_document uuid, p_ip text default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  f public.consent_forms;
begin
  if (select stage from public.cases where id = v_case) not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'your verification no longer takes uploads' using errcode = '22023';
  end if;
  if p_method not in ('esign', 'upload') then raise exception 'unknown consent method' using errcode = '22023'; end if;
  if p_method = 'esign' and length(coalesce(trim(p_signed_name), '')) < 3 then raise exception 'type your full name to sign' using errcode = '22023'; end if;
  if p_method = 'upload' and p_document is null then raise exception 'upload a photo of the signed form' using errcode = '22023'; end if;
  if p_document is not null and not exists (select 1 from public.documents d where d.id = p_document and d.case_id = v_case
       and d.uploaded_by_kind = 'candidate' and d.category = 'consent_form' and d.status in ('uploaded', 'accepted')) then
    raise exception 'consent document not found' using errcode = 'P0002';
  end if;
  select * into f from public.consent_forms where case_id = v_case for update;
  if f.status = 'accepted' then raise exception 'your consent has already been accepted' using errcode = '22023'; end if;
  insert into public.consent_forms (org_id, case_id, status, method, signed_name, signed_at, ip, user_agent, document_id)
  select c.org_id, c.id, 'submitted', p_method, nullif(trim(p_signed_name), ''), now(), left(p_ip, 64), left(p_user_agent, 300), p_document
    from public.cases c where c.id = v_case
  on conflict (case_id) do update set status = 'submitted', method = excluded.method, signed_name = excluded.signed_name,
    signed_at = excluded.signed_at, ip = excluded.ip, user_agent = excluded.user_agent, document_id = excluded.document_id,
    review_note = null, reviewed_by = null, reviewed_at = null, ai_check = '{}'::jsonb;
  perform public.log_case_event(v_case, null, 'consent_submitted', 'Consent form received', null,
    jsonb_build_object('method', p_method), true, true);
  perform public.notify_case_owner(v_case, 'candidate.consent', 'Candidate signed the consent form',
    (select reference from public.cases where id = v_case));
end $$;
create or replace function public.review_consent(p_case uuid, p_accept boolean, p_note text default null, p_document uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.consent_forms;
  v_case public.cases;
begin
  if not public.can_manage_candidate(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_case from public.cases where id = p_case;
  perform public.require_case_open(v_case);
  -- The candidate has to be able to sign again.
  if not p_accept and p_document is null then perform public.require_uploads_open(v_case); end if;
  select * into f from public.consent_forms where case_id = p_case for update;
  if p_document is not null then
    if not exists (select 1 from public.documents d where d.id = p_document and d.case_id = p_case and d.category = 'consent_form'
                    and d.status in ('uploaded', 'accepted')) then
      raise exception 'upload the signed consent form to the case first' using errcode = '22023';
    end if;
    insert into public.consent_forms (org_id, case_id, status, method, document_id, signed_at, reviewed_by, reviewed_at, review_note)
    select c.org_id, c.id, 'accepted', 'staff', p_document, now(), auth.uid(), now(), nullif(trim(p_note), '') from public.cases c where c.id = p_case
    on conflict (case_id) do update set status = 'accepted', method = 'staff', document_id = excluded.document_id,
      signed_at = coalesce(public.consent_forms.signed_at, now()), reviewed_by = auth.uid(), reviewed_at = now(), review_note = excluded.review_note;
  else
    if f.id is null or f.status not in ('submitted', 'accepted', 'rejected') then
      raise exception 'the candidate has not submitted consent yet' using errcode = '22023';
    end if;
    if not p_accept and coalesce(trim(p_note), '') = '' then raise exception 'tell the candidate what is wrong' using errcode = '22023'; end if;
    update public.consent_forms
       set status = case when p_accept then 'accepted' else 'rejected' end,
           review_note = case when p_accept then null else trim(p_note) end, reviewed_by = auth.uid(), reviewed_at = now()
     where id = f.id;
  end if;
  perform public.log_case_event(p_case, null, case when p_accept or p_document is not null then 'consent_accepted' else 'consent_rejected' end,
    case when p_accept or p_document is not null then 'Consent accepted' else 'Consent form needs to be signed again' end,
    case when not p_accept and p_document is null then trim(p_note) end, '{}'::jsonb, false, true);
end $$;

-- On hold, nothing more goes out and nobody works the case (spec 6.2).
create or replace function public.post_candidate_message(p_case uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.can_manage_candidate(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  perform public.require_case_open((select c from public.cases c where c.id = p_case));
  if coalesce(trim(p_body), '') = '' then raise exception 'write a message first' using errcode = '22023'; end if;
  insert into public.candidate_messages (org_id, case_id, from_kind, author_id, body)
  select c.org_id, c.id, 'staff', auth.uid(), left(trim(p_body), 4000) from public.cases c where c.id = p_case
  returning id into v_id;
  update public.candidate_messages set read_at = now() where case_id = p_case and from_kind = 'candidate' and read_at is null;
  return v_id;
end $$;
create or replace function public.record_candidate_link_sent(p_link uuid, p_channels text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.candidate_links;
begin
  select * into l from public.candidate_links where id = p_link for update;
  if l.id is null or (auth.uid() is not null and not public.can_manage_candidate(l.case_id)) then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if auth.uid() is not null then perform public.require_case_open((select c from public.cases c where c.id = l.case_id)); end if;
  if coalesce(cardinality(p_channels), 0) = 0 then return; end if;
  update public.candidate_links
     set sent_at = coalesce(sent_at, now()), sent_count = sent_count + 1,
         sent_via = (select array_agg(distinct x) from unnest(sent_via || p_channels) x)
   where id = l.id;
  perform public.log_case_event(l.case_id, null, 'candidate_invited',
    case when l.sent_count = 0 then 'Candidate invited to provide documents' else 'Candidate link sent again' end, null,
    jsonb_build_object('channels', p_channels), true, true);
end $$;
create or replace function public.review_candidate_request(p_request uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.candidate_requests;
begin
  select * into q from public.candidate_requests where id = p_request for update;
  if q.id is null or not public.can_manage_candidate(q.case_id) then raise exception 'request not found' using errcode = 'P0002'; end if;
  perform public.require_case_open((select c from public.cases c where c.id = q.case_id));
  if p_decision = 'accept' then
    if q.status <> 'answered' then raise exception 'there is no answer to accept yet' using errcode = '22023'; end if;
    update public.candidate_requests set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now(), review_note = null where id = q.id;
  elsif p_decision = 'reopen' then
    if q.kind = 'document' then perform public.require_uploads_open((select c from public.cases c where c.id = q.case_id)); end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'tell the candidate what to change' using errcode = '22023'; end if;
    update public.candidate_requests set status = 'open', review_note = trim(p_note), reviewed_by = auth.uid(), reviewed_at = now() where id = q.id;
    perform public.log_case_event(q.case_id, q.case_check_id, 'request_reopened', 'Please check: ' || q.title, trim(p_note),
      jsonb_build_object('request_id', q.id), false, true);
  elsif p_decision = 'cancel' then
    update public.candidate_requests set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now() where id = q.id;
  else
    raise exception 'unknown decision' using errcode = '22023';
  end if;
end $$;
create or replace function public.remap_check_records(p_check uuid, p_map jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check;
  if k.id is null or not public.case_visible(k.case_id) then raise exception 'check not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.cases where id = k.case_id;
  perform public.require_case_open(c);
  perform public.require_evidence_unlocked(c);
  update public.documents set record_key = p_map ->> record_key where case_check_id = p_check and record_key is not null and p_map ? record_key;
  update public.communications set record_key = p_map ->> record_key where case_check_id = p_check and record_key is not null and p_map ? record_key;
end $$;
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
  -- The clock stops while a case is held: resuming moves its due dates on by the time lost.
  if not p_hold and c.held_at is not null then
    update public.case_checks set due_at = due_at + (now() - c.held_at)
     where case_id = p_case and due_at is not null and state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived');
  end if;
  -- The hold's own event tells the client. The status change that comes with it stays quiet.
  perform set_config('app.stage_moved', p_case::text, true);
  update public.cases set on_hold = p_hold, hold_reason = case when p_hold then p_reason end, held_at = case when p_hold then now() end,
         due_at = case when not p_hold and c.held_at is not null then due_at + (now() - c.held_at) else due_at end
   where id = p_case;
  perform set_config('app.stage_moved', '', true);
  perform public.log_case_event(p_case, null, case when p_hold then 'hold' else 'resumed' end,
    case when p_hold then 'Put on hold' else 'Resumed' end, p_reason, '{}'::jsonb, true, false);
end $$;

-- Reminders reach the person the first link did (spec 2.2).
create or replace function public.candidate_reminder_candidates() returns table (
  link_id uuid, case_id uuid, org_id uuid, reference text, language text, sent_at timestamptz,
  reminders_sent int, last_reminded_at timestamptz, escalated_at timestamptz, expires_at timestamptz,
  candidate_name text, candidate_email text, candidate_phone text, client_name text,
  missing_documents int, open_requests int, consent_missing boolean
)
language sql stable security definer set search_path = '' as $$
  select l.id, c.id, c.org_id, c.reference, l.language, l.sent_at, l.reminders_sent, l.last_reminded_at, l.escalated_at, l.expires_at,
         coalesce(c.intake_candidate ->> 'full_name', cd.full_name), coalesce(c.intake_candidate ->> 'email', cd.email),
         coalesce(c.intake_candidate ->> 'phone', cd.phone), cl.name,
         (select count(*)::int from public.case_check_requirements r
           where r.case_id = c.id and r.status = 'pending' and r.min_count > r.received_count and public.candidate_providable(r.category, r.stage)),
         (select count(*)::int from public.candidate_requests q where q.case_id = c.id and q.status = 'open'),
         not exists (select 1 from public.consent_forms f where f.case_id = c.id and f.status in ('submitted', 'accepted'))
    from public.candidate_links l
    join public.cases c on c.id = l.case_id
    join public.candidates cd on cd.id = c.candidate_id
    join public.clients cl on cl.id = c.client_id
   where l.revoked_at is null and l.expires_at > now() and l.sent_at is not null
     and c.stage in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') and not c.on_hold
$$;

-- A price list is for clients it was offered to, and offered packages reach them (spec 10).
create or replace function public.package_offered_to_me(p_package uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.package_client_visibility v where v.package_id = p_package and v.client_id = public.client_id_of_user())
$$;
revoke execute on function public.package_offered_to_me(uuid) from public, anon;
grant execute on function public.package_offered_to_me(uuid) to authenticated, service_role;
drop policy packages_select on public.packages;
create policy packages_select on public.packages for select to authenticated
  using (org_id = (select public.auth_org_id()) and (
    (select public.is_staff())
    or ((select public.is_client()) and (
         (owner_scope = 'client' and client_id = (select public.client_id_of_user()))
         or (owner_scope = 'org' and is_active and (visibility = 'all' or public.package_offered_to_me(id)))
       ))
  ));
create or replace function public.portal_price_list() returns table (
  check_type_id uuid, key text, name text, description text, icon text, unit_price numeric, currency text
)
language sql stable security definer set search_path = '' as $$
  select ct.id, ct.key, ct.name, ct.description, ct.icon,
         coalesce((select max(pi.unit_price) from public.package_items pi join public.packages p on p.id = pi.package_id
                    where pi.check_type_id = ct.id and p.owner_scope = 'org' and p.is_active), 0),
         coalesce((select o.currency from public.orgs o where o.id = ct.org_id), 'LKR')
    from public.check_types ct
   where ct.org_id = (select public.auth_org_id()) and ct.archived_at is null and ct.current_version_id is not null
     and (select public.is_client())
     and not exists (select 1 from public.client_check_type_access a
                      where a.client_id = (select public.client_id_of_user()) and a.check_type_id = ct.id and not a.enabled)
   order by ct.sort, ct.name
$$;
create or replace function public.package_items_price_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Client-built packages take Ontriq's list price for each check, whatever was sent.
  if auth.uid() is not null and not public.is_staff() then
    new.unit_price := coalesce((
      select pi.unit_price from public.package_items pi
        join public.packages p on p.id = pi.package_id
       where pi.check_type_id = new.check_type_id and p.owner_scope = 'org' and p.is_active
       order by pi.unit_price desc limit 1), 0);
  end if;
  return new;
end $$;

-- A client's own package goes back to Ontriq when it changes, if Ontriq approves them.
create or replace function public.package_items_client_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_package uuid := coalesce(new.package_id, old.package_id);
begin
  if auth.uid() is null or public.is_staff() then return null; end if;
  if coalesce((select (s.portal ->> 'client_packages_need_approval')::boolean
                 from public.client_settings s join public.packages p on p.client_id = s.client_id where p.id = v_package), false) then
    perform set_config('app.package_review', v_package::text, true);
    update public.packages set needs_approval = true, is_active = false where id = v_package and owner_scope = 'client' and not needs_approval;
    perform set_config('app.package_review', '', true);
  end if;
  return null;
end $$;
revoke execute on function public.package_items_client_review() from public, anon, authenticated;
create trigger package_items_client_review after insert or delete on public.package_items
  for each row execute function public.package_items_client_review();

-- Who can read a question's answer is not who can switch off two-step sign-in (spec 10).
create or replace function public.orgs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.mfa_required_for_staff is distinct from old.mfa_required_for_staff and not public.is_super_admin() then
    raise exception 'only a Super Admin can change this' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.orgs_guard() from public, anon, authenticated;
create trigger orgs_guard before update on public.orgs for each row execute function public.orgs_guard();

-- The AI's reading of a candidate's files follows the same gate as the report itself.
drop policy ai_suggestions_select on public.ai_suggestions;
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.ai_suggestion_visible(entity_type, entity_id)
         and (capability <> 'candidate.report' or public.can_read_candidate_report(entity_id)));

-- How many people at the client can read a question, so staff know when nobody can.
create or replace function public.case_portal_readers(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.cases c
    join public.memberships m on m.client_id = c.client_id and m.kind = 'client' and m.status = 'active'
   where c.id = p_case and c.client_visible and public.is_staff() and public.case_visible(p_case)
     and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission = 'portal.cases.read')
$$;
revoke execute on function public.case_portal_readers(uuid) from public, anon;
grant execute on function public.case_portal_readers(uuid) to authenticated, service_role;

-- The name on a case, for staff who work it without access to the client's record.
create or replace function public.case_client_name(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select cl.name from public.cases c join public.clients cl on cl.id = c.client_id
   where c.id = p_case and public.is_staff() and public.case_visible(p_case)
$$;
revoke execute on function public.case_client_name(uuid) from public, anon;
grant execute on function public.case_client_name(uuid) to authenticated, service_role;

-- Quotations follow the same gate as their pages (spec 6.4).
create or replace function public.portal_quote(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.quotes.accept');
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote and client_id = v_client and status in ('sent', 'viewed', 'accepted', 'declined', 'expired');
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  return public.portal_quote_row(q) || jsonb_build_object(
    'intro', q.intro, 'scope', q.scope, 'assumptions', q.assumptions, 'tat_text', q.tat_text, 'closing', q.closing,
    'declined_reason', q.declined_reason, 'expected_monthly_volume', q.expected_monthly_volume,
    'can_accept', public.has_permission('portal.quotes.accept'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'kind', i.kind, 'quantity', i.quantity,
                                                           'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'total', i.total) order by i.sort)
                         from public.quote_items i where i.quote_id = q.id), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('min_volume', t.min_volume, 'max_volume', t.max_volume,
                                                           'discount_pct', t.discount_pct, 'note', t.note) order by t.min_volume)
                         from public.quote_tiers t where t.quote_id = q.id), '[]'::jsonb),
    'client_name', (select name from public.clients where id = q.client_id));
end $$;
create or replace function public.portal_quotes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.quotes.accept');
begin
  return coalesce((select jsonb_agg(public.portal_quote_row(q) order by q.sent_at desc nulls last)
                     from public.quotes q
                    where q.client_id = v_client and q.status in ('sent', 'viewed', 'accepted', 'declined', 'expired')), '[]'::jsonb);
end $$;
create or replace function public.portal_mark_quote_viewed(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.quotes.accept');
  v_id uuid;
begin
  update public.quotes set status = 'viewed', viewed_at = now()
   where id = p_quote and client_id = v_client and status = 'sent'
  returning id into v_id;
  if v_id is not null then perform public.log_quote_event(v_id, 'viewed', null, 'client'); end if;
end $$;

-- Money: what was quoted is what is billed, and every released case is billed once (spec 10).
create or replace function public.invoices_freeze_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_table_name = 'invoices' then
    if old.status <> 'draft' and (new.message, new.client_id, new.template_key, new.period_from, new.period_to, new.contact_id, new.issue_date)
       is distinct from (old.message, old.client_id, old.template_key, old.period_from, old.period_to, old.contact_id, old.issue_date) then
      raise exception 'this invoice is confirmed; issue a credit note or void it instead' using errcode = '22023';
    end if;
    return new;
  end if;
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then
    raise exception 'this invoice is confirmed; issue a credit note or void it instead' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('invoices.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status = 'void' then return; end if;
  if exists (select 1 from public.payments where invoice_id = i.id and voided_at is null) then
    raise exception 'void its payments first, or issue a credit note' using errcode = '22023';
  end if;
  if exists (select 1 from public.credit_notes where invoice_id = i.id and status = 'issued') then
    raise exception 'this invoice has a credit note, so it can''t be voided; credit the rest instead' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the invoice is voided' using errcode = '22023'; end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = trim(p_reason), balance = 0 where id = i.id;
  update public.generated_documents set status = 'void' where entity_type = 'invoice' and entity_id = i.id and status = 'ready';
  perform public.log_invoice_event(i.id, 'voided', trim(p_reason));
end $$;
create or replace function public.client_statement(p_client uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok boolean := (public.can_read_invoices() and exists (select 1 from public.clients where id = p_client and org_id = public.auth_org_id()))
               or (public.is_client() and p_client = public.client_id_of_user() and public.has_permission('portal.invoices.view'));
  v_opening numeric;
  v_lines jsonb;
begin
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  with tx as (
    select i.issue_date as d, 'invoice' as kind, i.number as ref, i.total as debit, 0::numeric as credit, i.id as id
      from public.invoices i where i.client_id = p_client and i.status not in ('draft', 'void')
       and (i.status <> 'confirmed' or not public.is_client())
    union all
    select p.paid_on, 'payment', coalesce(p.reference, p.receipt_number), 0, p.amount, p.id
      from public.payments p where p.client_id = p_client and p.voided_at is null
    union all
    select (n.created_at at time zone 'Asia/Colombo')::date, 'credit_note', n.number, 0, n.amount, n.id
      from public.credit_notes n where n.client_id = p_client and n.status = 'issued'
  )
  select coalesce(sum(debit - credit), 0) into v_opening from tx where d < p_from;
  with tx as (
    select i.issue_date as d, 'invoice' as kind, i.number as ref, i.total as debit, 0::numeric as credit, i.id as id
      from public.invoices i where i.client_id = p_client and i.status not in ('draft', 'void')
       and (i.status <> 'confirmed' or not public.is_client())
    union all
    select p.paid_on, 'payment', coalesce(p.reference, p.receipt_number), 0, p.amount, p.id
      from public.payments p where p.client_id = p_client and p.voided_at is null
    union all
    select (n.created_at at time zone 'Asia/Colombo')::date, 'credit_note', n.number, 0, n.amount, n.id
      from public.credit_notes n where n.client_id = p_client and n.status = 'issued'
  )
  , running as (
    select d, kind, ref, debit, credit,
           v_opening + sum(debit - credit) over (order by d, kind desc, ref rows unbounded preceding) as balance
      from tx where d between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'kind', kind, 'reference', ref, 'debit', debit, 'credit', credit, 'balance', balance)
           order by d, kind desc, ref), '[]'::jsonb)
    into v_lines from running;
  return jsonb_build_object('client', (select jsonb_build_object('id', id, 'name', name, 'code', code) from public.clients where id = p_client),
    'from', p_from, 'to', p_to, 'opening', v_opening, 'lines', v_lines,
    'closing', v_opening + coalesce((select sum((x ->> 'debit')::numeric - (x ->> 'credit')::numeric) from jsonb_array_elements(v_lines) x), 0));
end $$;
create or replace function public.case_invoice_lines(p_case uuid) returns table (
  case_id uuid, case_check_id uuid, description text, unit_price numeric, sort int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cases;
  v_on date;
  v_snap jsonb;
  v_contract numeric;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return; end if;
  v_on := (c.received_at at time zone 'Asia/Colombo')::date;
  v_snap := c.package_snapshot;
  v_contract := case when c.package_id is not null then public.contracted_price(c.client_id, null, c.package_id, v_on) end;
  -- A price agreed for the package is the price of the package, however it is built up.
  if c.package_id is not null and (v_snap ->> 'pricing_mode' = 'fixed' or v_contract is not null) then
    return query
      select c.id, null::uuid,
        coalesce(v_snap ->> 'name', 'Verification package') || ' · ' || c.reference || ' · ' || c.candidate_name,
        coalesce(v_contract, (v_snap ->> 'fixed_price')::numeric, 0), 10
      union all
      -- A kind of check added to the case comes on top of it.
      select c.id, k.id, k.label || ' · ' || c.reference || ' · ' || c.candidate_name,
             coalesce(public.contracted_price(c.client_id, k.check_type_id, null, v_on), (it.value ->> 'unit_price')::numeric, 0), k.sort
        from public.case_checks k
        join jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) it on it.value ->> 'check_type_id' = k.check_type_id::text
       where k.case_id = c.id and k.state <> 'waived' and coalesce((it.value ->> 'added')::boolean, false);
    return;
  end if;
  return query
    select c.id, k.id, k.label || ' · ' || c.reference || ' · ' || c.candidate_name,
           coalesce(public.contracted_price(c.client_id, k.check_type_id, null, v_on),
                    (select (it ->> 'unit_price')::numeric from jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) it
                      where it ->> 'check_type_id' = k.check_type_id::text limit 1), 0),
           k.sort
      from public.case_checks k
     where k.case_id = c.id and k.state <> 'waived'
     order by k.sort;
end $$;
create or replace function public.draft_case_invoice(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  cl public.clients;
  v_id uuid;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('invoices.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into c from public.cases where id = p_case;
  if c.id is null or (auth.uid() is not null and c.org_id <> public.auth_org_id()) then raise exception 'case not found' using errcode = 'P0002'; end if;
  -- Released once is billable, even if a revision has since started.
  if c.released_at is null then raise exception 'cases are invoiced once their report is released' using errcode = '22023'; end if;
  select * into cl from public.clients where id = c.client_id;
  select id into v_id from public.invoices where org_id = c.org_id and source_key = 'case:' || c.id and status <> 'void';
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void') then
    return null;   -- already billed on another invoice (e.g. monthly)
  end if;
  insert into public.invoices (org_id, client_id, kind, source_key, template_key, currency, contact_id, created_by)
  values (c.org_id, c.client_id, 'case', 'case:' || c.id, coalesce(nullif(cl.default_template, ''), 'executive'),
          coalesce(c.package_snapshot ->> 'currency', 'LKR'),
          (select id from public.client_contacts where client_id = c.client_id and receives_invoices order by is_primary desc, created_at limit 1),
          auth.uid())
  returning id into v_id;
  insert into public.invoice_items (org_id, invoice_id, sort, case_id, case_check_id, description, unit_price)
  select c.org_id, v_id, l.sort, l.case_id, l.case_check_id, l.description, l.unit_price from public.case_invoice_lines(c.id) l;
  perform public.recompute_invoice(v_id);
  perform public.log_invoice_event(v_id, 'drafted', c.reference, null, case when auth.uid() is null then 'system' else 'staff' end);
  perform public.notify_users(
    (select array_agg(m.user_id) from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
      where m.org_id = c.org_id and m.kind = 'staff' and m.status = 'active' and rp.permission in ('invoices.manage', '*')),
    'invoice.drafted', 'Invoice drafted for ' || c.reference, cl.name, '/app/invoices/' || v_id, false, 'invoice', v_id, c.org_id);
  return v_id;
end $$;
create or replace function public.monthly_billing_due(p_month date) returns table (client_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct c.client_id from public.cases c join public.clients cl on cl.id = c.client_id
   where cl.billing_policy = 'monthly_consolidated' and c.released_at is not null
     and (c.released_at at time zone 'Asia/Colombo')::date between date_trunc('month', p_month)::date
                                                               and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void')
$$;
create or replace function public.draft_monthly_invoice(p_client uuid, p_month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cl public.clients;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_key text;
  v_id uuid;
  v_cases int;
  v_part int;
  v_sort int;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('invoices.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cl from public.clients where id = p_client;
  if cl.id is null or (auth.uid() is not null and cl.org_id <> public.auth_org_id()) then raise exception 'client not found' using errcode = 'P0002'; end if;
  v_key := 'monthly:' || cl.id || ':' || to_char(v_from, 'YYYY-MM');
  -- One run at a time for a client's month, or two could add the same cases to the draft.
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select count(*) into v_cases from public.cases c
   where c.client_id = cl.id and c.released_at is not null and (c.released_at at time zone 'Asia/Colombo')::date between v_from and v_to
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void');
  if v_cases = 0 then
    return (select id from public.invoices where org_id = cl.org_id and source_key = v_key and status <> 'void');
  end if;
  -- Cases released after the month was drafted join the draft. Once it has gone out, they get an invoice of their own.
  select id into v_id from public.invoices
   where org_id = cl.org_id and (source_key = v_key or source_key like v_key || ':%') and status = 'draft' order by created_at desc limit 1 for update;
  if v_id is null then
    select count(*) into v_part from public.invoices where org_id = cl.org_id and (source_key = v_key or source_key like v_key || ':%');
    insert into public.invoices (org_id, client_id, kind, source_key, template_key, period_from, period_to, contact_id, created_by)
    values (cl.org_id, cl.id, 'monthly',
            case when exists (select 1 from public.invoices where org_id = cl.org_id and source_key = v_key and status <> 'void') then v_key || ':' || (v_part + 1) else v_key end,
            coalesce(nullif(cl.default_template, ''), 'executive'), v_from, v_to,
            (select id from public.client_contacts where client_id = cl.id and receives_invoices order by is_primary desc, created_at limit 1), auth.uid())
    returning id into v_id;
  end if;
  select coalesce(max(sort), 0) into v_sort from public.invoice_items where invoice_id = v_id;
  insert into public.invoice_items (org_id, invoice_id, sort, case_id, case_check_id, description, unit_price)
  select cl.org_id, v_id, v_sort + row_number() over (order by c.released_at, l.sort)::int, l.case_id, l.case_check_id, l.description, l.unit_price
    from public.cases c, public.case_invoice_lines(c.id) l
   where c.client_id = cl.id and c.released_at is not null and (c.released_at at time zone 'Asia/Colombo')::date between v_from and v_to
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void');
  perform public.recompute_invoice(v_id);
  perform public.log_invoice_event(v_id, 'drafted', to_char(v_from, 'Month YYYY') || ': ' || v_cases || ' case(s)', null,
    case when auth.uid() is null then 'system' else 'staff' end);
  return v_id;
end $$;

-- The final built-in forms: the police report comes with the documents, as both flowcharts draw it.

update public.client_requests q set status = 'closed'
  from public.cases c where c.id = q.case_id and c.stage in ('released', 'cancelled') and q.status = 'open';
update public.candidate_requests q set status = 'cancelled'
  from public.cases c where c.id = q.case_id and c.stage in ('released', 'cancelled') and q.status = 'open';

-- ---------------------------------------------------------------------------
-- What the final read of these fixes found
-- ---------------------------------------------------------------------------
-- A question to the client, for create_client_request and for a case sent back,
-- where the officer's own rights end with the move.
create or replace function public.post_client_question(c public.cases, p_check uuid, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.client_requests (org_id, case_id, case_check_id, question, created_by)
  values (c.org_id, c.id, p_check, left(p_question, 2000), auth.uid())
  returning id into v_id;
  perform public.log_case_event(c.id, p_check, 'information_requested', 'Ontriq asked for information', p_question,
    jsonb_build_object('request_id', v_id), true, false);
  perform public.notify_client_users(c.id, 'portal.information_needed', c.reference || ': Ontriq needs some information', left(p_question, 300));
  perform public.recompute_case(c.id);
  return v_id;
end $$;
revoke execute on function public.post_client_question(public.cases, uuid, text) from public, anon, authenticated;

-- A revision can stop only if the case still says what the released report says.
create or replace function public.revision_can_stop(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.stage in ('report', 'approval')
     and (select v.source_stamp from public.report_versions v where v.case_id = c.id and v.status = 'released' order by v.version desc limit 1)
         is not distinct from public.case_report_stamp(c.id)
    from public.cases c
   where c.id = p_case and (auth.uid() is null or (public.is_staff() and public.case_visible(p_case)))
$$;
revoke execute on function public.revision_can_stop(uuid) from public, anon;
grant execute on function public.revision_can_stop(uuid) to authenticated, service_role;

-- Client names for lists, for officers who work cases without the client's record.
create or replace function public.case_client_names(p_cases uuid[]) returns table (case_id uuid, client_name text)
language sql stable security definer set search_path = '' as $$
  select c.id, cl.name from public.cases c join public.clients cl on cl.id = c.client_id
   where c.id = any (p_cases) and public.is_staff() and public.case_visible(c.id)
$$;
revoke execute on function public.case_client_names(uuid[]) from public, anon;
grant execute on function public.case_client_names(uuid[]) to authenticated, service_role;

alter table public.case_checks add column discrepancy_at timestamptz;
comment on column public.case_checks.discrepancy_at is 'When the last recorded outcome was a discrepancy. It stays while the check is reopened or returned, so the finding can be corrected but not waived away.';
update public.case_checks k set discrepancy_at = e.at
  from (select distinct on (x.case_check_id) x.case_check_id, x.at, x.data ->> 'to' as outcome
          from public.case_events x
         where x.kind = 'check_state' and x.data ->> 'to' in ('completed', 'discrepancy', 'unable_to_verify')
         order by x.case_check_id, x.at desc) e
 where e.case_check_id = k.id and e.outcome = 'discrepancy';

-- Reports released before stamps existed: a released case can't have changed since.
update public.report_versions v set source_stamp = public.case_report_stamp(v.case_id)
  from public.cases c
 where c.id = v.case_id and c.stage = 'released' and c.erased_at is null and v.status = 'released' and v.source_stamp is null;

-- A waived check sent back from the report needs its evidence again too.
create or replace function public.return_to_verification(p_case uuid, p_reason text, p_checks uuid[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('cases.stage.change') or public.has_permission('reports.approve') or public.has_permission('qc.post')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage <> 'report' then raise exception 'the case is not at the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say what needs more work' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_checks, '{}')) x where not exists (select 1 from public.case_checks k where k.id = x and k.case_id = p_case)) then
    raise exception 'a returned check is not part of this case' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_checks), 0) = 0
     and not exists (select 1 from public.case_checks k where k.case_id = p_case and k.state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived')) then
    raise exception 'choose the checks that need more work' using errcode = '22023';
  end if;
  update public.report_versions set status = 'superseded' where case_id = p_case and kind = 'draft' and status in ('queued', 'rendering', 'ready', 'failed');
  perform public.restore_waived_check(k.id) from public.case_checks k where k.case_id = p_case and k.id = any (coalesce(p_checks, '{}')) and k.state = 'waived';
  update public.case_checks set state = 'returned', result = null, result_tone = null, completed_at = null
   where case_id = p_case and id = any (coalesce(p_checks, '{}'));
  perform public.move_case(p_case, 'verification', 'return_to_verification', trim(p_reason), true);
end $$;

-- What waiving a check set aside, for whichever road brings it back.
create or replace function public.restore_waived_check(p_check uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.case_check_requirements set status = 'pending', waived_reason = null, waived_by = null, waived_at = null
   where case_check_id = p_check and status = 'waived' and waived_reason = 'The check was waived';
  update public.candidate_requests set status = 'open', review_note = null, reviewed_by = null, reviewed_at = null
   where case_check_id = p_check and status = 'cancelled' and review_note = 'The check was waived';
  perform public.sync_requirement_counts((select case_id from public.case_checks where id = p_check));
end $$;
revoke execute on function public.restore_waived_check(uuid) from public, anon, authenticated;
