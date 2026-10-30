-- =============================================================================
-- 0005_packages_templates.sql
-- Feature: packages (Ontriq's and client-built), which checks each client may
-- order, and one-click request templates. Clients never set prices: they see
-- Ontriq's unit prices (Phase 3 adds per-client price lists).
-- Depends on: 0001_foundation, 0002_audit, 0003_clients, 0004_check_types.
-- =============================================================================

create type public.process_type as enum ('client_supplied', 'candidate_collected');

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  owner_scope text not null default 'org' check (owner_scope in ('org', 'client')),
  client_id uuid references public.clients (id) on delete cascade,
  name text not null,
  code text not null,
  description text not null default '',
  pricing_mode text not null default 'sum' check (pricing_mode in ('sum', 'fixed')),
  fixed_price numeric(12, 2) check (fixed_price is null or fixed_price >= 0),
  currency text not null default 'LKR',
  tat_days int not null default 7 check (tat_days between 1 and 90),
  default_process_type public.process_type not null default 'client_supplied',
  visibility text not null default 'all' check (visibility in ('all', 'selected')),
  is_active boolean not null default true,
  needs_approval boolean not null default false,
  sort int not null default 100,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code),
  check ((owner_scope = 'client') = (client_id is not null))
);
create index packages_client_idx on public.packages (client_id);
create index packages_created_by_idx on public.packages (created_by);
create trigger a_set_org_id before insert on public.packages
  for each row execute function public.set_org_id();
create trigger packages_updated_at before update on public.packages
  for each row execute function public.set_updated_at();

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  package_id uuid not null references public.packages (id) on delete cascade,
  check_type_id uuid not null references public.check_types (id) on delete restrict,
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  sort int not null default 100,
  unique (package_id, check_type_id)
);
create index package_items_org_idx on public.package_items (org_id);
create index package_items_check_type_idx on public.package_items (check_type_id);
create trigger a_set_org_id before insert on public.package_items
  for each row execute function public.set_org_id();

-- Which clients see a package with visibility 'selected'.
create table public.package_client_visibility (
  package_id uuid not null references public.packages (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  primary key (package_id, client_id)
);
create index package_client_visibility_client_idx on public.package_client_visibility (client_id);
create index package_client_visibility_org_idx on public.package_client_visibility (org_id);
create trigger a_set_org_id before insert on public.package_client_visibility
  for each row execute function public.set_org_id();

-- Checks a client may order. No row means allowed; enabled = false turns one off.
create table public.client_check_type_access (
  client_id uuid not null references public.clients (id) on delete cascade,
  check_type_id uuid not null references public.check_types (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  enabled boolean not null default true,
  primary key (client_id, check_type_id)
);
create index client_check_type_access_type_idx on public.client_check_type_access (check_type_id);
create index client_check_type_access_org_idx on public.client_check_type_access (org_id);
create trigger a_set_org_id before insert on public.client_check_type_access
  for each row execute function public.set_org_id();

alter table public.clients
  add constraint clients_default_package_fk foreign key (default_package_id) references public.packages (id) on delete set null;
create index clients_default_package_idx on public.clients (default_package_id);

create table public.request_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  owner_scope text not null default 'org' check (owner_scope in ('org', 'client')),
  client_id uuid references public.clients (id) on delete cascade,
  name text not null,
  description text not null default '',
  package_id uuid not null references public.packages (id) on delete cascade,
  process_type public.process_type not null default 'client_supplied',
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  -- position, department, instructions, notify emails
  defaults jsonb not null default '{}'::jsonb,
  is_favourite boolean not null default false,
  usage_count int not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_scope = 'client') = (client_id is not null))
);
create index request_templates_org_idx on public.request_templates (org_id);
create index request_templates_client_idx on public.request_templates (client_id);
create index request_templates_package_idx on public.request_templates (package_id);
create index request_templates_created_by_idx on public.request_templates (created_by);
create trigger a_set_org_id before insert on public.request_templates
  for each row execute function public.set_org_id();
create trigger request_templates_updated_at before update on public.request_templates
  for each row execute function public.set_updated_at();

-- Can the caller's client company use this package?
create or replace function public.client_can_use_package(p_package uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.packages p
     where p.id = p_package and p.is_active
       and ((p.owner_scope = 'client' and p.client_id = p_client)
            or (p.owner_scope = 'org' and (p.visibility = 'all'
                or exists (select 1 from public.package_client_visibility v where v.package_id = p.id and v.client_id = p_client))))
  )
$$;
revoke execute on function public.client_can_use_package(uuid, uuid) from public, anon;
grant execute on function public.client_can_use_package(uuid, uuid) to authenticated, service_role;

select public.attach_audit('public.packages');
select public.attach_audit('public.package_items');
select public.attach_audit('public.package_client_visibility', 'package_id,client_id');
select public.attach_audit('public.client_check_type_access', 'client_id,check_type_id');
select public.attach_audit('public.request_templates');

alter table public.packages enable row level security;
alter table public.package_items enable row level security;
alter table public.package_client_visibility enable row level security;
alter table public.client_check_type_access enable row level security;
alter table public.request_templates enable row level security;

-- Packages: staff read all; clients read Ontriq packages offered to them and their own.
create policy packages_select on public.packages for select to authenticated
  using (org_id = (select public.auth_org_id()) and (
    (select public.is_staff())
    or ((select public.is_client()) and public.client_can_use_package(id, (select public.client_id_of_user())))
  ));
create policy packages_insert on public.packages for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and (select public.has_permission('packages.manage')))
    or ((select public.is_client()) and (select public.has_permission('portal.packages.manage'))
        and owner_scope = 'client' and client_id = (select public.client_id_of_user()))
  ));
create policy packages_update on public.packages for update to authenticated
  using (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and (select public.has_permission('packages.manage')))
    or ((select public.is_client()) and (select public.has_permission('portal.packages.manage')) and client_id = (select public.client_id_of_user()))
  ))
  with check (org_id = (select public.auth_org_id()) and (
    (select public.is_staff()) or (owner_scope = 'client' and client_id = (select public.client_id_of_user()))
  ));

create policy package_items_select on public.package_items for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.packages p where p.id = package_id));
create policy package_items_write on public.package_items for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and exists (
    select 1 from public.packages p where p.id = package_id and (
      ((select public.is_staff()) and (select public.has_permission('packages.manage')))
      or ((select public.is_client()) and (select public.has_permission('portal.packages.manage')) and p.client_id = (select public.client_id_of_user()))
    )));
create policy package_items_delete on public.package_items for delete to authenticated
  using (org_id = (select public.auth_org_id()) and exists (
    select 1 from public.packages p where p.id = package_id and (
      ((select public.is_staff()) and (select public.has_permission('packages.manage')))
      or ((select public.is_client()) and (select public.has_permission('portal.packages.manage')) and p.client_id = (select public.client_id_of_user()))
    )));
-- Only Ontriq sets prices.
create policy package_items_update on public.package_items for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('packages.manage')))
  with check (org_id = (select public.auth_org_id()));

create or replace function public.package_items_price_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Client-built packages take Ontriq's list price for each check, whatever was sent.
  if auth.uid() is not null and not public.is_staff() then
    new.unit_price := coalesce((
      select pi.unit_price from public.package_items pi
        join public.packages p on p.id = pi.package_id
       where pi.check_type_id = new.check_type_id and p.owner_scope = 'org' and p.is_active
       order by pi.unit_price desc limit 1), 0);
  end if;
  return new;
end $$;
create trigger package_items_price_guard before insert on public.package_items
  for each row execute function public.package_items_price_guard();
revoke execute on function public.package_items_price_guard() from public, anon, authenticated;

create policy package_client_visibility_select on public.package_client_visibility for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy package_client_visibility_write on public.package_client_visibility for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('packages.manage')));
create policy package_client_visibility_delete on public.package_client_visibility for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('packages.manage')));

create policy client_check_type_access_select on public.client_check_type_access for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_staff()) or client_id = (select public.client_id_of_user())));
create policy client_check_type_access_write on public.client_check_type_access for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')));
create policy client_check_type_access_update on public.client_check_type_access for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy request_templates_select on public.request_templates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and owner_scope = 'org')
    or ((select public.is_staff()) and (select public.has_permission('clients.read')))
    or client_id = (select public.client_id_of_user())
  ));
create policy request_templates_insert on public.request_templates for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and (select public.has_permission('templates.manage')))
    or ((select public.is_client()) and (select public.has_permission('portal.templates.manage'))
        and owner_scope = 'client' and client_id = (select public.client_id_of_user()))
  ));
create policy request_templates_update on public.request_templates for update to authenticated
  using (org_id = (select public.auth_org_id()) and (
    ((select public.is_staff()) and (select public.has_permission('templates.manage')))
    or ((select public.is_client()) and (select public.has_permission('portal.templates.manage')) and client_id = (select public.client_id_of_user()))
  ))
  with check (org_id = (select public.auth_org_id()));
