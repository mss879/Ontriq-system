-- =============================================================================
-- 0038_security_fixes.sql
-- Fixes from the security review of Phases 3–5:
--  * AI suggestions are visible only to staff who can see the case (or the
--    record) they are about; before, any staff member could read every one,
--    including details extracted from candidates' documents.
--  * Ownership tests treated "no owner" as unknown, so a NOT around them let
--    the check pass: read-only roles could generate and submit report drafts
--    on unowned cases, and officers could change checks that aren't theirs.
--  * Report remarks: an officer may word only the checks (or case) they own.
--  * AI readings and OCR text of documents are for staff only (clients could
--    read the AI's tamper notes about their candidate's files).
--  * Generated PDFs are visible to staff by kind: quotes to those who read
--    quotes, invoices, receipts and credit notes to finance, case documents
--    to staff on the case.
--  * A file's real size is taken from Storage when its upload finishes (the
--    size the browser declared is not trusted); files over 25 MB are refused.
--  * At most 40 AI document readings per case a day; pause budgets for the
--    document AI capabilities.
--  * Erasure: tombstone storage paths stay unique (it failed for cases with
--    several files) and copies of the candidate's name in notifications,
--    emails, pushes, assistant conversations and queued replies are scrubbed.
-- Depends on: 0006, 0007, 0012, 0013, 0014, 0015, 0017, 0018, 0019, 0029, 0030, 0035, 0037.
-- =============================================================================

-- ---------------------------------------------------------------- AI suggestions
create or replace function public.ai_suggestion_visible(p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and case p_entity_type
    when 'case' then public.case_visible(p_entity_id)
    when 'case_check' then coalesce(public.case_visible((select k.case_id from public.case_checks k where k.id = p_entity_id)), false)
    when 'document' then coalesce(public.case_visible((select d.case_id from public.documents d where d.id = p_entity_id)), false)
    when 'org' then public.has_permission('staff.performance.read') or public.has_permission('analytics.read')
    when 'invoice' then public.can_read_invoices()
    when 'payment_slip' then public.can_read_invoices()
    else public.has_permission('ai.configure')
  end
$$;
revoke execute on function public.ai_suggestion_visible(text, uuid) from public, anon;
grant execute on function public.ai_suggestion_visible(text, uuid) to authenticated, service_role;

drop policy if exists ai_suggestions_select on public.ai_suggestions;
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.ai_suggestion_visible(entity_type, entity_id));

-- ---------------------------------------------------------------- documents: AI reading and OCR, staff only
drop policy if exists document_texts_select on public.document_texts;
create policy document_texts_select on public.document_texts for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and exists (select 1 from public.documents d where d.id = document_id));
drop policy if exists document_ai_select on public.document_ai;
create policy document_ai_select on public.document_ai for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and exists (select 1 from public.documents d where d.id = document_id));

-- ---------------------------------------------------------------- generated PDFs by kind
drop policy if exists generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and case kind
           when 'quote' then (select public.can_read_quotes())
           when 'invoice' then (select public.can_read_invoices())
           when 'receipt' then (select public.can_read_invoices())
           when 'credit_note' then (select public.can_read_invoices())
           when 'statement' then (select public.can_read_invoices())
           else case when entity_type = 'case' then public.case_visible(entity_id) else (select public.has_permission('settings.manage')) end
         end);

-- ---------------------------------------------------------------- real file size at upload
create or replace function public.documents_real_size() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_size bigint;
begin
  if new.status = 'uploaded' and old.status = 'pending_upload' then
    select (o.metadata ->> 'size')::bigint into v_size from storage.objects o where o.bucket_id = new.storage_bucket and o.name = new.storage_path;
    if v_size is not null then
      if v_size > 26214400 then raise exception 'files can be up to 25 MB' using errcode = '22023'; end if;
      new.size_bytes := v_size;
    end if;
  end if;
  return new;
end $$;
create trigger documents_real_size before update of status on public.documents
  for each row execute function public.documents_real_size();
revoke execute on function public.documents_real_size() from public, anon, authenticated;

-- ---------------------------------------------------------------- ownership tests that ignore "no owner"
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

create or replace function public.submit_report(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
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
  perform public.move_case(p_case, 'approval', 'submit_report');
end $$;
revoke execute on function public.submit_report(uuid) from public, anon;
grant execute on function public.submit_report(uuid) to authenticated, service_role;

create or replace function public.request_report_draft(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
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
  if not (public.has_permission('qc.post') or public.has_permission('cases.stage.change')
          or (public.has_permission('checks.verify') and (coalesce(k.assigned_to = auth.uid(), false) or coalesce(c.assigned_to = auth.uid(), false)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if c.stage in ('approval', 'released', 'cancelled') then raise exception 'remarks are locked once the report is with the approver' using errcode = '22023'; end if;
  update public.case_checks set client_note = nullif(trim(p_remarks), ''), updated_by = auth.uid() where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'remarks_updated', k.label || ': remarks updated', null, '{}'::jsonb, false, false);
end $$;
revoke execute on function public.set_check_remarks(uuid, text) from public, anon;
grant execute on function public.set_check_remarks(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- AI cost guards
create or replace function public.documents_queue_ai() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'uploaded' and old.status = 'pending_upload' then
    -- At most 40 AI readings per case a day, so a flood of uploads can't run up the AI bill.
    if (select count(*) from public.jobs j join public.documents d on d.id = (j.payload ->> 'document_id')::uuid
         where j.kind = 'ai.classify_document' and d.case_id = new.case_id and j.created_at > now() - interval '1 day') >= 40 then
      insert into public.system_events (org_id, kind, severity, message, context, fingerprint)
      values (new.org_id, 'ai.case_cap', 'warning', 'AI document reading paused for a case: 40 uploads in a day',
              jsonb_build_object('case_id', new.case_id), 'ai.case_cap:' || new.case_id || ':' || current_date)
      on conflict (org_id, fingerprint) where fingerprint is not null do update set occurrences = public.system_events.occurrences + 1, last_at = now();
      return null;
    end if;
    perform public.enqueue_job('ai.classify_document', jsonb_build_object('document_id', new.id), 'ai.classify_document:' || new.id,
                               now(), null, 'document', new.id, null, new.org_id, null);
  end if;
  return null;
end $$;
revoke execute on function public.documents_queue_ai() from public, anon, authenticated;

insert into public.ai_budgets (org_id, capability, daily_usd, monthly_usd, action)
select o.id, x.capability, x.daily, x.monthly, 'pause'
  from public.orgs o
  cross join (values ('document.classify', 5::numeric, 80::numeric), ('document.extract', 15::numeric, 250::numeric)) as x(capability, daily, monthly)
on conflict (org_id, capability) do nothing;

-- ---------------------------------------------------------------- erasure
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
    select jsonb_build_object('bucket', 'documents', 'path', g.storage_path) from public.generated_documents g
     where g.id = any (v_generated) and g.storage_path is not null
  ) x;

  -- Scrub.
  update public.case_checks set values = '{}'::jsonb, values_valid = false, client_note = null where id = any (v_checks);
  delete from public.document_texts where document_id = any (v_docs);
  delete from public.document_ai where document_id = any (v_docs);
  update public.documents set filename = 'erased', storage_path = 'erased/' || id where id = any (v_docs);
  update public.report_versions set snapshot = '{}'::jsonb, storage_path = null where id = any (v_reports);
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
         hold_reason = null, return_note = null, instructions = null, cancel_reason = null,
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
      or (table_name = 'consent_forms' and row_id = any (select unnest(v_consents)::text));

  perform public.log_case_event(c.id, null, 'erased', 'Personal data erased', null,
    jsonb_build_object('by', case when auth.uid() is null then 'retention' else 'super_admin' end), false, false);
  insert into public.system_events (org_id, kind, severity, message, context)
  values (c.org_id, 'data.erased', 'info', 'Personal data erased for case ' || c.reference,
          jsonb_build_object('case_id', c.id, 'reference', c.reference, 'by', auth.uid(), 'files', jsonb_array_length(v_objects),
                             'source', case when auth.uid() is null then 'retention' else 'request' end));
  return jsonb_build_object('case_id', c.id, 'reference', c.reference, 'objects', v_objects);
end $$;
revoke execute on function public.erase_case(uuid, text) from public, anon;
grant execute on function public.erase_case(uuid, text) to authenticated, service_role;
