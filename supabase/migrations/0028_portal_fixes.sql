-- 0028 Portal fixes found while building the portal screens (2026-10-30)
-- 1. "Needs your action" counted document slots on candidate-collected cases,
--    where Ontriq collects the documents from the candidate, not the client.
--    Only client-supplied cases now wait on the client.
-- 2. Client-built packages: packages_update lets a client edit their own
--    package, which also let them switch it on while it waited for Ontriq's
--    approval. A guard now applies Ontriq's portal options on insert
--    (client_settings.portal: client_packages, client_packages_need_approval)
--    and keeps approval with staff on update. Clients may still switch their
--    own package off.
-- Depends on 0005, 0021.

create or replace function public.portal_pending_slots(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.case_check_requirements r
    join public.cases c on c.id = r.case_id
   where r.case_id = p_case and c.process_type = 'client_supplied'
     and r.client_visible and r.stage = 'documents' and r.status = 'pending' and r.min_count > r.received_count
$$;
revoke execute on function public.portal_pending_slots(uuid) from public, anon, authenticated;

create or replace function public.packages_client_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_portal jsonb;
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  if tg_op = 'INSERT' then
    select s.portal into v_portal from public.client_settings s where s.client_id = new.client_id;
    if coalesce((v_portal ->> 'client_packages')::boolean, true) = false then
      raise exception 'Ontriq has not turned on custom packages for your company' using errcode = '42501';
    end if;
    if coalesce((v_portal ->> 'client_packages_need_approval')::boolean, false) then
      new.needs_approval := true;
      new.is_active := false;
    else
      new.needs_approval := false;
    end if;
    new.visibility := 'all';
    return new;
  end if;
  -- Update: approval stays with Ontriq; switching off is always allowed.
  if new.needs_approval is distinct from old.needs_approval then
    raise exception 'only Ontriq can approve a package' using errcode = '42501';
  end if;
  if new.is_active and not old.is_active and old.needs_approval then
    raise exception 'this package is waiting for Ontriq''s approval' using errcode = '42501';
  end if;
  if new.owner_scope is distinct from old.owner_scope or new.client_id is distinct from old.client_id
     or new.pricing_mode is distinct from old.pricing_mode or new.fixed_price is distinct from old.fixed_price then
    raise exception 'only Ontriq can change pricing or ownership' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists packages_client_guard on public.packages;
create trigger packages_client_guard before insert or update on public.packages
  for each row execute function public.packages_client_guard();
revoke execute on function public.packages_client_guard() from public, anon, authenticated;
