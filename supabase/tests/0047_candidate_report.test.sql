\o /dev/null
-- The candidate's last step, and the report it sets off (0047).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4700000-0000-4000-8000-000000000001', 'admin47@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4700000-0000-4000-8000-000000000002', 'verify47@ontriq.test', '{"full_name":"Vihanga Verify"}'),
  ('a4700000-0000-4000-8000-000000000003', 'client47@hemas.test', '{"full_name":"Chamari Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a4700000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a4700000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a4700000-0000-4000-8000-000000000003'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; v_link uuid;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Ishara Gunasekara')));
  perform set_config('t.case', r ->> 'case_id', false);
  v_link := public.issue_candidate_link((r ->> 'case_id')::uuid, repeat('a', 64), 'sealed', 'en', 14);
  perform set_config('t.link', v_link::text, false);
end $$;
reset role;

create or replace function pg_temp.upload(p_category text, p_filename text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
  values (v_id, '00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_category, p_filename, 'application/pdf', 'x/' || v_id, 'uploaded', 'candidate');
  return v_id;
end $$;

-- ---------------------------------------------------------------- nothing until they've given everything
do $$
begin
  perform public.candidate_confirm_submission(current_setting('t.link')::uuid);
  raise exception 'TEST FAILED: confirmed with documents still owed';
exception when sqlstate '22023' then
  assert sqlerrm like '%still needed%', 'should say something is needed: ' || sqlerrm;
end $$;

do $$
declare v_case uuid := current_setting('t.case')::uuid; r record;
begin
  for r in select distinct category from public.case_check_requirements
            where case_id = v_case and status = 'pending' and public.candidate_providable(category, stage) loop
    perform pg_temp.upload(r.category, r.category || '.pdf');
  end loop;
  begin
    perform public.candidate_confirm_submission(current_setting('t.link')::uuid);
    raise exception 'TEST FAILED: confirmed without consent';
  exception when sqlstate '22023' then null;
  end;
  perform public.candidate_submit_consent(current_setting('t.link')::uuid, 'esign', 'Ishara Gunasekara', null);
end $$;

-- ---------------------------------------------------------------- confirming
do $$
declare v_case uuid := current_setting('t.case')::uuid; v_view jsonb;
begin
  v_view := public.candidate_link_view(current_setting('t.link')::uuid);
  assert (v_view #>> '{submission,confirmed_at}') is null, 'not confirmed yet';
  perform public.candidate_confirm_submission(current_setting('t.link')::uuid);
  assert (select candidate_confirmed_at from public.cases where id = v_case) is not null, 'the case should record it';
  assert (select count(*) from public.generated_documents where entity_id = v_case and kind = 'candidate_report' and status = 'queued') = 1, 'one report queued';
  assert exists (select 1 from public.jobs where kind = 'ai.candidate_report' and entity_id = v_case and status = 'queued'), 'a job should write it';
  assert exists (select 1 from public.case_events where case_id = v_case and kind = 'candidate_confirmed' and visible_to_candidate), 'the candidate sees it on their timeline';

  -- A second click writes no second report.
  perform public.candidate_confirm_submission(current_setting('t.link')::uuid);
  assert (select count(*) from public.generated_documents where entity_id = v_case and kind = 'candidate_report') = 1, 'a second click changes nothing';
  v_view := public.candidate_link_view(current_setting('t.link')::uuid);
  assert (v_view #>> '{submission,changed_since}') = 'false', 'nothing new yet';
end $$;

-- ---------------------------------------------------------------- something new means confirming again
do $$
declare v_case uuid := current_setting('t.case')::uuid; v_view jsonb;
begin
  -- now() is fixed inside a transaction, so the new file has to be dated after the confirmation.
  update public.cases set candidate_confirmed_at = now() - interval '1 hour' where id = v_case;
  perform pg_temp.upload('other', 'late file.pdf');
  v_view := public.candidate_link_view(current_setting('t.link')::uuid);
  assert (v_view #>> '{submission,changed_since}') = 'true', 'a new file should ask them to confirm again';
  perform public.candidate_confirm_submission(current_setting('t.link')::uuid);
  assert (select count(*) from public.generated_documents where entity_id = v_case and kind = 'candidate_report') = 2, 'a new version';
  assert (select count(*) from public.generated_documents where entity_id = v_case and kind = 'candidate_report' and status = 'queued') = 1, 'the old one is replaced';
  update public.generated_documents set status = 'ready', storage_path = 'x/report.pdf' where entity_id = v_case and kind = 'candidate_report' and status = 'queued';
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, field_key, value)
  values ('00000000-0000-4000-8000-000000000001', 'candidate.report', 'case', v_case, 'candidate_report', '{"summary":"Written up."}');
end $$;

-- ---------------------------------------------------------------- who can open it
update public.cases set assigned_to = 'a4700000-0000-4000-8000-000000000002' where id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.generated_documents where kind = 'candidate_report' and status = 'ready'), 'staff on the case open it';
  assert public.case_ai_suggestions(current_setting('t.case')::uuid)::text like '%Written up%', 'and read what the AI wrote';
end $$;
reset role;
update public.documents set sensitive = true where case_id = current_setting('t.case')::uuid and filename = 'late file.pdf';
set local role authenticated;
do $$ begin
  assert not exists (select 1 from public.generated_documents where kind = 'candidate_report'), 'a sensitive file locks the report for someone who can''t open it';
  assert public.case_ai_suggestions(current_setting('t.case')::uuid)::text not like '%Written up%', 'and its text';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.generated_documents where kind = 'candidate_report' and status = 'ready'), 'an admin can still open it';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.generated_documents where kind = 'candidate_report'), 'the client never sees it';
end $$;
reset role;

-- ---------------------------------------------------------------- staff can have it made again
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare v_id uuid;
begin
  v_id := public.request_candidate_report(current_setting('t.case')::uuid);
  assert (select status from public.generated_documents where id = v_id) = 'queued', 'a new version is queued';
  assert (select decision from public.ai_suggestions where capability = 'candidate.report' and entity_id = current_setting('t.case')::uuid) = 'superseded', 'the old summary goes with the old report';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.request_candidate_report(current_setting('t.case')::uuid);
  raise exception 'TEST FAILED: a client asked for the report';
exception when sqlstate '42501' or sqlstate 'P0002' then null;
end $$;
reset role;

-- ---------------------------------------------------------------- erasure takes it too
select set_config('request.jwt.claims', '', true);
do $$
declare v_case uuid := current_setting('t.case')::uuid; v_out jsonb;
begin
  update public.generated_documents set status = 'ready', storage_path = 'x/final.pdf' where entity_id = v_case and kind = 'candidate_report' and status = 'queued';
  update public.cases set stage = 'cancelled' where id = v_case;
  v_out := public.erase_case(v_case, 'Test of erasure');
  assert v_out::text like '%x/final.pdf%', 'the report''s file should be listed for deletion';
  assert not exists (select 1 from public.generated_documents where entity_id = v_case and storage_path is not null), 'no report file left';
  assert not exists (select 1 from public.ai_suggestions where entity_id = v_case), 'no AI text left';
end $$;

rollback;
\echo '  ✓ candidate report'
