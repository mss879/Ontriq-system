\o /dev/null
-- 0030: deciding AI suggestions needs the matching permission; nobody can
-- rewrite a suggestion directly. Every row is created inside this transaction.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f3000000-0000-4000-8000-000000000001', 'qc30@ontriq.test', '{"full_name":"Q Officer"}'),
  ('f3000000-0000-4000-8000-000000000002', 'entry30@ontriq.test', '{"full_name":"E Entry"}'),
  ('f3000000-0000-4000-8000-000000000003', 'ops30@ontriq.test', '{"full_name":"O Ops"}');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff', r.id, 'active'
  from (values ('f3000000-0000-4000-8000-000000000001'::uuid, 'qc_officer'),
               ('f3000000-0000-4000-8000-000000000002'::uuid, 'data_entry_officer'),
               ('f3000000-0000-4000-8000-000000000003'::uuid, 'operations_manager')) as u(id, role)
  join public.roles r on r.org_id = '00000000-0000-4000-8000-000000000001' and r.key = u.role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f3000000-0000-4000-8000-000000000004', 'admin30@ontriq.test', '{"full_name":"A Admin"}'),
  ('f3000000-0000-4000-8000-000000000005', 'viewer30@ontriq.test', '{"full_name":"V Viewer"}');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff', r.id, 'active'
  from (values ('f3000000-0000-4000-8000-000000000004'::uuid, 'admin'), ('f3000000-0000-4000-8000-000000000005'::uuid, 'viewer')) as u(id, role)
  join public.roles r on r.org_id = '00000000-0000-4000-8000-000000000001' and r.key = u.role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'process_type', 'client_supplied', 'candidate', jsonb_build_object('full_name', 'Nimali Fernando', 'nic', '199112345678', 'nic_canonical', '199112345678')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
update public.cases set assigned_to = 'f3000000-0000-4000-8000-000000000002' where id = current_setting('t.case')::uuid;
insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, value) values
  ('00000000-0000-4000-8000-000000000001', 'case.postqc', 'case', current_setting('t.case')::uuid, '{"proposed_result":"amber"}'),
  ('00000000-0000-4000-8000-000000000001', 'check.outreach', 'case', current_setting('t.case')::uuid, '{"subject":"x"}');

set local role authenticated;

-- Nobody updates a suggestion directly any more.
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  update public.ai_suggestions set value = '{"proposed_result":"green"}' where entity_id = current_setting('t.case')::uuid;
  raise exception 'TEST FAILED: a manager rewrote an AI suggestion directly';
exception when insufficient_privilege then null;
end $$;

-- Data entry can see the case (assigned) but may not decide the Post-QC cross-check.
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.decide_ai_suggestion((select id from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'case.postqc'), 'rejected');
  raise exception 'TEST FAILED: data entry dismissed the Post-QC cross-check';
exception when insufficient_privilege or sqlstate 'P0002' then null;
end $$;

-- The QC officer may; an outreach draft can't be "edited" through this function.
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.decide_ai_suggestion((select id from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'case.postqc'), 'accepted');
  assert r ->> 'case_id' = current_setting('t.case'), 'decision result ' || r::text;
  begin
    perform public.decide_ai_suggestion((select id from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'check.outreach'), 'accepted');
    raise exception 'TEST FAILED: a QC officer decided an outreach draft';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.decide_ai_suggestion((select id from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'check.outreach'), 'edited', '{"subject":"y"}');
  raise exception 'TEST FAILED: an outreach draft was edited through the decision function';
exception when sqlstate '22023' then null;
end $$;

-- A viewer reads reports but doesn't write their remarks; the QC officer does.
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_remarks((select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1), 'Changed by a viewer.');
  raise exception 'TEST FAILED: a viewer wrote report remarks';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_remarks((select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1), 'Confirmed with the registrar.');
end $$;

reset role;
do $$ begin
  assert (select decision from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'case.postqc') = 'accepted', 'post-qc decision not recorded';
  assert (select value ->> 'proposed_result' from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and capability = 'case.postqc') = 'amber', 'suggestion value changed';
end $$;

rollback;
\echo '  ✓ AI suggestion decisions and report remarks'
