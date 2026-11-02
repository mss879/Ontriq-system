-- How the case security rules behave at real volume. Copies the local data up
-- to about 5,000 cases inside a transaction, times the reads that lists and
-- dashboards make for a full-access person and for restricted roles, and rolls
-- everything back. Local stack only.
--
--   psql "postgresql://postgres@127.0.0.1:55433/ontriq" -X -q -At -f scripts/db/rls-volume.sql
begin;
set local session_replication_role = replica;

create temp table copies on commit drop as
  select c.id as old_id, gen_random_uuid() as new_id, n
  from public.cases c cross join generate_series(1, 60) n;

insert into public.cases
select (jsonb_populate_record(null::public.cases, to_jsonb(c) || jsonb_build_object('id', m.new_id, 'reference', c.reference || '-' || m.n))).*
from public.cases c join copies m on m.old_id = c.id;

insert into public.case_checks
select (jsonb_populate_record(null::public.case_checks, to_jsonb(k) || jsonb_build_object('id', gen_random_uuid(), 'case_id', m.new_id))).*
from public.case_checks k join copies m on m.old_id = k.case_id;

insert into public.case_events overriding system value
select (jsonb_populate_record(null::public.case_events, to_jsonb(e) || jsonb_build_object('id', 100000000 + row_number() over (), 'case_id', m.new_id))).*
from public.case_events e join copies m on m.old_id = e.case_id;

insert into public.report_versions
select (jsonb_populate_record(null::public.report_versions, to_jsonb(v) || jsonb_build_object('id', gen_random_uuid(), 'case_id', m.new_id, 'job_id', null, 'based_on', null, 'document_id', null))).*
from public.report_versions v join copies m on m.old_id = v.case_id;

-- A restricted person's work should stay a small share of the whole.
update public.cases c set assigned_to = (select r.user_id from public.memberships r join public.roles o on o.id = r.role_id where o.key = 'super_admin' limit 1)
where c.assigned_to is not null and c.id in (select new_id from copies where n > 3);

analyze public.cases;
analyze public.case_checks;
analyze public.case_events;
analyze public.report_versions;

select 'cases ' || count(*) || ', checks ' || (select count(*) from public.case_checks) || ', events ' || (select count(*) from public.case_events) || ', report versions ' || (select count(*) from public.report_versions) from public.cases;

create temp table timing_queries (name text, sql text) on commit drop;
insert into timing_queries values
  ('case list, newest 50', $q$select id, reference from public.cases order by received_at desc limit 50$q$),
  ('all visible cases', $q$select id from public.cases$q$),
  ('report queues', $q$select v.id from public.report_versions v join public.cases c on c.id = v.case_id where c.stage = 'approval' and v.status in ('ready', 'queued', 'rendering') order by v.created_at$q$),
  ('checks on my desk', $q$select count(*) from public.case_checks k join public.cases c on c.id = k.case_id where c.stage in ('verification', 'data_entry')$q$),
  ('one case events', $q$select id from public.case_events where case_id = (select case_id from public.case_events limit 1) order by id desc limit 100$q$);

\o /dev/null
select set_config('t.people', (
  select jsonb_object_agg(r.key, m.user_id)::text
  from (select distinct on (r.id) m.user_id, r.id as role_id from public.memberships m join public.roles r on r.id = m.role_id where m.status = 'active' order by r.id, m.created_at) m
  join public.roles r on r.id = m.role_id
), true);
\o

create function pg_temp.time_as(person text) returns setof text language plpgsql as $f$
declare
  id text := current_setting('t.people')::jsonb ->> person;
  queries timing_queries[] := (select array_agg(q) from timing_queries q);
  q timing_queries;
  started timestamptz;
  ms numeric;
  rows bigint;
  pass int;
begin
  if id is null then return next person || ': nobody with this role'; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  foreach q in array queries loop
    -- The second pass is the one reported, so cached plans and pages even out.
    for pass in 1 .. 2 loop
      set local role authenticated;
      started := clock_timestamp();
      execute 'select count(*) from (' || q.sql || ') t' into rows;
      ms := round(extract(epoch from clock_timestamp() - started)::numeric * 1000, 1);
      reset role;
    end loop;
    return next rpad(person, 24) || rpad(q.name, 30) || lpad(ms::text, 9) || ' ms' || lpad(rows::text, 8) || ' rows';
  end loop;
end $f$;

select pg_temp.time_as('super_admin');
select pg_temp.time_as('verification_officer');
select pg_temp.time_as('data_entry_officer');

rollback;
