\o /dev/null
-- The queue count gives the same answer without reading finished jobs.
begin;

insert into public.jobs (org_id, kind, status, run_after) values
  ('00000000-0000-4000-8000-000000000001', 'test.queued', 'queued', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-000000000001', 'test.later', 'queued', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000001', 'test.running', 'running', now()),
  ('00000000-0000-4000-8000-000000000001', 'test.dead', 'dead', now()),
  ('00000000-0000-4000-8000-000000000001', 'test.done', 'succeeded', now());

do $$
declare
  v jsonb := public.queue_depth();
  base record;
begin
  select count(*) filter (where status = 'queued' and run_after <= now()) as queued,
         count(*) filter (where status = 'queued' and run_after > now()) as scheduled,
         count(*) filter (where status = 'running') as running,
         count(*) filter (where status = 'dead') as dead
    into base from public.jobs;
  assert (v ->> 'queued')::int = base.queued and base.queued >= 1, 'waiting jobs are counted';
  assert (v ->> 'scheduled')::int = base.scheduled and base.scheduled >= 1, 'later jobs are counted';
  assert (v ->> 'running')::int = base.running and base.running >= 1, 'running jobs are counted';
  assert (v ->> 'dead')::int = base.dead and base.dead >= 1, 'dead jobs are counted';
end $$;

rollback;
\o
\echo '  ✓ faster queue count'
