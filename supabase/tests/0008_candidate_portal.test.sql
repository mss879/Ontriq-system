\o /dev/null
-- Candidate link (0008) and client portal (0021): what the candidate and the
-- client can see and do, and what they never can.
begin;

-- ---------------------------------------------------------------- people
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'admin@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('d1000000-0000-4000-8000-000000000002', 'relations@ontriq.test', '{"full_name":"Rukshan Relations"}'),
  ('d1000000-0000-4000-8000-000000000003', 'viewer@ontriq.test', '{"full_name":"Vee Viewer"}'),
  ('d1000000-0000-4000-8000-000000000004', 'admin@hemas.test', '{"full_name":"Hema Admin"}'),
  ('d1000000-0000-4000-8000-000000000005', 'viewer@hemas.test', '{"full_name":"Hiru Viewer"}'),
  ('d1000000-0000-4000-8000-000000000006', 'admin@other.test', '{"full_name":"Other Admin"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('d1000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('d1000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'client_relations'),
  ('d1000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'viewer'),
  ('d1000000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('d1000000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_viewer'),
  ('d1000000-0000-4000-8000-000000000006'::uuid, 'client', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- two cases for Hemas, one for the other client
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where code = 'STANDARD'), 'process_type', 'candidate_collected',
    'candidate', jsonb_build_object('full_name', 'Kasun Silva', 'email', 'kasun@example.test')));
  perform set_config('t.case1', r ->> 'case_id', false);
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where code = 'ESSENTIAL'), 'candidate', jsonb_build_object('full_name', 'Nadee Perera')));
  perform set_config('t.case2', r ->> 'case_id', false);
  r := public.create_case(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'package_id', (select id from public.packages where code = 'ESSENTIAL'), 'candidate', jsonb_build_object('full_name', 'Other Person')));
  perform set_config('t.case3', r ->> 'case_id', false);
end $$;

-- ---------------------------------------------------------------- staff issue the link
do $$
declare v1 uuid; v2 uuid;
begin
  begin
    perform public.issue_candidate_link(current_setting('t.case1')::uuid, 'not-a-hash', null);
    raise exception 'TEST FAILED: a malformed secret hash was accepted';
  exception when sqlstate '22023' then null;
  end;
  v1 := public.issue_candidate_link(current_setting('t.case1')::uuid, repeat('a', 64), 'enc-1', 'si', 14);
  v2 := public.issue_candidate_link(current_setting('t.case1')::uuid, repeat('b', 64), 'enc-2', 'en', 14);
  perform set_config('t.link', v2::text, false);
  perform set_config('t.old_link', v1::text, false);
  assert public.candidate_link_secret(v2) = 'enc-2', 'staff should be able to copy the link again';
  begin
    perform public.candidate_link_secret(v1);
    raise exception 'TEST FAILED: a replaced link could still be copied';
  exception when sqlstate '22023' then null;
  end;
  perform public.record_candidate_link_sent(v2, array['email']);
  -- Staff never read the secret's hash or ciphertext directly.
  begin
    perform token_hash from public.candidate_links limit 1;
    raise exception 'TEST FAILED: staff read the link hash';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.candidate_links where case_id = current_setting('t.case1')::uuid and revoked_at is null) = 1,
    'exactly one active link per case';
end $$;
reset role;

-- A viewer cannot issue links; Client Relations (no cases.update) can ask for documents.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.issue_candidate_link(current_setting('t.case2')::uuid, repeat('c', 64), null);
    raise exception 'TEST FAILED: a viewer issued a candidate link';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare v uuid; k uuid;
begin
  select id into k from public.case_checks where case_id = current_setting('t.case1')::uuid and label = 'Employment';
  v := public.create_candidate_request(current_setting('t.case1')::uuid,
    jsonb_build_object('kind', 'document', 'check_id', k, 'category', 'resignation_letter', 'note', 'From ABC Ltd, please'));
  perform set_config('t.doc_request', v::text, false);
  begin
    perform public.create_candidate_request(current_setting('t.case1')::uuid, jsonb_build_object('kind', 'document', 'category', 'sanction_report'));
    raise exception 'TEST FAILED: the candidate was asked for a staff-only document';
  exception when sqlstate '22023' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare v uuid; k uuid;
begin
  select id into k from public.case_checks where case_id = current_setting('t.case1')::uuid and label = 'Employment';
  begin
    perform public.create_candidate_request(current_setting('t.case1')::uuid, jsonb_build_object('kind', 'field', 'check_id', k, 'field_key', 'no_such_field'));
    raise exception 'TEST FAILED: a request for an unknown field was accepted';
  exception when sqlstate '22023' then null;
  end;
  v := public.create_candidate_request(current_setting('t.case1')::uuid,
    jsonb_build_object('kind', 'question', 'title', 'When did you leave ABC Ltd?', 'help', 'Month and year is enough'));
  perform set_config('t.question', v::text, false);
  perform public.post_candidate_message(current_setting('t.case1')::uuid, 'Hello Kasun, please upload your NIC.');
  perform public.add_case_note(current_setting('t.case1')::uuid, null, 'INTERNAL: candidate seemed evasive on the phone');
end $$;
reset role;

-- ---------------------------------------------------------------- the candidate (through the service role)
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$
declare
  o jsonb; v jsonb; up jsonb; r uuid; police uuid;
begin
  o := public.candidate_open_link(repeat('b', 64));
  assert (o ->> 'ok')::boolean and o ->> 'link_id' = current_setting('t.link'), 'a valid secret should open the link';
  assert not (public.candidate_open_link(repeat('a', 64)) ->> 'ok')::boolean, 'a replaced link still opened';
  assert public.candidate_open_link(repeat('a', 64)) ->> 'reason' = 'revoked', 'replaced link should say revoked';
  assert public.candidate_open_link(repeat('f', 64)) ->> 'reason' = 'unknown', 'unknown secret';

  v := public.candidate_link_view(current_setting('t.link')::uuid);
  assert v -> 'case' ->> 'client_name' is not null and v -> 'candidate' ->> 'full_name' = 'Kasun Silva', 'welcome details missing';
  assert jsonb_array_length(v -> 'checks') = 3, 'the candidate should see the three checks by name';
  assert not exists (select 1 from jsonb_array_elements(v -> 'requirements') x where x ->> 'category' in ('field_verification', 'sanction_report')),
    'staff-only document slots reached the candidate';
  assert exists (select 1 from jsonb_array_elements(v -> 'requirements') x where x ->> 'category' = 'resignation_letter'), 'the requested document slot is missing';
  assert jsonb_array_length(v -> 'messages') = 1, 'the staff message is missing';
  assert v::text not like '%INTERNAL%' and v::text not like '%evasive%', 'an internal note reached the candidate';
  assert v -> 'consent' ->> 'status' = 'pending', 'consent should be pending';
  assert v::text not like '%result_tone%' and v::text not like '%assigned_to%', 'results or assignees reached the candidate';

  -- Upload into the NIC slot.
  select id into r from public.case_check_requirements where case_id = current_setting('t.case1')::uuid and category = 'nic_copy';
  up := public.candidate_begin_upload(current_setting('t.link')::uuid, r, null, 'My NIC.jpg', 'image/jpeg', 120000);
  assert up ->> 'path' like 'org/%/case/' || current_setting('t.case1') || '/%', 'unexpected storage path';
  perform public.candidate_finalize_upload(current_setting('t.link')::uuid, (up ->> 'id')::uuid, 'abc');
  assert (select received_count from public.case_check_requirements where id = r) = 1, 'the NIC slot did not fill';
  assert (select uploaded_by_kind from public.documents where id = (up ->> 'id')::uuid) = 'candidate', 'upload not marked as from the candidate';

  -- The requested resignation letter answers the document request.
  select id into r from public.case_check_requirements where case_id = current_setting('t.case1')::uuid and category = 'resignation_letter';
  up := public.candidate_begin_upload(current_setting('t.link')::uuid, r, null, 'resignation.pdf', 'application/pdf', 50000);
  perform public.candidate_finalize_upload(current_setting('t.link')::uuid, (up ->> 'id')::uuid);
  assert (select status from public.candidate_requests where id = current_setting('t.doc_request')::uuid) = 'answered', 'document request not answered';

  -- No uploads into staff-only slots, other cases, or odd file types.
  select id into police from public.case_check_requirements where case_id = current_setting('t.case3')::uuid limit 1;
  begin
    perform public.candidate_begin_upload(current_setting('t.link')::uuid, police, null, 'x.pdf', 'application/pdf', 10);
    raise exception 'TEST FAILED: a link uploaded into another case';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.candidate_begin_upload(current_setting('t.link')::uuid, r, null, 'x.exe', 'application/x-msdownload', 10);
    raise exception 'TEST FAILED: an executable was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Answer the question and write back.
  begin
    perform public.candidate_answer_request(current_setting('t.link')::uuid, current_setting('t.question')::uuid, '{"value": "  "}');
    raise exception 'TEST FAILED: an empty answer was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.candidate_answer_request(current_setting('t.link')::uuid, current_setting('t.question')::uuid, '{"value": "March 2024"}');
  perform public.candidate_post_message(current_setting('t.link')::uuid, 'Uploaded, thank you');
end $$;
reset role;

do $$ begin
  assert (select status from public.candidate_requests where id = current_setting('t.question')::uuid) = 'answered', 'question not answered';
  assert (select count(*) from public.candidate_messages where case_id = current_setting('t.case1')::uuid) = 2, 'messages missing';
  assert (select count(*) from public.case_events where case_id = current_setting('t.case1')::uuid and kind = 'candidate_opened') = 1, 'first open not logged once';
end $$;

-- Signed-in users can never call the candidate functions directly.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.candidate_link_view(current_setting('t.link')::uuid);
    raise exception 'TEST FAILED: a client user read the candidate view';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- consent before Pre-QC
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r record;
begin
  for r in select id from public.case_check_requirements where case_id = current_setting('t.case1')::uuid and status = 'pending' loop
    perform public.waive_requirement(r.id, 'test');
  end loop;
  begin
    perform public.case_transition(current_setting('t.case1')::uuid, 'submit_pre_qc');
    raise exception 'TEST FAILED: Pre-QC started without consent';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.review_consent(current_setting('t.case1')::uuid, true);
    raise exception 'TEST FAILED: consent accepted before the candidate signed';
  exception when sqlstate '22023' then null;
  end;
  perform public.review_candidate_request(current_setting('t.question')::uuid, 'reopen', 'Which day in March?');
  assert (select status from public.candidate_requests where id = current_setting('t.question')::uuid) = 'open', 'reopen failed';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$ begin
  begin
    perform public.candidate_submit_consent(current_setting('t.link')::uuid, 'esign', 'K', null);
    raise exception 'TEST FAILED: a one-letter signature was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform public.candidate_submit_consent(current_setting('t.link')::uuid, 'esign', 'Kasun Silva', null, '203.0.113.9', 'test');
  assert (select count(*) from public.candidate_reminder_candidates() where link_id = current_setting('t.link')::uuid) = 1, 'reminder list missed the link';
  assert (select consent_missing from public.candidate_reminder_candidates() where link_id = current_setting('t.link')::uuid) = false, 'consent still missing';
  perform public.record_candidate_reminder(current_setting('t.link')::uuid, 1);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.case_transition(current_setting('t.case1')::uuid, 'submit_pre_qc') = 'pre_qc', 'consent should let Pre-QC start';
  perform public.revoke_candidate_link(current_setting('t.link')::uuid, 'done');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$ begin
  begin
    perform public.candidate_link_view(current_setting('t.link')::uuid);
    raise exception 'TEST FAILED: a turned-off link still worked';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- the client portal
-- Staff share a document with the client and keep another internal.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare up jsonb;
begin
  up := public.begin_document_upload(current_setting('t.case2')::uuid, null, 'other', 'shared.pdf', 'application/pdf', 10);
  perform public.finalize_document_upload((up ->> 'id')::uuid);
  perform public.set_document_visibility((up ->> 'id')::uuid, 'client');
  perform set_config('t.shared_doc', up ->> 'id', false);
  up := public.begin_document_upload(current_setting('t.case2')::uuid, null, 'other', 'internal.pdf', 'application/pdf', 10);
  perform public.finalize_document_upload((up ->> 'id')::uuid);
  perform set_config('t.internal_doc', up ->> 'id', false);
  perform public.request_case_document(current_setting('t.case2')::uuid, null, 'cv', 'Latest CV', 'Please send the latest CV');
  perform public.add_case_note(current_setting('t.case2')::uuid, null, 'INTERNAL: check with HR first');
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$
declare d jsonb; l jsonb; r uuid; up jsonb;
begin
  l := public.portal_cases('{}');
  assert (l ->> 'total')::int = 2, 'Hemas should see its two cases, got ' || (l ->> 'total');
  assert (public.portal_cases('{"status":"action"}') ->> 'total')::int >= 1, 'the CV request should need action';
  assert (public.portal_cases('{"q":"Nadee"}') ->> 'total')::int = 1, 'search by candidate name';
  assert (public.portal_dashboard() -> 'counts' ->> 'total')::int = 2, 'dashboard total';

  d := public.portal_case_detail(current_setting('t.case1')::uuid);
  assert d -> 'case' ->> 'reference' is not null, 'detail missing';
  assert d::text not like '%INTERNAL%' and d::text not like '%evasive%', 'an internal note reached the client';
  assert not exists (select 1 from jsonb_array_elements(d -> 'timeline') e where e ->> 'kind' in ('note', 'returned', 'candidate_opened')),
    'internal timeline entries reached the client';
  assert not exists (select 1 from jsonb_array_elements(d -> 'checks') k where k ->> 'result_tone' is not null), 'results shown before release';
  assert (d -> 'candidate_progress' ->> 'consent')::boolean, 'candidate progress should show consent';

  begin
    perform public.portal_case_detail(current_setting('t.case3')::uuid);
    raise exception 'TEST FAILED: a client read another client''s case';
  exception when sqlstate 'P0002' then null;
  end;
  -- Direct table access stays closed.
  assert (select count(*) from public.cases) = 0, 'a client read cases directly';
  assert (select count(*) from public.case_events) = 0, 'a client read the timeline directly';
  assert (select count(*) from public.candidate_messages) = 0, 'a client read candidate messages';

  -- Shared documents only.
  assert exists (select 1 from public.documents where id = current_setting('t.shared_doc')::uuid), 'shared document hidden from the client';
  assert not exists (select 1 from public.documents where id = current_setting('t.internal_doc')::uuid), 'internal document visible to the client';

  -- Upload into the shared CV slot.
  d := public.portal_case_detail(current_setting('t.case2')::uuid);
  select (x ->> 'id')::uuid into r from jsonb_array_elements(d -> 'requirements') x where x ->> 'category' = 'cv';
  assert r is not null, 'the requested CV slot is not shown to the client';
  up := public.portal_begin_upload(current_setting('t.case2')::uuid, r, null, 'cv.pdf', 'application/pdf', 2000);
  perform public.portal_finalize_upload((up ->> 'id')::uuid, 'sha');
  assert exists (select 1 from public.documents where id = (up ->> 'id')::uuid), 'the client cannot see their own upload';
  begin
    perform public.portal_begin_upload(current_setting('t.case3')::uuid, null, 'cv', 'cv.pdf', 'application/pdf', 2000);
    raise exception 'TEST FAILED: a client uploaded into another client''s case';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.portal_begin_upload(current_setting('t.case2')::uuid, null, 'police_report', 'x.pdf', 'application/pdf', 20);
    raise exception 'TEST FAILED: a client chose an arbitrary category';
  exception when sqlstate '22023' then null;
  end;
  assert jsonb_array_length(public.portal_team()) = 2, 'Hemas has two portal users';
  -- Candidate-collected cases wait on the candidate, not the client (0028).
  assert not exists (select 1 from jsonb_array_elements(public.portal_cases('{"status":"action"}') -> 'rows') x
                      where x ->> 'id' = current_setting('t.case1')), 'a candidate-collected case asked the client for documents';
  assert exists (select 1 from public.portal_price_list() where key = 'nic'), 'price list missing';
end $$;
reset role;

do $$ begin
  assert (select received_count from public.case_check_requirements where case_id = current_setting('t.case2')::uuid and category = 'cv') = 1,
    'client upload did not fill the slot';
  assert exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-000000000004' and type = 'portal.documents_needed'),
    'the client admin was not told about the CV request';
  assert exists (select 1 from public.jobs j join public.notifications n on j.entity_id = n.id
                  where j.kind = 'notify.email' and n.user_id = 'd1000000-0000-4000-8000-000000000004'), 'no email copy queued for the client';
  assert not exists (select 1 from public.notifications where user_id = 'd1000000-0000-4000-8000-000000000006' and type like 'portal.%'),
    'another client heard about Hemas';
end $$;

-- Client-built packages: Ontriq's approval setting applies and clients can't approve their own (0028).
update public.client_settings set portal = portal || '{"client_packages_need_approval": true}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$
declare v uuid;
begin
  insert into public.packages (org_id, owner_scope, client_id, name, code, is_active, needs_approval)
  values ('00000000-0000-4000-8000-000000000001', 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Self approved', 'HEMAS-SELF', true, false)
  returning id into v;
  assert (select needs_approval and not is_active from public.packages where id = v), 'a client skipped package approval on insert';
  begin
    update public.packages set is_active = true where id = v;
    raise exception 'TEST FAILED: a client switched on a package awaiting approval';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.packages set needs_approval = false where id = v;
    raise exception 'TEST FAILED: a client approved their own package';
  exception when insufficient_privilege then null;
  end;
  update public.packages set name = 'Renamed' where id = v;  -- other edits still work
end $$;
reset role;
update public.client_settings set portal = portal || '{"client_packages_need_approval": false}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Client viewers read but cannot upload; staff are not portal users; visibility settings apply.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert (public.portal_cases('{}') ->> 'total')::int = 2, 'a client viewer should read cases';
  begin
    perform public.portal_begin_upload(current_setting('t.case2')::uuid, null, 'cv', 'cv.pdf', 'application/pdf', 2000);
    raise exception 'TEST FAILED: a client viewer uploaded';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.portal_cases('{}');
    raise exception 'TEST FAILED: staff used the portal functions';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.client_settings set visibility = '{"show_timeline": false, "show_documents": false}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.case2')::uuid);
  assert jsonb_array_length(d -> 'timeline') = 0 and jsonb_array_length(d -> 'documents') = 0, 'visibility settings ignored';
  assert not exists (select 1 from public.documents where id = current_setting('t.shared_doc')::uuid), 'hidden documents still downloadable';
end $$;
reset role;

rollback;
\echo '  ✓ candidate link and client portal'
