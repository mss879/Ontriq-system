\o /dev/null
-- Access control: tenancy, MFA enforcement, client isolation, escalation guards.
begin;

-- People (auth.users shim → profiles via trigger)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'super@ontriq.test', '{"full_name":"Sam Super"}'),
  ('22222222-2222-4222-8222-222222222222', 'admin@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('33333333-3333-4333-8333-333333333333', 'officer@ontriq.test', '{"full_name":"Nimal Officer"}'),
  ('44444444-4444-4444-8444-444444444444', 'clientadmin@hemas.test', '{"full_name":"Hema Client"}'),
  ('55555555-5555-4555-8555-555555555555', 'user@ceyfin.test', '{"full_name":"Ceyfin User"}');

insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'staff', null::uuid, 'super_admin'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'staff', null::uuid, 'admin'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'client', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'client_user')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

do $$ begin
  assert (select count(*) from public.profiles where full_name = 'Nimal Officer') = 1, 'profile trigger did not run';
end $$;

-- ---------------------------------------------------------------- anon
set local role anon;
do $$ begin
  assert (select count(*) from public.clients) = 0, 'anon can see clients';
  assert (select count(*) from public.memberships) = 0, 'anon can see memberships';
end $$;
reset role;

-- ---------------------------------------------------------------- client admin (Hemas)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  -- Client users read their company through portal_client_profile: the table holds Ontriq's own notes (0048).
  assert (select count(*) from public.clients) = 0, 'client admin can read the clients table';
  assert (select count(*) from public.client_settings) = 0, 'client admin can read client settings';
  assert public.portal_client_profile() ->> 'code' = 'HEMAS', 'client admin sees the wrong company';
  assert not (public.portal_client_profile() ? 'notes'), 'the profile carries internal notes';
  assert (select count(*) from public.client_contacts where client_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'client sees another client''s contacts';
  assert (select count(*) from public.audit_log) = 0, 'client can read the audit log';
  assert (select count(*) from public.jobs) = 0, 'client can read jobs';
  assert (select count(*) from public.roles where kind = 'staff') = 0, 'client can see staff roles';
  assert public.is_client(), 'is_client() false for client admin';
  assert not public.is_staff(), 'is_staff() true for client admin';
  assert (public.my_membership() ->> 'client_name') = 'Hemas Holdings', 'my_membership missing client name';
end $$;
do $$ begin
  begin
    insert into public.clients (name, code) values ('Sneaky Co', 'SNEAKY');
    raise exception 'TEST FAILED: client inserted a client';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- client user (Ceylon Fintech)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert (select count(*) from public.clients) = 0 and public.portal_client_profile() ->> 'code' = 'CEYFIN', 'client isolation broken';
  assert (select count(*) from public.memberships) = 1, 'client user should only see memberships of their own company';
end $$;
reset role;

-- ---------------------------------------------------------------- staff without MFA
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert not public.is_staff(), 'staff without aal2 treated as staff';
  assert (select count(*) from public.clients) = 0, 'staff without MFA can read clients';
  assert (public.my_membership() ->> 'mfa_required')::boolean, 'my_membership should flag MFA as required';
end $$;
reset role;

-- ---------------------------------------------------------------- verification officer (aal2)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.is_staff(), 'officer with aal2 is not staff';
  assert not public.has_permission('clients.manage'), 'officer should not manage clients';
  assert (select count(*) from public.clients) = 0, 'officer without clients.read/cases.read should not list clients';
end $$;
do $$ begin
  begin
    insert into public.clients (name, code) values ('Officer Co', 'OFFCO');
    raise exception 'TEST FAILED: officer inserted a client';
  exception when insufficient_privilege then null;
  end;
end $$;
-- cannot change own role
do $$ begin
  begin
    update public.memberships set role_id = (select id from public.roles where key = 'admin')
     where user_id = '33333333-3333-4333-8333-333333333333';
    if found then raise exception 'TEST FAILED: officer changed own role'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- admin (aal2)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.clients) = 2, 'admin should see both clients';
  assert (select count(*) from public.memberships where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555')) = 5,
    'admin should see every membership';
end $$;
insert into public.clients (name, code) values ('Dialog Axiata', 'DIALOG');
do $$ begin
  assert (select org_id from public.clients where code = 'DIALOG') = '00000000-0000-4000-8000-000000000001', 'org_id not filled';
end $$;
-- admin cannot promote the officer to super admin
do $$ begin
  begin
    update public.memberships set role_id = (select id from public.roles where key = 'super_admin')
     where user_id = '33333333-3333-4333-8333-333333333333';
    raise exception 'TEST FAILED: admin granted super admin';
  exception when insufficient_privilege then null;
  end;
end $$;
-- admin cannot change their own role
do $$ begin
  begin
    update public.memberships set role_id = (select id from public.roles where key = 'viewer')
     where user_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'TEST FAILED: admin changed own role';
  exception when insufficient_privilege then null;
  end;
end $$;
-- admin can move the officer to QC officer
update public.memberships set role_id = (select id from public.roles where key = 'qc_officer')
 where user_id = '33333333-3333-4333-8333-333333333333';
-- the command assistant permission is not grantable
do $$ begin
  begin
    insert into public.role_permissions (role_id, permission)
    values ((select id from public.roles where key = 'admin'), 'ai.super_assistant');
    raise exception 'TEST FAILED: granted ai.super_assistant to admin';
  exception when insufficient_privilege then null;
  end;
end $$;
-- client permissions cannot be granted to staff roles
do $$ begin
  begin
    insert into public.role_permissions (role_id, permission)
    values ((select id from public.roles where key = 'viewer'), 'portal.quotes.accept');
    raise exception 'TEST FAILED: granted a portal permission to a staff role';
  exception when insufficient_privilege then null;
  end;
end $$;
-- the super admin role cannot be edited
do $$ begin
  begin
    delete from public.role_permissions where role_id = (select id from public.roles where key = 'super_admin');
    raise exception 'TEST FAILED: edited the super admin role';
  exception when insufficient_privilege then null;
  end;
end $$;
-- custom designation
insert into public.roles (key, name, kind) values ('field_officer', 'Field Officer', 'staff');
insert into public.role_permissions (role_id, permission)
values ((select id from public.roles where key = 'field_officer'), 'checks.verify');
do $$ begin
  assert (select count(*) from public.audit_log where table_name = 'clients' and row_id = (select id::text from public.clients where code = 'DIALOG')
          and actor_id = '22222222-2222-4222-8222-222222222222') = 1, 'client insert was not audited with the actor';
  assert (select count(*) from public.audit_log where table_name = 'memberships' and op = 'UPDATE'
          and 'role_id' = any (changed_keys)) = 1, 'role change was not audited';
end $$;
reset role;

-- ---------------------------------------------------------------- super admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.is_super_admin(), 'super admin not recognised';
  assert public.has_permission('ai.super_assistant'), 'super admin lacks the command assistant';
  assert public.has_permission('anything.at.all'), 'super admin * not honoured';
end $$;
reset role;

-- ---------------------------------------------------------------- invitations
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal1"}', true);
insert into public.invitations (email, kind, client_id, role_id)
values ('colleague@hemas.test', 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.roles where key = 'client_user'));
do $$ begin
  begin
    insert into public.invitations (email, kind, client_id, role_id)
    values ('spy@ceyfin.test', 'client', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from public.roles where key = 'client_user'));
    raise exception 'TEST FAILED: client admin invited into another company';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- accepting an invitation
select set_config('request.jwt.claims', '', true);  -- act as the service, not the last user
insert into auth.users (id, email) values ('77777777-7777-4777-8777-777777777777', 'newboss@ontriq.test');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777', 'staff', id, 'invited'
from public.roles where key = 'super_admin';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert (public.my_membership() ->> 'status') = 'invited', 'invited membership not visible to its owner';
  assert not public.is_staff(), 'invited person treated as active staff';
  assert public.accept_my_invitation(), 'invited super admin could not accept';
  assert (public.my_membership() ->> 'status') = 'active', 'membership not active after accepting';
end $$;
-- accepting does not open a door to changing your own role:
-- without MFA, RLS matches nothing; with MFA, the guard refuses.
do $$ begin
  update public.memberships set role_id = (select id from public.roles where key = 'viewer')
   where user_id = '77777777-7777-4777-8777-777777777777';
  if found then raise exception 'TEST FAILED: aal1 session changed a membership'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    update public.memberships set role_id = (select id from public.roles where key = 'viewer')
     where user_id = '77777777-7777-4777-8777-777777777777';
    raise exception 'TEST FAILED: changed own role after accepting';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '  ✓ access control'
