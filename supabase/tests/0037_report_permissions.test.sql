\o /dev/null
-- Who may generate a report draft (0037).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3700000-0000-4000-8000-000000000001', 'admin37@ontriq.test', '{"full_name":"Amal Admin"}'),
  ('a3700000-0000-4000-8000-000000000002', 'viewer37@ontriq.test', '{"full_name":"Vasu Viewer"}'),
  ('a3700000-0000-4000-8000-000000000003', 'owner37@ontriq.test', '{"full_name":"Oshadi Owner"}'),
  ('a3700000-0000-4000-8000-000000000004', 'other37@ontriq.test', '{"full_name":"Oneli Other"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff', null, r.id, 'active'
from (values ('a3700000-0000-4000-8000-000000000001'::uuid, 'admin'), ('a3700000-0000-4000-8000-000000000002'::uuid, 'viewer'),
             ('a3700000-0000-4000-8000-000000000003'::uuid, 'verification_officer'), ('a3700000-0000-4000-8000-000000000004'::uuid, 'verification_officer')) as u(id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'candidate', jsonb_build_object('full_name', 'Pradeep Kumara')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
update public.cases set stage = 'report', assigned_to = 'a3700000-0000-4000-8000-000000000003' where id = current_setting('t.case')::uuid;
update public.case_checks set assigned_to = 'a3700000-0000-4000-8000-000000000004' where id = (select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.request_report_draft(current_setting('t.case')::uuid);
  raise exception 'TEST FAILED: the read-only viewer generated a report draft';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.request_report_draft(current_setting('t.case')::uuid);
  raise exception 'TEST FAILED: a verifier who doesn''t own the case generated its draft';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.request_report_draft(current_setting('t.case')::uuid) is not null, 'the case owner should generate the draft';
end $$;
select set_config('request.jwt.claims', '{"sub":"a3700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.request_report_draft(current_setting('t.case')::uuid) is not null, 'an admin should generate the draft';
end $$;

rollback;
\echo '  ✓ report draft permissions'
