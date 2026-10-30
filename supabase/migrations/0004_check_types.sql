-- =============================================================================
-- 0004_check_types.sql
-- Feature: the check type builder. Document categories, check types and their
-- versioned definitions (src/domain/check-types/schema.ts describes the JSON).
-- A published version is frozen: cases keep the version they started with.
-- Depends on: 0001_foundation, 0002_audit.
-- =============================================================================

create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name text not null,
  guide text not null default '',
  sensitive boolean not null default false,
  sort int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create trigger a_set_org_id before insert on public.document_categories
  for each row execute function public.set_org_id();
create trigger document_categories_updated_at before update on public.document_categories
  for each row execute function public.set_updated_at();

create table public.check_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  name text not null,
  description text not null default '',
  icon text not null default 'check',
  sort int not null default 100,
  is_builtin boolean not null default false,
  current_version_id uuid,
  draft_version_id uuid,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create index check_types_created_by_idx on public.check_types (created_by);
create trigger a_set_org_id before insert on public.check_types
  for each row execute function public.set_org_id();
create trigger check_types_updated_at before update on public.check_types
  for each row execute function public.set_updated_at();

create table public.check_type_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  check_type_id uuid not null references public.check_types (id) on delete cascade,
  version int,                      -- set when published
  schema jsonb not null,
  notes text,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (check_type_id, version)
);
create index check_type_versions_type_idx on public.check_type_versions (check_type_id);
create index check_type_versions_org_idx on public.check_type_versions (org_id);
create index check_type_versions_published_by_idx on public.check_type_versions (published_by);
create index check_type_versions_created_by_idx on public.check_type_versions (created_by);
create trigger a_set_org_id before insert on public.check_type_versions
  for each row execute function public.set_org_id();
create trigger check_type_versions_updated_at before update on public.check_type_versions
  for each row execute function public.set_updated_at();

alter table public.check_types
  add constraint check_types_current_version_fk foreign key (current_version_id) references public.check_type_versions (id) on delete set null,
  add constraint check_types_draft_version_fk foreign key (draft_version_id) references public.check_type_versions (id) on delete set null;
create index check_types_current_version_idx on public.check_types (current_version_id);
create index check_types_draft_version_idx on public.check_types (draft_version_id);

-- A published version never changes; edit a new draft instead.
create or replace function public.check_type_versions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'published check type versions cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.published_at is not null then
    raise exception 'published check type versions cannot be changed; edit a draft' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger check_type_versions_guard before update or delete on public.check_type_versions
  for each row execute function public.check_type_versions_guard();
revoke execute on function public.check_type_versions_guard() from public, anon, authenticated;

-- Save the editor's work as the draft version (created on first save).
create or replace function public.save_check_type_draft(p_check_type uuid, p_schema jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.check_types;
  v_draft uuid;
begin
  if auth.uid() is not null and not ((select public.is_staff()) and (select public.has_permission('check_types.manage'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_schema -> 'fields') <> 'array' then
    raise exception 'a check type needs a list of fields' using errcode = '22023';
  end if;
  select * into v_type from public.check_types where id = p_check_type for update;
  if v_type.id is null or (auth.uid() is not null and v_type.org_id <> public.auth_org_id()) then
    raise exception 'check type not found' using errcode = 'P0002';
  end if;
  if v_type.draft_version_id is not null then
    update public.check_type_versions set schema = p_schema where id = v_type.draft_version_id;
    return v_type.draft_version_id;
  end if;
  insert into public.check_type_versions (org_id, check_type_id, schema, created_by)
  values (v_type.org_id, v_type.id, p_schema, auth.uid())
  returning id into v_draft;
  update public.check_types set draft_version_id = v_draft where id = v_type.id;
  return v_draft;
end $$;

create or replace function public.discard_check_type_draft(p_check_type uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_draft uuid;
begin
  if auth.uid() is not null and not ((select public.is_staff()) and (select public.has_permission('check_types.manage'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select draft_version_id into v_draft from public.check_types
   where id = p_check_type and (auth.uid() is null or org_id = public.auth_org_id()) for update;
  if v_draft is null then return; end if;
  update public.check_types set draft_version_id = null where id = p_check_type;
  delete from public.check_type_versions where id = v_draft;
end $$;

-- Publish the draft: it becomes the current version with the next number.
create or replace function public.publish_check_type(p_check_type uuid, p_notes text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.check_types;
  v_version int;
begin
  if auth.uid() is not null and not ((select public.is_staff()) and (select public.has_permission('check_types.manage'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_type from public.check_types where id = p_check_type for update;
  if v_type.id is null or (auth.uid() is not null and v_type.org_id <> public.auth_org_id()) then
    raise exception 'check type not found' using errcode = 'P0002';
  end if;
  if v_type.draft_version_id is null then
    raise exception 'there is no draft to publish' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.check_type_versions where check_type_id = p_check_type;
  update public.check_type_versions
     set version = v_version, published_at = now(), published_by = auth.uid(), notes = coalesce(p_notes, notes)
   where id = v_type.draft_version_id;
  update public.check_types set current_version_id = draft_version_id, draft_version_id = null where id = p_check_type;
  return v_version;
end $$;

revoke execute on function public.save_check_type_draft(uuid, jsonb), public.discard_check_type_draft(uuid), public.publish_check_type(uuid, text) from public, anon;
grant execute on function public.save_check_type_draft(uuid, jsonb), public.discard_check_type_draft(uuid), public.publish_check_type(uuid, text) to authenticated, service_role;

select public.attach_audit('public.document_categories');
select public.attach_audit('public.check_types');
select public.attach_audit('public.check_type_versions');

alter table public.document_categories enable row level security;
alter table public.check_types enable row level security;
alter table public.check_type_versions enable row level security;

-- Catalogue names are not sensitive: staff and client users of the org read them.
create policy document_categories_select on public.document_categories for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_staff()) or (select public.is_client())));
create policy document_categories_write on public.document_categories for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('check_types.manage')));
create policy document_categories_update on public.document_categories for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('check_types.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy check_types_select on public.check_types for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_staff()) or (select public.is_client())));
create policy check_types_insert on public.check_types for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('check_types.manage')));
create policy check_types_update on public.check_types for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('check_types.manage')))
  with check (org_id = (select public.auth_org_id()));

-- Definitions are staff-only; the portal and candidate link get projections later.
create policy check_type_versions_select on public.check_type_versions for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
-- Versions change only through save_check_type_draft() and publish_check_type().
revoke insert, update, delete, truncate on public.check_type_versions from anon, authenticated;
-- Version pointers move only through those functions too.
revoke update on public.check_types from authenticated;
grant update (name, description, icon, sort, archived_at) on public.check_types to authenticated;
