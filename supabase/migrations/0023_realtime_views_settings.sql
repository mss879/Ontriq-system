-- =============================================================================
-- 0023_realtime_views_settings.sql
-- Feature: live updates for the case screens and saved views for the cases list.
-- Realtime honours row level security, so people only hear about rows they may read.
-- Depends on: 0006_cases, 0007_documents, 0016_assignment.
-- =============================================================================

alter publication supabase_realtime add table
  public.cases, public.case_checks, public.case_events, public.case_check_requirements, public.documents, public.assignment_events;

-- Saved filters for the cases list: private to their owner, or shared with all staff.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  entity text not null default 'cases' check (entity in ('cases')),
  name text not null check (length(trim(name)) between 1 and 60),
  query text not null default '',          -- the list's URL query string
  shared boolean not null default false,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_views_org_idx on public.saved_views (org_id, entity);
create index saved_views_owner_idx on public.saved_views (owner_id);
create trigger a_set_org_id before insert on public.saved_views
  for each row execute function public.set_org_id();
create trigger saved_views_updated_at before update on public.saved_views
  for each row execute function public.set_updated_at();

alter table public.saved_views enable row level security;
create policy saved_views_select on public.saved_views for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (shared or owner_id = (select auth.uid())));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and owner_id = (select auth.uid()));
create policy saved_views_update on public.saved_views for update to authenticated
  using (org_id = (select public.auth_org_id()) and owner_id = (select auth.uid()))
  with check (org_id = (select public.auth_org_id()) and owner_id = (select auth.uid()));
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (org_id = (select public.auth_org_id()) and owner_id = (select auth.uid()));
