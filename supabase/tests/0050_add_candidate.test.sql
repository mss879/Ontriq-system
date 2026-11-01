\o /dev/null
-- Adding a candidate by hand: who may, which client, and that one person stays one person.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-4000-8000-000000000001', 'ops@c50.test', '{"full_name":"Oshan Ops"}'),
  ('c5000000-0000-4000-8000-000000000002', 'viewer@c50.test', '{"full_name":"Vidu Viewer"}'),
  ('c5000000-0000-4000-8000-000000000003', 'officer@c50.test', '{"full_name":"Vihanga Officer"}'),
  ('c5000000-0000-4000-8000-000000000004', 'clientadmin@c50.test', '{"full_name":"Chamari Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('c5000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('c5000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'viewer'),
  ('c5000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('c5000000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- Nobody without the permission adds anyone, and a signed-out visitor can't call it.
do $$
declare ok boolean := false;
begin
  assert not has_function_privilege('anon', 'public.add_candidate(jsonb)', 'execute'), 'a visitor cannot add a candidate';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'full_name', 'No Viewer'));
  assert false, 'a viewer cannot add a candidate';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'full_name', 'No Officer'));
  assert false, 'a verification officer cannot add a candidate';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'full_name', 'No Client'));
  assert false, 'a client user cannot add a candidate';
exception when insufficient_privilege then null;
end $$;

-- Operations adds one, for a client, with no case yet.
select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; again jsonb; bare jsonb; c public.candidates;
begin
  r := public.add_candidate(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'full_name', '  Sachini Perera  ',
    'nic', '199512345678', 'nic_canonical', '199512345678', 'email', 'Sachini@Example.TEST', 'phone', '0771234567'));
  assert not (r ->> 'reused')::boolean, 'a new person is new';
  select * into c from public.candidates where id = (r ->> 'candidate_id')::uuid;
  assert c.added_for_client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'the client is recorded';
  assert c.full_name = 'Sachini Perera', 'the name is trimmed';
  assert c.email = 'sachini@example.test', 'the email is lower case';
  assert c.created_by = 'c5000000-0000-4000-8000-000000000001', 'who added them is recorded';
  assert not exists (select 1 from public.cases k where k.candidate_id = c.id), 'no case is opened';

  -- The same NIC is the same person, even when typed for another client.
  again := public.add_candidate(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'full_name', 'S Perera', 'nic_canonical', '199512345678'));
  assert (again ->> 'reused')::boolean and again ->> 'candidate_id' = r ->> 'candidate_id', 'a repeated NIC finds the first person';
  assert (select full_name from public.candidates where id = c.id) = 'Sachini Perera', 'the first record is not overwritten';
  assert (select added_for_client_id from public.candidates where id = c.id) = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'the first client stays';

  -- A person with no NIC yet can still be added.
  bare := public.add_candidate(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'full_name', 'Kasun Silva'));
  assert not (bare ->> 'reused')::boolean, 'no NIC, so a new person';

  perform set_config('t.candidate', r ->> 'candidate_id', false);
end $$;

-- Bad input gets a clear refusal.
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'full_name', ' '));
  assert false, 'a name is required';
exception when invalid_parameter_value then null;
end $$;
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', '00000000-0000-4000-8000-00000000dead', 'full_name', 'Nobody Here'));
  assert false, 'the client must exist';
exception when no_data_found then null;
end $$;
reset role;
update public.clients set status = 'suspended' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.add_candidate(jsonb_build_object('client_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'full_name', 'Paused Client'));
  assert false, 'a paused client takes no one new';
exception when invalid_parameter_value then null;
end $$;

-- Their first case uses the same record, for the client picked.
do $$
declare r jsonb; c uuid := current_setting('t.candidate')::uuid;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where is_active and owner_scope <> 'client' order by sort limit 1), 'candidate', jsonb_build_object('id', c)));
  assert (r ->> 'candidate_id')::uuid = c, 'the case uses the added person';
  assert (select count(*) from public.candidates where nic_canonical = '199512345678') = 1, 'still one person';
end $$;

-- The client's portal never reads who a person was added for.
reset role;
do $$
begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%' and p.prosrc like '%added_for_client_id%'
  ), 'the portal does not expose this column';
end $$;

rollback;
\o
\echo '  ✓ add a candidate'
