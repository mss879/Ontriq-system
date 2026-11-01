\o /dev/null
-- The final audit of the finished system (0049). Each block replays a finding:
-- what used to get through no longer does.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4900000-0000-4000-8000-000000000001', 'admin49@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4900000-0000-4000-8000-000000000002', 'verify49@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4900000-0000-4000-8000-000000000003', 'qc49@ontriq.test', '{"full_name":"Kumari QC"}'),
  ('a4900000-0000-4000-8000-000000000004', 'clientadmin49@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a4900000-0000-4000-8000-000000000005', 'clientuser49@hemas.test', '{"full_name":"Upul User"}'),
  ('a4900000-0000-4000-8000-000000000006', 'viewer49@ontriq.test', '{"full_name":"Vidu Viewer"}'),
  ('a4900000-0000-4000-8000-000000000007', 'ops49@ontriq.test', '{"full_name":"Oshan Ops"}'),
  ('a4900000-0000-4000-8000-000000000008', 'verify49b@ontriq.test', '{"full_name":"Bimal Verify"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4900000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4900000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4900000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'qc_officer'),
  ('a4900000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a4900000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_user'),
  ('a4900000-0000-4000-8000-000000000006'::uuid, 'staff', null::uuid, 'viewer'),
  ('a4900000-0000-4000-8000-000000000007'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('a4900000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'verification_officer')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- a NIC can't pull another client's candidate
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('full_name', 'Nimal Perera', 'nic', '199012345678', 'nic_canonical', '199012345678', 'email', 'nimal@private.test', 'phone', '0771234567')));
  perform set_config('t.other', r ->> 'case_id', false);
  perform set_config('t.nimal', r ->> 'candidate_id', false);
end $$;
reset role;
update public.client_settings set visibility = '{"show_candidate_details": true}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; d jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected',
    'candidate', jsonb_build_object('full_name', 'Probing Name', 'nic', '199012345678', 'nic_canonical', '199012345678', 'email', 'typed@client.test')));
  assert not (r ? 'candidate_id') and not (r ? 'candidate_reused'), 'the client learned a record matched: ' || r::text;
  perform set_config('t.probe', r ->> 'case_id', false);
  d := public.portal_case_detail((r ->> 'case_id')::uuid);
  assert d #>> '{case,candidate,full_name}' = 'Probing Name', 'the portal showed the stored name: ' || (d -> 'case' -> 'candidate')::text;
  assert d #>> '{case,candidate,email}' = 'typed@client.test', 'the portal should show what the client typed';
  assert d::text not like '%Nimal%' and d::text not like '%nimal@private%' and d::text not like '%0771234567%', 'another client''s candidate reached the portal';
  -- Naming a record by id gets nothing either.
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('id', current_setting('t.nimal'), 'full_name', 'Other Name')));
  perform set_config('t.probe2', r ->> 'case_id', false);
  assert public.portal_case_detail((r ->> 'case_id')::uuid) #>> '{case,candidate,full_name}' = 'Other Name', 'a client picked a record by id';
  begin
    perform public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'check_type_ids', jsonb_build_array((select id from public.check_types where key = 'nic')),
      'candidate', jsonb_build_object('full_name', 'No Package')));
    raise exception 'TEST FAILED: a client ordered checks without a package';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select candidate_id::text from public.cases where id = current_setting('t.probe2')::uuid) <> current_setting('t.nimal'), 'the id was honoured';
  assert (select candidate_match_open from public.cases where id = current_setting('t.probe')::uuid), 'a different name should wait for a person';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.probe')::uuid;
begin
  begin
    perform public.case_transition(c, 'accept_request');
    raise exception 'TEST FAILED: accepted with the candidate unchecked';
  exception when sqlstate '22023' then
    assert sqlerrm like '%different name%', sqlerrm;
  end;
  perform public.resolve_candidate_match(c, false);
  assert (select candidate_id::text from public.cases where id = c) <> current_setting('t.nimal'), 'kept apart should get its own record';
  assert (select email from public.candidates where id = (select candidate_id from public.cases where id = c)) = 'typed@client.test', 'the new record holds what was typed';
  perform public.case_transition(c, 'accept_request');
end $$;
reset role;

-- ---------------------------------------------------------------- what a client can read
do $$ begin
  update public.client_settings set visibility = jsonb_build_object('hidden_check_types', jsonb_build_array((select id from public.check_types where key = 'police')))
   where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  insert into public.client_price_lists (org_id, client_id, check_type_id, unit_price)
  values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from public.check_types where key = 'nic'), 1234);
  -- A shared file on the hidden check.
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility)
  select 'a4900000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', k.case_id, k.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'police_report', 'p.pdf', 'application/pdf', 'x/p.pdf', 'accepted', 'staff', 'client'
    from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = current_setting('t.probe2')::uuid and t.key = 'police';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.probe2')::uuid; d jsonb := public.portal_case_detail(current_setting('t.probe2')::uuid); r jsonb;
begin
  assert (d #>> '{case,checks_total}')::int = 1, 'hidden checks are not counted: ' || (d -> 'case' ->> 'checks_total');
  assert jsonb_array_length(d #> '{case,checks}') = 1, 'the list follows the same rule';
  assert not (d -> 'visibility' ? 'hidden_check_types') and not (public.portal_my_visibility() ? 'hidden_check_types'), 'the hidden ids reached the client';
  assert (select count(*) from public.documents where id = 'a4900000-1111-4000-8000-000000000001') = 0, 'a file on a hidden check was readable';
  assert (select count(*) from public.orgs) = 0, 'a client read Ontriq''s settings';
  assert public.portal_org_profile() ->> 'name' is not null, 'documents still need the name';
  assert (select count(*) from public.client_status_catalog) = 0, 'a client read internal wording';
  assert public.contracted_price('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from public.check_types where key = 'nic'), null) is null, 'a client read another client''s price';
  begin
    perform public.case_outstanding_requirements(c, 'documents');
    raise exception 'TEST FAILED: a client polled internal counts';
  exception when insufficient_privilege then null;
  end;
  insert into public.packages (org_id, owner_scope, client_id, name, code, pricing_mode, fixed_price)
  values ('00000000-0000-4000-8000-000000000001', 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cheap', 'CHEAP-49', 'fixed', 1);
  r := (select to_jsonb(p) from public.packages p where code = 'CHEAP-49');
  assert r ->> 'pricing_mode' = 'sum' and r ->> 'fixed_price' is null, 'a client set their own price: ' || r::text;
end $$;
reset role;
update public.client_settings set visibility = '{"show_check_progress": false}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.case_events (org_id, case_id, kind, title, data, visible_to_client)
select org_id, id, 'check_state', 'NIC: Completed', '{"to": "completed"}', true from public.cases where id = current_setting('t.probe2')::uuid;
set local role authenticated;
do $$
declare d jsonb := public.portal_case_detail(current_setting('t.probe2')::uuid); t text;
begin
  assert d #> '{case,checks_total}' = 'null'::jsonb and jsonb_array_length(d #> '{case,checks}') = 0, 'progress is switched off, counts included';
  select string_agg(e ->> 'title', ' | ') into t from jsonb_array_elements(d -> 'timeline') e;
  assert t not like '%completed%', 'the feed still names finished checks: ' || t;
end $$;
reset role;
update public.client_settings set visibility = '{}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------- a held case stops, a closed case stays closed
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'process_type', 'client_supplied', 'candidate', jsonb_build_object('full_name', 'Dinuka Herath')));
  perform set_config('t.case', r ->> 'case_id', false);
  perform set_config('t.person', r ->> 'candidate_id', false);
  assert exists (select 1 from public.case_check_requirements q where q.case_id = (r ->> 'case_id')::uuid and q.category = 'cv' and q.status = 'pending'), 'a request starts from the CV';
  perform set_config('t.slot', (select id::text from public.case_check_requirements q where q.case_id = (r ->> 'case_id')::uuid and q.category = 'cv'), false);
  perform set_config('t.nic', (select k.id::text from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = (r ->> 'case_id')::uuid and t.key = 'nic'), false);
  perform set_config('t.edu', (select k.id::text from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = (r ->> 'case_id')::uuid and t.key = 'education'), false);
  perform set_config('t.emp', (select k.id::text from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = (r ->> 'case_id')::uuid and t.key = 'employment'), false);
  perform set_config('t.ref', (select k.id::text from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = (r ->> 'case_id')::uuid and t.key = 'reference'), false);
  -- Listed in the flowchart's order, whatever the package says.
  assert (select array_agg(t.key order by k.sort) from public.case_checks k join public.check_types t on t.id = k.check_type_id where k.case_id = (r ->> 'case_id')::uuid)
       = array['education', 'employment', 'nic', 'sanction', 'reference', 'address', 'police'], 'checks should follow the flowchart';
  perform set_config('t.file', (public.begin_document_upload((r ->> 'case_id')::uuid, null, 'nic_copy', 'n.pdf', 'application/pdf', 100) ->> 'id'), false);
  perform public.finalize_document_upload(current_setting('t.file')::uuid);
end $$;
reset role;
update public.cases set on_hold = true, held_at = now() where id = current_setting('t.case')::uuid;
set local role authenticated;
do $$
declare
  c uuid := current_setting('t.case')::uuid;
  v_step text;
  v_steps text[] := array['waive', 'request', 'review', 'upload', 'ask client', 'ask candidate', 'bgv form', 'link', 'tie'];
begin
  foreach v_step in array v_steps loop
    begin
      case v_step
        when 'waive' then perform public.waive_requirement(current_setting('t.slot')::uuid, 'not needed');
        when 'request' then perform public.request_case_document(c, null, 'other', 'Something');
        when 'review' then perform public.review_document(current_setting('t.file')::uuid, true);
        when 'upload' then perform public.begin_document_upload(c, null, 'other', 'o.pdf', 'application/pdf', 100);
        when 'ask client' then perform public.create_client_request(c, null, 'Anything?');
        when 'ask candidate' then perform public.create_candidate_request(c, '{"kind":"question","title":"Anything?"}');
        when 'bgv form' then perform public.issue_bgv_form(c);
        when 'link' then perform public.issue_candidate_link(c, repeat('e', 64), 'enc', 'en', 14);
        when 'tie' then perform public.set_document_original(current_setting('t.file')::uuid, 'copy');
      end case;
      raise exception 'TEST FAILED: % went through on a held case', v_step;
    exception when sqlstate '22023' then
      assert sqlerrm like '%on hold%', v_step || ': ' || sqlerrm;
    end;
  end loop;
end $$;
reset role;
update public.cases set on_hold = false, held_at = null, stage = 'released' where id = current_setting('t.other')::uuid;
update public.cases set on_hold = false, held_at = null where id = current_setting('t.case')::uuid;
set local role authenticated;
do $$
declare
  c uuid := current_setting('t.other')::uuid;
  v_slot uuid := (select id from public.case_check_requirements where case_id = current_setting('t.other')::uuid limit 1);
  v_check uuid := (select id from public.case_checks where case_id = current_setting('t.other')::uuid limit 1);
begin
  begin
    perform public.waive_requirement(v_slot, 'not needed');
    raise exception 'TEST FAILED: waived on a closed case';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.update_case_details(c, '{"position_title":"Changed"}');
    raise exception 'TEST FAILED: details changed on a closed case';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.assign_check(v_check, 'a4900000-0000-4000-8000-000000000002');
    raise exception 'TEST FAILED: assigned on a closed case';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------- who may write
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.add_case_note(current_setting('t.case')::uuid, null, 'A viewer writing');
  raise exception 'TEST FAILED: a viewer wrote a note';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  update public.cases set stage = 'verification' where id = c;
  update public.case_checks set state = 'in_progress', assigned_to = 'a4900000-0000-4000-8000-000000000002' where case_id = c;
  update public.case_checks set assigned_to = 'a4900000-0000-4000-8000-000000000008' where id = current_setting('t.ref')::uuid;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.save_check_values(current_setting('t.nic')::uuid, '{}', false);
  raise exception 'TEST FAILED: an officer edited someone else''s check';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- a check records what the source said
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare
  k uuid := current_setting('t.edu')::uuid;
  v_entry jsonb := '{"candidate_name":"Dinuka Herath","qualification_level":"degree","qualification":"BSc","institution":"Colombo","student_number":"1","year_of_completion":2015}';
begin
  perform public.save_check_values(k, v_entry, true);
  assert not (select values_valid from public.case_checks where id = k), 'nothing from the source is recorded yet';
  begin
    perform public.set_check_state(k, 'completed', 'clear');
    raise exception 'TEST FAILED: verified with nothing from the source';
  exception when sqlstate '22023' then
    assert sqlerrm like '%what the source confirmed%', sqlerrm;
  end;
  -- A source that never replied has nothing to record. The finding says so.
  perform public.set_check_state(k, 'unable_to_verify', null, null, 'The institution has not replied');
  assert (select state from public.case_checks where id = k) = 'unable_to_verify', 'unable to verify should not need a reply';
  perform public.set_check_state(k, 'in_progress');
  perform public.save_check_values(k, v_entry || '{"qualification_level":"not an option","confirmed_by":"Registrar","confirmation_channel":"email","confirmed_on":"2026-10-01"}', true);
  assert not (select values_valid from public.case_checks where id = k), 'an option that doesn''t exist was accepted';
  perform public.save_check_values(k, v_entry || '{"year_of_completion":2015.5,"confirmed_by":"Registrar","confirmation_channel":"email","confirmed_on":"2026-10-01"}', true);
  assert not (select values_valid from public.case_checks where id = k), 'half a year was accepted';
  perform public.save_check_values(k, v_entry || '{"confirmed_by":"Registrar","confirmation_channel":"email","confirmed_on":"2026-10-01"}', true);
  assert (select values_valid from public.case_checks where id = k), 'complete details should pass';
  -- The state and the result say the same thing.
  begin
    perform public.set_check_state(k, 'discrepancy', 'clear', null, 'The dates differ');
    raise exception 'TEST FAILED: a discrepancy came out clear';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.set_check_state(k, 'unable_to_verify', 'clear', null, 'No reply');
    raise exception 'TEST FAILED: unable to verify came out clear';
  exception when sqlstate '22023' then null;
  end;
  perform public.set_check_state(k, 'discrepancy', null, null, 'The dates differ');
  begin
    perform public.set_check_remarks(k, '   ');
    raise exception 'TEST FAILED: a finding was blanked';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.set_check_state(k, 'discrepancy', null, null, '');
    raise exception 'TEST FAILED: a discrepancy lost its finding';
  exception when sqlstate '22023' then null;
  end;
  perform public.set_check_state(k, 'discrepancy');
  assert (select client_note from public.case_checks where id = k) = 'The dates differ', 'leaving the note out should keep the finding';
  -- A check that comes out clear can drop the old finding, or it prints beside Clear.
  begin
    perform public.set_check_state(k, 'in_progress');
    perform public.set_check_state(k, 'completed', 'clear', null, '');
    assert (select client_note from public.case_checks where id = k) is null, 'an empty note should clear the finding';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

-- ---------------------------------------------------------------- a file for each employer
reset role;
do $$
declare k uuid := current_setting('t.emp')::uuid; c uuid := current_setting('t.case')::uuid; r uuid;
begin
  update public.case_checks set values_valid = true, values = '{"employers":[{"company":"Dialog"},{"company":"SLT"}]}' where id = k;
  update public.case_check_requirements set status = 'received' where case_check_id = k and category = 'service_letter';
  select id into r from public.case_check_requirements where case_check_id = k and category = 'service_letter';
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, record_key)
  values ('a4900000-1111-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, k, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'service_letter', 'one.pdf', 'application/pdf', 'x/1.pdf', 'accepted', 'staff', 'employers.0');
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('a4900000-1111-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'combined.pdf', 'application/pdf', 'x/c.pdf', 'accepted', 'staff');
  insert into public.requirement_files (org_id, case_id, requirement_id, document_id, source) values ('00000000-0000-4000-8000-000000000001', c, r, 'a4900000-1111-4000-8000-000000000003', 'staff');
  assert cardinality(public.check_record_gaps(k)) = 1, 'a combined file with no rows named covers nobody';
  update public.requirement_files set record_keys = array['employers.1'] where document_id = 'a4900000-1111-4000-8000-000000000003';
  assert cardinality(public.check_record_gaps(k)) = 0, 'the row a person named should count';
  update public.documents set status = 'rejected' where id = 'a4900000-1111-4000-8000-000000000003';
  assert cardinality(public.check_record_gaps(k)) = 1, 'a rejected file covers nothing';
  update public.documents set status = 'accepted' where id = 'a4900000-1111-4000-8000-000000000003';
end $$;

-- ---------------------------------------------------------------- one file, one slot, and files can move
do $$
declare c uuid; r jsonb; v_a uuid; v_b uuid;
begin
  c := current_setting('t.case')::uuid;
  v_a := current_setting('t.edu')::uuid;
  -- A second education record on the same case.
  insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort)
  select org_id, case_id, check_type_id, check_type_version_id, 'Education: Secondary', 15 from public.case_checks where id = v_a returning id into v_b;
  perform set_config('t.edu2', v_b::text, false);
  update public.case_check_requirements set status = 'pending', received_count = 0 where case_check_id = v_a;
  insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, min_count, stage, status)
  values ('00000000-0000-4000-8000-000000000001', c, v_b, 'education_certificate', 'Certificates', 1, 'documents', 'pending');
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('a4900000-1111-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'education_certificate', 'cert.pdf', 'application/pdf', 'x/cert.pdf', 'uploaded', 'staff');
  assert (select count(*) from public.case_check_requirements where case_id = c and category = 'education_certificate' and status = 'received') = 0, 'one whole-case file filled two slots';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.refile_document('a4900000-1111-4000-8000-000000000004', current_setting('t.edu2')::uuid, 'education_certificate');
  assert (select status from public.case_check_requirements where case_check_id = current_setting('t.edu2')::uuid and category = 'education_certificate') = 'received', 'the slot should count the moved file';
  assert exists (select 1 from public.case_events where case_id = c and kind = 'document_refiled'), 'the move should be on the timeline';
end $$;
reset role;

-- ---------------------------------------------------------------- signing fills the consent slot, a drawing doesn't
do $$
declare c uuid := current_setting('t.case')::uuid; v_slot uuid;
begin
  update public.case_check_requirements set status = 'pending' where case_id = c and category = 'consent_form' returning id into v_slot;
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'consent_form', 'signature.png', 'image/png', 'x/s.png', 'uploaded', 'candidate');
  assert (select status from public.case_check_requirements where id = v_slot) = 'pending', 'a drawn signature filled the BGV form slot';
  insert into public.consent_forms (org_id, case_id, status, method, signed_name) values ('00000000-0000-4000-8000-000000000001', c, 'submitted', 'esign', 'Dinuka Herath');
  assert (select status from public.case_check_requirements where id = v_slot) = 'received', 'signing online should fill the consent slot';
end $$;

-- ---------------------------------------------------------------- only what the approver saw goes out
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.case_checks set state = 'waived', result = null, result_tone = null where case_id = c;
  update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green', client_note = null where id = current_setting('t.nic')::uuid;
  update public.cases set stage = 'report', assigned_to = 'a4900000-0000-4000-8000-000000000002' where id = c;
  perform public.recompute_case(c);
  insert into public.documents (id, org_id, case_id, case_check_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility, sensitive)
  values ('a4900000-1111-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', c, current_setting('t.nic')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nic_copy', 'secret.pdf', 'application/pdf', 'x/secret.pdf', 'accepted', 'staff', 'report', true);
  insert into public.report_versions (id, org_id, case_id, version, kind, status) values ('a4900000-2222-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 1, 'draft', 'rendering');
  perform public.report_render_done('a4900000-2222-4000-8000-000000000001', true,
    '{"annexures":[{"document_id":"a4900000-1111-4000-8000-000000000005","filename":"secret.pdf"}]}'::jsonb, 'h1', 'x/draft.pdf', 'sha', 3, 100,
    '[{"title":"Bad","filename":"bad.pdf","kind":"evidence","embedded":false,"attached":false,"altered":false}]'::jsonb);
  assert (select source_stamp from public.report_versions where id = 'a4900000-2222-4000-8000-000000000001') is not null, 'the draft should carry a stamp';
end $$;
set local role authenticated;
-- Someone allowed to preview reports, but not sensitive evidence.
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.report_download('a4900000-2222-4000-8000-000000000001');
  raise exception 'TEST FAILED: the report opened sensitive evidence for a viewer';
exception when insufficient_privilege then null;
end $$;
reset role;
update public.report_versions set snapshot = '{"checks":[{"evidence":["x"]}]}' where id = 'a4900000-2222-4000-8000-000000000001' and snapshot is null;
set local role authenticated;
do $$ begin
  assert public.reports_closed_to_caller(array['a4900000-2222-4000-8000-000000000001'::uuid]) = array['a4900000-2222-4000-8000-000000000001'::uuid],
    'the list should know a viewer can''t open this report';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert cardinality(public.reports_closed_to_caller(array['a4900000-2222-4000-8000-000000000001'::uuid])) = 0, 'the case owner can open it';
end $$;
-- The case owner works on it, so they can open it, but they can't wave a bad file through.
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert public.report_download('a4900000-2222-4000-8000-000000000001') ->> 'path' = 'x/draft.pdf', 'the owner should open the draft';
  begin
    perform public.submit_report(c);
    raise exception 'TEST FAILED: a draft that lost a file went for approval';
  exception when sqlstate '22023' then
    assert sqlerrm like '%bad.pdf%', sqlerrm;
  end;
  begin
    perform public.submit_report(c, 'The employer never sent a better copy');
    raise exception 'TEST FAILED: an officer overrode a lost file';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.submit_report(c, 'The employer never sent a better copy');
  assert (select evidence_note from public.report_versions where id = 'a4900000-2222-4000-8000-000000000001') like '%never sent%', 'the reason should be kept';
end $$;
reset role;
update public.case_checks set client_note = 'Changed after the draft' where id = current_setting('t.nic')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  -- Sending the draft's own hash is what a direct call would do. It changes nothing.
  perform public.approve_report(c, 'a4900000-2222-4000-8000-000000000001', 'green', 'h1', null, true, true);
  raise exception 'TEST FAILED: a stale draft was approved';
exception when sqlstate '22023' then
  assert sqlerrm like '%changed after this draft%', sqlerrm;
end $$;
reset role;
update public.case_checks set client_note = null where id = current_setting('t.nic')::uuid;
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid; d uuid := 'a4900000-2222-4000-8000-000000000001';
begin
  begin
    perform public.approve_report(c, d, 'amber', 'h1', null, true, true);
    raise exception 'TEST FAILED: the result changed with no reason';
  exception when sqlstate '22023' then
    assert sqlerrm like '%differs%', sqlerrm;
  end;
  begin
    perform public.approve_report(c, d, 'green', 'h1', null, false, true);
    raise exception 'TEST FAILED: sensitive evidence went without a decision';
  exception when sqlstate '22023' then
    assert sqlerrm like '%sensitive%', sqlerrm;
  end;
  begin
    perform public.approve_report(c, d, 'green', 'h1', null, true, false);
    raise exception 'TEST FAILED: approved over a lost file';
  exception when sqlstate '22023' then
    assert sqlerrm like '%evidence problems%', sqlerrm;
  end;
  perform public.approve_report(c, d, 'green', 'h1', null, true, true);
  assert (select final_result from public.cases where id = c) = 'green', 'should approve';
end $$;
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.report_versions set status = 'ready', storage_path = 'x/final.pdf',
         annexures = '[{"title":"Bad","filename":"bad.pdf","kind":"evidence","embedded":false},{"title":"NIC","filename":"nic.pdf","kind":"evidence","embedded":false}]'
   where case_id = c and kind = 'final';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.release_report(c);
  raise exception 'TEST FAILED: released a final that lost a file the draft had';
exception when sqlstate '22023' then
  assert sqlerrm like '%nic.pdf%', sqlerrm;
end $$;
reset role;
update public.report_versions set annexures = '[{"title":"Bad","filename":"bad.pdf","kind":"evidence","embedded":false}]' where case_id = current_setting('t.case')::uuid and kind = 'final';
update public.documents set visibility = 'internal' where id = 'a4900000-1111-4000-8000-000000000005';
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.release_report(c);
  raise exception 'TEST FAILED: released after the evidence changed';
exception when sqlstate '22023' then
  assert sqlerrm like '%changed after approval%', sqlerrm;
end $$;
reset role;
update public.documents set visibility = 'report' where id = 'a4900000-1111-4000-8000-000000000005';
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    perform public.release_report(c, array['a4900000-0000-4000-8000-000000000001'::uuid]);
    raise exception 'TEST FAILED: released to someone outside the client';
  exception when sqlstate '22023' then null;
  end;
  perform public.release_report(c, array['a4900000-0000-4000-8000-000000000004'::uuid]);
  assert (select stage from public.cases where id = c) = 'released', 'should release';
end $$;

-- ---------------------------------------------------------------- recipients can grow, and never open up by accident
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is null, 'someone off the list read the report';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.add_report_recipients(current_setting('t.case')::uuid, array['a4900000-0000-4000-8000-000000000005'::uuid]) = 1, 'a later joiner should be addable';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is not null, 'the new recipient should read it';
end $$;
reset role;
update public.report_recipients set user_id = null
 where report_version_id in (select id from public.report_versions where case_id = current_setting('t.case')::uuid);
set local role authenticated;
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is null, 'a deleted account opened the report to everyone';
end $$;
reset role;

-- ---------------------------------------------------------------- a revision that stops leaves the report standing
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.report_recipients set user_id = 'a4900000-0000-4000-8000-000000000005'
   where report_version_id in (select id from public.report_versions where case_id = c);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.revise_report(c, 'Wrong employer name');
  assert (select stage from public.cases where id = c) = 'report', 'revision goes back to the report stage';
  perform public.cancel_case(c, 'No revision needed after all');
  assert (select stage from public.cases where id = c) = 'released' and (select cancelled_at from public.cases where id = c) is null, 'a stopped revision is not a cancelled case';
  assert (select final_result from public.cases where id = c) = 'green', 'the released result stands';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb := public.portal_case_detail(current_setting('t.case')::uuid);
begin
  assert d #>> '{report,status}' = 'released', 'the portal should read released: ' || (d -> 'report')::text;
end $$;
reset role;

-- ---------------------------------------------------------------- stopping a revision tells the truth
delete from public.notifications where entity_id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  perform public.revise_report(c, 'One more look');
  perform public.cancel_case(c, 'Nothing to change');
end $$;
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert not exists (select 1 from public.notifications where entity_id = c and type = 'portal.report_released'), 'stopping a revision said a report was available';
  assert exists (select 1 from public.case_events where case_id = c and data ->> 'event' = 'revision_cancelled' and data ->> 'label' like 'Revision stopped%'), 'the feed should say the revision stopped';
end $$;
-- A revision that reopened work can't be walked away from: the portal reads the live checks of a released case.
set local role authenticated;
do $$
declare c uuid := current_setting('t.case')::uuid; k uuid;
begin
  begin
    perform public.revise_report(c, 'Second look');
    select id into k from public.case_checks where case_id = c and state = 'completed' order by sort limit 1;
    perform public.return_to_verification(c, 'One check needs another look', array[k]);
    assert (select public.portal_report_status(x) from public.cases x where x.id = c) = 'revising', 'the released report should read as being revised';
    begin
      perform public.cancel_case(c, 'Never mind');
      raise exception 'TEST FAILED: a revision that reopened a check was stopped';
    exception when sqlstate '22023' then
      assert sqlerrm like '%finish the revision%', sqlerrm;
    end;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  begin
    update public.cases set stage = 'report' where id = c;
    update public.case_checks set client_note = 'Reworded in the revision' where id = current_setting('t.nic')::uuid;
    begin
      perform public.cancel_case(c, 'Never mind');
      raise exception 'TEST FAILED: a revision that reworded a finding was stopped';
    exception when sqlstate '22023' then
      assert sqlerrm like '%finish the revision%', sqlerrm;
    end;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

-- ---------------------------------------------------------------- nobody is asked for what they can't send
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('full_name', 'Late Request')));
  perform set_config('t.late', r ->> 'case_id', false);
end $$;
reset role;
do $$
declare c uuid := current_setting('t.late')::uuid;
begin
  assert exists (select 1 from public.notifications where entity_id = c and type = 'portal.documents_needed'), 'the client should hear what is needed when the case opens';
  assert public.portal_pending_slots(c) > 0, 'the fixture should owe documents';
  update public.cases set stage = 'post_qc' where id = c;
  assert public.portal_pending_slots(c) = 0, 'a document nobody can upload any more is not waiting on the client';
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('a4900000-1111-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'late.pdf', 'application/pdf', 'x/late.pdf', 'uploaded', 'client');
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('t.late')::uuid;
begin
  begin
    perform public.request_case_document(c, null, 'other', 'Another file', 'Please send it');
    raise exception 'TEST FAILED: a file was asked for after uploads closed';
  exception when sqlstate '22023' then
    assert sqlerrm like '%back to verification%', sqlerrm;
  end;
  begin
    perform public.create_candidate_request(c, jsonb_build_object('kind', 'document', 'category', 'nic_copy'));
    raise exception 'TEST FAILED: a candidate was asked for a file after uploads closed';
  exception when sqlstate '22023' then
    assert sqlerrm like '%back to verification%', sqlerrm;
  end;
  begin
    perform public.review_document('a4900000-1111-4000-8000-000000000009', false, 'Blurred');
    raise exception 'TEST FAILED: a client''s file was rejected with no way to replace it';
  exception when sqlstate '22023' then
    assert sqlerrm like '%back to verification%', sqlerrm;
  end;
  perform public.review_document('a4900000-1111-4000-8000-000000000009', true);
end $$;
-- An import tells the client once.
do $$
declare i int;
begin
  for i in 1..3 loop
    perform public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
      'created_via', 'import', 'candidate', jsonb_build_object('full_name', 'Imported ' || i)));
  end loop;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where title = 'New cases need documents') = (select count(distinct user_id) from public.notifications where title = 'New cases need documents'),
    'an import told someone more than once';
  assert exists (select 1 from public.notifications where title = 'New cases need documents'), 'an import should still tell them';
  assert not has_function_privilege('authenticated', 'public.check_record_gaps(uuid)', 'execute'), 'a helper is open to anyone signed in';
  assert not has_function_privilege('authenticated', 'public.case_evidence_gaps(uuid)', 'execute'), 'a helper is open to anyone signed in';
end $$;

-- ---------------------------------------------------------------- notifications say a thing once
do $$
declare c uuid := current_setting('t.probe2')::uuid;
begin
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  update public.case_checks set state = 'not_started' where case_id = c;
  delete from public.notifications;
  update public.cases set candidate_match_open = false where id = c;
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'o.pdf', 'application/pdf', 'x/o.pdf', 'uploaded', 'client');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.case_transition(current_setting('t.probe2')::uuid, 'accept_request');
end $$;
reset role;
do $$ begin
  assert (select status_key from public.cases where id = current_setting('t.probe2')::uuid) = 'document_review', 'the fixture should reach document review';
  assert not exists (select 1 from public.notifications where type = 'portal.case_status'), 'accepting the request told the client twice';
  assert exists (select 1 from public.notifications where type = 'portal.case_accepted'), 'the client should hear it was accepted';
end $$;

-- ---------------------------------------------------------------- erasure leaves nothing personal behind
select set_config('request.jwt.claims', '', true);
do $$
declare c uuid := current_setting('t.case')::uuid; v_person uuid := current_setting('t.person')::uuid; r jsonb;
begin
  -- The same person on a second, live case: their record has to stay.
  insert into public.cases (org_id, reference, client_id, candidate_id, candidate_name, package_snapshot, stage, status_key)
  select org_id, 'OTHER-49', client_id, candidate_id, candidate_name, package_snapshot, 'documents', 'documents_pending' from public.cases where id = c;
  insert into public.communications (org_id, case_id, client_id, channel, direction, counterparty, subject, outcome, body)
  values ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'phone', 'outbound', 'Dinuka Herath', 'About Dinuka', 'Spoke to Dinuka', 'Called');
  insert into public.email_outbox (org_id, to_emails, subject, html, entity_type, entity_id)
  values ('00000000-0000-4000-8000-000000000001', array['dinuka@private.test'], 'Dinuka, your documents', '<p>Hi</p>', 'case', c);
  insert into public.sms_outbox (org_id, to_phone, body, entity_type, entity_id)
  values ('00000000-0000-4000-8000-000000000001', '0771112222', 'Hi', 'case', c);
  update public.case_check_requirements set requested_note = 'Dinuka sent the wrong letter' where case_id = c;
  update public.documents set rejection_reason = 'Not Dinuka''s letter', label = 'Dinuka letter' where case_id = c;
  insert into public.case_events (org_id, case_id, kind, title) select org_id, id, 'contact_logged', 'Contact logged: Dinuka Herath' from public.cases where id = c;
  insert into public.notifications (org_id, user_id, type, title, body, entity_id)
  values ('00000000-0000-4000-8000-000000000001', 'a4900000-0000-4000-8000-000000000005', 'portal.information_needed', 'A question', 'Is Dinuka your employee?', c);
  r := public.erase_case(c, 'Dinuka Herath asked for this');
  assert (select candidate_id from public.cases where id = c) <> v_person, 'the erased case still points at the person';
  assert (select full_name from public.candidates where id = v_person) = 'Dinuka Herath', 'the person''s other case still needs them';
  assert (select full_name from public.candidates where id = (select candidate_id from public.cases where id = c)) = 'Erased candidate', 'the erased case should point at nobody';
  assert (select erasure_reason from public.cases where id = c) = 'the candidate asked for this', 'the reason kept the name';
  assert not exists (select 1 from public.case_events where case_id = c and title like '%Dinuka%'), 'event titles kept the name';
  assert not exists (select 1 from public.case_events where case_id = c and title like '%.pdf%'), 'event titles kept a file name';
  assert not exists (select 1 from public.case_check_requirements where case_id = c and requested_note is not null), 'requests kept their notes';
  assert not exists (select 1 from public.documents where case_id = c and (rejection_reason is not null or label is not null or sha256 is not null or candidate_id is not null)), 'documents kept details';
  assert not exists (select 1 from public.communications where case_id = c and (subject is not null or outcome is not null)), 'contact records kept details';
  assert (select to_emails from public.email_outbox where entity_id = c) = array['erased'], 'the email address stayed';
  assert (select status from public.email_outbox where entity_id = c) = 'skipped', 'a queued email would still have gone out';
  assert (select to_phone from public.sms_outbox where entity_id = c) = '[erased]', 'the phone number stayed';
  assert not exists (select 1 from public.notifications where entity_id = c and body like '%Dinuka%'), 'a notification kept the question';
  assert (select count(*) from public.storage_deletions where case_id = c and done_at is null and is_folder) = 2, 'the folders should be queued for removal';
  assert (select count(*) from public.storage_deletions where case_id = c and path = 'x/secret.pdf') = 1, 'each file should be queued for removal';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.revise_report(current_setting('t.case')::uuid, 'After erasure');
  raise exception 'TEST FAILED: an erased case went back to work';
exception when sqlstate '22023' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb := public.portal_case_detail(current_setting('t.case')::uuid); t text;
begin
  select string_agg(e ->> 'title', ' | ') into t from jsonb_array_elements(d -> 'timeline') e;
  assert t like '%Report%' and t not like '%Cancelled%', 'the feed of an erased case misread its stages: ' || t;
end $$;
reset role;

rollback;
\o
\echo '  ✓ final audit'
