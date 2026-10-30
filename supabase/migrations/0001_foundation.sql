-- =============================================================================
-- 0001_foundation.sql
-- Feature: tenancy, people, roles and permissions.
-- Depends on: nothing (uses Supabase's auth schema).
--
-- Authority model: memberships (user → org, kind staff|client, role) is the
-- single source of truth. JWT app_metadata.kind is only a routing hint for the
-- proxy. Every RLS policy goes through the helper functions defined here.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_kind as enum ('staff', 'client');
create type public.member_status as enum ('invited', 'active', 'suspended');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisations (Ontriq is the only tenant today; the schema is tenant-ready)
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Colombo',
  currency text not null default 'LKR',
  mfa_required_for_staff boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger orgs_updated_at before update on public.orgs
  for each row execute function public.set_updated_at();

insert into public.orgs (id, name, slug, branding)
values (
  '00000000-0000-4000-8000-000000000001',
  'Ontriq (Pvt) Ltd',
  'ontriq',
  jsonb_build_object(
    'display_name', 'Ontriq',
    'legal_name', 'Ontriq (Pvt) Ltd',
    'primary_color', '#163A7A',
    'accent_color', '#1F8A5B',
    'email_from_name', 'Ontriq',
    'website', '',
    'address', '',
    'phone', ''
  )
)
on conflict (id) do nothing;

-- Returns the only org when exactly one exists (single-tenant convenience for
-- service-role writes). Returns null in a multi-tenant database.
create or replace function public.default_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when (select count(*) from public.orgs) = 1
              then (select id from public.orgs limit 1) end
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  phone text,
  title text,
  avatar_path text,
  locale text not null default 'en',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.sync_auth_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_auth_user_email();

-- Users may edit their own profile, but not the email (that follows auth.users).
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and new.email is distinct from old.email then
    raise exception 'email is managed by authentication' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- Permission catalog and roles
-- ---------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  group_key text not null,
  label text not null,
  description text not null default '',
  kind public.member_kind not null,
  grantable boolean not null default true,
  sort int not null default 0
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null,
  name text not null,
  description text not null default '',
  kind public.member_kind not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission)
);

-- ---------------------------------------------------------------------------
-- Memberships and invitations
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.member_kind not null,
  client_id uuid,                      -- FK added in 0003_clients
  role_id uuid not null references public.roles (id),
  status public.member_status not null default 'invited',
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id),
  constraint memberships_client_matches_kind check ((kind = 'client') = (client_id is not null))
);
create index memberships_user_active_idx on public.memberships (user_id) where status = 'active';
create index memberships_client_idx on public.memberships (client_id) where client_id is not null;
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  kind public.member_kind not null,
  client_id uuid,                      -- FK added in 0003_clients
  role_id uuid not null references public.roles (id),
  auth_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users (id) on delete set null,
  sent_count int not null default 0,
  last_sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitations_client_matches_kind check ((kind = 'client') = (client_id is not null))
);
create unique index invitations_pending_email_uq on public.invitations (org_id, lower(email)) where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS helper functions. Policies call them as (select fn()) so Postgres
-- evaluates each once per statement.
-- ---------------------------------------------------------------------------

-- The caller's usable membership. Staff need an aal2 (MFA) session when the
-- org requires it; until then they have no access at all.
create or replace function public.my_active_membership() returns public.memberships
language sql stable security definer set search_path = '' as $$
  select m.*
  from public.memberships m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (m.kind = 'client'
         or not o.mfa_required_for_staff
         or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  limit 1
$$;

create or replace function public.auth_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select (public.my_active_membership()).org_id
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((public.my_active_membership()).kind = 'staff', false)
$$;

create or replace function public.is_client() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((public.my_active_membership()).kind = 'client', false)
$$;

create or replace function public.client_id_of_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select (public.my_active_membership()).client_id
$$;

create or replace function public.has_permission(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = (public.my_active_membership()).role_id
      and rp.permission in (p, '*')
  )
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roles r
    where r.id = (public.my_active_membership()).role_id and r.key = 'super_admin'
  )
$$;

-- Fill org_id on insert so callers never send it (and cannot spoof it).
-- Convention: attach it as trigger "a_set_org_id" so it fires before any guard
-- trigger on the same table (same-timing triggers fire in name order).
create or replace function public.set_org_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.org_id is null then
    new.org_id := coalesce(public.auth_org_id(), public.default_org_id());
  end if;
  if new.org_id is null then
    raise exception 'org_id could not be determined' using errcode = '23502';
  end if;
  return new;
end $$;

-- The data access layer's one-call view of the caller. Unlike the helpers
-- above it also returns invited or MFA-pending memberships, so the app can
-- route the user to the right screen.
create or replace function public.my_membership() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', m.user_id,
    'org_id', m.org_id,
    'org_name', o.name,
    'kind', m.kind,
    'client_id', m.client_id,
    'status', m.status,
    'role_id', r.id,
    'role_key', r.key,
    'role_name', r.name,
    'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission)
                             from public.role_permissions rp where rp.role_id = r.id), '[]'::jsonb),
    'mfa_required', (m.kind = 'staff' and o.mfa_required_for_staff),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'full_name', coalesce(p.full_name, ''),
    'email', coalesce(p.email, '')
  )
  from public.memberships m
  join public.orgs o on o.id = m.org_id
  join public.roles r on r.id = m.role_id
  left join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and m.status in ('active', 'invited')
  order by (m.status = 'active') desc
  limit 1
$$;

-- Called once the invited user has set a password.
create or replace function public.accept_my_invitation() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.memberships
     set status = 'active', activated_at = now()
   where user_id = auth.uid() and status = 'invited';
  get diagnostics v_count = row_count;
  update public.invitations
     set status = 'accepted', accepted_at = now()
   where auth_user_id = auth.uid() and status = 'pending';
  return v_count > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Guards against privilege escalation (lesson from Arc AI migration 0129)
-- ---------------------------------------------------------------------------
create or replace function public.memberships_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = new.role_id;
  if v_role.id is null then
    raise exception 'role not found' using errcode = '23503';
  end if;
  if v_role.kind <> new.kind or v_role.org_id <> new.org_id then
    raise exception 'role % does not apply to this membership', v_role.key using errcode = '42501';
  end if;

  -- Service role (no auth.uid()) and the bootstrap script are trusted.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' and v_role.key = 'super_admin' and not public.is_super_admin() then
    raise exception 'only a super admin can grant super admin' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- An invited person accepting their own invitation: status only, nothing else.
    if new.user_id = auth.uid() and old.status = 'invited' and new.status = 'active'
       and new.role_id = old.role_id and new.kind = old.kind
       and new.client_id is not distinct from old.client_id and new.org_id = old.org_id then
      return new;
    end if;
    if new.role_id is distinct from old.role_id and v_role.key = 'super_admin' and not public.is_super_admin() then
      raise exception 'only a super admin can grant super admin' using errcode = '42501';
    end if;
    if new.user_id = auth.uid()
       and (new.role_id is distinct from old.role_id
            or new.status is distinct from old.status
            or new.kind is distinct from old.kind
            or new.client_id is distinct from old.client_id) then
      raise exception 'you cannot change your own access' using errcode = '42501';
    end if;
    if exists (select 1 from public.roles r where r.id = old.role_id and r.key = 'super_admin')
       and not public.is_super_admin() then
      raise exception 'only a super admin can change a super admin' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_guard before insert or update on public.memberships
  for each row execute function public.memberships_guard();

create or replace function public.role_permissions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_perm public.permissions;
begin
  select * into v_role from public.roles where id = coalesce(new.role_id, old.role_id);
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'the super admin role cannot be edited' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select * into v_perm from public.permissions where key = new.permission;
    if not v_perm.grantable then
      raise exception 'permission % cannot be granted to %', new.permission, v_role.key using errcode = '42501';
    end if;
    if v_perm.kind <> v_role.kind then
      raise exception 'permission % does not apply to % roles', new.permission, v_role.kind using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger role_permissions_guard before insert or delete on public.role_permissions
  for each row execute function public.role_permissions_guard();

create or replace function public.roles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and old.is_system
     and (new.key is distinct from old.key or new.kind is distinct from old.kind or new.is_system is distinct from old.is_system) then
    raise exception 'system roles keep their key and kind' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger roles_guard before update on public.roles
  for each row execute function public.roles_guard();

create trigger a_set_org_id before insert on public.roles
  for each row execute function public.set_org_id();
create trigger a_set_org_id before insert on public.memberships
  for each row execute function public.set_org_id();
create trigger a_set_org_id before insert on public.invitations
  for each row execute function public.set_org_id();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;

create policy orgs_select on public.orgs for select to authenticated
  using (id = (select public.auth_org_id()));
create policy orgs_update on public.orgs for update to authenticated
  using (id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('settings.manage')))
  with check (id = (select public.auth_org_id()));

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id
        and m.org_id = (select public.auth_org_id())
        and ((select public.is_staff()) or m.client_id = (select public.client_id_of_user()))
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy permissions_select on public.permissions for select to authenticated
  using ((select auth.uid()) is not null);

create policy roles_select on public.roles for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_staff()) or kind = 'client'));
create policy roles_insert on public.roles for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff())
              and (select public.has_permission('roles.manage')) and not is_system);
create policy roles_update on public.roles for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('roles.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r
                 where r.id = role_permissions.role_id
                   and r.org_id = (select public.auth_org_id())
                   and ((select public.is_staff()) or r.kind = 'client')));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select public.is_staff()) and (select public.has_permission('roles.manage'))
              and exists (select 1 from public.roles r where r.id = role_permissions.role_id
                          and r.org_id = (select public.auth_org_id())));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select public.is_staff()) and (select public.has_permission('roles.manage'))
         and exists (select 1 from public.roles r where r.id = role_permissions.role_id
                     and r.org_id = (select public.auth_org_id())));

create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (org_id = (select public.auth_org_id())
        and ((select public.is_staff()) or client_id = (select public.client_id_of_user())))
  );
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and (select public.has_permission('users.manage')))
         or ((select public.is_client()) and kind = 'client'
             and client_id = (select public.client_id_of_user())
             and (select public.has_permission('portal.users.manage'))))
  );
create policy memberships_update on public.memberships for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and (select public.has_permission('users.manage')))
         or ((select public.is_client()) and kind = 'client'
             and client_id = (select public.client_id_of_user())
             and (select public.has_permission('portal.users.manage'))))
  )
  with check (org_id = (select public.auth_org_id()));

create policy invitations_select on public.invitations for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and (select public.has_permission('users.manage')))
         or ((select public.is_client()) and client_id = (select public.client_id_of_user())
             and (select public.has_permission('portal.users.manage'))))
  );
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and (select public.has_permission('users.manage')))
         or ((select public.is_client()) and kind = 'client'
             and client_id = (select public.client_id_of_user())
             and (select public.has_permission('portal.users.manage'))))
  );
create policy invitations_update on public.invitations for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and (select public.has_permission('users.manage')))
         or ((select public.is_client()) and client_id = (select public.client_id_of_user())
             and (select public.has_permission('portal.users.manage'))))
  )
  with check (org_id = (select public.auth_org_id()));

-- Helper functions are for policies and the app's authenticated client only.
revoke execute on function public.my_active_membership() from public, anon;
revoke execute on function public.auth_org_id() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_client() from public, anon;
revoke execute on function public.client_id_of_user() from public, anon;
revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.my_membership() from public, anon;
revoke execute on function public.accept_my_invitation() from public, anon;
revoke execute on function public.default_org_id() from public, anon, authenticated;
grant execute on function public.my_active_membership(), public.auth_org_id(), public.is_staff(),
  public.is_client(), public.client_id_of_user(), public.has_permission(text), public.is_super_admin(),
  public.my_membership(), public.accept_my_invitation() to authenticated, service_role;
grant execute on function public.default_org_id() to service_role;

-- ---------------------------------------------------------------------------
-- Seed: permission catalog (mirrored in src/domain/permissions.ts)
-- ---------------------------------------------------------------------------
insert into public.permissions (key, group_key, label, description, kind, grantable, sort) values
  ('*', 'system', 'Everything', 'Unrestricted access. Super Admin only.', 'staff', false, 0),
  -- cases and checks
  ('cases.read', 'cases', 'View all cases', 'See every case in the organisation.', 'staff', true, 10),
  ('cases.read_assigned', 'cases', 'View assigned cases', 'See cases and checks assigned to you.', 'staff', true, 11),
  ('cases.create', 'cases', 'Create cases', 'Open new verification cases.', 'staff', true, 12),
  ('cases.update', 'cases', 'Edit cases', 'Edit case details and check data.', 'staff', true, 13),
  ('cases.assign', 'cases', 'Assign work', 'Assign and reassign cases and checks.', 'staff', true, 14),
  ('cases.stage.change', 'cases', 'Move case stages', 'Move cases between workflow stages.', 'staff', true, 15),
  ('cases.hold', 'cases', 'Hold cases', 'Put cases on hold and resume them.', 'staff', true, 16),
  ('cases.cancel', 'cases', 'Cancel cases', 'Cancel cases.', 'staff', true, 17),
  ('checks.verify', 'cases', 'Verify checks', 'Perform verification checks and record findings.', 'staff', true, 18),
  ('checks.data_entry', 'cases', 'Data entry', 'Confirm extracted data and complete check fields.', 'staff', true, 19),
  ('qc.pre', 'cases', 'Pre-QC review', 'Review documents before verification.', 'staff', true, 20),
  ('qc.post', 'cases', 'Post-QC review', 'Review completed checks before reporting.', 'staff', true, 21),
  ('candidates.manage', 'cases', 'Manage candidates', 'Create candidates and send candidate links.', 'staff', true, 22),
  ('candidates.requests', 'cases', 'Ask candidates', 'Send information and document requests to candidates.', 'staff', true, 23),
  -- documents and reports
  ('documents.read', 'documents', 'View documents', 'Open case documents and evidence.', 'staff', true, 30),
  ('documents.read_sensitive', 'documents', 'View sensitive evidence', 'Open evidence marked sensitive.', 'staff', true, 31),
  ('documents.manage_visibility', 'documents', 'Control visibility', 'Decide what clients and reports can see.', 'staff', true, 32),
  ('reports.preview', 'documents', 'Preview reports', 'Generate and view draft reports.', 'staff', true, 33),
  ('reports.approve', 'documents', 'Approve reports', 'Give final approval to reports.', 'staff', true, 34),
  ('reports.release', 'documents', 'Release reports', 'Release approved reports to clients.', 'staff', true, 35),
  -- clients and catalog
  ('clients.read', 'clients', 'View clients', 'See client companies and contacts.', 'staff', true, 40),
  ('clients.manage', 'clients', 'Manage clients', 'Create and edit clients and their portal users.', 'staff', true, 41),
  ('packages.manage', 'clients', 'Manage packages', 'Build verification packages and prices.', 'staff', true, 42),
  ('check_types.manage', 'clients', 'Manage check types', 'Design verification check types and fields.', 'staff', true, 43),
  ('templates.manage', 'clients', 'Manage templates', 'Edit document, email and request templates.', 'staff', true, 44),
  -- commercial
  ('quotes.manage', 'commercial', 'Build quotations', 'Draft and edit quotations.', 'staff', true, 50),
  ('quotes.send', 'commercial', 'Send quotations', 'Confirm and send quotations to clients.', 'staff', true, 51),
  ('invoices.manage', 'commercial', 'Manage invoices', 'Draft, edit and void invoices.', 'staff', true, 52),
  ('invoices.send', 'commercial', 'Send invoices', 'Confirm and send invoices and reminders.', 'staff', true, 53),
  ('payments.record', 'commercial', 'Record payments', 'Record payments and confirm payment slips.', 'staff', true, 54),
  ('billing.export', 'commercial', 'Export billing', 'Export statements and billing data.', 'staff', true, 55),
  -- team
  ('users.manage', 'team', 'Manage users', 'Invite staff and change their roles.', 'staff', true, 60),
  ('roles.manage', 'team', 'Manage roles', 'Create designations and edit permissions.', 'staff', true, 61),
  ('assignment.configure', 'team', 'Configure assignment', 'Edit auto-assignment rules, skills and capacity.', 'staff', true, 62),
  ('staff.performance.read', 'team', 'View performance', 'See team performance and workload.', 'staff', true, 63),
  ('staff.nudge', 'team', 'Push staff', 'Send nudges to staff who are behind.', 'staff', true, 64),
  -- platform
  ('settings.manage', 'platform', 'Manage settings', 'Change organisation settings and branding.', 'staff', true, 70),
  ('jobs.read', 'platform', 'View background jobs', 'Monitor and retry background jobs.', 'staff', true, 71),
  ('ai.assistant', 'platform', 'Use the AI assistant', 'Ask the assistant about the data you can see.', 'staff', true, 72),
  ('ai.configure', 'platform', 'Configure AI', 'Change AI models, budgets and switches.', 'staff', true, 73),
  ('ai.usage.read', 'platform', 'View AI usage and cost', 'See AI usage and spend.', 'staff', true, 74),
  ('ai.super_assistant', 'platform', 'Command assistant', 'Voice-enabled assistant with reach across the whole system.', 'staff', false, 75),
  ('audit.read', 'platform', 'View audit log', 'Read the audit trail.', 'staff', true, 76),
  ('analytics.read', 'platform', 'View analytics', 'See operational and revenue analytics.', 'staff', true, 77),
  -- client portal
  ('portal.cases.read', 'portal', 'View cases', 'See your company''s cases.', 'client', true, 100),
  ('portal.cases.create', 'portal', 'Request verifications', 'Submit new verification requests.', 'client', true, 101),
  ('portal.packages.manage', 'portal', 'Build packages', 'Create and name custom packages.', 'client', true, 102),
  ('portal.templates.manage', 'portal', 'Manage request templates', 'Create quick-pick request templates.', 'client', true, 103),
  ('portal.quotes.accept', 'portal', 'Accept quotations', 'Accept or decline quotations.', 'client', true, 104),
  ('portal.invoices.view', 'portal', 'View invoices', 'See invoices and statements.', 'client', true, 105),
  ('portal.payments.upload', 'portal', 'Upload payments', 'Upload payment slips.', 'client', true, 106),
  ('portal.users.manage', 'portal', 'Manage your team', 'Invite colleagues to the portal.', 'client', true, 107)
on conflict (key) do update
  set group_key = excluded.group_key, label = excluded.label, description = excluded.description,
      kind = excluded.kind, grantable = excluded.grantable, sort = excluded.sort;

-- ---------------------------------------------------------------------------
-- Seed: system roles for an org (re-usable when a new tenant is created)
-- ---------------------------------------------------------------------------
create or replace function public.provision_org_roles(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_def record;
  v_role_id uuid;
begin
  for v_def in
    select * from (values
      ('super_admin', 'Super Admin', 'Unrestricted access, including the command assistant.', 'staff',
        array['*']),
      ('admin', 'Admin', 'Runs the organisation: people, clients, catalog, approvals.', 'staff',
        array['cases.read','cases.create','cases.update','cases.assign','cases.stage.change','cases.hold','cases.cancel',
              'checks.verify','checks.data_entry','qc.pre','qc.post','candidates.manage','candidates.requests',
              'documents.read','documents.read_sensitive','documents.manage_visibility','reports.preview','reports.approve','reports.release',
              'clients.read','clients.manage','packages.manage','check_types.manage','templates.manage',
              'quotes.manage','quotes.send','invoices.manage','invoices.send','payments.record','billing.export',
              'users.manage','roles.manage','assignment.configure','staff.performance.read','staff.nudge',
              'settings.manage','jobs.read','ai.assistant','ai.configure','ai.usage.read','audit.read','analytics.read']),
      ('operations_manager', 'Operations Manager', 'Assigns and balances work, approves reports, watches SLAs.', 'staff',
        array['cases.read','cases.create','cases.update','cases.assign','cases.stage.change','cases.hold','cases.cancel',
              'checks.verify','checks.data_entry','qc.pre','qc.post','candidates.manage','candidates.requests',
              'documents.read','documents.read_sensitive','documents.manage_visibility','reports.preview','reports.approve','reports.release',
              'clients.read','assignment.configure','staff.performance.read','staff.nudge','jobs.read','ai.assistant','analytics.read','audit.read']),
      ('verification_officer', 'Verification Officer', 'Performs assigned checks and records findings.', 'staff',
        array['cases.read_assigned','cases.update','checks.verify','candidates.requests','documents.read','reports.preview','ai.assistant']),
      ('qc_officer', 'QC Officer', 'Runs Pre-QC and Post-QC reviews.', 'staff',
        array['cases.read','cases.update','cases.stage.change','qc.pre','qc.post','candidates.requests',
              'documents.read','documents.read_sensitive','reports.preview','ai.assistant']),
      ('data_entry_officer', 'Data Entry Officer', 'Confirms extracted data and completes check fields.', 'staff',
        array['cases.read_assigned','cases.update','checks.data_entry','documents.read','ai.assistant']),
      ('client_relations', 'Client Relations', 'Onboards clients, quotes, invoices and payments.', 'staff',
        array['cases.read','cases.create','candidates.manage','candidates.requests','clients.read','clients.manage',
              'documents.read','reports.preview','quotes.manage','quotes.send','invoices.manage','invoices.send',
              'payments.record','billing.export','ai.assistant','analytics.read']),
      ('viewer', 'Viewer', 'Read-only access to cases and clients.', 'staff',
        array['cases.read','clients.read','documents.read','reports.preview','analytics.read']),
      ('client_admin', 'Client Admin', 'Manages the client company''s portal, requests, quotes and invoices.', 'client',
        array['portal.cases.read','portal.cases.create','portal.packages.manage','portal.templates.manage',
              'portal.quotes.accept','portal.invoices.view','portal.payments.upload','portal.users.manage']),
      ('client_user', 'Client User', 'Submits requests and follows their progress.', 'client',
        array['portal.cases.read','portal.cases.create','portal.invoices.view']),
      ('client_viewer', 'Client Viewer', 'Views cases and reports only.', 'client',
        array['portal.cases.read'])
    ) as t(key, name, description, kind, perms)
  loop
    insert into public.roles (org_id, key, name, description, kind, is_system)
    values (p_org, v_def.key, v_def.name, v_def.description, v_def.kind::public.member_kind, true)
    on conflict (org_id, key) do update set name = excluded.name, description = excluded.description
    returning id into v_role_id;

    insert into public.role_permissions (role_id, permission)
    select v_role_id, unnest(v_def.perms)
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function public.provision_org_roles(uuid) from public, anon, authenticated;

select public.provision_org_roles('00000000-0000-4000-8000-000000000001');
