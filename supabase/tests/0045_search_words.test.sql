\o /dev/null
-- Search matches each word of what was typed (0045).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4500000-0000-4000-8000-000000000001', 'admin45@ontriq.test', '{"full_name":"Ama Admin"}');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', 'a4500000-0000-4000-8000-000000000001', 'staff', r.id, 'active'
  from public.roles r where r.key = 'admin' and r.org_id = '00000000-0000-4000-8000-000000000001';

insert into public.candidates (org_id, full_name, nic) values
  ('00000000-0000-4000-8000-000000000001', 'Nimali Sanduni Perera', '199057501234'),
  ('00000000-0000-4000-8000-000000000001', 'Ruwan Perera', '198830701234');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

do $$
begin
  assert (select count(*) from public.search_everything('Nimali Perera') where kind = 'candidate') = 1, 'first and last name should find a name with a middle name';
  assert (select count(*) from public.search_everything('perera nimali') where kind = 'candidate') = 1, 'word order should not matter';
  assert (select count(*) from public.search_everything('Nimali Silva') where kind = 'candidate') = 0, 'every word has to match';
  assert (select count(*) from public.search_everything('Perera') where kind = 'candidate') = 2, 'one word still finds everyone with it';
  assert (select count(*) from public.search_everything('199057501234') where kind = 'candidate') = 1, 'a NIC is still found';
  assert (select count(*) from public.search_everything('nimali%') where kind = 'candidate') = 0, 'a percent sign is matched literally';
end $$;

rollback;
