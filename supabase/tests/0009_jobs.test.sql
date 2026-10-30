\o /dev/null
-- Background jobs: idempotency, claiming, backoff, dead-lettering, outbox.
begin;
set local role service_role;

do $$
declare
  a uuid; b uuid; j public.jobs; st public.job_status; n int;
begin
  a := public.enqueue_job('ai.classify_document', '{"document_id":"x"}', 'ai.classify_document:x:abc');
  b := public.enqueue_job('ai.classify_document', '{"document_id":"x"}', 'ai.classify_document:x:abc');
  assert a = b, 'idempotency key did not dedupe';

  select * into j from public.claim_jobs('w1', 1, 600);
  assert j.id = a and j.status = 'running' and j.attempts = 1, 'claim failed';
  assert (select count(*) from public.claim_jobs('w2', 5, 600)) = 0, 'a running job was claimed twice';

  st := public.fail_job(a, 'w1', 'boom', true);
  assert st = 'queued', 'retryable failure should requeue';
  assert (select run_after from public.jobs where id = a) > now(), 'backoff not applied';
  assert (select count(*) from public.job_failures where job_id = a) = 1, 'failure not recorded';

  -- make it runnable now and exhaust attempts (max 3 for this kind)
  update public.jobs set run_after = now() - interval '1 second' where id = a;
  perform public.claim_jobs('w1', 1, 600);
  perform public.fail_job(a, 'w1', 'boom 2', true);
  update public.jobs set run_after = now() - interval '1 second' where id = a;
  perform public.claim_jobs('w1', 1, 600);
  st := public.fail_job(a, 'w1', 'boom 3', true);
  assert st = 'dead', 'job should be dead after max attempts, got ' || st;
  assert (select count(*) from public.system_events where kind = 'job.dead') >= 1, 'dead job not logged';

  -- a worker that dies three times without progress is dead-lettered, never re-run forever
  b := public.enqueue_job('ai.extract_fields', '{}', 'loop-guard', now(), null, null, null, 10);
  for i in 1..3 loop
    perform public.claim_jobs('dying-' || i, 1, 1);
    update public.jobs set locked_until = now() - interval '1 second' where id = b;
  end loop;
  select * into j from public.jobs where id = b;
  assert j.claims = 3, 'claims counter wrong: ' || j.claims;
  assert (select count(*) from public.claim_jobs('w9', 1, 600)) = 0, 'job claimed a 4th time without progress';
  perform public.sweep_jobs();
  assert (select status from public.jobs where id = b) = 'dead', 'sweep did not dead-letter the looping job';

  -- heartbeat resets claims and completion succeeds
  a := public.enqueue_job('email.send', '{}', 'hb');
  select * into j from public.claim_jobs('w3', 1, 600);
  assert public.heartbeat_job(a, 'w3', 600, '{"step":1}'), 'heartbeat failed';
  assert (select claims from public.jobs where id = a) = 0, 'heartbeat did not reset claims';
  assert public.complete_job(a, 'w3', '{"ok":true}'), 'complete failed';
  assert (select status from public.jobs where id = a) = 'succeeded', 'job not succeeded';

  -- outbox queues its delivery job atomically
  a := public.queue_email(array['someone@example.com'], 'Hello', '<p>Hi</p>');
  assert (select count(*) from public.jobs where kind = 'email.send' and idempotency_key = 'email.send:' || a) = 1,
    'queue_email did not enqueue a job';

  n := (public.queue_depth() ->> 'queued')::int;
  assert n >= 1, 'queue_depth wrong';
end $$;
reset role;

-- staff cannot write jobs directly
insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'ops@ontriq.test');
insert into public.memberships (org_id, user_id, kind, role_id, status)
select '00000000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 'staff', id, 'active'
from public.roles where key = 'operations_manager';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (select count(*) from public.jobs) >= 1, 'ops manager with jobs.read cannot see jobs';
  begin
    perform public.enqueue_job('email.send', '{}', 'nope');
    raise exception 'TEST FAILED: authenticated user enqueued a job';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.jobs (org_id, kind) values ('00000000-0000-4000-8000-000000000001', 'email.send');
    raise exception 'TEST FAILED: authenticated user inserted a job';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
\echo '  ✓ background jobs'
