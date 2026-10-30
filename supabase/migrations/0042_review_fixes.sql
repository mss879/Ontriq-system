-- =============================================================================
-- 0042_review_fixes.sql
-- Fixes from an independent re-audit of the code against the client's documents.
-- See docs/features/0042-review-fixes.md. A route back to verification from the
-- report, evidence in the report by default, the client's feed limited to their
-- own files, recipients limiting results as well as the PDF, unfinished results
-- that can't print as verified, a BGV form slot on client-supplied cases, and
-- due dates that really stop while a case is on hold.
-- Depends on: 0006, 0007, 0008, 0012, 0021, 0040, 0041.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Back to verification from the report (spec 3, flowchart step 9)
-- ---------------------------------------------------------------------------
-- A case returned from approval, or a released report being revised, sits at
-- the report stage with its details locked. This reopens it. Checks sent on
-- pending stay open; p_checks reopens finished ones.
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
  update public.case_checks set state = 'returned', result = null, result_tone = null, completed_at = null
   where case_id = p_case and id = any (coalesce(p_checks, '{}'));
  perform public.move_case(p_case, 'verification', 'return_to_verification', trim(p_reason), true);
end $$;
revoke execute on function public.return_to_verification(uuid, text, uuid[]) from public, anon;
grant execute on function public.return_to_verification(uuid, text, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Evidence reaches the report by default (spec 7, 8.5)
-- ---------------------------------------------------------------------------
alter table public.document_categories add column in_report boolean not null default false;
update public.document_categories set in_report = true
 where key in ('nic_copy', 'education_certificate', 'transcript', 'service_letter', 'resignation_letter',
               'gn_certificate', 'field_verification', 'police_report', 'reference_form');

create or replace function public.documents_report_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'internal'
     and exists (select 1 from public.document_categories dc where dc.org_id = new.org_id and dc.key = new.category and dc.in_report) then
    new.visibility := 'report';
  end if;
  return new;
end $$;
revoke execute on function public.documents_report_default() from public, anon, authenticated;
create trigger documents_report_default before insert on public.documents
  for each row execute function public.documents_report_default();

update public.documents d set visibility = 'report'
  from public.cases c, public.document_categories dc
 where c.id = d.case_id and c.stage not in ('released', 'cancelled')
   and dc.org_id = d.org_id and dc.key = d.category and dc.in_report and d.visibility = 'internal';

-- Finished checks whose required evidence someone took out of the report.
create or replace function public.case_unreported_evidence(p_case uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct k.label), '{}')
    from public.case_checks k
    join public.case_check_requirements r on r.case_check_id = k.id
   where k.case_id = p_case
     and (auth.uid() is null or (public.is_staff() and public.case_visible(p_case)))
     and k.state in ('completed', 'discrepancy') and r.status <> 'waived' and r.min_count > 0
     and not exists (select 1 from public.documents d
                      where d.case_check_id = k.id and d.category = r.category and d.status in ('uploaded', 'accepted')
                        and d.visibility in ('report', 'client'))
$$;
revoke execute on function public.case_unreported_evidence(uuid) from public, anon;
grant execute on function public.case_unreported_evidence(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- File and contact records follow their row when rows move (spec 4.2, 4.6)
-- ---------------------------------------------------------------------------
create or replace function public.remap_check_records(p_check uuid, p_map jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
begin
  select * into k from public.case_checks where id = p_check;
  if k.id is null or not public.case_visible(k.case_id) then raise exception 'check not found' using errcode = 'P0002'; end if;
  if not public.has_permission('cases.update') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.documents set record_key = p_map ->> record_key where case_check_id = p_check and record_key is not null and p_map ? record_key;
  update public.communications set record_key = p_map ->> record_key where case_check_id = p_check and record_key is not null and p_map ? record_key;
end $$;
revoke execute on function public.remap_check_records(uuid, jsonb) from public, anon;
grant execute on function public.remap_check_records(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The flowchart's "BGV form" on client-supplied cases, and consent on the rest
-- ---------------------------------------------------------------------------
create or replace function public.cases_consent_slot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.process_type = 'client_supplied' then
    insert into public.case_check_requirements (org_id, case_id, category, label, description, min_count, stage, client_visible, status)
    values (new.org_id, new.id, 'consent_form', 'BGV form and signed consent', 'The candidate''s completed BGV form with their signed consent.', 1, 'documents', true, 'pending');
  end if;
  return null;
end $$;
revoke execute on function public.cases_consent_slot() from public, anon, authenticated;
create trigger cases_consent_slot after insert on public.cases
  for each row execute function public.cases_consent_slot();

create or replace function public.cases_consent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'pre_qc' and old.stage = 'documents'
     and (new.process_type = 'candidate_collected' or exists (select 1 from public.candidate_links l where l.case_id = new.id))
     and not exists (select 1 from public.consent_forms f where f.case_id = new.id and f.status in ('submitted', 'accepted')) then
    raise exception 'the candidate has not given consent yet; it is needed before Pre-QC' using errcode = '22023';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Status, holds and notifications
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
    into v_pending_info;
  v_missing := public.case_outstanding_requirements(p_case, 'documents');
  select exists (select 1 from public.documents d where d.case_id = p_case and d.status in ('uploaded', 'accepted')) into v_has_files;
  select exists (select 1 from public.report_versions v where v.case_id = p_case and v.kind = 'final' and v.status = 'ready') into v_final_ready;

  v_status := case when c.on_hold then 'on_hold' else case c.stage
    when 'intake' then 'case_received'
    when 'documents' then case when c.returned_at is not null then 'returned_for_correction'
                               when v_pending_info then 'pending_information'
                               when v_missing = 0 and v_has_files then 'document_review'
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
  update public.cases set on_hold = p_hold, hold_reason = case when p_hold then p_reason end, held_at = case when p_hold then now() end,
         due_at = case when not p_hold and c.held_at is not null then due_at + (now() - c.held_at) else due_at end
   where id = p_case;
  perform public.log_case_event(p_case, null, case when p_hold then 'hold' else 'resumed' end,
    case when p_hold then 'Put on hold' else 'Resumed' end, p_reason, '{}'::jsonb, true, false);
end $$;
revoke execute on function public.set_case_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_case_hold(uuid, boolean, text) to authenticated, service_role;

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
  elsif new.kind in ('stage_changed', 'hold', 'resumed', 'returned')
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
revoke execute on function public.case_events_notify_client() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Results that can't mislead (spec 8, 9)
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
    nullif(trim(p_note), ''), jsonb_build_object('from', k.state, 'to', p_state, 'result', v_result), p_state in ('completed', 'waived'), false);
  perform public.recompute_case(k.case_id);
end $$;
revoke execute on function public.set_check_state(uuid, public.check_state, text, text, text) from public, anon;
grant execute on function public.set_check_state(uuid, public.check_state, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What clients see
-- ---------------------------------------------------------------------------
-- Recipients limit the results as well as the PDF.
create or replace function public.portal_results_open(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.report_open_to_caller(v.id) from public.report_versions v
                    where v.case_id = p_case and v.status = 'released' order by v.version desc limit 1), true)
$$;
revoke execute on function public.portal_results_open(uuid) from public, anon;
grant execute on function public.portal_results_open(uuid) to authenticated, service_role;

-- Is this check type hidden from this client? Null means "not tied to a check".
create or replace function public.portal_check_hidden(p_client uuid, p_type uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_type is not null and exists (
    select 1 from jsonb_array_elements_text(public.portal_visibility(p_client) -> 'hidden_check_types') x where x::uuid = p_type)
$$;
revoke execute on function public.portal_check_hidden(uuid, uuid) from public, anon, authenticated;

create or replace function public.portal_pending_slots(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from public.case_check_requirements r
            join public.cases c on c.id = r.case_id
            left join public.case_checks k on k.id = r.case_check_id
           where r.case_id = p_case and c.process_type = 'client_supplied'
             and r.client_visible and r.status = 'pending' and r.min_count > r.received_count
             and not public.portal_check_hidden(c.client_id, k.check_type_id))
       + (select count(*)::int from public.client_requests q
            join public.cases c on c.id = q.case_id
            left join public.case_checks k on k.id = q.case_check_id
           where q.case_id = p_case and q.status = 'open' and not public.portal_check_hidden(c.client_id, k.check_type_id))
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
    'final_result', case when c.stage = 'released' and public.portal_results_open(c.id) then c.final_result end)
$$;
revoke execute on function public.portal_case_row(public.cases) from public, anon, authenticated;

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
  -- Report recipients limit the results too, not only the PDF.
  v_results := (c.stage = 'released' or coalesce((v_vis ->> 'show_results_before_release')::boolean, false)) and public.portal_results_open(c.id);
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
       where r.case_id = c.id and r.client_visible and r.status <> 'waived' and not coalesce(k.check_type_id = any (v_hidden), false)), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'status', q.status, 'answer', q.answer,
                                          'check_label', k.label, 'asked_at', q.created_at, 'answered_at', q.answered_at)
             order by q.created_at)
        from public.client_requests q
        left join public.case_checks k on k.id = q.case_check_id
       where q.case_id = c.id and q.status <> 'closed' and not coalesce(k.check_type_id = any (v_hidden), false)), '[]'::jsonb),
    'can_answer', public.has_permission('portal.cases.create') and c.stage not in ('released', 'cancelled'),
    'documents', case when coalesce((v_vis ->> 'show_documents')::boolean, true) then coalesce((
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
                   when 'stage_changed' then public.portal_stage_label((ev.data ->> 'to')::public.case_stage)
                   when 'hold' then 'Put on hold'
                   when 'resumed' then 'Resumed'
                   when 'check_state' then coalesce(k.label, 'A check') || case when ev.data ->> 'to' = 'waived' then ' is not required' else ' completed' end
                   else ev.title end as title,
                 case when ev.kind in ('document_requested', 'document_rejected') then ev.body end as body
            from public.case_events ev
            left join public.case_checks k on k.id = ev.case_check_id
           where ev.case_id = c.id and ev.visible_to_client and ev.kind <> 'returned'
             and not coalesce(k.check_type_id = any (v_hidden), false)
             -- Their own files only: staff evidence and other people's rejections stay off the feed.
             and not (ev.kind = 'document_uploaded' and coalesce(ev.data ->> 'by', '') <> 'client')
             and not (ev.kind in ('document_accepted', 'document_rejected') and not exists (
                   select 1 from public.documents d where d.id = (ev.data ->> 'document_id')::uuid and d.uploaded_by_kind = 'client'))
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
