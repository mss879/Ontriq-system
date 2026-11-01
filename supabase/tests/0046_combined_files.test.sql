\o /dev/null
-- One file filling several document slots (0046).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4600000-0000-4000-8000-000000000001', 'admin46@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a4600000-0000-4000-8000-000000000002', 'qc46@ontriq.test', '{"full_name":"Qasim QC"}'),
  ('a4600000-0000-4000-8000-000000000003', 'viewer46@ontriq.test', '{"full_name":"Vino Viewer"}'),
  ('a4600000-0000-4000-8000-000000000004', 'verify46@ontriq.test', '{"full_name":"Vihanga Verify"}');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff'::public.member_kind, r.id, 'active'
from (values
  ('a4600000-0000-4000-8000-000000000001'::uuid, 'admin'),
  ('a4600000-0000-4000-8000-000000000002'::uuid, 'qc_officer'),
  ('a4600000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('a4600000-0000-4000-8000-000000000004'::uuid, 'verification_officer')
) as u(id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'COMPREHENSIVE'),
    'process_type', 'client_supplied', 'candidate', jsonb_build_object('full_name', 'Dinuka Herath')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;

create temp table t_reqs on commit drop as
  select category, min(id::text)::uuid as id from public.case_check_requirements
   where case_id = current_setting('t.case')::uuid group by category;
grant select on t_reqs to authenticated;

insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind)
values ('a4600000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'candidate documents.pdf', 'application/pdf', 'x/pack.pdf', 'uploaded', 'client');

-- ---------------------------------------------------------------- the AI only suggests
do $$
declare c uuid := current_setting('t.case')::uuid;
begin
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 'pending', 'a general file should not fill a slot by itself';
  assert public.case_outstanding_requirements(c, 'documents') > 0, 'the slots should start outstanding';
end $$;

-- ---------------------------------------------------------------- who may confirm
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', (select id from t_reqs where category = 'nic_copy'))));
  raise exception 'TEST FAILED: a viewer confirmed a file';
exception when sqlstate '42501' or sqlstate 'P0002' then null;
end $$;

-- ---------------------------------------------------------------- a person confirms
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare n int;
begin
  n := public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(
    jsonb_build_object('requirement', (select id from t_reqs where category = 'nic_copy'), 'pages', '1'),
    jsonb_build_object('requirement', (select id from t_reqs where category = 'police_report'), 'pages', '3-4')), 'ai');
  assert n = 2, 'two slots should be confirmed';
  -- Confirming again changes the pages and doesn't count the file twice.
  perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', (select id from t_reqs where category = 'nic_copy'), 'pages', '1-2')));
end $$;
reset role;
do $$
declare d public.documents;
begin
  select * into d from public.documents where id = 'a4600000-1111-4000-8000-000000000001';
  assert (select received_count from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 1, 'the file counts once for its slot';
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 'received', 'a confirmed slot is received';
  assert (select pages from public.requirement_files where requirement_id = (select id from t_reqs where category = 'nic_copy')) = '1-2', 'confirming again updates the pages';
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'gn_certificate')) = 'pending', 'other slots stay open';
  assert d.sensitive, 'a file holding a police report is sensitive evidence';
  assert d.visibility = 'report', 'a file holding evidence goes in the report';
  assert exists (select 1 from public.case_events where case_id = d.case_id and kind = 'document_matched'), 'the decision should be on the timeline';
end $$;

-- ---------------------------------------------------------------- the file's own rules cover its links
-- On the case, but not its owner and not on the check the file belongs to.
update public.case_checks set assigned_to = 'a4600000-0000-4000-8000-000000000004'
 where id = (select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.requirement_files) = 2, 'an admin reads the links';
end $$;
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.requirement_files) = 0, 'someone who can''t open sensitive files sees no links to one';
end $$;
reset role;

-- ---------------------------------------------------------------- what can't be filled from a combined file
do $$
begin
  perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', (select id from t_reqs where category = 'sanction_report'))));
  raise exception 'TEST FAILED: the screening report came from a combined file';
exception when sqlstate '22023' then null;
end $$;
do $$
begin
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where id = (select id from t_reqs where category = 'gn_certificate');
  perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', (select id from t_reqs where category = 'gn_certificate'))));
  raise exception 'TEST FAILED: a waived slot took a file';
exception when sqlstate '22023' then null;
end $$;
do $$
begin
  perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', 'a4600000-9999-4000-8000-000000000001')));
  raise exception 'TEST FAILED: a slot from nowhere took a file';
exception when sqlstate 'P0002' then null;
end $$;

-- ---------------------------------------------------------------- the report sees the evidence through the file
do $$
declare c uuid := current_setting('t.case')::uuid; v_nic uuid;
begin
  select case_check_id into v_nic from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy');
  update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green', completed_at = now() where id = v_nic;
  assert not (select label from public.case_checks where id = v_nic) = any (public.case_unreported_evidence(c)), 'evidence in a combined file reaches the report';
  update public.documents set visibility = 'internal' where id = 'a4600000-1111-4000-8000-000000000001';
  assert (select label from public.case_checks where id = v_nic) = any (public.case_unreported_evidence(c)), 'taking the file out of the report should be caught';
  update public.documents set visibility = 'report' where id = 'a4600000-1111-4000-8000-000000000001';
end $$;

-- ---------------------------------------------------------------- a rejected file gives its slots back
do $$
begin
  update public.documents set status = 'rejected' where id = 'a4600000-1111-4000-8000-000000000001';
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 'pending', 'a rejected file no longer counts';
  update public.documents set status = 'accepted' where id = 'a4600000-1111-4000-8000-000000000001';
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 'received', 'accepting it counts again';
  begin
    update public.documents set status = 'rejected' where id = 'a4600000-1111-4000-8000-000000000001';
    perform public.confirm_requirement_files('a4600000-1111-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('requirement', (select id from t_reqs where category = 'service_letter'))));
    raise exception 'TEST FAILED: a rejected file took a slot';
  exception when sqlstate '22023' then null;
  end;
  update public.documents set status = 'accepted' where id = 'a4600000-1111-4000-8000-000000000001';
end $$;

-- ---------------------------------------------------------------- undo
do $$
begin
  perform public.remove_requirement_file((select id from t_reqs where category = 'nic_copy'), 'a4600000-1111-4000-8000-000000000001');
  assert (select status from public.case_check_requirements where id = (select id from t_reqs where category = 'nic_copy')) = 'pending', 'removing the file reopens the slot';
  assert (select visibility from public.documents where id = 'a4600000-1111-4000-8000-000000000001') = 'report', 'it still holds other evidence';
  perform public.remove_requirement_file((select id from t_reqs where category = 'police_report'), 'a4600000-1111-4000-8000-000000000001');
  assert (select visibility from public.documents where id = 'a4600000-1111-4000-8000-000000000001') = 'internal', 'a file holding no evidence leaves the report';
  assert (select sensitive from public.documents where id = 'a4600000-1111-4000-8000-000000000001'), 'sensitive stays on, in case a person slipped';
  begin
    perform public.remove_requirement_file((select id from t_reqs where category = 'police_report'), 'a4600000-1111-4000-8000-000000000001');
    raise exception 'TEST FAILED: removed a link that was not there';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- ---------------------------------------------------------------- nobody writes the table directly
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4600000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  insert into public.requirement_files (org_id, case_id, requirement_id, document_id)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, (select id from t_reqs where category = 'nic_copy'), 'a4600000-1111-4000-8000-000000000001');
  raise exception 'TEST FAILED: wrote a link directly';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\echo '  ✓ combined files'
