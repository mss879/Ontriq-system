\o /dev/null
-- A report the assistant made opens only for the person who asked for it, and
-- the policy's other documents keep their rules.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d5300000-0000-4000-8000-000000000001', 'owner@reports.test', '{"full_name":"Olu Owner"}'),
  ('d5300000-0000-4000-8000-000000000002', 'second@reports.test', '{"full_name":"Sam Second"}'),
  ('d5300000-0000-4000-8000-000000000003', 'admin@reports.test', '{"full_name":"Ama Admin"}'),
  ('d5300000-0000-4000-8000-000000000004', 'client@reports.test', '{"full_name":"Cal Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('d5300000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'super_admin'),
  ('d5300000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'super_admin'),
  ('d5300000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'admin'),
  ('d5300000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

insert into public.generated_documents (id, org_id, kind, title, status, created_by) values
  ('d5300000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'assistant_report', 'Team performance', 'ready', 'd5300000-0000-4000-8000-000000000001'),
  ('d5300000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'cost_report', 'Another kind', 'ready', 'd5300000-0000-4000-8000-000000000001');

set local role authenticated;
do $$
declare
  t record;
  seen bigint;
begin
  for t in select * from (values
    ('d5300000-0000-4000-8000-000000000001', 1, 'the person who asked'),
    ('d5300000-0000-4000-8000-000000000002', 0, 'another Super Admin'),
    ('d5300000-0000-4000-8000-000000000003', 0, 'an admin'),
    ('d5300000-0000-4000-8000-000000000004', 0, 'a client')
  ) as v(person, expected, label) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', t.person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    select count(*) into seen from public.generated_documents where id = 'd5300000-0000-4000-8000-0000000000a1';
    assert seen = t.expected, format('%s saw %s reports', t.label, seen);
  end loop;

  -- Other kinds still fall to settings.manage.
  perform set_config('request.jwt.claims', '{"sub":"d5300000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
  select count(*) into seen from public.generated_documents where id = 'd5300000-0000-4000-8000-0000000000a2';
  assert seen = 1, 'other documents kept their rule';
end $$;
reset role;

-- The figures waiting for the worker are out of reach for everyone but the service role.
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"d5300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
  begin
    perform 1 from public.assistant_report_figures limit 1;
    raise exception 'TEST FAILED: a signed-in person could read the waiting figures';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\o
\echo '  ✓ assistant reports stay private'
