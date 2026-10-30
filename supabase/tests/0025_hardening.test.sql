\o /dev/null
-- Hardening rules every migration keeps (see 0025_hardening.sql).
begin;

-- ---------------------------------------------------------------- structural rules
do $$
declare
  v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute');
  assert v is null, 'anon can execute: ' || coalesce(v, '');

  select string_agg(p.oid::regprocedure::text, ', ') into v
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute');
  assert v is null, 'trigger functions callable by signed-in users: ' || coalesce(v, '');

  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ') into v
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
  assert v is null, 'foreign keys without an index: ' || coalesce(v, '');

  select string_agg(c.oid::regclass::text, ', ') into v
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  assert v is null, 'tables without row level security: ' || coalesce(v, '');
end $$;

-- ---------------------------------------------------------------- people
insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'viewer@ontriq.test'),
  ('a2222222-2222-4222-8222-222222222222', 'admin2@ontriq.test'),
  ('a3333333-3333-4333-8333-333333333333', 'client2@hemas.test');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a1111111-1111-4111-8111-111111111111'::uuid, 'staff', null::uuid, 'viewer'),
  ('a2222222-2222-4222-8222-222222222222'::uuid, 'staff', null::uuid, 'admin'),
  ('a3333333-3333-4333-8333-333333333333'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- client user
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.queue_depth();
    raise exception 'TEST FAILED: client user read the job queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.suggest_client_code('Ceylon Fintech');
    raise exception 'TEST FAILED: client user probed client codes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_document_number('invoice');
    raise exception 'TEST FAILED: client user drew an invoice number';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- viewer (aal2)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.queue_depth() ? 'queued', 'staff should read queue depth';
  begin
    perform public.next_document_number('invoice');
    raise exception 'TEST FAILED: viewer drew an invoice number';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- admin (aal2): triggers still fire
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.suggest_client_code('Hemas Holdings') = 'HEMASHOL', 'admin should get a client code';
end $$;
insert into public.clients (name, code) values ('John Keells', 'JKH');
update public.clients set industry = 'Conglomerate' where code = 'JKH';
insert into public.roles (key, name, kind) values ('auditor', 'Auditor', 'staff');
do $$ begin
  assert (select org_id from public.clients where code = 'JKH') = '00000000-0000-4000-8000-000000000001', 'set_org_id trigger did not fire';
  assert (select count(*) from public.client_settings s join public.clients c on c.id = s.client_id where c.code = 'JKH') = 1,
    'client settings trigger did not fire';
  assert (select updated_at > created_at or updated_at = created_at from public.clients where code = 'JKH'), 'updated_at missing';
  assert (select count(*) from public.audit_log where table_name = 'clients'
          and row_id = (select id::text from public.clients where code = 'JKH')) = 2, 'audit trigger did not record insert and update';
end $$;
reset role;

rollback;
\echo '  ✓ hardening rules'
