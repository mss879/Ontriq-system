-- =============================================================================
-- 0040_evidence_and_entry_rules.sql
-- Three fixes from the requirements audit (docs/verification/requirements-audit-2026-10-30.md).
-- 1. The Global Sanction report goes in the final report without anyone marking
--    it (spec 4.7, 7, 8). A check that reached a result can't move on without
--    the file; the app refuses a report that couldn't embed it.
-- 2. Clients see only what Ontriq chose to show them (spec 6.4). "In the report"
--    no longer opens a file in the portal: the client gets it inside the
--    released PDF. Repeating groups show only their client-visible columns, and
--    candidate NIC, email and phone are off unless Ontriq turns them on per
--    client. Sharing sensitive evidence takes someone who may read it.
-- 3. Fields carry a stage. Data Entry no longer needs results that don't exist
--    yet (spec 2.1 steps 5 and 6): results and "verified by" are recorded during
--    verification, and a check still can't close without them.
-- Depends on: 0004, 0006, 0007, 0012, 0021, 0038.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Field stages on the built-in check types (src/domain/check-types/builtin.ts)
-- ---------------------------------------------------------------------------
-- Stored versions are updated in place, drafts and published alike, so cases
-- already open benefit too. Published versions are otherwise frozen. This is
-- the one exception, and it's safe: "stage" says when a field is due, and
-- changes no field, value, option or report line.
create function pg_temp.mark_stage(p_fields jsonb, p_keys jsonb) returns jsonb
language plpgsql as $$
declare
  v_out jsonb := '[]'::jsonb;
  f jsonb;
begin
  for f in select * from jsonb_array_elements(p_fields) loop
    if p_keys ? (f ->> 'key') then
      f := f || '{"stage": "verification"}'::jsonb;
    elsif jsonb_typeof(f -> 'fields') = 'array' then
      f := jsonb_set(f, '{fields}', pg_temp.mark_stage(f -> 'fields', p_keys));
    end if;
    v_out := v_out || jsonb_build_array(f);
  end loop;
  return v_out;
end $$;

alter table public.check_type_versions disable trigger check_type_versions_guard;
update public.check_type_versions v
   set schema = jsonb_set(v.schema, '{fields}', pg_temp.mark_stage(v.schema -> 'fields', s.keys))
  from public.check_types t,
       jsonb_each($stages${
  "education": [
    "confirmed_by",
    "confirmation_channel",
    "confirmed_on"
  ],
  "employment": [
    "confirmed_by"
  ],
  "address": [
    "verified_by",
    "gn_name",
    "gn_division",
    "gn_contact",
    "visit_date",
    "visit_notes"
  ],
  "police": [
    "verified_by",
    "oic_name",
    "station_contact"
  ],
  "nic": [
    "validation_source"
  ],
  "reference": [
    "feedback"
  ],
  "sanction": [
    "sanctions_found",
    "details",
    "screening_platform",
    "screened_on"
  ]
}$stages$::jsonb) as s(key, keys)
 where t.id = v.check_type_id and t.key = s.key and jsonb_typeof(v.schema -> 'fields') = 'array';
alter table public.check_type_versions enable trigger check_type_versions_guard;

-- ---------------------------------------------------------------------------
-- What Data Entry owes
-- ---------------------------------------------------------------------------
create or replace function public.field_blank(p_value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_value is null then true
    else case jsonb_typeof(p_value)
      when 'null' then true
      when 'string' then trim(p_value #>> '{}') = ''
      when 'array' then jsonb_array_length(p_value) = 0
      when 'object' then not exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'null' and e.value <> '""'::jsonb)
      else false end
    end
$$;
revoke execute on function public.field_blank(jsonb) from public, anon, authenticated;

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
          if s ->> 'type' = 'date_range' and (public.field_blank(item #> array[s ->> 'key', 'from']) or public.field_blank(item #> array[s ->> 'key', 'to'])) then
            return false;
          end if;
        end loop;
      end loop;
    elsif coalesce((f ->> 'required')::boolean, false) then
      if public.field_blank(v) then return false; end if;
      if f ->> 'type' = 'date_range' and (public.field_blank(v -> 'from') or public.field_blank(v -> 'to')) then return false; end if;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function public.check_entry_complete(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The fixed annexure
-- ---------------------------------------------------------------------------
-- Checks that reached a result and need a fixed annexure with no file behind
-- it. "Unable to verify" and waived checks have no report to attach. Security
-- definer so the answer is right for staff who can't open sensitive evidence.
create or replace function public.case_missing_annexures(p_case uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(k.label order by k.sort), '{}')
    from public.case_checks k
    join public.check_type_versions v on v.id = k.check_type_version_id
   where k.case_id = p_case
     and (auth.uid() is null or (public.is_staff() and public.case_visible(p_case)))
     and k.state in ('completed', 'discrepancy')
     and v.schema #>> '{fixed_annexure,category}' is not null
     and not exists (select 1 from public.documents d
                      where d.case_id = p_case and d.category = v.schema #>> '{fixed_annexure,category}'
                        and d.status in ('uploaded', 'accepted'))
$$;
revoke execute on function public.case_missing_annexures(uuid) from public, anon;
grant execute on function public.case_missing_annexures(uuid) to authenticated, service_role;

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
      if v_n > 0 then raise exception '% check(s) still open', v_n using errcode = '22023'; end if;
      v_n := public.case_outstanding_requirements(p_case, 'verification');
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

create or replace function public.request_report_draft(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
  v_missing text[];
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  -- Seeing reports isn't enough (the Viewer role can): the case owner, someone who moves stages, or an approver.
  if auth.uid() is not null and not (public.has_permission('reports.preview')
       and (public.has_permission('cases.stage.change') or public.has_permission('reports.approve') or coalesce(c.assigned_to = auth.uid(), false))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage <> 'report' then raise exception 'drafts are made once the case reaches the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  v_missing := public.case_missing_annexures(p_case);
  if cardinality(v_missing) > 0 then
    raise exception '% has no report attached; upload it first', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;
  update public.report_versions set status = 'superseded'
   where case_id = p_case and kind = 'draft' and status in ('queued', 'rendering', 'ready', 'failed');
  insert into public.report_versions (org_id, case_id, version, kind, requested_by)
  values (c.org_id, c.id, public.next_report_version(c.id), 'draft', auth.uid())
  returning id into v_id;
  perform public.queue_report_render(v_id);
  perform public.log_case_event(p_case, null, 'report_draft', 'Report draft requested', null, jsonb_build_object('version_id', v_id), false, false);
  return v_id;
end $$;
revoke execute on function public.request_report_draft(uuid) from public, anon;
grant execute on function public.request_report_draft(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What clients see
-- ---------------------------------------------------------------------------
-- Candidate NIC, email and phone join the rules Ontriq sets per client, off by default.
create or replace function public.portal_visibility(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"show_check_progress": true, "show_timeline": true, "show_documents": true,
           "show_results_before_release": false, "show_candidate_progress": true, "show_candidate_details": false,
           "hidden_check_types": []}'::jsonb
         || coalesce((select s.visibility from public.client_settings s where s.client_id = p_client), '{}'::jsonb)
$$;
revoke execute on function public.portal_visibility(uuid) from public, anon, authenticated;

-- A repeating group keeps only its client-visible columns. 0021 returned whole
-- rows, so staff-only contacts inside a shared group reached the portal.
create or replace function public.portal_field_value(p_field jsonb, p_value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when p_field ->> 'type' = 'repeatable_group' and jsonb_typeof(p_value) = 'array' then coalesce((
      select jsonb_agg(r.cols order by r.n)
        from (select i.n, (select jsonb_object_agg(s ->> 'key', i.item -> (s ->> 'key'))
                             from jsonb_array_elements(coalesce(p_field -> 'fields', '[]'::jsonb)) s
                            where coalesce((s -> 'visibility' ->> 'client')::boolean, false) and i.item ? (s ->> 'key')) as cols
                from jsonb_array_elements(p_value) with ordinality as i(item, n)) r
       where r.cols is not null), '[]'::jsonb)
    else p_value end
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
       where r.case_id = c.id and r.client_visible and r.stage = 'documents' and r.status <> 'waived'), '[]'::jsonb),
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

-- "In the report" no longer means "the client can open it". Files reach the
-- portal only when Ontriq shares them, or when the client uploaded them.
drop policy documents_select_client on public.documents;
create policy documents_select_client on public.documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_client())
         and client_id = (select public.client_id_of_user())
         and (visibility = 'client' and status in ('uploaded', 'accepted')
              or uploaded_by_kind = 'client' and status in ('uploaded', 'accepted', 'rejected'))
         and coalesce(((select public.portal_my_visibility()) ->> 'show_documents')::boolean, true)
         and public.portal_case_visible(case_id));

-- Sharing sensitive evidence is a deliberate act by someone allowed to read it.
create or replace function public.set_document_visibility(p_document uuid, p_visibility text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('documents.manage_visibility') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_visibility not in ('internal', 'client', 'report') then raise exception 'unknown visibility' using errcode = '22023'; end if;
  if p_visibility = 'client' and d.sensitive and auth.uid() is not null and not public.has_permission('documents.read_sensitive') then
    raise exception 'only someone who can open sensitive evidence can share it' using errcode = '42501';
  end if;
  update public.documents set visibility = p_visibility where id = p_document;
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_visibility', d.filename || ' is now ' || p_visibility, null,
    jsonb_build_object('document_id', d.id, 'visibility', p_visibility), false, false);
end $$;
revoke execute on function public.set_document_visibility(uuid, text) from public, anon;
grant execute on function public.set_document_visibility(uuid, text) to authenticated, service_role;
