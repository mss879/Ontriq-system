\o /dev/null
-- The Global Sanction annexure, what clients see, and what Data Entry owes (0040).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4000000-0000-4000-8000-000000000001', 'admin40@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4000000-0000-4000-8000-000000000002', 'entry40@ontriq.test', '{"full_name":"Eranga Entry"}'),
  ('a4000000-0000-4000-8000-000000000003', 'verify40@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4000000-0000-4000-8000-000000000004', 'client40@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a4000000-0000-4000-8000-000000000005', 'other40@ontriq.test', '{"full_name":"Oshan Other"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('a4000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4000000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a4000000-0000-4000-8000-000000000005'::uuid, 'staff', null::uuid, 'verification_officer')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- field stages
do $$
declare
  sanction jsonb; nic jsonb; employment jsonb; reference jsonb;
  good jsonb := '{"candidate_name":"A","employers":[{"company":"Dialog","designation":"Engineer","period":{"from":"2019-01-01","to":"2023-01-01"},"employee_code":"D1","employment_type":"permanent"}]}';
begin
  select v.schema into sanction from public.check_type_versions v join public.check_types t on t.id = v.check_type_id where t.key = 'sanction' and v.published_at is not null order by v.version desc limit 1;
  select v.schema into nic from public.check_type_versions v join public.check_types t on t.id = v.check_type_id where t.key = 'nic' and v.published_at is not null order by v.version desc limit 1;
  select v.schema into employment from public.check_type_versions v join public.check_types t on t.id = v.check_type_id where t.key = 'employment' and v.published_at is not null order by v.version desc limit 1;
  select v.schema into reference from public.check_type_versions v join public.check_types t on t.id = v.check_type_id where t.key = 'reference' and v.published_at is not null order by v.version desc limit 1;
  assert public.check_entry_complete(sanction, '{}'), 'Global Sanction owes Data Entry nothing';
  assert not public.check_entry_complete(nic, '{}'), 'an empty NIC check is not ready';
  assert not public.check_entry_complete(nic, '{"nic_number":"853400937V"}'), 'a half-filled NIC check is not ready';
  assert public.check_entry_complete(nic, '{"nic_number":"853400937V","name_on_nic":"N"}'), '"Validated through" must wait for verification';
  assert public.check_entry_complete(employment, good), 'employment rows are complete';
  assert not public.check_entry_complete(employment, jsonb_set(good, '{employers,0,period}', '{"from":"2019-01-01"}')), 'a date range needs both dates';
  assert not public.check_entry_complete(employment, jsonb_set(good, '{employers}', '[]')), 'employment needs a row';
  assert not public.check_entry_complete(reference, '{"referees":[{"full_name":"A"}]}'), 'two referees are required';
end $$;

-- ---------------------------------------------------------------- a case with every check
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'candidate', jsonb_build_object('full_name', 'Nimali Perera', 'nic', '198812345678', 'nic_canonical', '198812345678', 'email', 'nimali@example.test', 'phone', '+94771234567')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
update public.cases set stage = 'data_entry', assigned_to = 'a4000000-0000-4000-8000-000000000002' where id = current_setting('t.case')::uuid;

-- ---------------------------------------------------------------- Data Entry
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.case_transition(current_setting('t.case')::uuid, 'start_verification');
  raise exception 'TEST FAILED: verification started with empty checks';
exception when sqlstate '22023' then
  assert sqlerrm like '% check(s) still have missing or invalid details', sqlerrm;
end $$;
do $$
declare k record; v jsonb;
begin
  -- Only what the documents can give. Nobody has entered a result.
  for k in select c.id, t.key from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid loop
    v := case k.key
      when 'education' then '{"candidate_name":"N","qualification_level":"degree","qualification":"BSc","institution":"Moratuwa","student_number":"1","year_of_completion":2012}'
      when 'employment' then '{"candidate_name":"N","employers":[{"company":"Dialog","designation":"Engineer","period":{"from":"2019-01-01","to":"2023-01-01"},"employee_code":"D1","employment_type":"permanent","hr_contact":"Harsha HR","hr_phone":"+94112345678","reason_for_leaving":"Relocated"}]}'
      when 'address' then '{"address":"1 Galle Rd","district":"Colombo","residence_period":{"from":"2019-01-01","to":"2023-01-01"}}'
      when 'police' then '{"nic":"198812345678","permanent_address":"1 Galle Rd","residence_period":{"from":"2019-01-01","to":"2023-01-01"},"police_station_area":"Kollupitiya"}'
      when 'nic' then '{"nic_number":"198812345678","name_on_nic":"N"}'
      when 'reference' then '{"referees":[{"full_name":"R1","current_employer":"E","current_job_title":"M","worked_together_at":"D","relationship":"colleague","acquaintance_duration":"2 years","contact_number":"+94771111111","email":"r1@example.test"},{"full_name":"R2","current_employer":"E","current_job_title":"M","worked_together_at":"D","relationship":"colleague","acquaintance_duration":"2 years","contact_number":"+94772222222","email":"r2@example.test"}]}'
      else '{}' end;
    perform public.save_check_values(k.id, v, false);
  end loop;
  assert public.case_transition(current_setting('t.case')::uuid, 'start_verification') = 'verification', 'Data Entry should finish without results';
end $$;

-- The result is still owed before the check can close.
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_state((select c.id from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid and t.key = 'sanction'), 'completed', 'clear');
  raise exception 'TEST FAILED: Global Sanction closed without "Sanctions found"';
exception when sqlstate '22023' then
  assert sqlerrm like 'complete the check%', sqlerrm;
end $$;

-- ---------------------------------------------------------------- the annexure
reset role;
update public.case_checks set state = 'completed', values_valid = true, result = 'clear', result_tone = 'green' where case_id = current_setting('t.case')::uuid;
update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = current_setting('t.case')::uuid;
set local role authenticated;
do $$ begin
  assert public.case_missing_annexures(current_setting('t.case')::uuid) = array['Global sanction screening'], 'should name the check: ' || public.case_missing_annexures(current_setting('t.case')::uuid)::text;
  perform public.case_transition(current_setting('t.case')::uuid, 'submit_post_qc');
  raise exception 'TEST FAILED: Post-QC without the Global Sanction report';
exception when sqlstate '22023' then
  assert sqlerrm like '%has no report attached%', sqlerrm;
end $$;
-- A check nobody could verify has no report to attach.
reset role;
update public.case_checks c set state = 'unable_to_verify', result = 'unable_to_verify', result_tone = 'amber' from public.check_types t where t.id = c.check_type_id and c.case_id = current_setting('t.case')::uuid and t.key = 'sanction';
do $$ begin
  assert cardinality(public.case_missing_annexures(current_setting('t.case')::uuid)) = 0, 'unable to verify needs no annexure';
end $$;
update public.case_checks c set state = 'completed', result = 'clear', result_tone = 'green' from public.check_types t where t.id = c.check_type_id and c.case_id = current_setting('t.case')::uuid and t.key = 'sanction';

-- Internal visibility is fine: the report picks it up on its own.
insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility, sensitive)
values ('a4000000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'sanction_report', 'cfirst.pdf', 'application/pdf', 'org/x/sanction.pdf', 'uploaded', 'staff', 'internal', true);
set local role authenticated;
do $$ begin
  assert cardinality(public.case_missing_annexures(current_setting('t.case')::uuid)) = 0, 'the file is in';
  assert public.case_transition(current_setting('t.case')::uuid, 'submit_post_qc') = 'post_qc', 'Post-QC should accept the case now';
end $$;

-- The report stage checks again: the file can be rejected after Post-QC.
reset role;
update public.cases set stage = 'report' where id = current_setting('t.case')::uuid;
update public.documents set status = 'rejected' where id = 'a4000000-1111-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  perform public.request_report_draft(current_setting('t.case')::uuid);
  raise exception 'TEST FAILED: a draft without the Global Sanction report';
exception when sqlstate '22023' then
  assert sqlerrm like '%has no report attached%', sqlerrm;
end $$;
reset role;
update public.documents set status = 'accepted' where id = 'a4000000-1111-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  assert public.request_report_draft(current_setting('t.case')::uuid) is not null, 'the draft should be made once the file is back';
end $$;

-- ---------------------------------------------------------------- what clients see
reset role;
update public.cases set stage = 'released', released_at = now() where id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb; employers jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert jsonb_array_length(d -> 'documents') = 0, 'an internal file reached the portal';
  -- Personal details stay hidden unless Ontriq turns them on.
  assert d -> 'case' -> 'candidate' ->> 'full_name' = 'Nimali Perera', 'the name stays';
  assert d -> 'case' -> 'candidate' ->> 'nic' is null and d -> 'case' -> 'candidate' ->> 'email' is null and d -> 'case' -> 'candidate' ->> 'phone' is null, 'candidate details reached the portal';
  assert (d -> 'visibility' ->> 'show_candidate_details')::boolean = false, 'candidate details default off';
  -- Repeating groups show only their client columns.
  select f -> 'value' into employers from jsonb_array_elements(d -> 'checks') k, jsonb_array_elements(k -> 'fields') f where f ->> 'label' = 'Employment history';
  assert employers -> 0 ->> 'company' = 'Dialog', 'client columns stay: ' || coalesce(employers::text, 'null');
  assert not (employers -> 0) ?| array['hr_contact', 'hr_phone', 'employee_code', 'reason_for_leaving'], 'staff-only columns reached the portal: ' || employers::text;
end $$;

-- "In the report" stays out of the portal, before and after release.
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin perform public.set_document_visibility('a4000000-1111-4000-8000-000000000001', 'report'); end $$;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert jsonb_array_length(public.portal_case_detail(current_setting('t.case')::uuid) -> 'documents') = 0, 'a report-only file reached the portal';
  assert not exists (select 1 from public.documents where id = 'a4000000-1111-4000-8000-000000000001'), 'a client read a report-only file';
end $$;

-- Sharing is deliberate, and takes someone who may open the file.
reset role;
delete from public.role_permissions where permission = 'documents.read_sensitive' and role_id = (select id from public.roles where key = 'admin');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_document_visibility('a4000000-1111-4000-8000-000000000001', 'client');
  raise exception 'TEST FAILED: sensitive evidence shared by someone who cannot open it';
exception when insufficient_privilege then null;
end $$;
reset role;
insert into public.role_permissions (role_id, permission) select id, 'documents.read_sensitive' from public.roles where key = 'admin';
set local role authenticated;
do $$ begin perform public.set_document_visibility('a4000000-1111-4000-8000-000000000001', 'client'); end $$;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert jsonb_array_length(public.portal_case_detail(current_setting('t.case')::uuid) -> 'documents') = 1, 'a shared file should reach the portal';
  assert exists (select 1 from public.documents where id = 'a4000000-1111-4000-8000-000000000001'), 'a client should open a shared file';
  assert cardinality(public.case_missing_annexures(current_setting('t.case')::uuid)) = 0, 'clients learn nothing from this function';
end $$;

-- Ontriq can turn candidate details on for one client.
reset role;
update public.client_settings set visibility = '{"show_candidate_details": true}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.client_settings (client_id, org_id, visibility)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000001', '{"show_candidate_details": true}'
where not exists (select 1 from public.client_settings where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
set local role authenticated;
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert d -> 'case' -> 'candidate' ->> 'email' = 'nimali@example.test', 'the setting should show the email';
end $$;

-- ---------------------------------------------------------------- "no owner" is not "the owner"
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('full_name', 'Ruwan Silva')));
  perform set_config('t.case2', r ->> 'case_id', false);
end $$;
reset role;
update public.cases set assigned_to = null, stage = 'documents' where id = current_setting('t.case2')::uuid;
update public.case_checks set assigned_to = 'a4000000-0000-4000-8000-000000000003' where case_id = current_setting('t.case2')::uuid;
update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = current_setting('t.case2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.case_transition(current_setting('t.case2')::uuid, 'submit_pre_qc');
  raise exception 'TEST FAILED: an officer moved a case nobody owns';
exception when insufficient_privilege then null;
end $$;

rollback;
\echo '  ✓ annexure, client visibility and data entry rules'
