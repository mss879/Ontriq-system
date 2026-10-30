\o /dev/null
-- The rest of the requirements audit (0041).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4100000-0000-4000-8000-000000000001', 'admin41@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4100000-0000-4000-8000-000000000002', 'verify41@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4100000-0000-4000-8000-000000000003', 'clientadmin41@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a4100000-0000-4000-8000-000000000004', 'clientuser41@hemas.test', '{"full_name":"Upul User"}'),
  ('a4100000-0000-4000-8000-000000000005', 'clientview41@hemas.test', '{"full_name":"Vijitha Viewer"}'),
  ('a4100000-0000-4000-8000-000000000006', 'other41@other.test', '{"full_name":"Other Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4100000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4100000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4100000-0000-4000-8000-000000000003'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a4100000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_user'),
  ('a4100000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_viewer'),
  ('a4100000-0000-4000-8000-000000000006'::uuid, 'client', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'client_user')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'candidate', jsonb_build_object('full_name', 'Sachini Fernando')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;

-- ---------------------------------------------------------------- new check versions
do $$
declare s jsonb; f jsonb;
begin
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'reference';
  select x into f from jsonb_array_elements(s #> '{fields,0,fields}') x where x ->> 'key' = 'contact_number';
  assert (f #>> '{visibility,report}')::boolean, 'referee contact numbers should print';
  select v.schema into s from public.check_types t join public.check_type_versions v on v.id = t.current_version_id where t.key = 'employment';
  select x into f from jsonb_array_elements(s #> '{fields,1,fields}') x where x ->> 'key' = 'hr_contact';
  assert not (f #>> '{visibility,report}')::boolean, 'HR contacts stay staff-only';
  select x into f from jsonb_array_elements(s #> '{fields,1,fields}') x where x ->> 'key' = 'employment_type';
  assert f -> 'fill_by' ? 'candidate', 'candidates should say what type of job it was';
  assert (select r.client_visible from public.case_check_requirements r where r.case_id = current_setting('t.case')::uuid and r.category = 'gn_certificate'), 'the client should send the GN certificate';
  assert (select r.client_visible from public.case_check_requirements r where r.case_id = current_setting('t.case')::uuid and r.category = 'police_report'), 'the client should send the police report';
  assert not (select r.client_visible from public.case_check_requirements r where r.case_id = current_setting('t.case')::uuid and r.category = 'sanction_report'), 'the sanction report stays with Ontriq';
  assert public.candidate_providable('police_report', 'verification'), 'the candidate should send a police report';
  assert not public.candidate_providable('sanction_report', 'verification'), 'the sanction report stays with Ontriq';
  assert not public.candidate_providable('consent_form', 'documents'), 'consent has its own step';
end $$;

-- ---------------------------------------------------------------- adding a check
set local role authenticated;
do $$
declare k uuid; before int;
begin
  before := (select checks_total from public.cases where id = current_setting('t.case')::uuid);
  k := public.add_case_check(current_setting('t.case')::uuid, (select id from public.check_types where key = 'education'), 'Education: A/L');
  perform set_config('t.alevel', k::text, false);
  assert (select checks_total from public.cases where id = current_setting('t.case')::uuid) = before + 1, 'the new check should count';
  assert exists (select 1 from public.case_check_requirements where case_check_id = k and category = 'education_certificate'), 'the new check needs its documents';
  begin
    perform public.add_case_check(current_setting('t.case')::uuid, (select id from public.check_types where key = 'education'), 'Education: A/L');
    raise exception 'TEST FAILED: two checks with one name';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.add_case_check(current_setting('t.case')::uuid, (select id from public.check_types where key = 'education'), 'Education: O/L');
  raise exception 'TEST FAILED: an officer added a check';
exception when insufficient_privilege or sqlstate 'P0002' then null;
end $$;

-- ---------------------------------------------------------------- statuses
reset role;
do $$
declare
  c uuid := current_setting('t.case')::uuid;
  status text;
begin
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'documents_pending', 'nothing to review yet';
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cv', 'cv.pdf', 'application/pdf', 'x/cv.pdf', 'uploaded', 'client');
  assert (select status_key from public.cases where id = c) = 'document_review', 'a file waiting for review means Document Review in Progress';
  update public.documents set status = 'accepted' where case_id = c;
  assert (select status_key from public.cases where id = c) = 'document_review', 'reviewed files still wait for Pre-QC';

  update public.cases set stage = 'verification', status_key = 'verification_in_progress' where id = c;
  update public.case_checks set state = 'pending_info' where id = current_setting('t.alevel')::uuid;
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'pending_information', 'Pending Information applies at verification too';
  update public.case_checks set state = 'in_progress' where id = current_setting('t.alevel')::uuid;
  perform public.recompute_case(c);
  update public.cases set on_hold = true, held_at = now() where id = c;
  assert (select status_key from public.cases where id = c) = 'on_hold', 'on hold should show as a status';
  update public.cases set on_hold = false where id = c;
  assert (select status_key from public.cases where id = c) <> 'on_hold', 'resuming clears it';

  update public.cases set stage = 'approval' where id = c;
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'pending_final_approval', 'waiting for approval';
  insert into public.report_versions (org_id, case_id, version, kind, status) values ('00000000-0000-4000-8000-000000000001', c, 90, 'final', 'rendering');
  update public.report_versions set status = 'ready' where case_id = c and version = 90;
  assert (select status_key from public.cases where id = c) = 'report_completed', 'an approved final means Report Completed';
  delete from public.report_versions where case_id = c;
  update public.cases set stage = 'documents' where id = c;
  perform public.recompute_case(c);
  assert not exists (select 1 from public.client_status_catalog where client_label <> internal_label), 'clients should see the spec''s wording';
end $$;

-- ---------------------------------------------------------------- questions to the client
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare q uuid;
begin
  q := public.create_client_request(current_setting('t.case')::uuid, null, 'What was the candidate''s employee number?');
  perform set_config('t.q', q::text, false);
  assert (select status_key from public.cases where id = current_setting('t.case')::uuid) = 'pending_information', 'an open question means Pending Information';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb; r jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case')::uuid);
  assert jsonb_array_length(d -> 'questions') = 1, 'the client should see the question';
  assert (d ->> 'can_answer')::boolean, 'a client admin can answer';
  assert (public.portal_dashboard() -> 'counts' ->> 'action')::int >= 1, 'the question should count as needing action';
  assert exists (select 1 from jsonb_array_elements(public.portal_cases('{"status":"action"}') -> 'rows') x where x ->> 'id' = current_setting('t.case')), 'the case should be in Needs your action';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_answer_request(current_setting('t.q')::uuid, 'E-1024');
  raise exception 'TEST FAILED: a client viewer answered';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_answer_request(current_setting('t.q')::uuid, 'E-1024');
  raise exception 'TEST FAILED: another company answered';
exception when sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_answer_request(current_setting('t.q')::uuid, 'E-1024');
  assert (select count(*) from public.client_requests) = 0, 'clients read questions through the portal only';
end $$;
reset role;
do $$ begin
  assert (select answer from public.client_requests where id = current_setting('t.q')::uuid) = 'E-1024', 'the answer should be kept';
  assert (select status_key from public.cases where id = current_setting('t.case')::uuid) <> 'pending_information', 'answering clears Pending Information';
end $$;

-- ---------------------------------------------------------------- the contact log
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid;
begin
  select id into k from public.case_checks where case_id = current_setting('t.case')::uuid and label = 'Reference check';
  perform public.log_contact(current_setting('t.case')::uuid, jsonb_build_object('check_id', k, 'record_key', 'referees.0', 'counterparty', 'Ruwan Perera', 'channel', 'phone', 'outcome', 'Reached', 'body', 'Confirmed dates'));
  assert (select count(*) from public.communications where case_id = current_setting('t.case')::uuid and case_check_id = k and record_key = 'referees.0') = 1, 'the call should be logged against the referee';
  begin
    perform public.log_contact(current_setting('t.case')::uuid, '{"channel":"phone"}');
    raise exception 'TEST FAILED: a contact with nobody';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.communications where case_id = current_setting('t.case')::uuid) = 0, 'clients must not read the contact log';
end $$;

-- ---------------------------------------------------------------- hiding a case
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin perform public.set_case_client_visible(current_setting('t.case')::uuid, false); end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_case_detail(current_setting('t.case')::uuid);
  raise exception 'TEST FAILED: a hidden case reached the portal';
exception when sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin perform public.set_case_client_visible(current_setting('t.case')::uuid, true); end $$;

-- ---------------------------------------------------------------- findings always print
reset role;
update public.cases set stage = 'verification' where id = current_setting('t.case')::uuid;
update public.case_checks set values_valid = true where case_id = current_setting('t.case')::uuid;
set local role authenticated;
do $$ begin
  perform public.set_check_state(current_setting('t.alevel')::uuid, 'discrepancy', null, 'Internal note only');
  raise exception 'TEST FAILED: a discrepancy with nothing to print';
exception when sqlstate '22023' then
  assert sqlerrm like 'write the finding%', sqlerrm;
end $$;
do $$ begin
  perform public.set_check_state(current_setting('t.alevel')::uuid, 'unable_to_verify', null, 'Internal note only');
  raise exception 'TEST FAILED: unable to verify with nothing to print';
exception when sqlstate '22023' then null;
end $$;
do $$ begin
  perform public.set_check_state(current_setting('t.alevel')::uuid, 'discrepancy', null, 'Internal', 'The certificate number does not match.');
  assert (select client_note from public.case_checks where id = current_setting('t.alevel')::uuid) = 'The certificate number does not match.', 'the finding should be kept';
end $$;

-- ---------------------------------------------------------------- a report with pending checks
do $$ begin
  perform public.case_transition(current_setting('t.case')::uuid, 'submit_post_qc');
  raise exception 'TEST FAILED: open checks went to Post-QC with no reason';
exception when sqlstate '22023' then
  assert sqlerrm like '%still open', sqlerrm;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
reset role;
update public.cases set assigned_to = 'a4100000-0000-4000-8000-000000000002' where id = current_setting('t.case')::uuid;
set local role authenticated;
do $$ begin
  perform public.case_transition(current_setting('t.case')::uuid, 'submit_post_qc', 'Client asked for it now');
  raise exception 'TEST FAILED: an officer sent open checks to Post-QC';
exception when sqlstate '22023' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.case_transition(current_setting('t.case')::uuid, 'submit_post_qc', 'Police report delayed; client asked for the rest now') = 'post_qc', 'a manager may send it on with a reason';
end $$;

-- ---------------------------------------------------------------- report recipients
reset role;
do $$
declare v uuid;
begin
  update public.cases set stage = 'released', released_at = now(), client_visible = true where id = current_setting('t.case')::uuid;
  insert into public.report_versions (org_id, case_id, version, kind, status, storage_path, released_at)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 95, 'final', 'released', 'x.pdf', now()) returning id into v;
  perform set_config('t.version', v::text, false);
  insert into public.report_recipients (org_id, report_version_id, user_id) values ('00000000-0000-4000-8000-000000000001', v, 'a4100000-0000-4000-8000-000000000003');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is not null, 'the chosen recipient should have the report';
  assert public.report_download(current_setting('t.version')::uuid) ->> 'path' = 'x.pdf', 'the chosen recipient should download it';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is null, 'someone not chosen should not see the report';
  perform public.report_download(current_setting('t.version')::uuid);
  raise exception 'TEST FAILED: someone not chosen downloaded the report';
exception when sqlstate 'P0002' then null;
end $$;

-- A revision keeps the released report available, and it stays on the Reports page.
reset role;
update public.cases set stage = 'report' where id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_report(current_setting('t.case')::uuid) is not null, 'the client keeps the report during a revision';
  assert exists (select 1 from jsonb_array_elements(public.portal_cases('{"status":"released"}') -> 'rows') x where x ->> 'id' = current_setting('t.case')), 'the report stays on the Reports page';
end $$;

-- ---------------------------------------------------------------- candidates fill in rows
reset role;
do $$
declare k uuid; l uuid; q uuid; v jsonb;
begin
  update public.cases set stage = 'documents' where id = current_setting('t.case')::uuid;
  select id into k from public.case_checks where case_id = current_setting('t.case')::uuid and label = 'Reference check';
  perform set_config('t.reference', k::text, false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare q uuid; o jsonb;
begin
  q := public.create_candidate_request(current_setting('t.case')::uuid, jsonb_build_object('kind', 'field', 'check_id', current_setting('t.reference'), 'field_key', 'referees'));
  perform set_config('t.req', q::text, false);
end $$;
reset role;
do $$
declare o jsonb;
begin
  select options into o from public.candidate_requests where id = current_setting('t.req')::uuid;
  assert (o ->> 'min')::int = 2, 'two referees are needed';
  assert jsonb_array_length(o -> 'fields') = 8, 'the candidate fills the eight spec fields: ' || (o -> 'fields')::text;
  assert not exists (select 1 from jsonb_array_elements(o -> 'fields') f where f ->> 'key' = 'feedback'), 'feedback is not the candidate''s to write';
end $$;

rollback;
\echo '  ✓ client requirements'
