\o /dev/null
-- Retention and erasure (0035).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3500000-0000-4000-8000-000000000001', 'admin35@ontriq.test', '{"full_name":"Anu Admin"}'),
  ('a3500000-0000-4000-8000-000000000002', 'super35@ontriq.test', '{"full_name":"Sunil Super"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff', null, r.id, 'active'
from (values ('a3500000-0000-4000-8000-000000000001'::uuid, 'admin'), ('a3500000-0000-4000-8000-000000000002'::uuid, 'super_admin')) as u(id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'process_type', 'client_supplied', 'position_title', 'Accountant', 'client_reference', 'HR-77',
    'candidate', jsonb_build_object('full_name', 'Ruwani Jayasuriya', 'nic', '199011112222', 'nic_canonical', '199011112222', 'email', 'ruwani@example.lk')));
  perform set_config('t.case', r ->> 'case_id', false);
  r2 := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'candidate', jsonb_build_object('full_name', 'Tharindu Bandara', 'nic', '199122223333', 'nic_canonical', '199122223333')));
  perform set_config('t.open', r2 ->> 'case_id', false);
end $$;
reset role;
do $$
declare k uuid := (select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1);
declare d uuid; v uuid;
begin
  update public.case_checks set values = '{"nic":"199011112222","full_name":"Ruwani Jayasuriya"}', client_note = 'Ruwani''s NIC matched.' where id = k;
  insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'nic', 'ruwani-nic.jpg', 'image/jpeg', 'case-files', 'org/x/ruwani-nic.jpg', 'uploaded', 'staff')
  returning id into d;
  insert into public.document_texts (document_id, org_id, text) values (d, '00000000-0000-4000-8000-000000000001', 'RUWANI JAYASURIYA 199011112222');
  insert into public.candidate_messages (org_id, case_id, from_kind, body) values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'candidate', 'My NIC is 199011112222');
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, value) values
    ('00000000-0000-4000-8000-000000000001', 'case.consistency', 'case', current_setting('t.case')::uuid, '{"summary":"Ruwani names agree"}');
  insert into public.report_versions (org_id, case_id, version, kind, status, snapshot, storage_path, sha256, released_at)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 1, 'final', 'released', '{"candidate":{"name":"Ruwani Jayasuriya"}}', 'org/x/report.pdf', 'abc', now())
  returning id into v;
  perform set_config('t.report', v::text, false);
  assert (public.verify_report(v) ->> 'candidate') = 'R. J.', 'initials before erasure';
end $$;

-- ================================================================= who may erase
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.erase_case(current_setting('t.case')::uuid, 'Candidate asked for deletion');
  raise exception 'TEST FAILED: an admin erased a case';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3500000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  perform public.erase_case(current_setting('t.case')::uuid, 'Candidate asked for deletion');
  raise exception 'TEST FAILED: erased without two-step verification';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3500000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.erase_case(current_setting('t.open')::uuid, 'Candidate asked for deletion');
    raise exception 'TEST FAILED: erased a case still in progress';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.erase_case(current_setting('t.case')::uuid, 'x');
    raise exception 'TEST FAILED: erased without a reason';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.retention_due_cases();
    raise exception 'TEST FAILED: staff listed retention cases';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
update public.cases set stage = 'cancelled', cancelled_at = now() where id = current_setting('t.case')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3500000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.erase_case(current_setting('t.case')::uuid, 'Candidate asked for deletion under the PDPA');
  assert jsonb_array_length(r -> 'objects') = 2, 'files to delete: ' || (r -> 'objects')::text;
  assert (r -> 'objects') @> '[{"bucket":"case-files","path":"org/x/ruwani-nic.jpg"},{"bucket":"reports","path":"org/x/report.pdf"}]', 'wrong files';
  begin
    perform public.erase_case(current_setting('t.case')::uuid, 'Candidate asked again');
    raise exception 'TEST FAILED: erased twice';
  exception when sqlstate '22023' then null;
  end;
end $$;

reset role;
do $$
declare c public.cases := (select c from public.cases c where id = current_setting('t.case')::uuid);
begin
  assert c.candidate_name = 'Erased candidate' and c.client_reference is null and c.position_title is null and c.erased_at is not null, 'case not scrubbed';
  assert c.reference like 'ONT-%' and c.client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reporting fields must stay';
  assert (select full_name = 'Erased candidate' and nic is null and email is null and erased_at is not null from public.candidates where id = c.candidate_id), 'candidate not scrubbed';
  assert not exists (select 1 from public.case_checks where case_id = c.id and (values <> '{}'::jsonb or client_note is not null)), 'check values remain';
  assert not exists (select 1 from public.document_texts t join public.documents d on d.id = t.document_id where d.case_id = c.id), 'OCR text remains';
  assert not exists (select 1 from public.ai_suggestions where entity_id = c.id), 'AI suggestions remain';
  assert (select bool_and(body = '[erased]') from public.candidate_messages where case_id = c.id), 'messages remain';
  assert (select snapshot = '{}'::jsonb and storage_path is null from public.report_versions where id = current_setting('t.report')::uuid), 'report not scrubbed';
  assert not exists (select 1 from public.audit_log where before::text like '%199011112222%' or after::text like '%199011112222%'
                       or before::text like '%Ruwani%' or after::text like '%Ruwani%'), 'the audit log still holds personal data';
  assert exists (select 1 from public.audit_log where table_name = 'cases' and row_id = c.id::text), 'audit entries must be kept';
  assert exists (select 1 from public.system_events where kind = 'data.erased' and context ->> 'case_id' = c.id::text), 'erasure not recorded';
  assert public.verify_report(current_setting('t.report')::uuid) ->> 'status' = 'erased'
     and public.verify_report(current_setting('t.report')::uuid) ->> 'candidate' is null, 'verify page should say erased';
end $$;

-- ================================================================= retention period (as the job: no signed-in user)
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare r jsonb;
begin
  update public.cases set stage = 'released', released_at = now() - interval '30 months' where id = current_setting('t.open')::uuid;
  assert exists (select 1 from public.retention_due_cases() where case_id = current_setting('t.open')::uuid), 'a case past retention should be due';
  update public.clients set retention_months = 36 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert not exists (select 1 from public.retention_due_cases() where case_id = current_setting('t.open')::uuid), 'the client''s longer retention should apply';
  update public.clients set retention_months = 24 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r := public.erase_case(current_setting('t.open')::uuid, 'Retention period of 24 months passed');
  assert not exists (select 1 from public.retention_due_cases() where case_id = current_setting('t.open')::uuid), 'erased cases are not due again';
  assert (select context ->> 'source' from public.system_events where kind = 'data.erased' and context ->> 'case_id' = current_setting('t.open')) = 'retention', 'source';
end $$;

rollback;
\echo '  ✓ retention and erasure'
