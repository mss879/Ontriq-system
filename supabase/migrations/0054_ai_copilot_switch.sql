-- The AI copilot's panels on case and check screens (reviews, drafted
-- remarks, values read from files) can be switched off for the whole
-- organisation. Ontriq asked for them off, so off is the default.
-- Only the screens change: AI jobs keep running under ai_capabilities, and
-- the command assistant and Ask Ontriq are not affected.
-- orgs is already audited (0002), so each change lands in audit_log.

alter table public.orgs add column ai_copilot_enabled boolean not null default false;

comment on column public.orgs.ai_copilot_enabled is
  'Show the AI copilot panels on case and check screens. Only a Super Admin may change it.';

-- Like two-step sign-in, only a Super Admin may change it.
create or replace function public.orgs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.mfa_required_for_staff is distinct from old.mfa_required_for_staff and not public.is_super_admin() then
    raise exception 'only a Super Admin can change this' using errcode = '42501';
  end if;
  if auth.uid() is not null and new.ai_copilot_enabled is distinct from old.ai_copilot_enabled and not public.is_super_admin() then
    raise exception 'only a Super Admin can change this' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.orgs_guard() from public, anon, authenticated;
