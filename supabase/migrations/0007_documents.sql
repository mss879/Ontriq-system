-- =============================================================================
-- 0007_documents.sql
-- Feature: documents and evidence. Every file is a row here and an object in
-- the private case-files bucket. Uploads go straight from the browser to
-- Storage through a signed upload URL minted after begin_document_upload();
-- downloads are 60-second signed URLs minted after an RLS read, and each one
-- is logged. Received counts on case requirements stay in step by trigger.
-- Depends on: 0006_cases.
-- =============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete set null,
  candidate_id uuid references public.candidates (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  category text not null,
  label text,
  storage_bucket text not null default 'case-files',
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  sha256 text,
  version int not null default 1,
  parent_id uuid references public.documents (id) on delete set null,
  sensitive boolean not null default false,
  visibility text not null default 'internal' check (visibility in ('internal', 'client', 'report')),
  status text not null default 'pending_upload'
    check (status in ('pending_upload', 'uploaded', 'accepted', 'rejected', 'superseded')),
  rejection_reason text,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_kind text not null default 'staff' check (uploaded_by_kind in ('staff', 'client', 'candidate', 'system')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index documents_org_idx on public.documents (org_id, created_at desc);
create index documents_case_idx on public.documents (case_id, status);
create index documents_check_idx on public.documents (case_check_id);
create index documents_candidate_idx on public.documents (candidate_id);
create index documents_client_idx on public.documents (client_id);
create index documents_parent_idx on public.documents (parent_id);
create index documents_uploaded_by_idx on public.documents (uploaded_by);
create index documents_reviewed_by_idx on public.documents (reviewed_by);
create trigger a_set_org_id before insert on public.documents
  for each row execute function public.set_org_id();
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- OCR text and AI findings arrive in Phase 4; the tables exist so features can land independently.
create table public.document_texts (
  document_id uuid primary key references public.documents (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  text text not null default '',
  language text,
  created_at timestamptz not null default now()
);
create index document_texts_org_idx on public.document_texts (org_id);

create table public.document_ai (
  document_id uuid primary key references public.documents (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  classification jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index document_ai_org_idx on public.document_ai (org_id);

-- Who opened which file, when.
create table public.document_access_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  action text not null default 'view' check (action in ('view', 'download')),
  ip text,
  at timestamptz not null default now()
);
create index document_access_log_org_idx on public.document_access_log (org_id, at desc);
create index document_access_log_document_idx on public.document_access_log (document_id, at desc);
create index document_access_log_user_idx on public.document_access_log (user_id);

-- Private buckets. No storage.objects policies: every read and write is a signed URL minted by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('case-files', 'case-files', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('reports', 'reports', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

-- Keep requirement counts in step: a file counts while it is uploaded or accepted.
create or replace function public.sync_requirement_counts(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.case_check_requirements r
     set received_count = x.n,
         status = case
           when r.status = 'waived' then 'waived'
           when r.min_count = 0 then 'optional'
           when x.n >= r.min_count then 'received'
           else 'pending' end
    from (
      select r2.id, (select count(*) from public.documents d
                      where d.case_id = r2.case_id and d.category = r2.category
                        and (r2.case_check_id is null or d.case_check_id is null or d.case_check_id = r2.case_check_id)
                        and d.status in ('uploaded', 'accepted'))::int as n
        from public.case_check_requirements r2 where r2.case_id = p_case
    ) x
   where r.id = x.id and (r.received_count, r.status) is distinct from (x.n, case
           when r.status = 'waived' then 'waived' when r.min_count = 0 then 'optional'
           when x.n >= r.min_count then 'received' else 'pending' end);
  perform public.recompute_case(p_case);
end $$;
revoke execute on function public.sync_requirement_counts(uuid) from public, anon, authenticated;

create or replace function public.documents_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_requirement_counts(coalesce(new.case_id, old.case_id));
  return null;
end $$;
create trigger documents_after_change after insert or update of status, category, case_check_id or delete on public.documents
  for each row execute function public.documents_after_change();
revoke execute on function public.documents_after_change() from public, anon, authenticated;

-- Step 1 of an upload: create the row and the storage path. The server then
-- mints a signed upload URL for that path with the service key.
create or replace function public.begin_document_upload(
  p_case uuid, p_check uuid, p_category text, p_filename text, p_mime text, p_size bigint, p_parent uuid default null, p_label text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_parent public.documents;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_safe text;
  v_sensitive boolean;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('candidates.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if p_check is not null and not exists (select 1 from public.case_checks where id = p_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  select sensitive into v_sensitive from public.document_categories where org_id = c.org_id and key = p_category and is_active;
  if v_sensitive is null then raise exception 'unknown document category' using errcode = '22023'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'upload a PDF, JPEG, PNG, WebP or HEIC file' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then raise exception 'files must be under 25 MB' using errcode = '22023'; end if;
  if p_parent is not null then
    select * into v_parent from public.documents where id = p_parent and case_id = p_case;
    if v_parent.id is null then raise exception 'previous version not found' using errcode = 'P0002'; end if;
  end if;

  v_safe := left(regexp_replace(lower(coalesce(p_filename, 'file')), '[^a-z0-9._-]+', '-', 'g'), 80);
  v_path := 'org/' || c.org_id || '/case/' || c.id || '/' || v_id || '/' || v_safe;
  insert into public.documents (id, org_id, case_id, case_check_id, candidate_id, client_id, category, label, storage_path, filename, mime, size_bytes,
                                version, parent_id, sensitive, uploaded_by, uploaded_by_kind)
  values (v_id, c.org_id, c.id, coalesce(p_check, v_parent.case_check_id), c.candidate_id, c.client_id, p_category, nullif(trim(p_label), ''), v_path,
          coalesce(nullif(trim(p_filename), ''), 'file'), p_mime, p_size, coalesce(v_parent.version + 1, 1), v_parent.id, v_sensitive,
          auth.uid(), case when auth.uid() is null then 'system' else 'staff' end);
  return jsonb_build_object('id', v_id, 'bucket', 'case-files', 'path', v_path);
end $$;
revoke execute on function public.begin_document_upload(uuid, uuid, text, text, text, bigint, uuid, text) from public, anon;
grant execute on function public.begin_document_upload(uuid, uuid, text, text, text, bigint, uuid, text) to authenticated, service_role;

-- Step 2: the server confirmed the object exists. Marks the file uploaded and
-- retires the version it replaces.
create or replace function public.finalize_document_upload(p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  if auth.uid() is not null and d.uploaded_by is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = p_document;
  if d.parent_id is not null then
    update public.documents set status = 'superseded' where id = d.parent_id and status <> 'superseded';
  end if;
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_uploaded',
    coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category) || ' uploaded',
    d.filename, jsonb_build_object('document_id', d.id, 'version', d.version), true, true);
end $$;
revoke execute on function public.finalize_document_upload(uuid, text) from public, anon;
grant execute on function public.finalize_document_upload(uuid, text) to authenticated, service_role;

create or replace function public.review_document(p_document uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if d.status not in ('uploaded', 'accepted', 'rejected') then raise exception 'this file cannot be reviewed now' using errcode = '22023'; end if;
  if not p_accept and coalesce(trim(p_reason), '') = '' then raise exception 'say what is wrong with the file' using errcode = '22023'; end if;
  update public.documents
     set status = case when p_accept then 'accepted' else 'rejected' end,
         rejection_reason = case when p_accept then null else p_reason end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_document;
  perform public.log_case_event(d.case_id, d.case_check_id, case when p_accept then 'document_accepted' else 'document_rejected' end,
    d.filename || case when p_accept then ' accepted' else ' needs replacing' end, p_reason,
    jsonb_build_object('document_id', d.id), not p_accept, not p_accept);
end $$;
revoke execute on function public.review_document(uuid, boolean, text) from public, anon;
grant execute on function public.review_document(uuid, boolean, text) to authenticated, service_role;

create or replace function public.set_document_visibility(p_document uuid, p_visibility text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('documents.manage_visibility') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_visibility not in ('internal', 'client', 'report') then raise exception 'unknown visibility' using errcode = '22023'; end if;
  update public.documents set visibility = p_visibility where id = p_document;
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_visibility', d.filename || ' is now ' || p_visibility, null,
    jsonb_build_object('document_id', d.id, 'visibility', p_visibility), false, false);
end $$;
revoke execute on function public.set_document_visibility(uuid, text) from public, anon;
grant execute on function public.set_document_visibility(uuid, text) to authenticated, service_role;

-- Record a view or download. Called by the download route after its RLS read.
create or replace function public.log_document_access(p_document uuid, p_action text, p_ip text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.document_access_log (org_id, document_id, user_id, action, ip)
  select d.org_id, d.id, auth.uid(), coalesce(p_action, 'view'), p_ip from public.documents d
   where d.id = p_document and d.org_id = public.auth_org_id();
end $$;
revoke execute on function public.log_document_access(uuid, text, text) from public, anon;
grant execute on function public.log_document_access(uuid, text, text) to authenticated, service_role;

select public.attach_audit('public.documents');

alter table public.documents enable row level security;
alter table public.document_texts enable row level security;
alter table public.document_ai enable row level security;
alter table public.document_access_log enable row level security;

-- Staff with documents.read on a case they can see; sensitive evidence needs documents.read_sensitive.
create policy documents_select on public.documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('documents.read'))
         and (not sensitive or (select public.has_permission('documents.read_sensitive')))
         and public.case_visible(case_id));
create policy document_texts_select on public.document_texts for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.documents d where d.id = document_id));
create policy document_ai_select on public.document_ai for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.documents d where d.id = document_id));
create policy document_access_log_select on public.document_access_log for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('audit.read')));

revoke insert, update, delete, truncate on public.documents, public.document_texts, public.document_ai, public.document_access_log from anon, authenticated;
