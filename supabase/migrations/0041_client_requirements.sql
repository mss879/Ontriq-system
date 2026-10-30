-- =============================================================================
-- 0041_client_requirements.sql
-- The rest of the requirements audit (docs/verification/requirements-audit-2026-10-30.md,
-- gaps 4 to 21, and question 145). See docs/features/0041-client-requirements.md.
-- Evidence per employer or referee, a contact log, questions to the client,
-- the full status list with status updates, report recipients that limit
-- access, hiding a case, adding a check to an open case, findings that always
-- print, reports with pending checks, and candidates filling in referee and
-- employer rows.
-- Depends on: 0006, 0007, 0008, 0010, 0011, 0012, 0021, 0028, 0038, 0040.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Which record a file belongs to (spec 4.2, 4.6): "employers.0", "referees.1"
-- ---------------------------------------------------------------------------
alter table public.documents add column record_key text check (record_key ~ '^[a-z][a-z0-9_]*\.[0-9]+$');

create or replace function public.set_document_record(p_document uuid, p_record text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.documents set record_key = nullif(trim(p_record), '') where id = p_document;
end $$;
revoke execute on function public.set_document_record(uuid, text) from public, anon;
grant execute on function public.set_document_record(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Contact log (spec 4.6, the flowchart's "call the candidate")
-- ---------------------------------------------------------------------------
alter table public.communications
  add column case_check_id uuid references public.case_checks (id) on delete set null,
  add column record_key text,
  add column outcome text;
create index communications_check_idx on public.communications (case_check_id);

create or replace function public.log_contact(p_case uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_check uuid := nullif(p ->> 'check_id', '')::uuid;
  v_who text := nullif(trim(p ->> 'counterparty'), '');
  v_channel text := p ->> 'channel';
  v_outcome text := nullif(trim(p ->> 'outcome'), '');
  v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and (public.has_permission('cases.update') or public.has_permission('checks.verify'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_who is null then raise exception 'say who you spoke to' using errcode = '22023'; end if;
  if v_channel not in ('phone', 'email', 'whatsapp', 'sms', 'letter', 'visit') then raise exception 'choose how you contacted them' using errcode = '22023'; end if;
  if v_check is not null and not exists (select 1 from public.case_checks where id = v_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  insert into public.communications (org_id, case_id, client_id, case_check_id, record_key, channel, direction, counterparty, outcome, body, created_by)
  values (c.org_id, p_case, c.client_id, v_check, nullif(p ->> 'record_key', ''), v_channel,
          case when p ->> 'direction' = 'inbound' then 'inbound' else 'outbound' end, left(v_who, 200), left(v_outcome, 100),
          left(coalesce(trim(p ->> 'body'), ''), 4000), auth.uid())
  returning id into v_id;
  perform public.log_case_event(p_case, v_check, 'contact_logged', 'Contact logged: ' || left(v_who, 120), v_outcome,
    jsonb_build_object('communication_id', v_id, 'channel', v_channel), false, false);
  return v_id;
end $$;
revoke execute on function public.log_contact(uuid, jsonb) from public, anon;
grant execute on function public.log_contact(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Questions to the client (spec 6.1, 6.3): information, not only documents
-- ---------------------------------------------------------------------------
create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete set null,
  question text not null check (length(question) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer text,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_requests_org_idx on public.client_requests (org_id, status);
create index client_requests_case_idx on public.client_requests (case_id, created_at);
create index client_requests_check_idx on public.client_requests (case_check_id);
create index client_requests_answered_by_idx on public.client_requests (answered_by);
create index client_requests_created_by_idx on public.client_requests (created_by);
create trigger a_set_org_id before insert on public.client_requests
  for each row execute function public.set_org_id();
create trigger client_requests_updated_at before update on public.client_requests
  for each row execute function public.set_updated_at();
select public.attach_audit('public.client_requests');
alter table public.client_requests enable row level security;
create policy client_requests_select on public.client_requests for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and public.case_visible(case_id));
revoke insert, update, delete, truncate on public.client_requests from anon, authenticated;
alter publication supabase_realtime add table public.client_requests;

create or replace function public.create_client_request(p_case uuid, p_check uuid, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_q text := trim(coalesce(p_question, ''));
  v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if v_q = '' then raise exception 'write the question' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  insert into public.client_requests (org_id, case_id, case_check_id, question, created_by)
  values (c.org_id, p_case, p_check, left(v_q, 2000), auth.uid())
  returning id into v_id;
  perform public.log_case_event(p_case, p_check, 'information_requested', 'Ontriq asked for information', v_q,
    jsonb_build_object('request_id', v_id), true, false);
  perform public.notify_client_users(p_case, 'portal.information_needed', c.reference || ': Ontriq needs some information', left(v_q, 300));
  perform public.recompute_case(p_case);
  return v_id;
end $$;
revoke execute on function public.create_client_request(uuid, uuid, text) from public, anon;
grant execute on function public.create_client_request(uuid, uuid, text) to authenticated, service_role;

create or replace function public.close_client_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.client_requests;
begin
  select * into q from public.client_requests where id = p_request for update;
  if q.id is null or not public.case_visible(q.case_id) then raise exception 'question not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.client_requests set status = 'closed' where id = p_request;
  perform public.recompute_case(q.case_id);
end $$;
revoke execute on function public.close_client_request(uuid) from public, anon;
grant execute on function public.close_client_request(uuid) to authenticated, service_role;

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
  if v_a = '' then raise exception 'write an answer first' using errcode = '22023'; end if;
  update public.client_requests set status = 'answered', answer = left(v_a, 4000), answered_by = auth.uid(), answered_at = now() where id = p_request;
  perform public.log_case_event(c.id, q.case_check_id, 'information_received', 'The client answered a question', left(v_a, 500),
    jsonb_build_object('request_id', q.id), true, false);
  perform public.notify_case_owner(c.id, 'client.answer', 'The client answered your question', c.reference);
  perform public.recompute_case(c.id);
end $$;
revoke execute on function public.portal_answer_request(uuid, text) from public, anon;
grant execute on function public.portal_answer_request(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The full status list (spec 6.2)
-- ---------------------------------------------------------------------------
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
  v_to_review boolean;
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
    into v_pending_info;
  v_missing := public.case_outstanding_requirements(p_case, 'documents');
  select exists (select 1 from public.documents d where d.case_id = p_case and d.status = 'uploaded') into v_to_review;
  select exists (select 1 from public.report_versions v where v.case_id = p_case and v.kind = 'final' and v.status = 'ready') into v_final_ready;

  v_status := case when c.on_hold then 'on_hold' else case c.stage
    when 'intake' then 'case_received'
    when 'documents' then case when c.returned_at is not null then 'returned_for_correction'
                               when v_pending_info then 'pending_information'
                               when v_missing = 0 and v_to_review then 'document_review'
                               else 'documents_pending' end
    when 'pre_qc' then 'pre_qc_in_progress'
    when 'data_entry' then case when v_pending_info then 'pending_information' else 'data_entry_in_progress' end
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
revoke execute on function public.recompute_case(uuid) from public, anon, authenticated;

-- Keep the status current when something other than a stage move changes it.
create or replace function public.case_status_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_case(new.case_id);
  return null;
end $$;
revoke execute on function public.case_status_refresh() from public, anon, authenticated;
create trigger documents_status_refresh after insert or update of status on public.documents
  for each row execute function public.case_status_refresh();
create trigger report_versions_status_refresh after update of status on public.report_versions
  for each row execute function public.case_status_refresh();

create or replace function public.cases_hold_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_case(new.id);
  return null;
end $$;
revoke execute on function public.cases_hold_refresh() from public, anon, authenticated;
create trigger cases_hold_refresh after update of on_hold on public.cases
  for each row when (old.on_hold is distinct from new.on_hold) execute function public.cases_hold_refresh();

-- Clients see the spec's own wording by default. Settings -> Workflow changes it.
update public.client_status_catalog set client_label = internal_label;

-- ---------------------------------------------------------------------------
-- Status updates for clients (spec 6.3), on by default per client
-- ---------------------------------------------------------------------------
create or replace function public.case_events_notify_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_users uuid[];
begin
  if not new.visible_to_client then return null; end if;
  select * into c from public.cases where id = new.case_id;
  if c.id is null then return null; end if;
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
  elsif new.kind in ('stage_changed', 'hold', 'resumed')
        and coalesce((select (s.portal ->> 'status_updates')::boolean from public.client_settings s where s.client_id = c.client_id), true) then
    perform public.notify_client_users(c.id, 'portal.case_status',
      c.reference || ': ' || case new.kind when 'hold' then 'on hold' when 'resumed' then 'resumed'
                                           else lower(public.portal_stage_label((new.data ->> 'to')::public.case_stage)) end,
      c.candidate_name);
  end if;
  return null;
end $$;
revoke execute on function public.case_events_notify_client() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Report recipients limit access (spec 2.1 step 9)
-- ---------------------------------------------------------------------------
-- No recipients chosen means the whole client company, as before.
create or replace function public.report_open_to_caller(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.report_recipients r where r.report_version_id = p_version and r.user_id is not null)
      or exists (select 1 from public.report_recipients r where r.report_version_id = p_version and r.user_id = auth.uid())
$$;
revoke execute on function public.report_open_to_caller(uuid) from public, anon;
grant execute on function public.report_open_to_caller(uuid) to authenticated, service_role;

create or replace function public.report_download(p_version uuid, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
  c public.cases;
  v_who text;
begin
  select * into v from public.report_versions where id = p_version;
  if v.id is null or v.storage_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
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
  return jsonb_build_object('bucket', 'reports', 'path', v.storage_path,
    'filename', c.reference || case v.kind when 'draft' then '-DRAFT-v' || v.version else '' end || '.pdf');
end $$;
revoke execute on function public.report_download(uuid, text) from public, anon;
grant execute on function public.report_download(uuid, text) to authenticated, service_role;

create or replace function public.portal_report(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.portal_case_visible(p_case) then return null; end if;
  return (select jsonb_build_object('version_id', v.id, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256,
                                    'page_count', v.page_count, 'final_result', v.final_result)
            from public.report_versions v where v.case_id = p_case and v.status = 'released' and public.report_open_to_caller(v.id)
           order by v.version desc limit 1);
end $$;
revoke execute on function public.portal_report(uuid) from public, anon;
grant execute on function public.portal_report(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Hiding a case from the portal (spec 6.4)
-- ---------------------------------------------------------------------------
create or replace function public.set_case_client_visible(p_case uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('documents.manage_visibility') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.cases set client_visible = p_visible where id = p_case;
  perform public.log_case_event(p_case, null, 'client_visibility', case when p_visible then 'Shown in the client portal' else 'Hidden from the client portal' end,
    null, jsonb_build_object('visible', p_visible), false, false);
end $$;
revoke execute on function public.set_case_client_visible(uuid, boolean) from public, anon;
grant execute on function public.set_case_client_visible(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Adding a check to an open case (the flowchart's O/L, A/L and degree records)
-- ---------------------------------------------------------------------------
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
  if exists (select 1 from public.case_checks where case_id = p_case and label = v_label) then
    raise exception 'this case already has a check called %', v_label using errcode = '22023';
  end if;
  select coalesce(max(sort), 0) + 10 into v_sort from public.case_checks where case_id = p_case;
  v_days := coalesce((v_schema ->> 'sla_days')::int, 5);
  insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort, due_at, state, started_at)
  values (c.org_id, p_case, t.id, t.current_version_id, left(v_label, 120), v_sort, public.add_working_days(now(), v_days),
          case when c.stage = 'verification' then 'in_progress'::public.check_state else 'not_started'::public.check_state end,
          case when c.stage = 'verification' then now() end)
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
             jsonb_build_object('check_type_id', t.id, 'key', t.key, 'name', t.name, 'version_id', t.current_version_id, 'unit_price', v_price)))
     where id = p_case;
  end if;
  perform public.log_case_event(p_case, v_id, 'check_added', left(v_label, 120) || ' added', null, jsonb_build_object('check_type', t.key), true, false);
  perform public.recompute_case(p_case);
  return v_id;
end $$;
revoke execute on function public.add_case_check(uuid, uuid, text) from public, anon;
grant execute on function public.add_case_check(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A finding always prints; a report may go out with pending checks
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
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or (auth.uid() is not null and not public.case_visible(k.case_id)) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  v_manager := auth.uid() is null or public.has_permission('cases.stage.change') or public.has_permission('cases.assign');
  if auth.uid() is not null and not (public.has_permission('checks.verify') and (coalesce(k.assigned_to = auth.uid(), false) or coalesce(c.assigned_to = auth.uid(), false) or v_manager)) then
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
    -- Spec 8: the report states the finding. The note for the client is what prints.
    if p_state in ('discrepancy', 'unable_to_verify') and coalesce(trim(coalesce(p_client_note, k.client_note)), '') = '' then
      raise exception 'write the finding for the report' using errcode = '22023';
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

-- A current job or address has a start and no end yet (spec 4.2, 4.3).
create or replace function public.range_complete(p_value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select not public.field_blank(p_value -> 'from')
     and (not public.field_blank(p_value -> 'to') or coalesce((p_value ->> 'present')::boolean, false))
$$;
revoke execute on function public.range_complete(jsonb) from public, anon, authenticated;

-- Are the required Data Entry fields filled? The stored values already passed
-- the form's format rules (saveCheckValues refuses anything invalid), so this
-- only looks for gaps. Mirrors "entry" mode in src/domain/check-types/validate.ts.
create or replace function public.check_entry_complete(p_schema jsonb, p_values jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  s jsonb;
  v jsonb;
  item jsonb;
  items jsonb;
begin
  for f in select * from jsonb_array_elements(coalesce(p_schema -> 'fields', '[]'::jsonb)) loop
    continue when coalesce(f ->> 'stage', 'data_entry') = 'verification';
    v := p_values -> (f ->> 'key');
    if f ->> 'type' = 'repeatable_group' then
      items := case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
      if jsonb_array_length(items) < coalesce((f #>> '{group,min}')::int, case when coalesce((f ->> 'required')::boolean, false) then 1 else 0 end) then
        return false;
      end if;
      for item in select * from jsonb_array_elements(items) loop
        for s in select * from jsonb_array_elements(coalesce(f -> 'fields', '[]'::jsonb)) loop
          continue when coalesce(s ->> 'stage', 'data_entry') = 'verification' or not coalesce((s ->> 'required')::boolean, false);
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
revoke execute on function public.check_entry_complete(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Candidates: police reports, referee and employer rows, reminders to the end
-- ---------------------------------------------------------------------------
create or replace function public.candidate_providable(p_category text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_category not in ('field_verification', 'sanction_report', 'consent_form')
$$;
revoke execute on function public.candidate_providable(text, text) from public, anon;
grant execute on function public.candidate_providable(text, text) to authenticated, service_role;

create or replace function public.candidate_reminder_candidates() returns table (
  link_id uuid, case_id uuid, org_id uuid, reference text, language text, sent_at timestamptz,
  reminders_sent int, last_reminded_at timestamptz, escalated_at timestamptz, expires_at timestamptz,
  candidate_name text, candidate_email text, candidate_phone text, client_name text,
  missing_documents int, open_requests int, consent_missing boolean
)
language sql stable security definer set search_path = '' as $$
  select l.id, c.id, c.org_id, c.reference, l.language, l.sent_at, l.reminders_sent, l.last_reminded_at, l.escalated_at, l.expires_at,
         cd.full_name, cd.email, cd.phone, cl.name,
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
revoke execute on function public.candidate_reminder_candidates() from public, anon, authenticated;

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
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if v_kind not in ('document', 'field', 'question') then raise exception 'choose what to ask for' using errcode = '22023'; end if;
  if v_check is not null and not exists (select 1 from public.case_checks where id = v_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;

  if v_kind = 'document' then
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
         set status = 'pending', min_count = greatest(min_count, received_count + 1), requested_note = nullif(trim(p ->> 'note'), ''),
             requested_at = now(), requested_by = auth.uid(), waived_reason = null, waived_by = null, waived_at = null
       where id = v_req;
    else
      insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, min_count, status, client_visible,
                                                  requested_note, requested_at, requested_by)
      values (c.org_id, p_case, v_check, p ->> 'category', left(v_title, 200), 1, 'pending', false,
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
                                              'options', coalesce(s -> 'options', '[]'::jsonb)) order by n)
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
revoke execute on function public.create_candidate_request(uuid, jsonb) from public, anon;
grant execute on function public.create_candidate_request(uuid, jsonb) to authenticated, service_role;

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
  if q.field_type = 'repeatable_group' then
    if coalesce(jsonb_typeof(p_answer -> 'rows'), '') <> 'array' or jsonb_array_length(p_answer -> 'rows') = 0 then
      raise exception 'write an answer first' using errcode = '22023';
    end if;
  elsif p_answer is null or coalesce(trim(p_answer ->> 'value'), '') = '' then
    raise exception 'write an answer first' using errcode = '22023';
  end if;
  if length(p_answer::text) > 20000 then raise exception 'that answer is too long' using errcode = '22023'; end if;
  update public.candidate_requests set status = 'answered', answer = p_answer, answered_at = now() where id = q.id;
  perform public.log_case_event(v_case, q.case_check_id, 'request_answered', 'Answered: ' || q.title, null,
    jsonb_build_object('request_id', q.id), false, true);
  perform public.notify_case_owner(v_case, 'candidate.answer', 'Candidate answered: ' || q.title,
    (select reference from public.cases where id = v_case));
end $$;
revoke execute on function public.candidate_answer_request(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The portal: what is waiting on the client, at any stage
-- ---------------------------------------------------------------------------
create or replace function public.portal_pending_slots(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from public.case_check_requirements r
            join public.cases c on c.id = r.case_id
           where r.case_id = p_case and c.process_type = 'client_supplied'
             and r.client_visible and r.status = 'pending' and r.min_count > r.received_count)
       + (select count(*)::int from public.client_requests q where q.case_id = p_case and q.status = 'open')
$$;
revoke execute on function public.portal_pending_slots(uuid) from public, anon, authenticated;

create or replace function public.portal_case_row(c public.cases) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'reference', c.reference, 'candidate_name', c.candidate_name, 'position_title', c.position_title,
    'department', c.department, 'client_reference', c.client_reference, 'package_name', c.package_snapshot ->> 'name',
    'stage', c.stage, 'stage_label', public.portal_stage_label(c.stage),
    'status_label', coalesce((select s.client_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = c.status_key),
                             public.portal_stage_label(c.stage)),
    'priority', c.priority, 'on_hold', c.on_hold, 'checks_total', c.checks_total, 'checks_done', c.checks_done,
    'received_at', c.received_at, 'due_at', c.due_at, 'released_at', c.released_at, 'cancelled_at', c.cancelled_at,
    'process_type', c.process_type, 'created_via', c.created_via,
    'needs_documents', case when c.stage not in ('released', 'cancelled') then public.portal_pending_slots(c.id) else 0 end,
    'final_result', case when c.stage = 'released' then c.final_result end)
$$;
revoke execute on function public.portal_case_row(public.cases) from public, anon, authenticated;

create or replace function public.portal_cases(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_status text := coalesce(nullif(p ->> 'status', ''), 'all');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 25), 1), 100);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_out jsonb;
begin
  with matched as (
    select c.id, c.due_at, c.received_at from public.cases c
     where c.client_id = v_client and c.client_visible
       and (v_q is null or c.reference ilike '%' || v_q || '%' or c.candidate_name ilike '%' || v_q || '%'
            or c.client_reference ilike '%' || v_q || '%' or c.position_title ilike '%' || v_q || '%')
       and case v_status
             when 'action' then c.stage not in ('released', 'cancelled') and public.portal_pending_slots(c.id) > 0
             when 'active' then c.stage not in ('released', 'cancelled')
             when 'released' then c.released_at is not null
             when 'cancelled' then c.stage = 'cancelled'
             else true end
  ), page as (
    select m.id from matched m
     order by case when p ->> 'sort' = 'due' then m.due_at end asc nulls last, m.received_at desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(public.portal_case_row(c) order by
                        case when p ->> 'sort' = 'due' then c.due_at end asc nulls last, c.received_at desc)
                        from public.cases c where c.id in (select id from page)), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke execute on function public.portal_cases(jsonb) from public, anon;
grant execute on function public.portal_cases(jsonb) to authenticated, service_role;

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
       'overdue', (select count(*) from mine where stage not in ('released', 'cancelled') and due_at < now())),
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
revoke execute on function public.portal_dashboard() from public, anon;
grant execute on function public.portal_dashboard() to authenticated, service_role;

-- Option labels rather than stored keys ("Degree", not "degree").
create or replace function public.portal_scalar_value(p_field jsonb, p_value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_field ->> 'type' = 'select'
              then coalesce((select o -> 'label' from jsonb_array_elements(coalesce(p_field -> 'options', '[]'::jsonb)) o
                              where o ->> 'value' = p_value #>> '{}' limit 1), p_value)
              else p_value end
$$;
revoke execute on function public.portal_scalar_value(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.portal_field_value(p_field jsonb, p_value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when p_field ->> 'type' = 'repeatable_group' and jsonb_typeof(p_value) = 'array' then coalesce((
      select jsonb_agg(r.cols order by r.n)
        from (select i.n, (select jsonb_object_agg(s ->> 'key', public.portal_scalar_value(s, i.item -> (s ->> 'key')))
                             from jsonb_array_elements(coalesce(p_field -> 'fields', '[]'::jsonb)) s
                            where coalesce((s -> 'visibility' ->> 'client')::boolean, false) and i.item ? (s ->> 'key')) as cols
                from jsonb_array_elements(p_value) with ordinality as i(item, n)) r
       where r.cols is not null), '[]'::jsonb)
    else public.portal_scalar_value(p_field, p_value) end
$$;
revoke execute on function public.portal_field_value(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.portal_case_detail(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  c public.cases;
  v_vis jsonb;
  v_hidden uuid[];
  v_results boolean;
  v_contact boolean;
  v_can_upload boolean := public.has_permission('portal.cases.create');
  v_out jsonb;
begin
  select * into c from public.cases where id = p_case and client_id = v_client and client_visible;
  if c.id is null then raise exception 'case not found' using errcode = 'P0002'; end if;
  v_vis := public.portal_visibility(v_client);
  v_hidden := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_vis -> 'hidden_check_types') x), '{}');
  v_results := c.stage = 'released' or coalesce((v_vis ->> 'show_results_before_release')::boolean, false);
  v_contact := coalesce((v_vis ->> 'show_candidate_details')::boolean, false);

  select jsonb_build_object(
    'case', public.portal_case_row(c) || jsonb_build_object(
              'candidate', (select jsonb_build_object('full_name', cd.full_name,
                                                 'nic', case when v_contact then cd.nic end,
                                                 'email', case when v_contact then cd.email end,
                                                 'phone', case when v_contact then cd.phone end)
                              from public.candidates cd where cd.id = c.candidate_id),
              'instructions', c.instructions,
              'package', jsonb_build_object('name', c.package_snapshot ->> 'name', 'code', c.package_snapshot ->> 'code',
                                            'tat_days', c.package_snapshot -> 'tat_days'),
              'hold_label', case when c.on_hold then 'On hold' end,
              'results_visible', v_results),
    'visibility', v_vis,
    'can_upload', v_can_upload and c.stage in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification'),
    'checks', case when coalesce((v_vis ->> 'show_check_progress')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', k.label, 'key', ct.key, 'icon', ct.icon,
               'state', case when k.state in ('completed', 'discrepancy', 'unable_to_verify') then 'done'
                             when k.state = 'waived' then 'not_required'
                             when k.state = 'pending_info' then 'needs_information'
                             when k.state = 'not_started' then 'not_started'
                             else 'in_progress' end,
               'completed_at', case when k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then k.completed_at end,
               'result_tone', case when v_results then k.result_tone end,
               'result_label', case when v_results then (
                   select o ->> 'label' from public.check_type_versions v, jsonb_array_elements(coalesce(v.schema -> 'result' -> 'options', '[]'::jsonb)) o
                    where v.id = k.check_type_version_id and o ->> 'key' = k.result) end,
               'client_note', case when v_results then k.client_note end,
               'fields', case when v_results then coalesce((
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
               'requested_note', r.requested_note, 'requested_at', r.requested_at)
             order by coalesce(k.sort, 0), dc.sort, r.created_at)
        from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
        left join public.document_categories dc on dc.org_id = r.org_id and dc.key = r.category
       where r.case_id = c.id and r.client_visible and r.status <> 'waived'), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'status', q.status, 'answer', q.answer,
                                          'check_label', k.label, 'asked_at', q.created_at, 'answered_at', q.answered_at)
             order by q.created_at)
        from public.client_requests q
        left join public.case_checks k on k.id = q.case_check_id
       where q.case_id = c.id and q.status <> 'closed'), '[]'::jsonb),
    'can_answer', public.has_permission('portal.cases.create') and c.stage not in ('released', 'cancelled'),
    'documents', case when coalesce((v_vis ->> 'show_documents')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'filename', d.filename, 'category', d.category, 'category_name', dc.name, 'label', d.label,
               'from', d.uploaded_by_kind, 'status', d.status, 'created_at', d.created_at, 'mime', d.mime, 'size', d.size_bytes,
               'rejection_reason', case when d.uploaded_by_kind = 'client' then d.rejection_reason end)
             order by d.created_at desc)
        from public.documents d
        left join public.document_categories dc on dc.org_id = d.org_id and dc.key = d.category
       where d.case_id = c.id
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
                   when 'stage_changed' then public.portal_stage_label((ev.data ->> 'to')::public.case_stage)
                   when 'hold' then 'Put on hold'
                   when 'resumed' then 'Resumed'
                   when 'check_state' then coalesce(k.label, 'A check') || case when ev.data ->> 'to' = 'waived' then ' is not required' else ' completed' end
                   else ev.title end as title,
                 case when ev.kind in ('document_requested', 'document_rejected') then ev.body end as body
            from public.case_events ev
            left join public.case_checks k on k.id = ev.case_check_id
           where ev.case_id = c.id and ev.visible_to_client and ev.kind <> 'returned'
             and not (ev.kind = 'check_state' and k.check_type_id = any (v_hidden))
           order by ev.at desc limit 80) e), '[]'::jsonb) else '[]'::jsonb end,
    'report', jsonb_build_object(
      'status', case when c.stage = 'released' then 'released' when c.stage in ('report', 'approval') then 'in_preparation'
                     when c.stage = 'cancelled' then 'cancelled' else 'not_ready' end,
      'released_at', c.released_at)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.portal_case_detail(uuid) from public, anon;
grant execute on function public.portal_case_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- New versions of the built-in check types (src/domain/check-types/builtin.ts)
-- ---------------------------------------------------------------------------
-- Clients can send every document the flowchart lists for them, spec 8's
-- required fields print, and candidates can say what type of job each one was.
-- These are published as new versions: cases keep the version they started on.
create function pg_temp.touch_field(f jsonb, p_report jsonb, p_candidate jsonb) returns jsonb
language plpgsql as $$
declare
  v_subs jsonb;
begin
  if p_report ? (f ->> 'key') then
    f := jsonb_set(f, '{visibility}', coalesce(f -> 'visibility', '{}'::jsonb) || '{"report": true}'::jsonb);
  end if;
  if p_candidate ? (f ->> 'key') then
    f := f || jsonb_build_object('fill_by', coalesce(f -> 'fill_by', '["staff"]'::jsonb) || '["candidate"]'::jsonb);
  end if;
  if jsonb_typeof(f -> 'fields') = 'array' then
    select coalesce(jsonb_agg(pg_temp.touch_field(s, p_report, p_candidate) order by n), '[]'::jsonb)
      into v_subs from jsonb_array_elements(f -> 'fields') with ordinality as a(s, n);
    f := jsonb_set(f, '{fields}', v_subs);
  end if;
  return f;
end $$;

do $delta$
declare
  d jsonb := $json${
  "documents_client_visible": {
    "education": [
      "transcript"
    ],
    "employment": [
      "resignation_letter"
    ],
    "address": [
      "gn_certificate"
    ],
    "police": [
      "police_report"
    ]
  },
  "report_fields": {
    "address": [
      "gn_contact"
    ],
    "police": [
      "station_contact"
    ],
    "reference": [
      "contact_number",
      "email"
    ]
  },
  "candidate_fields": {
    "employment": [
      "employment_type"
    ]
  }
}$json$::jsonb;
  t record;
  v_schema jsonb;
  v_fields jsonb;
  v_id uuid;
begin
  for t in select ct.id, ct.org_id, ct.key, ct.current_version_id from public.check_types ct
            where ct.current_version_id is not null
              and (d -> 'documents_client_visible' ? ct.key or d -> 'report_fields' ? ct.key or d -> 'candidate_fields' ? ct.key) loop
    select schema into v_schema from public.check_type_versions where id = t.current_version_id;
    select coalesce(jsonb_agg(case when coalesce(d -> 'documents_client_visible' -> t.key, '[]'::jsonb) ? (x ->> 'category')
                                   then x || '{"client_visible": true}'::jsonb else x end order by n), '[]'::jsonb)
      into v_fields from jsonb_array_elements(coalesce(v_schema -> 'documents', '[]'::jsonb)) with ordinality as a(x, n);
    v_schema := jsonb_set(v_schema, '{documents}', v_fields);
    select coalesce(jsonb_agg(pg_temp.touch_field(f, coalesce(d -> 'report_fields' -> t.key, '[]'::jsonb), coalesce(d -> 'candidate_fields' -> t.key, '[]'::jsonb)) order by n), '[]'::jsonb)
      into v_fields from jsonb_array_elements(v_schema -> 'fields') with ordinality as a(f, n);
    v_schema := jsonb_set(v_schema, '{fields}', v_fields);
    insert into public.check_type_versions (org_id, check_type_id, version, schema, notes, published_at)
    values (t.org_id, t.id, (select coalesce(max(version), 0) + 1 from public.check_type_versions where check_type_id = t.id), v_schema,
            'Client can send more documents; required contacts print in the report', now())
    returning id into v_id;
    update public.check_types set current_version_id = v_id where id = t.id;
  end loop;
end $delta$;

-- Slots on open cases follow the same rule.
update public.case_check_requirements r set client_visible = true
  from public.cases c
 where c.id = r.case_id and c.stage not in ('released', 'cancelled')
   and r.category in ('transcript', 'resignation_letter', 'gn_certificate', 'police_report');
