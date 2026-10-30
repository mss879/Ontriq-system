-- =============================================================================
-- 0003_clients.sql
-- Feature: client companies, contacts and client settings.
-- Depends on: 0001_foundation, 0002_audit.
-- (client_check_type_access lives in 0005, after check types exist.)
-- =============================================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  code text not null,
  legal_name text,
  registration_no text,
  vat_no text,
  industry text,
  website text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  sla_days int not null default 7 check (sla_days between 1 and 120),
  default_package_id uuid,              -- FK added in 0005_packages_templates
  default_template text not null default 'executive',
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 180),
  billing_policy text not null default 'per_case_on_release'
    check (billing_policy in ('per_case_on_release', 'monthly_consolidated')),
  ai_opt_out boolean not null default false,
  status text not null default 'active' check (status in ('prospect', 'active', 'suspended', 'archived')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create index clients_org_name_idx on public.clients (org_id, lower(name));
create trigger a_set_org_id before insert on public.clients
  for each row execute function public.set_org_id();
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  receives_reports boolean not null default true,
  receives_invoices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts (client_id);
create unique index client_contacts_one_primary_uq on public.client_contacts (client_id) where is_primary;
create trigger a_set_org_id before insert on public.client_contacts
  for each row execute function public.set_org_id();
create trigger client_contacts_updated_at before update on public.client_contacts
  for each row execute function public.set_updated_at();

-- Visibility defaults, portal options and notification routing per client.
create table public.client_settings (
  client_id uuid primary key references public.clients (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  visibility jsonb not null default '{}'::jsonb,
  portal jsonb not null default '{"bulk_upload": true, "client_packages": true, "client_packages_need_approval": false}'::jsonb,
  notifications jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger a_set_org_id before insert on public.client_settings
  for each row execute function public.set_org_id();
create trigger client_settings_updated_at before update on public.client_settings
  for each row execute function public.set_updated_at();

create or replace function public.create_client_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_settings (client_id, org_id) values (new.id, new.org_id)
  on conflict (client_id) do nothing;
  return new;
end $$;
create trigger clients_create_settings after insert on public.clients
  for each row execute function public.create_client_settings();

-- Client foreign keys deferred from 0001.
alter table public.memberships
  add constraint memberships_client_fk foreign key (client_id) references public.clients (id) on delete cascade;
alter table public.invitations
  add constraint invitations_client_fk foreign key (client_id) references public.clients (id) on delete cascade;

-- Client users should see their company's name in the app header.
create or replace function public.my_membership() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', m.user_id,
    'org_id', m.org_id,
    'org_name', o.name,
    'kind', m.kind,
    'client_id', m.client_id,
    'client_name', c.name,
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
  left join public.clients c on c.id = m.client_id
  where m.user_id = auth.uid() and m.status in ('active', 'invited')
  order by (m.status = 'active') desc
  limit 1
$$;

-- Short unique client code from a name: "Hemas Holdings" -> "HEMAS", "HEMAS-2".
create or replace function public.suggest_client_code(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '', 'g'), 8));
  v_code text;
  n int := 1;
begin
  if v_base = '' then v_base := 'CLIENT'; end if;
  v_code := v_base;
  while exists (select 1 from public.clients c where c.code = v_code
                and c.org_id = coalesce(public.auth_org_id(), public.default_org_id())) loop
    n := n + 1;
    v_code := v_base || '-' || n;
  end loop;
  return v_code;
end $$;
revoke execute on function public.suggest_client_code(text) from public, anon;
grant execute on function public.suggest_client_code(text) to authenticated, service_role;

select public.attach_audit('public.clients');
select public.attach_audit('public.client_contacts');
select public.attach_audit('public.client_settings', 'client_id');

alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_settings enable row level security;

create policy clients_select on public.clients for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and ((select public.has_permission('clients.read')) or (select public.has_permission('clients.manage'))
                                          or (select public.has_permission('cases.read'))))
         or id = (select public.client_id_of_user()))
  );
create policy clients_insert on public.clients for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')));
create policy clients_update on public.clients for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy client_contacts_select on public.client_contacts for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and ((select public.has_permission('clients.read')) or (select public.has_permission('clients.manage'))))
         or client_id = (select public.client_id_of_user()))
  );
create policy client_contacts_write on public.client_contacts for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')));
create policy client_contacts_update on public.client_contacts for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')))
  with check (org_id = (select public.auth_org_id()));
create policy client_contacts_delete on public.client_contacts for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')));

create policy client_settings_select on public.client_settings for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (((select public.is_staff()) and ((select public.has_permission('clients.read')) or (select public.has_permission('clients.manage'))))
         or client_id = (select public.client_id_of_user()))
  );
create policy client_settings_update on public.client_settings for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('clients.manage')))
  with check (org_id = (select public.auth_org_id()));
