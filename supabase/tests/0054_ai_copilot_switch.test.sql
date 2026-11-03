\o /dev/null
-- The copilot switch starts off, only a Super Admin moves it, and each change is audited.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b5400000-0000-4000-8000-000000000001', 'admin@b54.test', '{"full_name":"Ama Admin"}'),
  ('b5400000-0000-4000-8000-000000000002', 'super@b54.test', '{"full_name":"Sam Super"}');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, 'staff', r.id, 'active'
from (values
  ('b5400000-0000-4000-8000-000000000001'::uuid, 'admin'),
  ('b5400000-0000-4000-8000-000000000002'::uuid, 'super_admin')
) as u(id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

do $$ begin
  assert not (select ai_copilot_enabled from public.orgs where id = '00000000-0000-4000-8000-000000000001'), 'the copilot should start off';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b5400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  update public.orgs set ai_copilot_enabled = true where id = '00000000-0000-4000-8000-000000000001';
  raise exception 'TEST FAILED: an admin switched the copilot on';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"b5400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare v boolean;
begin
  update public.orgs set ai_copilot_enabled = true where id = '00000000-0000-4000-8000-000000000001' returning ai_copilot_enabled into v;
  assert v, 'the Super Admin should be able to';
end $$;
reset role;

do $$ begin
  assert exists (
    select 1 from public.audit_log
     where table_name = 'orgs' and row_id = '00000000-0000-4000-8000-000000000001'
       and 'ai_copilot_enabled' = any (changed_keys) and actor_id = 'b5400000-0000-4000-8000-000000000002'
  ), 'the change should be in the audit log';
end $$;

rollback;
\o
\echo '  ✓ copilot switch'
