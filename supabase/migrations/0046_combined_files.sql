-- =============================================================================
-- 0046_combined_files.sql
-- One file can hold several documents: a client scans a NIC, a service letter
-- and a police report into one PDF. The AI lists what it sees; a person
-- confirms which slots the file fills, and each confirmed slot counts the file
-- as received. The AI never ticks a slot. See docs/features/0046-combined-files.md.
-- Depends on: 0007_documents, 0042_review_fixes.
-- =============================================================================

create table public.requirement_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  requirement_id uuid not null references public.case_check_requirements (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  pages text check (char_length(pages) <= 40),
  source text not null default 'staff' check (source in ('ai', 'staff')),
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (requirement_id, document_id)
);
create index requirement_files_org_idx on public.requirement_files (org_id);
create index requirement_files_case_idx on public.requirement_files (case_id);
create index requirement_files_document_idx on public.requirement_files (document_id);
create index requirement_files_confirmed_by_idx on public.requirement_files (confirmed_by);
select public.attach_audit('public.requirement_files');

alter table public.requirement_files enable row level security;
create policy requirement_files_select on public.requirement_files for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.documents d where d.id = document_id));
revoke insert, update, delete, truncate on public.requirement_files from anon, authenticated;

-- A file counts once for a slot: by its own category, or because a person said it holds that document.
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
                      where d.case_id = r2.case_id and d.status in ('uploaded', 'accepted')
                        and ((d.category = r2.category
                              and (r2.case_check_id is null or d.case_check_id is null or d.case_check_id = r2.case_check_id))
                             or exists (select 1 from public.requirement_files f where f.requirement_id = r2.id and f.document_id = d.id)))::int as n
        from public.case_check_requirements r2 where r2.case_id = p_case
    ) x
   where r.id = x.id and (r.received_count, r.status) is distinct from (x.n, case
           when r.status = 'waived' then 'waived' when r.min_count = 0 then 'optional'
           when x.n >= r.min_count then 'received' else 'pending' end);
  perform public.recompute_case(p_case);
end $$;
revoke execute on function public.sync_requirement_counts(uuid) from public, anon, authenticated;

create or replace function public.requirement_files_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_requirement_counts(coalesce(new.case_id, old.case_id));
  return null;
end $$;
create trigger requirement_files_after_change after insert or delete on public.requirement_files
  for each row execute function public.requirement_files_after_change();
revoke execute on function public.requirement_files_after_change() from public, anon, authenticated;

-- A person confirms which slots a file fills. p_links: [{"requirement": uuid, "pages": "3-4"}].
create or replace function public.confirm_requirement_files(p_document uuid, p_links jsonb, p_source text default 'staff') returns int
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  r public.case_check_requirements;
  v_link jsonb;
  v_labels text[] := '{}';
  v_sensitive boolean;
  v_report boolean;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if d.status not in ('uploaded', 'accepted') then raise exception 'this file cannot fill a document slot now' using errcode = '22023'; end if;
  if p_source not in ('ai', 'staff') then raise exception 'unknown source' using errcode = '22023'; end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links) = 0 then raise exception 'choose at least one document' using errcode = '22023'; end if;

  for v_link in select * from jsonb_array_elements(p_links) loop
    select * into r from public.case_check_requirements where id = (v_link ->> 'requirement')::uuid and case_id = d.case_id for update;
    if r.id is null then raise exception 'requirement not found' using errcode = 'P0002'; end if;
    if r.status = 'waived' then raise exception '% was waived', r.label using errcode = '22023'; end if;
    -- The screening report is attached to the client's report untouched, so it has to stay a file of its own.
    if exists (select 1 from public.case_checks k join public.check_type_versions v on v.id = k.check_type_version_id
                where k.case_id = d.case_id and v.schema #>> '{fixed_annexure,category}' = r.category) then
      raise exception '% must be uploaded as its own file', r.label using errcode = '22023';
    end if;
    insert into public.requirement_files (org_id, case_id, requirement_id, document_id, pages, source, confirmed_by)
    values (d.org_id, d.case_id, r.id, d.id, left(nullif(trim(v_link ->> 'pages'), ''), 40), p_source, auth.uid())
    on conflict (requirement_id, document_id) do update set pages = excluded.pages, source = excluded.source, confirmed_by = excluded.confirmed_by;
    v_labels := v_labels || r.label;
  end loop;

  -- The file now carries these documents, so it takes on their handling.
  select coalesce(bool_or(dc.sensitive), false), coalesce(bool_or(dc.in_report), false) into v_sensitive, v_report
    from public.requirement_files f
    join public.case_check_requirements q on q.id = f.requirement_id
    join public.document_categories dc on dc.org_id = d.org_id and dc.key = q.category
   where f.document_id = d.id;
  update public.documents
     set sensitive = sensitive or v_sensitive,
         visibility = case when visibility = 'internal' and v_report then 'report' else visibility end
   where id = d.id and ((v_sensitive and not sensitive) or (visibility = 'internal' and v_report));

  perform public.log_case_event(d.case_id, null, 'document_matched', d.filename || ' holds ' || array_to_string(v_labels, ', '), null,
    jsonb_build_object('document_id', d.id, 'source', p_source), false, false);
  return cardinality(v_labels);
end $$;
revoke execute on function public.confirm_requirement_files(uuid, jsonb, text) from public, anon;
grant execute on function public.confirm_requirement_files(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.remove_requirement_file(p_requirement uuid, p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  v_label text;
begin
  select * into d from public.documents where id = p_document for update;
  if d.id is null or (auth.uid() is not null and not public.case_visible(d.case_id)) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select r.label into v_label from public.case_check_requirements r
    join public.requirement_files f on f.requirement_id = r.id and f.document_id = d.id
   where r.id = p_requirement;
  if v_label is null then raise exception 'that file is not on this slot' using errcode = 'P0002'; end if;
  delete from public.requirement_files where requirement_id = p_requirement and document_id = d.id;
  -- A file that no longer holds any evidence shouldn't stay in the report because of a slip.
  if d.visibility = 'report'
     and not exists (select 1 from public.requirement_files f where f.document_id = d.id)
     and not exists (select 1 from public.document_categories dc where dc.org_id = d.org_id and dc.key = d.category and dc.in_report) then
    update public.documents set visibility = 'internal' where id = d.id;
  end if;
  perform public.log_case_event(d.case_id, null, 'document_unmatched', d.filename || ' no longer counts for ' || v_label, null,
    jsonb_build_object('document_id', d.id), false, false);
end $$;
revoke execute on function public.remove_requirement_file(uuid, uuid) from public, anon;
grant execute on function public.remove_requirement_file(uuid, uuid) to authenticated, service_role;

-- A slot filled from a combined file has its evidence in the report through that file.
create or replace function public.case_unreported_evidence(p_case uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct k.label), '{}')
    from public.case_checks k
    join public.case_check_requirements r on r.case_check_id = k.id
   where k.case_id = p_case
     and (auth.uid() is null or (public.is_staff() and public.case_visible(p_case)))
     and k.state in ('completed', 'discrepancy') and r.status <> 'waived' and r.min_count > 0
     and not exists (select 1 from public.documents d
                      where d.status in ('uploaded', 'accepted') and d.visibility in ('report', 'client')
                        and ((d.case_check_id = k.id and d.category = r.category)
                             or exists (select 1 from public.requirement_files f where f.requirement_id = r.id and f.document_id = d.id)))
$$;
revoke execute on function public.case_unreported_evidence(uuid) from public, anon;
grant execute on function public.case_unreported_evidence(uuid) to authenticated, service_role;

-- A person can keep part of the AI's list of what a file holds, so that counts as edited.
create or replace function public.decide_ai_suggestion(p_suggestion uuid, p_decision text, p_value jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.ai_suggestions;
  v_case uuid;
begin
  select * into s from public.ai_suggestions where id = p_suggestion for update;
  if s.id is null or s.org_id <> public.auth_org_id() or not public.is_staff() then raise exception 'suggestion not found' using errcode = 'P0002'; end if;
  v_case := case s.entity_type
    when 'case' then s.entity_id
    when 'case_check' then (select case_id from public.case_checks where id = s.entity_id)
    when 'document' then (select case_id from public.documents where id = s.entity_id)
    else null end;
  if v_case is not null and not public.case_visible(v_case) then raise exception 'suggestion not found' using errcode = 'P0002'; end if;
  if p_decision not in ('accepted', 'edited', 'rejected') then raise exception 'unknown decision' using errcode = '22023'; end if;
  if not public.can_decide_ai_suggestion(s.capability) then raise exception 'not allowed to decide this suggestion' using errcode = '42501'; end if;
  if p_decision = 'edited' and s.capability not in ('document.extract', 'document.classify', 'report.narrative', 'check.response', 'case.preqc', 'case.consistency', 'case.postqc') then
    raise exception 'this suggestion can be accepted or rejected, not edited' using errcode = '22023';
  end if;
  if s.decision <> 'pending' then raise exception 'this suggestion was already decided' using errcode = '22023'; end if;
  update public.ai_suggestions
     set decision = p_decision, value = case when p_decision = 'edited' and p_value is not null then p_value else value end,
         decided_by = auth.uid(), decided_at = now()
   where id = s.id;
  update public.ai_suggestions set decision = 'superseded'
   where entity_type = s.entity_type and entity_id = s.entity_id and field_key is not distinct from s.field_key
     and capability = s.capability and decision = 'pending' and created_at < s.created_at;
  if v_case is not null then
    perform public.log_case_event(v_case, case when s.entity_type = 'case_check' then s.entity_id end, 'ai_decision',
      'AI suggestion ' || p_decision || coalesce(': ' || s.field_key, ''), null,
      jsonb_build_object('suggestion_id', s.id, 'capability', s.capability), false, false);
  end if;
  return jsonb_build_object('entity_type', s.entity_type, 'entity_id', s.entity_id, 'field_key', s.field_key,
    'value', case when p_decision = 'edited' and p_value is not null then p_value else s.value end, 'case_id', v_case);
end $$;
revoke execute on function public.decide_ai_suggestion(uuid, text, jsonb) from public, anon;
grant execute on function public.decide_ai_suggestion(uuid, text, jsonb) to authenticated, service_role;
