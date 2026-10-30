-- =============================================================================
-- 0035_retention_erasure.sql
-- Feature: data retention and erasure (plan §14). A finished case (released
-- or cancelled) can have its candidate's personal data erased: on request by
-- the Super Admin, or automatically once the client's retention period has
-- passed since the case closed (retention.purge job, nightly). Erasure scrubs
-- names, numbers, answers, messages, extracted text and AI suggestions,
-- redacts the matching audit entries, and hands back the stored files for the
-- caller to delete. Financial records (quotes, invoices, payments) are kept
-- for the statutory period and are not touched. The case keeps its reference,
-- client, package, dates and results so reporting stays accurate.
-- Depends on: 0002, 0003, 0006, 0007, 0008, 0010, 0011, 0012, 0013, 0018.
-- =============================================================================

alter table public.clients add column retention_months int not null default 24 check (retention_months between 6 and 120);

alter table public.cases
  add column erased_at timestamptz,
  add column erased_by uuid references auth.users (id) on delete set null,
  add column erasure_reason text;
create index cases_erased_by_idx on public.cases (erased_by);
create index cases_retention_idx on public.cases (org_id, stage, released_at) where erased_at is null;

alter table public.candidates add column erased_at timestamptz;

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
    select jsonb_build_object('bucket', d.storage_bucket, 'path', d.storage_path) o from public.documents d where d.id = any (v_docs) and d.storage_path <> ''
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
  update public.documents set filename = 'erased', storage_path = '' where id = any (v_docs);
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

-- Closed cases whose client's retention period has passed (retention.purge job).
create or replace function public.retention_due_cases(p_limit int default 50) returns table (case_id uuid, reference text, closed_at timestamptz, retention_months int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.reference, coalesce(c.released_at, c.updated_at), cl.retention_months
    from public.cases c join public.clients cl on cl.id = c.client_id
   where c.erased_at is null and c.stage in ('released', 'cancelled')
     and coalesce(c.released_at, c.updated_at) < now() - make_interval(months => cl.retention_months)
   order by coalesce(c.released_at, c.updated_at)
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke execute on function public.retention_due_cases(int) from public, anon, authenticated;
grant execute on function public.retention_due_cases(int) to service_role;

-- The verification page says plainly when a report's personal data was erased.
create or replace function public.verify_report(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'found', true,
    'status', case when c.erased_at is not null then 'erased' when v.status = 'released' then 'valid' when v.status = 'superseded' then 'superseded' else 'not_released' end,
    'reference', c.reference, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256, 'page_count', v.page_count,
    'client', cl.name,
    'candidate', case when c.erased_at is null then (select string_agg(left(w, 1) || '.', ' ') from regexp_split_to_table(c.candidate_name, '\s+') w) end,
    'issuer', coalesce(o.branding ->> 'legal_name', o.name))
  from public.report_versions v
  join public.cases c on c.id = v.case_id
  join public.clients cl on cl.id = c.client_id
  join public.orgs o on o.id = v.org_id
  where v.id = p_version and v.kind = 'final' and v.status in ('released', 'superseded')
$$;
revoke execute on function public.verify_report(uuid) from public, anon, authenticated;
grant execute on function public.verify_report(uuid) to service_role;
