-- =============================================================================
-- 0013_document_system.sql
-- Feature: branded document templates, numbering series, generated PDFs.
-- Depends on: 0001_foundation, 0002_audit, 0009_jobs.
-- Buckets created here: documents (private), org-assets (public).
-- =============================================================================

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null check (key in ('executive', 'modern', 'classic')),
  name text not null,
  description text not null default '',
  settings jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create unique index document_templates_one_default_uq on public.document_templates (org_id) where is_default;
create trigger a_set_org_id before insert on public.document_templates
  for each row execute function public.set_org_id();
create trigger document_templates_updated_at before update on public.document_templates
  for each row execute function public.set_updated_at();

insert into public.document_templates (org_id, key, name, description, is_default) values
  ('00000000-0000-4000-8000-000000000001', 'executive', 'Executive',
   'Navy header band, serif headings, summary box on the first page.', true),
  ('00000000-0000-4000-8000-000000000001', 'modern', 'Modern',
   'White page, thin navy accent rule, airy tables and a totals card.', false),
  ('00000000-0000-4000-8000-000000000001', 'classic', 'Classic',
   'Formal bordered tables, compact rows, traditional letterhead.', false)
on conflict (org_id, key) do nothing;

-- Numbering series per document kind, e.g. QT-2026-0001.
create table public.document_series (
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null,
  prefix text not null,
  padding int not null default 4 check (padding between 3 and 8),
  yearly_reset boolean not null default true,
  primary key (org_id, kind)
);
insert into public.document_series (org_id, kind, prefix) values
  ('00000000-0000-4000-8000-000000000001', 'quote', 'QT'),
  ('00000000-0000-4000-8000-000000000001', 'invoice', 'INV'),
  ('00000000-0000-4000-8000-000000000001', 'credit_note', 'CN'),
  ('00000000-0000-4000-8000-000000000001', 'receipt', 'RCT'),
  ('00000000-0000-4000-8000-000000000001', 'consent', 'CNS'),
  ('00000000-0000-4000-8000-000000000001', 'statement', 'ST')
on conflict do nothing;

create table public.document_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null,
  year int not null,
  last_value int not null default 0,
  primary key (org_id, kind, year)
);

-- Gap-free numbers allocated under a row lock (never reuse, void instead).
create or replace function public.next_document_number(p_kind text, p_org uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.auth_org_id(), public.default_org_id());
  v_series public.document_series;
  v_year int := extract(year from now() at time zone 'Asia/Colombo')::int;
  v_value int;
begin
  if auth.uid() is not null and not (select public.is_staff()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_series from public.document_series where org_id = v_org and kind = p_kind;
  if v_series.kind is null then
    raise exception 'no numbering series for %', p_kind using errcode = '22023';
  end if;
  if not v_series.yearly_reset then
    v_year := 0;
  end if;

  insert into public.document_counters (org_id, kind, year, last_value) values (v_org, p_kind, v_year, 1)
  on conflict (org_id, kind, year) do update set last_value = public.document_counters.last_value + 1
  returning last_value into v_value;

  return v_series.prefix || '-' || case when v_year > 0 then v_year::text || '-' else '' end
         || lpad(v_value::text, v_series.padding, '0');
end $$;
revoke execute on function public.next_document_number(text, uuid) from public, anon;
grant execute on function public.next_document_number(text, uuid) to authenticated, service_role;

-- Every PDF the system produces.
create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null,                  -- quote, invoice, statement, receipt, consent, cost_report…
  entity_type text,
  entity_id uuid,
  version int not null default 1,
  template_key text,
  title text not null default '',
  status text not null default 'queued' check (status in ('queued', 'ready', 'failed', 'superseded', 'void')),
  storage_path text,
  sha256 text,
  page_count int,
  size_bytes bigint,
  job_id uuid references public.jobs (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, kind, version)
);
create index generated_documents_entity_idx on public.generated_documents (entity_type, entity_id, created_at desc);
create trigger a_set_org_id before insert on public.generated_documents
  for each row execute function public.set_org_id();
create trigger generated_documents_updated_at before update on public.generated_documents
  for each row execute function public.set_updated_at();

select public.attach_audit('public.document_templates');
select public.attach_audit('public.document_series', 'org_id,kind');
select public.attach_audit('public.generated_documents');

alter table public.document_templates enable row level security;
alter table public.document_series enable row level security;
alter table public.document_counters enable row level security;
alter table public.generated_documents enable row level security;

create policy document_templates_select on public.document_templates for select to authenticated
  using (org_id = (select public.auth_org_id()));
create policy document_templates_update on public.document_templates for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('templates.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy document_series_select on public.document_series for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy document_series_update on public.document_series for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('settings.manage')))
  with check (org_id = (select public.auth_org_id()));
revoke insert, update, delete, truncate on public.document_counters from anon, authenticated;

-- Staff see documents in their org. Client visibility is granted per kind by
-- the quote/invoice migrations through portal views, not here.
create policy generated_documents_select on public.generated_documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
revoke insert, update, delete, truncate on public.generated_documents from anon, authenticated;

-- Storage buckets. No storage.objects policies for authenticated users: every
-- read is a short-lived signed URL minted by the server after an RLS check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents', 'documents', false, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav']),
  ('org-assets', 'org-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;
