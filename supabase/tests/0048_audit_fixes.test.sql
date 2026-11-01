\o /dev/null
-- The independent check of the build against the client's documents (0048).
-- Each block replays a finding: what used to get through no longer does.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4800000-0000-4000-8000-000000000001', 'admin48@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4800000-0000-4000-8000-000000000002', 'verify48@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4800000-0000-4000-8000-000000000003', 'qc48@ontriq.test', '{"full_name":"Kumari QC"}'),
  ('a4800000-0000-4000-8000-000000000004', 'clientadmin48@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a4800000-0000-4000-8000-000000000005', 'clientuser48@hemas.test', '{"full_name":"Upul User"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4800000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4800000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4800000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'qc_officer'),
  ('a4800000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a4800000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_user')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

update public.clients set notes = 'Slow payer, chase early' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------- staff notes aren't client instructions
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; v_education uuid := (select id from public.check_types where key = 'education');
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'process_type', 'client_supplied', 'instructions', 'Please start with the degree', 'internal_notes', 'Hiring manager is a friend of the candidate',
    'extra_checks', jsonb_build_array(jsonb_build_object('check_type_id', v_education, 'label', 'Education: Secondary')),
    'candidate', jsonb_build_object('full_name', 'Dinuka Herath')));
  perform set_config('t.case', r ->> 'case_id', false);
  assert (select count(*) from public.case_checks where case_id = (r ->> 'case_id')::uuid and check_type_id = v_education) = 2, 'a second education record should be created with the case';
  begin
    perform public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
      'extra_checks', jsonb_build_array(jsonb_build_object('check_type_id', v_education, 'label', 'education')), 'candidate', jsonb_build_object('full_name', 'Same Name')));
    raise exception 'TEST FAILED: two checks shared a name';
  exception when sqlstate '22023' then null;
  end;
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Ishara Gunasekara', 'email', 'ishara@example.test')));
  perform set_config('t.type2', r ->> 'case_id', false);
end $$;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb := public.portal_case_detail(current_setting('t.case')::uuid); r jsonb;
begin
  assert d #>> '{case,instructions}' = 'Please start with the degree', 'the client should see their own instructions';
  assert d::text not like '%friend of the candidate%', 'staff notes reached the portal';
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'internal_notes', 'smuggled', 'candidate', jsonb_build_object('full_name', 'Portal Person')));
  perform set_config('t.portal', r ->> 'case_id', false);
end $$;
reset role;
do $$ begin
  assert (select internal_notes from public.cases where id = current_setting('t.portal')::uuid) is null, 'a client wrote a staff note';
  assert (select internal_notes from public.cases where id = current_setting('t.case')::uuid) like '%friend%', 'staff note not stored';
end $$;

-- ---------------------------------------------------------------- client users and the clients table
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare p jsonb := public.portal_client_profile();
begin
  assert (select count(*) from public.clients) = 0, 'a client user read the clients table';
  assert (select count(*) from public.client_settings) = 0, 'a client user read client settings';
  assert p ->> 'name' = 'Hemas Holdings' and (p #>> '{portal,bulk_upload}')::boolean, 'the profile lacks what the portal needs';
  assert p::text not like '%Slow payer%' and not (p ? 'billing_policy') and not (p ? 'ai_opt_out'), 'the profile leaks internal columns';
end $$;
reset role;

-- ---------------------------------------------------------------- moving someone to another company
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    update public.memberships set client_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where user_id = 'a4800000-0000-4000-8000-000000000005';
    raise exception 'TEST FAILED: a client admin moved a colleague to another company';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- new check versions
do $$
declare s jsonb;
begin
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'education';
  assert exists (select 1 from jsonb_array_elements(s -> 'fields') f, jsonb_array_elements(f -> 'options') o where f ->> 'key' = 'qualification_level' and o ->> 'value' = 'secondary'), 'no secondary level';
  assert exists (select 1 from jsonb_array_elements(s -> 'documents') d where d ->> 'category' = 'verification_response'), 'no reply slot on education';
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'employment';
  assert exists (select 1 from jsonb_array_elements(s -> 'documents') d where d ->> 'category' = 'service_letter' and d ->> 'per_record' = 'employers'), 'service letters should be per employer';
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'sanction';
  assert exists (select 1 from jsonb_array_elements(s -> 'fields') f where f ->> 'key' = 'screened_name' and f -> 'fill_by' ? 'candidate'), 'no screening details';
  assert s #>> '{fixed_annexure,category}' = 'sanction_report', 'the sanction report must stay the fixed annexure';
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'reference';
  assert exists (select 1 from jsonb_array_elements(s #> '{fields,0,fields}') f where f ->> 'key' = 'details_confirmed'), 'no referee confirmation';
end $$;

-- ---------------------------------------------------------------- details: the database counts what is missing
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.cases set assigned_to = 'a4800000-0000-4000-8000-000000000002', stage = 'data_entry' where id = c;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid := (select id from public.case_checks where case_id = current_setting('t.case')::uuid and label = 'NIC verification');
begin
  perform public.save_check_values(k, '{}', true);
  assert not (select values_valid from public.case_checks where id = k), 'empty details were marked valid';
  perform public.save_check_values(k, '{"nic_number":"853400937V","name_on_nic":"Dinuka Herath"}', true);
  assert not (select values_valid from public.case_checks where id = k), 'verification''s required field was skipped';
  perform public.save_check_values(k, '{"nic_number":"853400937V","name_on_nic":"Dinuka Herath","validation_source":"online"}', true);
  assert (select values_valid from public.case_checks where id = k), 'complete details should be valid';
end $$;
reset role;

-- ---------------------------------------------------------------- Pre-QC
do $$ begin
  update public.cases set stage = 'pre_qc' where id = current_setting('t.case')::uuid;
  update public.case_check_requirements set status = 'pending' where case_id = current_setting('t.case')::uuid and category = 'nic_copy';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    perform public.record_qc_review(c, 'pre', 'approved', '[{"item":"Readable","ok":true}]');
    raise exception 'TEST FAILED: Pre-QC approved a case with a required document missing';
  exception when sqlstate '22023' then
    assert sqlerrm like '%missing or were rejected%', sqlerrm;
  end;
end $$;
reset role;
update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = current_setting('t.case')::uuid;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    perform public.record_qc_review(c, 'pre', 'approved', '[{"item":"Readable","ok":false}]');
    raise exception 'TEST FAILED: approved with an unticked item and no reason';
  exception when sqlstate '22023' then null;
  end;
  perform public.record_qc_review(c, 'pre', 'approved', '[{"item":"Readable","ok":false}]', 'Photo is faint but the number can be read');
  assert (select stage from public.cases where id = c) = 'data_entry', 'approval with a reason should pass';
end $$;
reset role;

-- ---------------------------------------------------------------- locked checks
do $$ begin
  update public.cases set stage = 'verification' where id = current_setting('t.case')::uuid;
  update public.case_checks set values_valid = true, state = 'in_progress', assigned_to = 'a4800000-0000-4000-8000-000000000002' where case_id = current_setting('t.case')::uuid;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid; v_nic uuid;
begin
  -- The owner can send the case back, not only a manager.
  perform public.case_transition(c, 'return_to_documents', 'The service letter is for a different employer');
  assert (select stage from public.cases where id = c) = 'documents', 'the owner should be able to return the case';
end $$;
reset role;
update public.cases set stage = 'verification', returned_at = null where id = current_setting('t.case')::uuid;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid := (select id from public.case_checks where case_id = current_setting('t.case')::uuid and label = 'Employment');
begin
  perform public.set_check_state(k, 'discrepancy', null, null, 'The dates differ by eight months');
  perform public.set_check_state((select id from public.case_checks where case_id = c and label = 'Reference check'), 'unable_to_verify', null, null, 'No reply from either referee');
  perform public.set_check_state((select id from public.case_checks where case_id = c and label = 'NIC verification'), 'completed', 'clear');
  perform set_config('t.check', k::text, false);
end $$;
reset role;

-- The client's feed reads the same whatever the check found.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb := public.portal_case_detail(current_setting('t.case')::uuid); v_titles text;
begin
  select string_agg(e ->> 'title', ' | ') into v_titles from jsonb_array_elements(d -> 'timeline') e;
  assert v_titles like '%Employment completed%', 'a discrepancy should appear in the feed like any finished check: ' || v_titles;
  assert v_titles like '%Reference check completed%', 'unable to verify should appear in the feed too: ' || v_titles;
  assert v_titles like '%NIC verification completed%', 'a verified check should appear in the feed';
  assert d::text not like '%differ by eight months%' and d::text not like '%Discrepancy%', 'a finding reached the portal before release';
end $$;
reset role;

update public.cases set stage = 'post_qc' where id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid := current_setting('t.check')::uuid; v_open uuid := (select id from public.case_checks where case_id = current_setting('t.case')::uuid and state = 'in_progress' limit 1);
begin
  begin
    perform public.set_check_state(v_open, 'pending_info');
    raise exception 'TEST FAILED: a check changed during Post-QC';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.set_check_state(k, 'waived', null, 'Not needed');
    raise exception 'TEST FAILED: a finished check was waived during Post-QC';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
do $$ begin
  update public.cases set stage = 'released' where id = current_setting('t.case')::uuid;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.set_check_state(current_setting('t.check')::uuid, 'in_progress');
    raise exception 'TEST FAILED: a check was reopened after release';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
update public.cases set stage = 'post_qc' where id = current_setting('t.case')::uuid;

-- ---------------------------------------------------------------- Post-QC back to data entry, quietly
delete from public.notifications where type = 'portal.case_status';
-- The earlier send-back asked the client. An open question would read as pending information.
update public.client_requests set status = 'closed' where case_id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid := current_setting('t.check')::uuid;
begin
  perform public.record_qc_review(c, 'post', 'returned', '[]', 'The employee code is wrong', array[k], 'data_entry');
  assert (select stage from public.cases where id = c) = 'data_entry', 'Post-QC should be able to return to data entry';
  assert (select status_key from public.cases where id = c) = 'returned_to_data_entry', 'staff should see the return at data entry';
  assert (select client_label from public.client_status_catalog where key = 'returned_to_data_entry') = 'Data Entry in Progress', 'the client reads the stage as usual';
  assert (select state from public.case_checks where id = k) = 'returned', 'check not returned';
end $$;
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert not exists (select 1 from public.notifications n where n.type = 'portal.case_status' and n.title like '%returned%'),
    'an internal return reached the client: ' || (select string_agg(n.title, ' | ') from public.notifications n where n.type = 'portal.case_status');
  assert exists (select 1 from public.audit_log where table_name = 'qc_reviews' and after ->> 'case_id' = c::text), 'QC decisions should be in the audit log';
end $$;

-- ---------------------------------------------------------------- statuses that change inside a stage
delete from public.notifications where type = 'portal.case_status';
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.cases set stage = 'verification', returned_at = null where id = c;
  update public.case_checks set state = 'in_progress', result = null, result_tone = null, completed_at = null where case_id = c;
  perform public.recompute_case(c);
  update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green' where id = current_setting('t.check')::uuid;
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'partially_completed', 'expected a partial status';
  assert exists (select 1 from public.notifications where type = 'portal.case_status' and title like '%partially completed%'), 'partly done should reach the client';
end $$;

-- ---------------------------------------------------------------- a file for each employer
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid := current_setting('t.check')::uuid;
begin
  update public.case_checks set state = 'in_progress', result = null, result_tone = null,
         values = '{"candidate_name":"Dinuka Herath","employers":[{"company":"Dialog"},{"company":"Hemas"}]}'
   where id = k;
  update public.case_check_requirements set status = 'received' where case_check_id = k and category = 'service_letter';
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, record_key)
  values ('a4800000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, k, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'service_letter', 'dialog.pdf', 'application/pdf', 'x/dialog.pdf', 'accepted', 'staff', 'employers.0');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid := current_setting('t.check')::uuid;
begin
  begin
    perform public.set_check_state(k, 'completed', 'clear');
    raise exception 'TEST FAILED: two employers verified on one letter';
  exception when sqlstate '22023' then
    assert sqlerrm like '%tie a document to each row%', sqlerrm;
  end;
  begin
    perform public.set_document_record('a4800000-1111-4000-8000-000000000001', 'employers.7');
    raise exception 'TEST FAILED: a file was tied to a row that does not exist';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, record_key)
values ('a4800000-1111-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, current_setting('t.check')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'service_letter', 'hemas.pdf', 'application/pdf', 'x/hemas.pdf', 'accepted', 'staff', 'employers.1');
set local role authenticated;
do $$ begin
  perform public.set_check_state(current_setting('t.check')::uuid, 'completed', 'clear');
  assert (select state from public.case_checks where id = current_setting('t.check')::uuid) = 'completed', 'a letter for each employer should pass';
end $$;
reset role;

-- ---------------------------------------------------------------- the flowchart's order, when switched on
update public.orgs set settings = jsonb_set(settings, '{workflow}', '{"enforce_check_order": true}') where id = '00000000-0000-4000-8000-000000000001';
update public.case_checks set state = 'in_progress', result = null, result_tone = null where case_id = current_setting('t.case')::uuid;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    perform public.set_check_state((select id from public.case_checks where case_id = c and label = 'NIC verification'), 'completed', 'clear');
    raise exception 'TEST FAILED: NIC finished before education';
  exception when sqlstate '22023' then
    assert sqlerrm like '%checks run in order%', sqlerrm;
  end;
end $$;
reset role;
update public.orgs set settings = settings - 'workflow' where id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- evidence in the report
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.cases set stage = 'report' where id = c;
  update public.case_check_requirements set status = 'pending' where case_id = c;
  update public.case_checks set state = 'waived' where case_id = c;
  update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green' where case_id = c and label in ('Global sanction screening', 'NIC verification');
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility)
  select 'a4800000-1111-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', c, k.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sanction_report', 's.pdf', 'application/pdf', 'x/s.pdf', 'accepted', 'staff', 'internal'
    from public.case_checks k where k.case_id = c and k.label = 'Global sanction screening';
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  select 'a4800000-1111-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', c, k.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nic_copy', 'nic.pdf', 'application/pdf', 'x/nic.pdf', 'accepted', 'staff'
    from public.case_checks k where k.case_id = c and k.label = 'NIC verification';
  update public.documents set visibility = 'internal' where id = 'a4800000-1111-4000-8000-000000000004';
  insert into public.report_versions (id, org_id, case_id, version, kind, status, requested_by)
  values ('a4800000-2222-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 1, 'draft', 'ready', 'a4800000-0000-4000-8000-000000000001');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert public.case_unreported_evidence(c) = array['NIC verification'], 'the sanction report must not be flagged; the NIC copy must be: ' || public.case_unreported_evidence(c)::text;
  begin
    perform public.submit_report(c);
    raise exception 'TEST FAILED: a report went for approval without its evidence';
  exception when sqlstate '22023' then
    assert sqlerrm like '%no evidence in the report%', sqlerrm;
  end;
  perform public.set_document_visibility('a4800000-1111-4000-8000-000000000004', 'report');
  assert cardinality(public.case_unreported_evidence(c)) = 0, 'evidence back in the report should clear the warning';
  -- A file uploaded to the whole case rather than one check fills the slot, so it counts too.
  perform public.set_document_visibility('a4800000-1111-4000-8000-000000000004', 'internal');
  assert public.case_unreported_evidence(c) = array['NIC verification'], 'internal again should flag it again';
end $$;
reset role;
insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility)
values ('a4800000-1111-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nic_copy', 'whole-case.pdf', 'application/pdf', 'x/whole-case.pdf', 'accepted', 'staff', 'report');
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert cardinality(public.case_unreported_evidence(c)) = 0, 'a whole-case file in the report should count';
  perform public.submit_report(c);
  assert (select stage from public.cases where id = c) = 'approval', 'report should go for approval';
end $$;
reset role;

-- ---------------------------------------------------------------- holds stick
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  insert into public.report_versions (id, org_id, case_id, version, kind, status, storage_path, approved_by, parts)
  values ('a4800000-2222-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, 2, 'final', 'ready', 'org/x/v2.pdf', 'a4800000-0000-4000-8000-000000000002',
          '[{"part": 2, "path": "org/x/v2-part-2.pdf", "pages": 40}]');
  update public.cases set on_hold = true, held_at = now() where id = c;
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    perform public.release_report(c);
    raise exception 'TEST FAILED: a held case was released';
  exception when sqlstate '22023' then
    assert sqlerrm like '%on hold%', sqlerrm;
  end;
  begin
    perform public.return_report(c, 'Fix the dates');
    raise exception 'TEST FAILED: a held case was sent back';
  exception when sqlstate '22023' then
    assert sqlerrm like '%on hold%', sqlerrm;
  end;
end $$;
reset role;
delete from public.notifications where type = 'portal.case_status';
update public.cases set on_hold = false, held_at = null where id = current_setting('t.case')::uuid;

-- ---------------------------------------------------------------- reports in parts, and "Report Completed"
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'report_completed', 'a ready final is Report Completed';
  assert exists (select 1 from public.notifications where type = 'portal.case_status' and title like '%report completed%'), 'clients should hear the report is complete';
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid; v jsonb;
begin
  v := public.report_download('a4800000-2222-4000-8000-000000000002', null, 2);
  assert v ->> 'path' = 'org/x/v2-part-2.pdf' and v ->> 'filename' like '%-part-2.pdf', 'part 2 should download: ' || v::text;
  begin
    perform public.report_download('a4800000-2222-4000-8000-000000000002', null, 3);
    raise exception 'TEST FAILED: a part that does not exist came back';
  exception when sqlstate 'P0002' then null;
  end;
  perform public.release_report(c);
  assert (select stage from public.cases where id = c) = 'released', 'should release';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare v jsonb := public.portal_report(current_setting('t.case')::uuid);
begin
  assert (v ->> 'extra_parts')::int = 1 and not (v ->> 'file_removed')::boolean, 'the portal should know about the second part: ' || v::text;
end $$;
reset role;

-- ---------------------------------------------------------------- erasure takes the new columns too
select set_config('request.jwt.claims', '', true);
do $$
declare c uuid := current_setting('t.case')::uuid; r jsonb;
begin
  insert into public.client_requests (org_id, case_id, question, created_by) values ('00000000-0000-4000-8000-000000000001', c, 'Is Dinuka your employee?', 'a4800000-0000-4000-8000-000000000001');
  r := public.erase_case(c, 'Retention period ended');
  assert (select internal_notes from public.cases where id = c) is null, 'staff notes survived erasure';
  assert r::text like '%v2-part-2.pdf%', 'later parts of the report must be deleted too';
  assert not exists (select 1 from public.client_requests where case_id = c and question <> '[erased]'), 'questions survived erasure';
  assert not exists (select 1 from public.audit_log where table_name = 'qc_reviews' and after ->> 'case_id' = c::text and after ? 'remarks'), 'QC remarks survived in the audit log';
  assert exists (select 1 from public.audit_log where table_name = 'qc_reviews' and after ->> 'case_id' = c::text), 'an erased case''s trail should still be findable';
  assert (select parts from public.report_versions where id = 'a4800000-2222-4000-8000-000000000002') = '[]'::jsonb, 'parts survived erasure';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare v jsonb := public.portal_report(current_setting('t.case')::uuid);
begin
  assert (v ->> 'file_removed')::boolean, 'a removed file should say so: ' || coalesce(v::text, 'null');
end $$;
reset role;

-- ---------------------------------------------------------------- the BGV form
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.type2')::uuid; v_n int; v_second int; v_link uuid;
begin
  v_n := public.issue_bgv_form(c);
  assert v_n > 0, 'the form should ask for something';
  v_second := public.issue_bgv_form(c);
  assert v_second = 0, 'sending the form twice should not double it';
  assert (select bool_and(form) from public.candidate_requests where case_id = c), 'requests should be marked as the form';
  v_link := public.issue_candidate_link(c, repeat('d', 64), 'enc-4', 'en', 14);
  perform set_config('t.link', v_link::text, false);
end $$;
reset role;
do $$
declare c uuid := current_setting('t.type2')::uuid; q public.candidate_requests;
begin
  -- The form is document collection, not a chase.
  assert (select status_key from public.cases where id = c) = 'documents_pending', 'the BGV form shouldn''t read as pending information';
  select * into q from public.candidate_requests where case_id = c and field_type = 'check_form' limit 1;
  assert q.options ->> 'max' = '1' and jsonb_array_length(q.options -> 'fields') > 0, 'a form needs fields';
  begin
    perform public.candidate_answer_request(current_setting('t.link')::uuid, q.id, '{"rows": []}');
    raise exception 'TEST FAILED: an empty form was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.candidate_answer_request(current_setting('t.link')::uuid, q.id, '{"rows": [{"nic_number": "853400937V"}]}');
  assert (select status from public.candidate_requests where id = q.id) = 'answered', 'the form should be answered';
end $$;

-- A detail asked of the candidate outside the form is pending information, and answers can be lists and dates.
set local role authenticated;
do $$
declare c uuid := current_setting('t.type2')::uuid; q uuid;
begin
  q := public.create_candidate_request(c, jsonb_build_object('kind', 'question', 'title', 'When did you move?'));
  perform set_config('t.question', q::text, false);
end $$;
reset role;
do $$
declare c uuid := current_setting('t.type2')::uuid;
begin
  assert (select status_key from public.cases where id = c) = 'pending_information', 'an open question should read as pending information';
  begin
    perform public.candidate_answer_request(current_setting('t.link')::uuid, current_setting('t.question')::uuid, '{"value": {"from": ""}}');
    raise exception 'TEST FAILED: a blank date range was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.candidate_answer_request(current_setting('t.link')::uuid, current_setting('t.question')::uuid, '{"value": {"from": "2020-01-01", "present": true}}');
  assert (select status_key from public.cases where id = c) <> 'pending_information', 'an answer clears pending information';
end $$;

-- ---------------------------------------------------------------- statuses of your own
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.type2')::uuid; v_key text;
begin
  v_key := public.save_custom_status('{"internal_label": "Waiting for head office", "client_label": "With our head office"}');
  assert v_key like 'custom_waiting_for_head_office_%', 'unexpected key ' || v_key;
  perform public.set_case_status(c, v_key);
  assert (select status_key from public.cases where id = c) = v_key, 'the status should show on the case';
  perform set_config('t.status', v_key, false);
  perform public.save_custom_status(jsonb_build_object('key', v_key, 'internal_label', 'Waiting for head office', 'is_active', false));
  begin
    perform public.set_case_status(c, v_key);
    raise exception 'TEST FAILED: a status that was turned off was set';
  exception when sqlstate 'P0002' then null;
  end;
  perform public.set_case_status(c, null);
  assert (select status_key from public.cases where id = c) <> v_key, 'clearing should go back to automatic';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.save_custom_status('{"internal_label": "Sneaky"}');
    raise exception 'TEST FAILED: an officer added a status';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- copy or original
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
reset role;
insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
values ('a4800000-1111-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', current_setting('t.type2')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nic_copy', 'nic2.pdf', 'application/pdf', 'x/nic2.pdf', 'accepted', 'staff');
update public.cases set assigned_to = 'a4800000-0000-4000-8000-000000000003' where id = current_setting('t.type2')::uuid;
set local role authenticated;
do $$ begin
  perform public.set_document_original('a4800000-1111-4000-8000-000000000005', 'certified_copy');
  assert (select original_kind from public.documents where id = 'a4800000-1111-4000-8000-000000000005') = 'certified_copy', 'not recorded';
  begin
    perform public.set_document_original('a4800000-1111-4000-8000-000000000005', 'photocopy-ish');
    raise exception 'TEST FAILED: an unknown kind was stored';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4800000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.set_document_original('a4800000-1111-4000-8000-000000000005', 'original');
    raise exception 'TEST FAILED: a client set it';
  exception when insufficient_privilege or sqlstate 'P0002' then null;
  end;
end $$;
reset role;

rollback;
\o
\echo '  ✓ audit fixes'
