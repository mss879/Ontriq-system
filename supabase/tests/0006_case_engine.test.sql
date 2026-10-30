\o /dev/null
-- Case engine: creation, NIC matching, visibility per role, workflow guards,
-- documents, QC loops, assignment, check type versions, search and packages.
begin;

-- ---------------------------------------------------------------- people
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'admin@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('c1000000-0000-4000-8000-000000000002', 'ops@ontriq.test', '{"full_name":"Oshan Ops"}'),
  ('c1000000-0000-4000-8000-000000000003', 'verifier@ontriq.test', '{"full_name":"Vihanga Verifier"}'),
  ('c1000000-0000-4000-8000-000000000004', 'verifier2@ontriq.test', '{"full_name":"Vino Verifier"}'),
  ('c1000000-0000-4000-8000-000000000005', 'entry@ontriq.test', '{"full_name":"Dilini Entry"}'),
  ('c1000000-0000-4000-8000-000000000006', 'qc@ontriq.test', '{"full_name":"Qasim QC"}'),
  ('c1000000-0000-4000-8000-000000000007', 'viewer@ontriq.test', '{"full_name":"Vee Viewer"}'),
  ('c1000000-0000-4000-8000-000000000008', 'client@hemas.test', '{"full_name":"Hema Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('c1000000-0000-4000-8000-000000000005'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('c1000000-0000-4000-8000-000000000006'::uuid, 'staff', null::uuid, 'qc_officer'),
  ('c1000000-0000-4000-8000-000000000007'::uuid, 'staff', null::uuid, 'viewer'),
  ('c1000000-0000-4000-8000-000000000008'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- catalogue
do $$ begin
  assert (select count(*) from public.check_types where is_builtin and current_version_id is not null) = 7, 'seven built-in check types should be published';
  assert (select count(*) from public.packages where owner_scope = 'org') = 3, 'three packages expected';
  assert (select count(*) from public.package_items pi join public.packages p on p.id = pi.package_id where p.code = 'COMPREHENSIVE') = 7, 'comprehensive has 7 checks';
  assert (select count(*) from public.document_categories) >= 13, 'document categories missing';
  assert (select count(*) from public.client_status_catalog) = 16, 'status catalogue missing';
  assert public.add_working_days('2026-10-30 10:00+05:30', 1) = '2026-11-02 17:30+05:30', 'working days wrong';
end $$;

-- ---------------------------------------------------------------- admin creates a case
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where code = 'STANDARD'),
    'process_type', 'client_supplied', 'position_title', 'Engineer',
    'candidate', jsonb_build_object('full_name', 'Nimal Perera', 'nic', '853400937V', 'nic_canonical', '198534000937', 'district', 'Kandy')));
  assert r ->> 'reference' ~ '^ONT-\d{4}-000001$', 'unexpected reference ' || (r ->> 'reference');
  assert not (r ->> 'candidate_reused')::boolean, 'new candidate marked reused';
  perform set_config('t.case1', r ->> 'case_id', false);
  -- Same person, newer card: matched by NIC.
  r2 := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('full_name', 'N. Perera', 'nic', '198534000937', 'nic_canonical', '198534000937')));
  assert (r2 ->> 'candidate_reused')::boolean, 'NIC match missed';
  assert (r2 ->> 'reference') like '%-000002', 'references are not sequential';
  perform set_config('t.case2', r2 ->> 'case_id', false);
end $$;
reset role;

do $$
declare c public.cases;
begin
  select * into c from public.cases where id = current_setting('t.case1')::uuid;
  assert c.stage = 'documents' and c.status_key = 'documents_pending', 'new case should collect documents';
  assert c.checks_total = 3 and c.proposed_result = 'amber', 'roll-up wrong at creation';
  assert c.due_at is not null and c.package_snapshot ->> 'code' = 'STANDARD', 'snapshot or due date missing';
  assert (select count(*) from public.case_checks where case_id = c.id) = 3, 'three checks expected';
  assert (select count(*) from public.case_check_requirements where case_id = c.id and status = 'pending') = 3, 'three required documents expected (NIC, certificates, service letters)';
  assert (select count(*) from public.jobs where kind = 'assign.auto' and entity_id = c.id) = 1, 'assign.auto not queued';
  assert (select count(*) from public.case_events where case_id = c.id and kind = 'created') = 1, 'created event missing';
end $$;

-- ---------------------------------------------------------------- visibility by role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 2, 'viewer (cases.read) should see both cases';
  assert (select count(*) from public.search_everything('nimal')) >= 2, 'search should find the case and candidate';
  begin
    perform public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
      'candidate', jsonb_build_object('full_name', 'X')));
    raise exception 'TEST FAILED: viewer created a case';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.cases (reference, client_id, candidate_id, candidate_name) select 'X', client_id, candidate_id, 'x' from public.cases limit 1;
    raise exception 'TEST FAILED: direct insert into cases';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 0, 'verification officer should see no unassigned cases';
  assert (select count(*) from public.candidates) = 0, 'verification officer should see no candidates';
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 0, 'client users read cases through the portal, not the table';
  assert (select count(*) from public.search_everything('nimal')) = 0, 'client search leaked staff records';
  begin
    perform public.create_case(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'package_id', (select id from public.packages where code = 'STANDARD'),
      'candidate', jsonb_build_object('full_name', 'Spy')));
    raise exception 'TEST FAILED: client created a case for another company';
  exception when insufficient_privilege then null;
  end;
  -- A portal request for their own company starts at intake.
  perform set_config('t.case3', public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where code = 'ESSENTIAL'), 'candidate', jsonb_build_object('full_name', 'Portal Person'))) ->> 'case_id', false);
end $$;
reset role;
do $$ begin
  assert (select stage from public.cases where id = current_setting('t.case3')::uuid) = 'intake', 'portal requests should start at intake';
  assert (select created_via from public.cases where id = current_setting('t.case3')::uuid) = 'portal', 'portal request not marked';
end $$;

-- ---------------------------------------------------------------- assignment
select set_config('request.jwt.claims', '', true);  -- act as the service, not the last user
set local role service_role;
select public.apply_auto_assignment(current_setting('t.case1')::uuid, jsonb_build_object(
  'strategy', 'least_loaded',
  'owner', jsonb_build_object('user_id', 'c1000000-0000-4000-8000-000000000003', 'explanation', 'Vihanga: 0 open cases'),
  'checks', (select jsonb_agg(jsonb_build_object('check_id', id, 'user_id', 'c1000000-0000-4000-8000-000000000003', 'explanation', 'qualified')) from public.case_checks where case_id = current_setting('t.case1')::uuid)));
do $$ begin
  assert (select count(*) from jsonb_array_elements(public.staff_load_snapshot('00000000-0000-4000-8000-000000000001')) e
          where e ->> 'user_id' like 'c1000000-%') = 7, 'snapshot should list the seven active test staff';
end $$;
reset role;
do $$ begin
  assert (select assigned_to from public.cases where id = current_setting('t.case1')::uuid) = 'c1000000-0000-4000-8000-000000000003', 'owner not applied';
  assert (select count(*) from public.case_checks where case_id = current_setting('t.case1')::uuid and assigned_to is not null) = 3, 'checks not assigned';
  assert (select count(*) from public.notifications where user_id = 'c1000000-0000-4000-8000-000000000003' and type = 'case.assigned') = 1, 'assignee not notified once';
  assert (select count(*) from public.assignment_events where case_id = current_setting('t.case1')::uuid and mode = 'auto') = 4, 'assignment log incomplete';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 1, 'assigned officer should now see exactly their case';
  begin
    perform public.staff_load_snapshot();
    raise exception 'TEST FAILED: officer read the team load';
  exception when insufficient_privilege then null;
  end;
  -- The owner may not move a case past missing documents.
  begin
    perform public.case_transition(current_setting('t.case1')::uuid, 'submit_pre_qc');
    raise exception 'TEST FAILED: moved to Pre-QC with documents missing';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 0, 'another officer sees the case';
  begin
    perform public.save_check_values((select id from public.case_checks where case_id = current_setting('t.case1')::uuid limit 1), '{}'::jsonb, false);
    raise exception 'TEST FAILED: officer without access edited a check';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- ---------------------------------------------------------------- documents
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb; c uuid := current_setting('t.case1')::uuid;
begin
  begin
    perform public.begin_document_upload(c, null, 'nic_copy', 'nic.exe', 'application/x-msdownload', 100);
    raise exception 'TEST FAILED: accepted an executable';
  exception when sqlstate '22023' then null;
  end;
  d := public.begin_document_upload(c, null, 'nic_copy', 'NIC front.pdf', 'application/pdf', 2048);
  assert d ->> 'path' like 'org/%/case/' || c || '/%/nic-front.pdf', 'unexpected storage path ' || (d ->> 'path');
  perform public.finalize_document_upload((d ->> 'id')::uuid, 'abc');
  perform set_config('t.doc1', d ->> 'id', false);
  d := public.begin_document_upload(c, null, 'police_report', 'police.pdf', 'application/pdf', 2048);
  perform public.finalize_document_upload((d ->> 'id')::uuid);
  -- Police reports are sensitive: an officer without documents.read_sensitive can't see them.
  assert (select count(*) from public.documents where case_id = c) = 1, 'sensitive document visible without permission';
end $$;
reset role;
do $$ begin
  assert (select status from public.case_check_requirements where case_id = current_setting('t.case1')::uuid and category = 'nic_copy') = 'received', 'requirement not received';
  assert (select count(*) from public.case_events where case_id = current_setting('t.case1')::uuid and kind = 'document_uploaded') = 2, 'upload not on the timeline';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case1')::uuid;
begin
  -- Rejecting the file reopens the requirement.
  perform public.review_document(current_setting('t.doc1')::uuid, false, 'Blurred');
  assert (select status from public.case_check_requirements where case_id = c and category = 'nic_copy') = 'pending', 'rejection did not reopen the requirement';
  perform public.review_document(current_setting('t.doc1')::uuid, true);
  -- The manager waives the rest and moves the case on.
  perform public.waive_requirement(id, 'Client confirmed by email') from public.case_check_requirements where case_id = c and status = 'pending';
  assert public.case_outstanding_requirements(c, 'documents') = 0, 'requirements still outstanding';
  assert public.case_transition(c, 'submit_pre_qc') = 'pre_qc', 'did not reach Pre-QC';
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.record_qc_review(current_setting('t.case1')::uuid, 'pre', 'approved');
    raise exception 'TEST FAILED: a verification officer recorded Pre-QC';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- QC and data entry
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case1')::uuid;
begin
  begin
    perform public.record_qc_review(c, 'pre', 'returned', '[]', '');
    raise exception 'TEST FAILED: returned without remarks';
  exception when sqlstate '22023' then null;
  end;
  perform public.record_qc_review(c, 'pre', 'returned', '[]', 'NIC copy unreadable');
  assert (select stage from public.cases where id = c) = 'documents', 'Pre-QC return did not go back to documents';
  assert (select status_key from public.cases where id = c) = 'returned_for_correction', 'returned status missing';
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select public.case_transition(current_setting('t.case1')::uuid, 'submit_pre_qc');
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
select public.record_qc_review(current_setting('t.case1')::uuid, 'pre', 'approved', '[{"item":"readable","ok":true}]');
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case1')::uuid; k record;
begin
  assert (select stage from public.cases where id = c) = 'data_entry', 'Pre-QC approval did not reach data entry';
  assert (select count(*) from public.cases) = 1, 'data entry officer should see the data entry queue';
  perform public.save_check_values((select id from public.case_checks where case_id = c and label = 'NIC verification'), '{"nic_number":"853400937V"}', false);
  begin
    perform public.case_transition(c, 'start_verification');
    raise exception 'TEST FAILED: verification started with invalid details';
  exception when sqlstate '22023' then null;
  end;
  for k in select id from public.case_checks where case_id = c loop
    perform public.save_check_values(k.id, '{"ok":true}', true);
  end loop;
  begin
    perform public.set_check_state((select id from public.case_checks where case_id = c limit 1), 'completed', 'clear');
    raise exception 'TEST FAILED: data entry officer recorded a result';
  exception when insufficient_privilege then null;
  end;
  assert public.case_transition(c, 'start_verification') = 'verification', 'verification did not start';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.case_checks where case_id = current_setting('t.case1')::uuid and state = 'in_progress') = 3, 'checks should be in progress';
  assert (select count(*) from public.cases where id = current_setting('t.case1')::uuid and assigned_to is not null) = 1, 'owner lost';
end $$;

-- ---------------------------------------------------------------- verification and Post-QC
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case1')::uuid; k record;
begin
  begin
    perform public.set_check_state((select id from public.case_checks where case_id = c limit 1), 'completed', 'discrepancy');
    raise exception 'TEST FAILED: a red result was recorded as completed';
  exception when sqlstate '22023' then null;
  end;
  perform public.set_check_state((select id from public.case_checks where case_id = c and label = 'NIC verification'), 'completed', 'clear');
  assert (select status_key from public.cases where id = c) = 'partially_completed', 'partial status not set';
  begin
    perform public.case_transition(c, 'submit_post_qc');
    raise exception 'TEST FAILED: Post-QC with open checks';
  exception when sqlstate '22023' then null;
  end;
  for k in select id from public.case_checks where case_id = c and state <> 'completed' loop
    perform public.set_check_state(k.id, 'completed', 'clear', null, 'Confirmed by the institution');
  end loop;
  assert (select proposed_result from public.cases where id = c) = 'green', 'all clear should propose green';
  assert public.case_transition(c, 'submit_post_qc') = 'post_qc', 'did not reach Post-QC';
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case1')::uuid; v_check uuid;
begin
  select id into v_check from public.case_checks where case_id = c and label = 'Employment';
  perform public.record_qc_review(c, 'post', 'returned', '[]', 'Confirm the second employer', array[v_check]);
  assert (select stage from public.cases where id = c) = 'verification', 'Post-QC return did not reopen verification';
  assert (select state from public.case_checks where id = v_check) = 'returned', 'check not marked returned';
  assert (select proposed_result from public.cases where id = c) = 'amber', 'reopened case should not be green';
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select public.set_check_state((select id from public.case_checks where case_id = current_setting('t.case1')::uuid and label = 'Employment'), 'discrepancy', null, 'Dates differ by 8 months');
select public.case_transition(current_setting('t.case1')::uuid, 'submit_post_qc');
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
select public.record_qc_review(current_setting('t.case1')::uuid, 'post', 'approved');
reset role;
do $$
declare c public.cases;
begin
  select * into c from public.cases where id = current_setting('t.case1')::uuid;
  assert c.stage = 'report' and c.status_key = 'final_report_in_progress', 'Post-QC approval did not reach the report stage';
  assert c.proposed_result = 'red', 'a confirmed discrepancy should propose red';
  assert c.completed_at is not null, 'completion time missing';
  assert (select count(*) from public.qc_reviews where case_id = c.id) = 4, 'QC reviews not recorded';
  assert (select count(*) from public.stage_history where case_id = c.id) >= 8, 'stage history incomplete';
  assert (select count(*) from public.notifications where user_id = 'c1000000-0000-4000-8000-000000000003' and type = 'case.returned') = 2, 'owner should be told about both QC returns';
end $$;

-- ---------------------------------------------------------------- hold and cancel
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.set_case_hold(current_setting('t.case2')::uuid, true, 'Client asked');
    raise exception 'TEST FAILED: viewer put a case on hold';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case2')::uuid;
begin
  perform public.set_case_hold(c, true, 'Client asked to pause');
  begin
    perform public.case_transition(c, 'submit_pre_qc');
    raise exception 'TEST FAILED: moved a case on hold';
  exception when sqlstate '22023' then null;
  end;
  perform public.set_case_hold(c, false);
  perform public.cancel_case(c, 'Candidate withdrew');
  assert (select stage from public.cases where id = c) = 'cancelled', 'not cancelled';
end $$;

-- ---------------------------------------------------------------- check type versions
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare t uuid := (select id from public.check_types where key = 'nic'); v int;
begin
  perform public.save_check_type_draft(t, (select schema from public.check_type_versions where id = (select current_version_id from public.check_types where id = t)) || '{"sla_days": 3}');
  v := public.publish_check_type(t, 'Faster SLA');
  assert v = 2, 'second version should be 2';
  assert (select (v2.schema ->> 'sla_days')::int from public.check_types ct join public.check_type_versions v2 on v2.id = ct.current_version_id where ct.id = t) = 3, 'published schema wrong';
  -- Cases keep the version they started with.
  assert (select count(*) from public.case_checks k join public.check_type_versions cv on cv.id = k.check_type_version_id where cv.check_type_id = t and cv.version = 1) >= 1,
    'existing checks should stay on version 1';
end $$;
reset role;
do $$ begin
  begin
    update public.check_type_versions set schema = '{}' where version = 1 and check_type_id = (select id from public.check_types where key = 'nic');
    raise exception 'TEST FAILED: changed a published version';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.publish_check_type((select id from public.check_types where key = 'nic'));
    raise exception 'TEST FAILED: viewer published a check type';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- client-built packages take Ontriq's prices
reset role;
update public.package_items set unit_price = 1500 where check_type_id = (select id from public.check_types where key = 'nic');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal1"}', true);
-- With RETURNING, as the portal inserts it (0027 fixed this).
do $$
declare v uuid;
begin
  insert into public.packages (org_id, owner_scope, client_id, name, code)
  values ('00000000-0000-4000-8000-000000000001', 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Driver onboarding', 'HEMAS-DRIVER')
  returning id into v;
  assert v is not null, 'client could not read back their new package';
end $$;
insert into public.package_items (org_id, package_id, check_type_id, unit_price)
values ('00000000-0000-4000-8000-000000000001', (select id from public.packages where code = 'HEMAS-DRIVER'), (select id from public.check_types where key = 'nic'), 1);
do $$ begin
  assert (select unit_price from public.package_items where package_id = (select id from public.packages where code = 'HEMAS-DRIVER')) = 1500,
    'a client set their own price';
  assert (select count(*) from public.packages where owner_scope = 'org') = 3, 'client should see the three Ontriq packages';
end $$;
reset role;

rollback;
\echo '  ✓ case engine'
