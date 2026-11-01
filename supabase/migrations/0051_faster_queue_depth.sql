-- The dashboard's queue count read every job ever run to find the few still
-- open. Finished jobs can't change any of these numbers, so they're left out.

create or replace function public.queue_depth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not (select public.is_staff()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued' and run_after <= now()),
    'scheduled', count(*) filter (where status = 'queued' and run_after > now()),
    'running', count(*) filter (where status = 'running'),
    'dead', count(*) filter (where status = 'dead'),
    'live_workers', (select count(*) from public.job_workers where heartbeat_at > now() - interval '90 seconds')
  ) into v
  from public.jobs
  where status in ('queued', 'running', 'dead')
    and org_id = coalesce(public.auth_org_id(), public.default_org_id());
  return v;
end $$;
