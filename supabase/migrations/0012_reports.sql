-- =============================================================================
-- 0012_reports.sql
-- Feature: the final verification report. Staff generate a DRAFT (the
-- report.render job compiles a snapshot of the case, renders the PDF with
-- the evidence annexures and the Global Sanction report appended untouched,
-- and stores its hash). The case goes for approval; the approver confirms the
-- final result, and approval is refused if the case changed after the draft
-- (the app recompiles and compares the snapshot hash). Approval renders the
-- FINAL report (no watermark, QR code to /verify/<id>, SHA-256). A different
-- person releases it to the client (Super Admin excepted); release can bill
-- the case. A revision makes a new version and supersedes the old one on its
-- release; versions are never overwritten. Downloads are logged.
-- Depends on: 0006_cases, 0007_documents, 0011_qc. Calls 0009_jobs at run time.
-- =============================================================================

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  version int not null,
  kind text not null check (kind in ('draft', 'final')),
  status text not null default 'queued' check (status in ('queued', 'rendering', 'ready', 'failed', 'superseded', 'released')),
  snapshot jsonb not null default '{}'::jsonb,   -- what the report says, compiled from the case (src/domain/reports/compile-core.ts)
  snapshot_hash text,                            -- sha256 of the canonical snapshot
  final_result text check (final_result in ('green', 'amber', 'red')),
  based_on uuid references public.report_versions (id) on delete set null,   -- the draft a final came from
  storage_path text,
  sha256 text,
  page_count int,
  size_bytes bigint,
  annexures jsonb not null default '[]'::jsonb,
  error text,
  job_id uuid references public.jobs (id) on delete set null,
  revision_reason text,
  requested_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, version)
);
create index report_versions_org_idx on public.report_versions (org_id, created_at desc);
create index report_versions_case_idx on public.report_versions (case_id, version desc);
create index report_versions_based_on_idx on public.report_versions (based_on);
create index report_versions_job_idx on public.report_versions (job_id);
create index report_versions_requested_by_idx on public.report_versions (requested_by);
create index report_versions_approved_by_idx on public.report_versions (approved_by);
create index report_versions_released_by_idx on public.report_versions (released_by);
create trigger a_set_org_id before insert on public.report_versions
  for each row execute function public.set_org_id();
create trigger report_versions_updated_at before update on public.report_versions
  for each row execute function public.set_updated_at();

create table public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  report_version_id uuid not null references public.report_versions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index report_recipients_org_idx on public.report_recipients (org_id);
create index report_recipients_version_idx on public.report_recipients (report_version_id);
create index report_recipients_user_idx on public.report_recipients (user_id);
create trigger a_set_org_id before insert on public.report_recipients
  for each row execute function public.set_org_id();

create table public.report_downloads (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  report_version_id uuid not null references public.report_versions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  who text not null check (who in ('staff', 'client', 'verify')),
  ip text,
  at timestamptz not null default now()
);
create index report_downloads_org_idx on public.report_downloads (org_id, at desc);
create index report_downloads_version_idx on public.report_downloads (report_version_id, at desc);
create index report_downloads_user_idx on public.report_downloads (user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.next_report_version(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(version), 0) + 1 from public.report_versions where case_id = p_case
$$;
revoke execute on function public.next_report_version(uuid) from public, anon, authenticated;

create or replace function public.queue_report_render(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
  v_job uuid;
begin
  select * into v from public.report_versions where id = p_version;
  v_job := public.enqueue_job('report.render', jsonb_build_object('version_id', v.id), 'report.render:' || v.id,
                              now(), null, 'report_version', v.id, null, v.org_id, auth.uid());
  update public.report_versions set job_id = v_job where id = v.id;
end $$;
revoke execute on function public.queue_report_render(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

-- A new draft (in the report stage). Older drafts that were never approved are superseded.
create or replace function public.request_report_draft(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.has_permission('reports.preview') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'report' then raise exception 'drafts are made once the case reaches the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  update public.report_versions set status = 'superseded'
   where case_id = p_case and kind = 'draft' and status in ('queued', 'rendering', 'ready', 'failed');
  insert into public.report_versions (org_id, case_id, version, kind, requested_by)
  values (c.org_id, c.id, public.next_report_version(c.id), 'draft', auth.uid())
  returning id into v_id;
  perform public.queue_report_render(v_id);
  perform public.log_case_event(p_case, null, 'report_draft', 'Report draft requested', null, jsonb_build_object('version_id', v_id), false, false);
  return v_id;
end $$;
revoke execute on function public.request_report_draft(uuid) from public, anon;
grant execute on function public.request_report_draft(uuid) to authenticated, service_role;

-- The worker records the outcome of a render.
create or replace function public.report_render_done(
  p_version uuid, p_ok boolean, p_snapshot jsonb default null, p_snapshot_hash text default null, p_storage_path text default null,
  p_sha256 text default null, p_pages int default null, p_size bigint default null, p_annexures jsonb default '[]'::jsonb, p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
begin
  select * into v from public.report_versions where id = p_version for update;
  if v.id is null then raise exception 'report version not found' using errcode = 'P0002'; end if;
  if v.status = 'superseded' then return; end if;   -- a newer draft replaced it while rendering
  if p_ok then
    update public.report_versions
       set status = 'ready', snapshot = coalesce(p_snapshot, snapshot), snapshot_hash = coalesce(p_snapshot_hash, snapshot_hash),
           storage_path = p_storage_path, sha256 = p_sha256, page_count = p_pages, size_bytes = p_size,
           annexures = coalesce(p_annexures, '[]'::jsonb), error = null
     where id = v.id;
    perform public.log_case_event(v.case_id, null, 'report_ready',
      case v.kind when 'draft' then 'Report draft ready' else 'Final report ready' end, null,
      jsonb_build_object('version_id', v.id, 'version', v.version), false, false);
    if v.requested_by is not null then
      perform public.notify_users(array[v.requested_by], 'report.ready',
        (select reference from public.cases where id = v.case_id) || case v.kind when 'draft' then ': report draft ready' else ': final report ready' end,
        '', '/app/cases/' || v.case_id, false, 'case', v.case_id, v.org_id);
    end if;
  else
    update public.report_versions set status = 'failed', error = left(coalesce(p_error, 'unknown error'), 2000) where id = v.id;
    perform public.log_case_event(v.case_id, null, 'report_failed', 'Report generation failed', left(p_error, 500),
      jsonb_build_object('version_id', v.id), false, false);
  end if;
end $$;
revoke execute on function public.report_render_done(uuid, boolean, jsonb, text, text, text, int, bigint, jsonb, text) from public, anon, authenticated;

create or replace function public.report_render_started(p_version uuid) returns public.report_versions
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
begin
  update public.report_versions set status = 'rendering' where id = p_version and status in ('queued', 'rendering', 'failed')
  returning * into v;
  return v;
end $$;
revoke execute on function public.report_render_started(uuid) from public, anon, authenticated;

-- Report stage → approval, with a ready draft.
create or replace function public.submit_report(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('reports.preview') and (public.has_permission('cases.stage.change') or c.assigned_to = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage <> 'report' then raise exception 'the case is not at the report stage' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if not exists (select 1 from public.report_versions where case_id = p_case and kind = 'draft' and status = 'ready'
                  and version = (select max(version) from public.report_versions where case_id = p_case)) then
    raise exception 'generate a draft and check it before sending it for approval' using errcode = '22023';
  end if;
  perform public.move_case(p_case, 'approval', 'submit_report');
end $$;
revoke execute on function public.submit_report(uuid) from public, anon;
grant execute on function public.submit_report(uuid) to authenticated, service_role;

-- Approver sends it back to the report stage with a reason.
create or replace function public.return_report(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for approval' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say what needs changing' using errcode = '22023'; end if;
  update public.report_versions set status = 'superseded' where case_id = p_case and status in ('queued', 'rendering', 'ready', 'failed');
  perform public.move_case(p_case, 'report', 'return_report', p_reason, true);
end $$;
revoke execute on function public.return_report(uuid, text) from public, anon;
grant execute on function public.return_report(uuid, text) to authenticated, service_role;

-- Approve the checked draft with the final result. p_current_hash is the
-- snapshot recompiled from the case now; it must equal the draft's.
create or replace function public.approve_report(p_case uuid, p_draft uuid, p_final_result text, p_current_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  d public.report_versions;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for approval' using errcode = '22023'; end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if p_final_result not in ('green', 'amber', 'red') then raise exception 'choose the final result' using errcode = '22023'; end if;
  select * into d from public.report_versions where id = p_draft and case_id = p_case and kind = 'draft' for update;
  if d.id is null or d.status <> 'ready' then raise exception 'approve a ready draft' using errcode = '22023'; end if;
  if d.version <> (select max(version) from public.report_versions where case_id = p_case) then
    raise exception 'a newer version exists; approve the latest draft' using errcode = '22023';
  end if;
  if d.snapshot_hash is null or d.snapshot_hash is distinct from p_current_hash then
    raise exception 'the case changed after this draft was made; generate a new draft first' using errcode = '22023';
  end if;
  -- Incomplete checks never print as verified: a green result needs every counted check completed and clear.
  if p_final_result = 'green' and exists (select 1 from public.case_checks k where k.case_id = p_case and k.state <> 'waived'
                                           and not (k.state = 'completed' and k.result_tone = 'green')) then
    raise exception 'a green result needs every check completed and clear' using errcode = '22023';
  end if;
  update public.cases set final_result = p_final_result where id = p_case;
  update public.report_versions set approved_by = auth.uid(), approved_at = now(), final_result = p_final_result where id = d.id;
  insert into public.report_versions (org_id, case_id, version, kind, based_on, final_result, snapshot, snapshot_hash, requested_by, approved_by, approved_at, revision_reason)
  values (c.org_id, c.id, d.version + 1, 'final', d.id, p_final_result, d.snapshot, d.snapshot_hash, auth.uid(), auth.uid(), now(),
          (select revision_reason from public.report_versions where case_id = p_case and kind = 'final' and revision_reason is not null and status = 'released' order by version desc limit 1))
  returning id into v_id;
  perform public.queue_report_render(v_id);
  perform public.log_case_event(p_case, null, 'report_approved', 'Report approved (' || p_final_result || ')', null,
    jsonb_build_object('version_id', v_id, 'final_result', p_final_result), false, false);
  return v_id;
end $$;
revoke execute on function public.approve_report(uuid, uuid, text, text) from public, anon;
grant execute on function public.approve_report(uuid, uuid, text, text) to authenticated, service_role;

-- Release the ready final to the client. A second person, unless Super Admin.
create or replace function public.release_report(p_case uuid, p_recipients uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  f public.report_versions;
  v_policy text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.release') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'approval' then raise exception 'the case is not waiting for release' using errcode = '22023'; end if;
  select * into f from public.report_versions where case_id = p_case and kind = 'final'
   order by version desc limit 1 for update;
  if f.id is null or f.status <> 'ready' then raise exception 'the final report is not ready yet' using errcode = '22023'; end if;
  if f.approved_by = auth.uid() and not public.is_super_admin() then
    raise exception 'a different person must release the report they approved' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_recipients, '{}')) r
              where not exists (select 1 from public.memberships m where m.user_id = r and m.client_id = c.client_id and m.kind = 'client' and m.status = 'active')) then
    raise exception 'recipients must be portal users of this client' using errcode = '22023';
  end if;
  -- Earlier released versions are superseded by this one.
  update public.report_versions set status = 'superseded' where case_id = p_case and status = 'released';
  update public.report_versions set status = 'released', released_by = auth.uid(), released_at = now() where id = f.id;
  insert into public.report_recipients (org_id, report_version_id, user_id)
  select c.org_id, f.id, r from unnest(coalesce(p_recipients, '{}')) r;
  update public.cases set released_at = now() where id = p_case;
  perform public.move_case(p_case, 'released', 'release_report');
  -- Per-case billing drafts the invoice now (0015).
  select billing_policy into v_policy from public.clients where id = c.client_id;
  if v_policy = 'per_case_on_release' then
    perform public.enqueue_job('invoice.draft', jsonb_build_object('case_id', p_case), 'invoice.draft:case:' || p_case,
                               now(), null, 'case', p_case, null, c.org_id, auth.uid());
  end if;
  return f.id;
end $$;
revoke execute on function public.release_report(uuid, uuid[]) from public, anon;
grant execute on function public.release_report(uuid, uuid[]) to authenticated, service_role;

-- A released report needs changing: back to the report stage with a reason.
-- The released version stays available to the client until the revision is released.
create or replace function public.revise_report(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.has_permission('reports.approve') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage <> 'released' then raise exception 'only a released report can be revised' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the report is being revised' using errcode = '22023'; end if;
  update public.report_versions set revision_reason = trim(p_reason)
   where id = (select id from public.report_versions where case_id = p_case and status = 'released' order by version desc limit 1);
  perform public.move_case(p_case, 'report', 'revise_report', p_reason);
end $$;
revoke execute on function public.revise_report(uuid, text) from public, anon;
grant execute on function public.revise_report(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Downloads and verification
-- ---------------------------------------------------------------------------

-- The file behind a report version, if the caller may have it, and log the download.
-- Staff: reports.preview on a case they can see. Client users: the latest released
-- version of their own company's case.
create or replace function public.report_download(p_version uuid, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.report_versions;
  c public.cases;
  v_who text;
begin
  select * into v from public.report_versions where id = p_version;
  if v.id is null or v.storage_path is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = v.case_id;
  if public.is_staff() and public.has_permission('reports.preview') and public.case_visible(c.id) then
    v_who := 'staff';
  elsif public.is_client() and public.has_permission('portal.cases.read') and c.client_id = public.client_id_of_user() and c.client_visible
        and v.status = 'released' then
    v_who := 'client';
  else
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  insert into public.report_downloads (org_id, report_version_id, user_id, who, ip) values (v.org_id, v.id, auth.uid(), v_who, left(p_ip, 64));
  if v_who = 'client' then
    perform public.log_case_event(c.id, null, 'report_downloaded', 'Report downloaded', null,
      jsonb_build_object('version_id', v.id), true, false);
  end if;
  return jsonb_build_object('bucket', 'reports', 'path', v.storage_path,
    'filename', c.reference || case v.kind when 'draft' then '-DRAFT-v' || v.version else '' end || '.pdf');
end $$;
revoke execute on function public.report_download(uuid, text) from public, anon;
grant execute on function public.report_download(uuid, text) to authenticated, service_role;

-- The client's latest released report for a case (portal).
-- plpgsql so it resolves portal_case_visible (0021) at run time.
create or replace function public.portal_report(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.portal_case_visible(p_case) then return null; end if;
  return (select jsonb_build_object('version_id', v.id, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256,
                                    'page_count', v.page_count, 'final_result', v.final_result)
            from public.report_versions v where v.case_id = p_case and v.status = 'released' order by v.version desc limit 1);
end $$;
revoke execute on function public.portal_report(uuid) from public, anon;
grant execute on function public.portal_report(uuid) to authenticated, service_role;

-- Public authenticity check (/verify/<id>, service role): enough to confirm a
-- report is genuine, nothing more. The result itself is not shown.
create or replace function public.verify_report(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'found', true,
    'status', case v.status when 'released' then 'valid' when 'superseded' then 'superseded' else 'not_released' end,
    'reference', c.reference, 'version', v.version, 'released_at', v.released_at, 'sha256', v.sha256, 'page_count', v.page_count,
    'client', cl.name,
    'candidate', (select string_agg(left(w, 1) || '.', ' ') from regexp_split_to_table(c.candidate_name, '\s+') w),
    'issuer', coalesce(o.branding ->> 'legal_name', o.name))
  from public.report_versions v
  join public.cases c on c.id = v.case_id
  join public.clients cl on cl.id = c.client_id
  join public.orgs o on o.id = v.org_id
  where v.id = p_version and v.kind = 'final' and v.status in ('released', 'superseded')
$$;
revoke execute on function public.verify_report(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
select public.attach_audit('public.report_versions');

alter table public.report_versions enable row level security;
alter table public.report_recipients enable row level security;
alter table public.report_downloads enable row level security;

create policy report_versions_select on public.report_versions for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('reports.preview'))
         and public.case_visible(case_id));
create policy report_recipients_select on public.report_recipients for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and exists (select 1 from public.report_versions v where v.id = report_version_id));
create policy report_downloads_select on public.report_downloads for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('audit.read')) or exists (select 1 from public.report_versions v where v.id = report_version_id)));

revoke insert, update, delete, truncate on public.report_versions, public.report_recipients, public.report_downloads from anon, authenticated;

alter publication supabase_realtime add table public.report_versions;
