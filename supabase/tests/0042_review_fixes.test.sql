\o /dev/null
-- Fixes from the independent re-audit (0042).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4200000-0000-4000-8000-000000000001', 'admin42@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4200000-0000-4000-8000-000000000002', 'verify42@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4200000-0000-4000-8000-000000000003', 'clientadmin42@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a4200000-0000-4000-8000-000000000004', 'clientuser42@hemas.test', '{"full_name":"Upul User"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4200000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4200000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4200000-0000-4000-8000-000000000003'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a4200000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_user')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'process_type', 'client_supplied', 'candidate', jsonb_build_object('full_name', 'Dinuka Herath')));
  perform set_config('t.case', r ->> 'case_id', false);
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Ishara Gunasekara')));
  perform set_config('t.case2', r ->> 'case_id', false);
end $$;
reset role;

-- ---------------------------------------------------------------- the BGV form and consent
do $$
declare c uuid := current_setting('t.case')::uuid; c2 uuid := current_setting('t.case2')::uuid;
begin
  assert (select count(*) from public.case_check_requirements where case_id = c and category = 'consent_form' and client_visible and status = 'pending') = 1, 'a client-supplied case needs a BGV form slot';
  assert not exists (select 1 from public.case_check_requirements where case_id = c2 and category = 'consent_form'), 'the candidate signs on their own page';
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c2;
  begin
    update public.cases set stage = 'pre_qc' where id = c2;
    raise exception 'TEST FAILED: a candidate-collected case passed without consent';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------- evidence by default
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('a4200000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'service_letter', 'letter.pdf', 'application/pdf', 'x/letter.pdf', 'accepted', 'staff'),
         ('a4200000-1111-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cv', 'cv.pdf', 'application/pdf', 'x/cv.pdf', 'accepted', 'staff');
  assert (select visibility from public.documents where id = 'a4200000-1111-4000-8000-000000000001') = 'report', 'evidence should go in the report by default';
  assert (select visibility from public.documents where id = 'a4200000-1111-4000-8000-000000000002') = 'internal', 'a CV stays internal';
end $$;

-- ---------------------------------------------------------------- results that can't mislead
reset role;
update public.cases set stage = 'verification' where id = current_setting('t.case')::uuid;
update public.case_checks set values_valid = true where case_id = current_setting('t.case')::uuid;
update public.case_checks set values = '{"sanctions_found":"yes"}' where id = (select c.id from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid and t.key = 'sanction');
set local role authenticated;
do $$
declare k uuid; n uuid; w uuid;
begin
  select c.id into k from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid and t.key = 'sanction';
  select c.id into n from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid and t.key = 'nic';
  select c.id into w from public.case_checks c join public.check_types t on t.id = c.check_type_id where c.case_id = current_setting('t.case')::uuid and t.key = 'address';
  begin
    perform public.set_check_state(k, 'completed', 'clear');
    raise exception 'TEST FAILED: sanctions found came out clear';
  exception when sqlstate '22023' then assert sqlerrm like 'sanctions were found%', sqlerrm;
  end;
  begin
    perform public.set_check_state(n, 'completed', 'pending');
    raise exception 'TEST FAILED: pending review recorded as completed';
  exception when sqlstate '22023' then null;
  end;
  perform public.set_check_state(w, 'waived', null, 'The client removed this check');
  assert (select client_note from public.case_checks where id = w) = 'The client removed this check', 'a waived check should print its reason';
end $$;

-- ---------------------------------------------------------------- the way back from the report
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green' where case_id = c and state <> 'waived';
  update public.cases set stage = 'report' where id = c;
  insert into public.report_versions (org_id, case_id, version, kind, status) values ('00000000-0000-4000-8000-000000000001', c, 1, 'draft', 'ready');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.return_to_verification(current_setting('t.case')::uuid, 'Wrong date', array[(select id from public.case_checks where case_id = current_setting('t.case')::uuid limit 1)]);
  raise exception 'TEST FAILED: an officer reopened a case at the report stage';
exception when insufficient_privilege or sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid;
begin
  select id into k from public.case_checks where case_id = current_setting('t.case')::uuid and state = 'completed' order by sort limit 1;
  begin
    perform public.return_to_verification(current_setting('t.case')::uuid, 'Nothing chosen');
    raise exception 'TEST FAILED: back to verification with nothing to do';
  exception when sqlstate '22023' then null;
  end;
  perform public.return_to_verification(current_setting('t.case')::uuid, 'The employment dates are wrong', array[k]);
  assert (select stage from public.cases where id = current_setting('t.case')::uuid) = 'verification', 'the case should be back in verification';
  assert (select state from public.case_checks where id = k) = 'returned', 'the chosen check should reopen';
  assert (select status from public.report_versions where case_id = current_setting('t.case')::uuid and version = 1) = 'superseded', 'the old draft no longer counts';
end $$;

-- ---------------------------------------------------------------- the client's feed
reset role;
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  update public.cases set stage = 'documents', returned_at = null where id = c;
  perform public.log_case_event(c, null, 'document_uploaded', 'Police clearance report uploaded', 'police.pdf', '{}'::jsonb, true, true);
  perform public.log_case_event(c, null, 'document_uploaded', 'CV uploaded by the client', 'mine.pdf', '{"by":"client"}'::jsonb, true, false);
  perform public.log_case_event(c, null, 'document_rejected', 'letter.pdf needs replacing', 'Blurred', jsonb_build_object('document_id', 'a4200000-1111-4000-8000-000000000001'), true, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb; t text;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  t := (d -> 'timeline')::text;
  assert t like '%CV uploaded by the client%', 'their own upload should show';
  assert t not like '%Police clearance report uploaded%', 'staff evidence reached the feed';
  assert t not like '%letter.pdf%', 'someone else''s rejected file reached the feed';
end $$;

-- ---------------------------------------------------------------- hidden checks
reset role;
update public.client_settings set visibility = jsonb_build_object('hidden_check_types', jsonb_build_array((select id from public.check_types where key = 'police')))
 where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert not exists (select 1 from jsonb_array_elements(d -> 'requirements') x where x ->> 'category' = 'police_report'), 'a hidden check''s document slot reached the portal';
end $$;
reset role;
update public.client_settings set visibility = '{}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------- recipients limit results too
do $$
declare c uuid := current_setting('t.case')::uuid; v uuid;
begin
  update public.cases set stage = 'released', released_at = now(), final_result = 'green' where id = c;
  update public.case_checks set client_note = 'Confirmed.' where case_id = c;
  insert into public.report_versions (org_id, case_id, version, kind, status, storage_path, released_at)
  values ('00000000-0000-4000-8000-000000000001', c, 5, 'final', 'released', 'x.pdf', now()) returning id into v;
  insert into public.report_recipients (org_id, report_version_id, user_id) values ('00000000-0000-4000-8000-000000000001', v, 'a4200000-0000-4000-8000-000000000003');
end $$;
set local role authenticated;
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert (d -> 'case' ->> 'results_visible')::boolean, 'the chosen recipient sees results';
  assert d -> 'case' ->> 'final_result' = 'green', 'the chosen recipient sees the result';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert not (d -> 'case' ->> 'results_visible')::boolean, 'someone not chosen must not see results';
  assert d -> 'case' ->> 'final_result' is null, 'someone not chosen must not see the final result';
  assert not exists (select 1 from jsonb_array_elements(d -> 'checks') k where k ->> 'client_note' is not null or jsonb_array_length(k -> 'fields') > 0), 'someone not chosen must not see notes or fields';
end $$;

-- ---------------------------------------------------------------- records follow their rows
reset role;
do $$
declare d uuid := 'a4200000-1111-4000-8000-000000000001'; k uuid;
begin
  select id into k from public.case_checks where case_id = current_setting('t.case')::uuid limit 1;
  update public.documents set case_check_id = k, record_key = 'employers.2' where id = d;
  update public.cases set stage = 'verification' where id = current_setting('t.case')::uuid;
  perform set_config('t.k', k::text, false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.remap_check_records(current_setting('t.k')::uuid, '{"employers.2":"employers.1"}');
end $$;
reset role;
do $$ begin
  assert (select record_key from public.documents where id = 'a4200000-1111-4000-8000-000000000001') = 'employers.1', 'the file should follow its row';
end $$;

-- ---------------------------------------------------------------- a hold really stops the clock
do $$
declare c uuid := current_setting('t.case')::uuid; before timestamptz;
begin
  update public.cases set stage = 'verification', on_hold = true, held_at = now() - interval '3 days' where id = c;
  select due_at into before from public.cases where id = c;
  perform set_config('t.due', before::text, false);
end $$;
set local role authenticated;
do $$ begin
  perform public.set_case_hold(current_setting('t.case')::uuid, false);
  assert (select due_at from public.cases where id = current_setting('t.case')::uuid) >= current_setting('t.due')::timestamptz + interval '3 days', 'resuming should move the due date on';
end $$;

rollback;
\echo '  ✓ review fixes'
