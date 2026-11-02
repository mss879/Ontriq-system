\o /dev/null
-- The faster case rules show exactly what case_visible() shows, to every kind
-- of person, on every table they cover.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d5200000-0000-4000-8000-000000000001', 'admin@speed.test', '{"full_name":"Ama Admin"}'),
  ('d5200000-0000-4000-8000-000000000002', 'officer@speed.test', '{"full_name":"Olu Officer"}'),
  ('d5200000-0000-4000-8000-000000000003', 'entry@speed.test', '{"full_name":"Dee Entry"}'),
  ('d5200000-0000-4000-8000-000000000004', 'idle@speed.test', '{"full_name":"Ida Idle"}'),
  ('d5200000-0000-4000-8000-000000000005', 'client@speed.test', '{"full_name":"Cal Client"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('d5200000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('d5200000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('d5200000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('d5200000-0000-4000-8000-000000000004'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('d5200000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- Four cases, each visible for a different reason.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare
  label text;
begin
  foreach label in array array['assigned', 'by_check', 'in_entry', 'nobody'] loop
    perform set_config('t.' || label, public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'package_id', (select id from public.packages where code = 'ESSENTIAL'), 'candidate', jsonb_build_object('full_name', 'Case ' || label))) ->> 'case_id', true);
  end loop;
end $$;
reset role;

set local session_replication_role = replica;
update public.cases set assigned_to = null, stage = 'verification' where id in (current_setting('t.assigned')::uuid, current_setting('t.by_check')::uuid, current_setting('t.in_entry')::uuid, current_setting('t.nobody')::uuid);
update public.case_checks set assigned_to = null where case_id in (current_setting('t.assigned')::uuid, current_setting('t.by_check')::uuid, current_setting('t.in_entry')::uuid, current_setting('t.nobody')::uuid);
update public.cases set assigned_to = 'd5200000-0000-4000-8000-000000000002' where id = current_setting('t.assigned')::uuid;
update public.case_checks set assigned_to = 'd5200000-0000-4000-8000-000000000002' where id = (select id from public.case_checks where case_id = current_setting('t.by_check')::uuid limit 1);
update public.cases set stage = 'data_entry' where id = current_setting('t.in_entry')::uuid;
set local session_replication_role = origin;

create temp table speed_people (id uuid, sees_all boolean) on commit drop;
insert into speed_people values
  ('d5200000-0000-4000-8000-000000000001', true),
  ('d5200000-0000-4000-8000-000000000002', false),
  ('d5200000-0000-4000-8000-000000000003', false),
  ('d5200000-0000-4000-8000-000000000004', false),
  ('d5200000-0000-4000-8000-000000000005', false);

-- The list and the one-case check agree on every case, for every person.
do $$
declare
  p record;
  mismatches bigint;
begin
  for p in select * from speed_people loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    select count(*) into mismatches from public.cases c where public.case_visible(c.id) <> (c.id in (select public.visible_case_ids()));
    assert mismatches = 0, format('visible_case_ids() and case_visible() disagree on %s cases for %s', mismatches, p.id);
    assert public.sees_all_cases() = p.sees_all, format('wrong full access for %s', p.id);
  end loop;
end $$;

-- Each person sees the cases they should, through the policies.
do $$
declare
  seen uuid[];
  tests record;
begin
  for tests in
    select * from (values
      ('d5200000-0000-4000-8000-000000000002', array[current_setting('t.assigned'), current_setting('t.by_check')]),
      ('d5200000-0000-4000-8000-000000000003', array[current_setting('t.in_entry')]),
      ('d5200000-0000-4000-8000-000000000004', array[]::text[])
    ) as t(person, expected)
  loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    select coalesce(array_agg(id order by id), '{}') into seen from public.cases
     where id = any (array[current_setting('t.assigned')::uuid, current_setting('t.by_check')::uuid, current_setting('t.in_entry')::uuid, current_setting('t.nobody')::uuid]);
    reset role;
    assert seen = coalesce((select array_agg(e::uuid order by e::uuid) from unnest(tests.expected) e), '{}'),
      format('%s saw the wrong cases: %s', tests.person, seen);
  end loop;
end $$;

-- Every table under the new rule shows the same rows the old rule would have.
do $$
declare
  p record;
  t record;
  expected bigint;
  actual bigint;
  checked bigint := 0;
begin
  for p in select * from speed_people loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    for t in
      select * from (values
        ('case_checks', 'true'),
        ('case_events', 'true'),
        ('case_check_requirements', 'true'),
        ('assignment_events', 'true'),
        ('qc_reviews', 'true'),
        ('stage_history', 'true'),
        ('candidate_links', 'public.is_staff()'),
        ('candidate_messages', 'public.is_staff()'),
        ('candidate_requests', 'public.is_staff()'),
        ('client_requests', 'public.is_staff()'),
        ('consent_forms', 'public.is_staff()'),
        ('report_versions', 'public.is_staff() and public.has_permission(''reports.preview'')')
      ) as v(tbl, extra)
    loop
      execute format('select count(*) from public.%I r where r.org_id = public.auth_org_id() and public.case_visible(r.case_id) and %s', t.tbl, t.extra) into expected;
      set local role authenticated;
      execute format('select count(*) from public.%I', t.tbl) into actual;
      reset role;
      assert actual = expected, format('%s: %s rows, expected %s, for %s', t.tbl, actual, expected, p.id);
      checked := checked + actual;
    end loop;
  end loop;
  assert checked > 0, 'the comparison ran on no rows at all';
end $$;

-- communications has no foreign key to cases, so a row can outlive its case.
-- Nobody could read one of those before, so nobody can now, whatever their
-- access. A row with no case stays open to staff.
insert into public.communications (id, org_id, case_id, channel, direction) values
  ('d5200000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'email', 'outbound'),
  ('d5200000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', null, 'email', 'outbound');

do $$
declare
  p record;
  orphan bigint;
  no_case bigint;
  expected bigint;
  actual bigint;
begin
  for p in select * from speed_people loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    select count(*) into expected from public.communications r
     where r.org_id = public.auth_org_id() and public.is_staff() and (r.case_id is null or public.case_visible(r.case_id));
    set local role authenticated;
    select count(*) into actual from public.communications;
    select count(*) into orphan from public.communications where id = 'd5200000-0000-4000-8000-0000000000c1';
    select count(*) into no_case from public.communications where id = 'd5200000-0000-4000-8000-0000000000c2';
    reset role;
    assert orphan = 0, format('%s can read a message whose case is gone', p.id);
    assert actual = expected, format('communications: %s rows, expected %s, for %s', actual, expected, p.id);
    assert no_case = case when p.id = 'd5200000-0000-4000-8000-000000000005' then 0 else 1 end, format('wrong access to a message with no case for %s', p.id);
  end loop;
end $$;

-- Stage counts follow the same rules as the rows.
do $$
declare
  counts jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"d5200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  select jsonb_object_agg(stage, total) into counts from public.case_stage_counts(array['verification', 'data_entry']::public.case_stage[]);
  reset role;
  assert (counts ->> 'verification')::int = 2 and counts ->> 'data_entry' is null, format('officer stage counts: %s', counts);

  perform set_config('request.jwt.claims', '{"sub":"d5200000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  select jsonb_object_agg(stage, total) into counts from public.case_stage_counts(array['verification', 'data_entry']::public.case_stage[]);
  reset role;
  assert (counts ->> 'data_entry')::int = 1 and counts ->> 'verification' is null, format('data entry stage counts: %s', counts);
end $$;

rollback;
\o
\echo '  ✓ faster case rules show the same rows'
