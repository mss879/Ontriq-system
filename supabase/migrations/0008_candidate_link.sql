-- =============================================================================
-- 0008_candidate_link.sql
-- Feature: the candidate's public link. A candidate has no account: staff
-- issue a secret, expiring, single-case link; the server swaps it for a short
-- signed cookie and then reads and writes only through the candidate_* functions
-- below, which the service role alone may call and which always work from the
-- link's own case. The candidate sees a projection (candidate_link_view): the
-- documents to provide, staff requests, messages, consent and a candidate-safe
-- timeline. Never results, internal notes or other people's data.
-- Staff manage links, requests, messages and consent through the staff
-- functions further down. Consent is required before Pre-QC once a link has
-- been issued (guard trigger on cases).
-- Depends on: 0006_cases, 0007_documents. Calls 0009_jobs and
-- 0010_notifications_comms at run time only (plpgsql), so it may be applied
-- before or after them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.candidate_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  token_hash text not null unique,      -- sha256 (hex) of the secret in the URL; the secret itself is never stored in clear
  token_enc text,                       -- the secret encrypted with the app's key, so staff can copy the link again
  language text not null default 'en' check (language in ('en', 'si', 'ta')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  revoked_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  sent_via text[] not null default '{}',
  sent_count int not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count int not null default 0,
  reminders_sent int not null default 0,
  last_reminded_at timestamptz,
  escalated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index candidate_links_one_active_uq on public.candidate_links (case_id) where revoked_at is null;
create index candidate_links_org_idx on public.candidate_links (org_id, created_at desc);
create index candidate_links_case_idx on public.candidate_links (case_id, created_at desc);
create index candidate_links_revoked_by_idx on public.candidate_links (revoked_by);
create index candidate_links_created_by_idx on public.candidate_links (created_by);
create trigger a_set_org_id before insert on public.candidate_links
  for each row execute function public.set_org_id();

-- Things staff ask the candidate for: a document, one detail of a check, or a question.
create table public.candidate_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  case_check_id uuid references public.case_checks (id) on delete cascade,
  requirement_id uuid references public.case_check_requirements (id) on delete set null,
  kind text not null check (kind in ('document', 'field', 'question')),
  title text not null check (length(title) between 1 and 200),
  help text,
  field_key text,                       -- kind = field: the key in the check's schema
  field_type text,                      -- snapshot of the field's type for the candidate's form
  options jsonb not null default '[]'::jsonb,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'answered', 'accepted', 'cancelled')),
  answer jsonb,
  answered_at timestamptz,
  review_note text,                     -- shown to the candidate when staff ask again
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  reminders_sent int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'field') = (field_key is not null and case_check_id is not null))
);
create index candidate_requests_org_idx on public.candidate_requests (org_id, status);
create index candidate_requests_case_idx on public.candidate_requests (case_id, created_at);
create index candidate_requests_check_idx on public.candidate_requests (case_check_id);
create index candidate_requests_requirement_idx on public.candidate_requests (requirement_id);
create index candidate_requests_reviewed_by_idx on public.candidate_requests (reviewed_by);
create index candidate_requests_created_by_idx on public.candidate_requests (created_by);
create trigger a_set_org_id before insert on public.candidate_requests
  for each row execute function public.set_org_id();
create trigger candidate_requests_updated_at before update on public.candidate_requests
  for each row execute function public.set_updated_at();

create table public.candidate_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  from_kind text not null check (from_kind in ('staff', 'candidate')),
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index candidate_messages_org_idx on public.candidate_messages (org_id, created_at desc);
create index candidate_messages_case_idx on public.candidate_messages (case_id, created_at);
create index candidate_messages_author_idx on public.candidate_messages (author_id);
create trigger a_set_org_id before insert on public.candidate_messages
  for each row execute function public.set_org_id();

-- One consent record per case: signed on the page, or a photographed paper form.
create table public.consent_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null unique references public.cases (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'accepted', 'rejected')),
  method text check (method in ('esign', 'upload', 'staff')),
  form_version text not null default 'v1',
  signed_name text,
  signed_at timestamptz,
  ip text,
  user_agent text,
  document_id uuid references public.documents (id) on delete set null,
  ai_check jsonb not null default '{}'::jsonb,
  review_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consent_forms_org_idx on public.consent_forms (org_id, status);
create index consent_forms_document_idx on public.consent_forms (document_id);
create index consent_forms_reviewed_by_idx on public.consent_forms (reviewed_by);
create trigger a_set_org_id before insert on public.consent_forms
  for each row execute function public.set_org_id();
create trigger consent_forms_updated_at before update on public.consent_forms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Categories only Ontriq staff provide; the candidate never sees them as slots.
create or replace function public.candidate_providable(p_category text, p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage = 'documents' and p_category not in ('field_verification', 'sanction_report', 'police_report', 'consent_form')
$$;
revoke execute on function public.candidate_providable(text, text) from public, anon;
grant execute on function public.candidate_providable(text, text) to authenticated, service_role;

-- The case a link may act on, or an error the page turns into "this link has expired".
create or replace function public.candidate_link_case(p_link uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_case uuid;
begin
  select l.case_id into v_case
    from public.candidate_links l join public.cases c on c.id = l.case_id
   where l.id = p_link and l.revoked_at is null and l.expires_at > now() and c.stage <> 'cancelled';
  if v_case is null then raise exception 'link_expired' using errcode = 'P0002'; end if;
  return v_case;
end $$;
revoke execute on function public.candidate_link_case(uuid) from public, anon, authenticated;

-- Tell the people on a case (owner, else whoever assigned) about something the candidate did.
create or replace function public.notify_case_owner(p_case uuid, p_type text, p_title text, p_body text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_users uuid[];
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return; end if;
  v_users := array_remove(array[c.assigned_to], null);
  if cardinality(v_users) = 0 then
    select array_agg(distinct cc.assigned_to) into v_users from public.case_checks cc where cc.case_id = p_case and cc.assigned_to is not null;
  end if;
  if coalesce(cardinality(v_users), 0) = 0 then return; end if;
  perform public.notify_users(v_users, p_type, p_title, coalesce(p_body, ''), '/app/cases/' || c.id, false, 'case', c.id, c.org_id);
end $$;
revoke execute on function public.notify_case_owner(uuid, text, text, text) from public, anon, authenticated;

-- Staff may manage the candidate side of a case they can see.
create or replace function public.can_manage_candidate(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and public.case_visible(p_case)
     and (public.has_permission('candidates.requests') or public.has_permission('cases.update'))
$$;
revoke execute on function public.can_manage_candidate(uuid) from public, anon;
grant execute on function public.can_manage_candidate(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Candidate side (service role only; the server verified the session cookie)
-- ---------------------------------------------------------------------------

-- Swap the secret from the URL for the link it belongs to, and count the visit.
create or replace function public.candidate_open_link(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.candidate_links;
  v_stage public.case_stage;
begin
  select * into l from public.candidate_links where token_hash = p_token_hash for update;
  if l.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select stage into v_stage from public.cases where id = l.case_id;
  if l.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if v_stage = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  update public.candidate_links
     set open_count = open_count + 1, last_opened_at = now(), first_opened_at = coalesce(first_opened_at, now())
   where id = l.id;
  if l.first_opened_at is null then
    perform public.log_case_event(l.case_id, null, 'candidate_opened', 'Candidate opened their link', null, '{}'::jsonb, false, false);
  end if;
  return jsonb_build_object('ok', true, 'link_id', l.id, 'expires_at', l.expires_at, 'language', l.language);
end $$;
revoke execute on function public.candidate_open_link(text) from public, anon, authenticated;

-- Everything the candidate's page shows, and nothing more.
create or replace function public.candidate_link_view(p_link uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  l public.candidate_links;
  c public.cases;
  v_out jsonb;
begin
  select * into l from public.candidate_links where id = p_link;
  select * into c from public.cases where id = v_case;
  select jsonb_build_object(
    'link', jsonb_build_object('id', l.id, 'expires_at', l.expires_at, 'language', l.language, 'sent_at', l.sent_at),
    'org', (select jsonb_build_object(
              'name', coalesce(o.branding ->> 'display_name', o.name), 'legal_name', coalesce(o.branding ->> 'legal_name', o.name),
              'email', o.branding ->> 'email', 'phone', o.branding ->> 'phone', 'website', o.branding ->> 'website',
              'address', o.branding ->> 'address')
              from public.orgs o where o.id = c.org_id),
    'case', jsonb_build_object(
              'reference', c.reference, 'position_title', c.position_title, 'stage', c.stage, 'status_key', c.status_key,
              'status_label', (select s.candidate_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = c.status_key),
              'process_type', c.process_type, 'on_hold', c.on_hold, 'received_at', c.received_at,
              'client_name', (select cl.name from public.clients cl where cl.id = c.client_id)),
    'candidate', (select jsonb_build_object('full_name', cd.full_name, 'preferred_language', cd.preferred_language)
                    from public.candidates cd where cd.id = c.candidate_id),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('label', k.label, 'key', ct.key) order by k.sort)
                          from public.case_checks k join public.check_types ct on ct.id = k.check_type_id
                         where k.case_id = c.id and k.state <> 'waived'), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'category', r.category, 'label', r.label, 'description', r.description,
               'category_name', dc.name, 'guide', dc.guide, 'check_label', k.label,
               'min_count', r.min_count, 'received_count', r.received_count, 'status', r.status,
               'requested_note', r.requested_note, 'requested_at', r.requested_at,
               'files', coalesce((
                  select jsonb_agg(jsonb_build_object('id', d.id, 'filename', d.filename, 'status', d.status,
                                                      'rejection_reason', d.rejection_reason, 'created_at', d.created_at) order by d.created_at)
                    from public.documents d
                   where d.case_id = c.id and d.uploaded_by_kind = 'candidate' and d.category = r.category
                     and d.case_check_id is not distinct from r.case_check_id and d.status <> 'pending_upload'), '[]'::jsonb))
             order by coalesce(k.sort, 0), dc.sort, r.created_at)
        from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
        left join public.document_categories dc on dc.org_id = r.org_id and dc.key = r.category
       where r.case_id = c.id and r.status <> 'waived' and public.candidate_providable(r.category, r.stage)), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'kind', q.kind, 'title', q.title, 'help', q.help, 'field_type', q.field_type, 'options', q.options,
               'requirement_id', q.requirement_id, 'due_at', q.due_at, 'status', q.status, 'answer', q.answer,
               'answered_at', q.answered_at, 'review_note', q.review_note, 'created_at', q.created_at) order by q.created_at)
        from public.candidate_requests q where q.case_id = c.id and q.status <> 'cancelled'), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.from_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
        from (select * from public.candidate_messages where case_id = c.id order by created_at desc limit 100) m), '[]'::jsonb),
    'consent', (select jsonb_build_object('status', f.status, 'method', f.method, 'signed_name', f.signed_name,
                                          'signed_at', f.signed_at, 'review_note', f.review_note)
                  from public.consent_forms f where f.case_id = c.id),
    -- Titles are rewritten so internal wording never reaches the candidate; bodies only where they help them act.
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'at', e.at,
               'title', case
                 when e.kind = 'stage_changed' then case e.data ->> 'to'
                   when 'pre_qc' then 'Your documents are being reviewed'
                   when 'verification' then 'Verification has started'
                   when 'report' then 'Verification is complete'
                   else 'Your case moved forward' end
                 when e.kind = 'created' then 'Your verification was opened'
                 else e.title end,
               'body', case when e.kind in ('document_requested', 'document_rejected', 'request_created') then e.body end,
               'data', jsonb_build_object('to', e.data ->> 'to', 'category', e.data ->> 'category'))
             order by e.at desc)
        from (select * from public.case_events where case_id = c.id and visible_to_candidate order by at desc limit 60) e), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.candidate_link_view(uuid) from public, anon, authenticated;

-- Step 1 of a candidate upload: a document slot (requirement) or the consent form.
create or replace function public.candidate_begin_upload(
  p_link uuid, p_requirement uuid, p_category text, p_filename text, p_mime text, p_size bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  c public.cases;
  r public.case_check_requirements;
  v_category text;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_open int;
begin
  select * into c from public.cases where id = v_case;
  if c.stage not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'your verification no longer takes uploads' using errcode = '22023';
  end if;
  if p_requirement is not null then
    select * into r from public.case_check_requirements where id = p_requirement and case_id = v_case;
    if r.id is null or not public.candidate_providable(r.category, r.stage) or r.status = 'waived' then
      raise exception 'document slot not found' using errcode = 'P0002';
    end if;
    v_category := r.category;
  elsif p_category = 'consent_form' then
    v_category := 'consent_form';
  else
    raise exception 'choose where this document belongs' using errcode = '22023';
  end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'upload a PDF or a photo (JPEG, PNG, WebP or HEIC)' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then raise exception 'files must be under 25 MB' using errcode = '22023'; end if;
  -- A runaway page cannot fill the case with half-finished uploads.
  select count(*) into v_open from public.documents where case_id = v_case and uploaded_by_kind = 'candidate' and status = 'pending_upload'
     and created_at > now() - interval '1 hour';
  if v_open >= 20 then raise exception 'too many uploads at once; wait a moment and try again' using errcode = '22023'; end if;

  v_path := 'org/' || c.org_id || '/case/' || c.id || '/' || v_id || '/'
            || left(regexp_replace(lower(coalesce(p_filename, 'file')), '[^a-z0-9._-]+', '-', 'g'), 80);
  insert into public.documents (id, org_id, case_id, case_check_id, candidate_id, client_id, category, label, storage_path, filename, mime, size_bytes,
                                sensitive, uploaded_by, uploaded_by_kind)
  values (v_id, c.org_id, c.id, r.case_check_id, c.candidate_id, c.client_id, v_category, coalesce(r.label, 'Signed consent form'), v_path,
          left(coalesce(nullif(trim(p_filename), ''), 'file'), 200), p_mime, p_size,
          coalesce((select sensitive from public.document_categories where org_id = c.org_id and key = v_category), false),
          null, 'candidate');
  return jsonb_build_object('id', v_id, 'bucket', 'case-files', 'path', v_path);
end $$;
revoke execute on function public.candidate_begin_upload(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;

-- Step 2: the server confirmed the object exists.
create or replace function public.candidate_finalize_upload(p_link uuid, p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  d public.documents;
  v_name text;
begin
  select * into d from public.documents where id = p_document and case_id = v_case and uploaded_by_kind = 'candidate' for update;
  if d.id is null then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = d.id;
  if d.category = 'consent_form' then return; end if;   -- candidate_submit_consent records it
  v_name := coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category);
  -- A document request is answered once its slot has a file.
  update public.candidate_requests q set status = 'answered', answered_at = now(), answer = jsonb_build_object('document_id', d.id)
   where q.case_id = v_case and q.kind = 'document' and q.status = 'open'
     and q.requirement_id in (select r.id from public.case_check_requirements r
                               where r.case_id = v_case and r.category = d.category and r.case_check_id is not distinct from d.case_check_id);
  perform public.log_case_event(v_case, d.case_check_id, 'document_uploaded', v_name || ' received from the candidate', d.filename,
    jsonb_build_object('document_id', d.id, 'category', d.category, 'by', 'candidate'), true, true);
  perform public.notify_case_owner(v_case, 'candidate.upload', 'Candidate uploaded ' || v_name,
    (select reference from public.cases where id = v_case));
end $$;
revoke execute on function public.candidate_finalize_upload(uuid, uuid, text) from public, anon, authenticated;

-- A detail or an answer to a question.
create or replace function public.candidate_answer_request(p_link uuid, p_request uuid, p_answer jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  q public.candidate_requests;
begin
  select * into q from public.candidate_requests where id = p_request and case_id = v_case for update;
  if q.id is null or q.status = 'cancelled' then raise exception 'request not found' using errcode = 'P0002'; end if;
  if q.kind = 'document' then raise exception 'upload a file for this request' using errcode = '22023'; end if;
  if q.status = 'accepted' then raise exception 'this answer has already been accepted' using errcode = '22023'; end if;
  if p_answer is null or coalesce(trim(p_answer ->> 'value'), '') = '' then raise exception 'write an answer first' using errcode = '22023'; end if;
  if length(p_answer::text) > 8000 then raise exception 'that answer is too long' using errcode = '22023'; end if;
  update public.candidate_requests set status = 'answered', answer = p_answer, answered_at = now() where id = q.id;
  perform public.log_case_event(v_case, q.case_check_id, 'request_answered', 'Answered: ' || q.title, null,
    jsonb_build_object('request_id', q.id), false, true);
  perform public.notify_case_owner(v_case, 'candidate.answer', 'Candidate answered: ' || q.title,
    (select reference from public.cases where id = v_case));
end $$;
revoke execute on function public.candidate_answer_request(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.candidate_post_message(p_link uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  v_id uuid;
begin
  if coalesce(trim(p_body), '') = '' then raise exception 'write a message first' using errcode = '22023'; end if;
  insert into public.candidate_messages (org_id, case_id, from_kind, body)
  select c.org_id, c.id, 'candidate', left(trim(p_body), 4000) from public.cases c where c.id = v_case
  returning id into v_id;
  perform public.notify_case_owner(v_case, 'candidate.message', 'New message from the candidate',
    (select reference from public.cases where id = v_case));
  return v_id;
end $$;
revoke execute on function public.candidate_post_message(uuid, text) from public, anon, authenticated;

-- Consent: signed on the page (typed name, optional drawn signature image) or a photographed paper form.
create or replace function public.candidate_submit_consent(
  p_link uuid, p_method text, p_signed_name text, p_document uuid, p_ip text default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  f public.consent_forms;
begin
  if p_method not in ('esign', 'upload') then raise exception 'unknown consent method' using errcode = '22023'; end if;
  if p_method = 'esign' and length(coalesce(trim(p_signed_name), '')) < 3 then raise exception 'type your full name to sign' using errcode = '22023'; end if;
  if p_method = 'upload' and p_document is null then raise exception 'upload a photo of the signed form' using errcode = '22023'; end if;
  if p_document is not null and not exists (select 1 from public.documents d where d.id = p_document and d.case_id = v_case
       and d.uploaded_by_kind = 'candidate' and d.category = 'consent_form' and d.status in ('uploaded', 'accepted')) then
    raise exception 'consent document not found' using errcode = 'P0002';
  end if;
  select * into f from public.consent_forms where case_id = v_case for update;
  if f.status = 'accepted' then raise exception 'your consent has already been accepted' using errcode = '22023'; end if;
  insert into public.consent_forms (org_id, case_id, status, method, signed_name, signed_at, ip, user_agent, document_id)
  select c.org_id, c.id, 'submitted', p_method, nullif(trim(p_signed_name), ''), now(), left(p_ip, 64), left(p_user_agent, 300), p_document
    from public.cases c where c.id = v_case
  on conflict (case_id) do update set status = 'submitted', method = excluded.method, signed_name = excluded.signed_name,
    signed_at = excluded.signed_at, ip = excluded.ip, user_agent = excluded.user_agent, document_id = excluded.document_id,
    review_note = null, reviewed_by = null, reviewed_at = null, ai_check = '{}'::jsonb;
  perform public.log_case_event(v_case, null, 'consent_submitted', 'Consent form received', null,
    jsonb_build_object('method', p_method), true, true);
  perform public.notify_case_owner(v_case, 'candidate.consent', 'Candidate signed the consent form',
    (select reference from public.cases where id = v_case));
end $$;
revoke execute on function public.candidate_submit_consent(uuid, text, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff side
-- ---------------------------------------------------------------------------

-- Issue (or replace) the case's link. The server generated the secret; only
-- its hash and an encrypted copy arrive here.
create or replace function public.issue_candidate_link(
  p_case uuid, p_token_hash text, p_token_enc text, p_language text default 'en', p_days int default 14
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad link secret' using errcode = '22023'; end if;
  update public.candidate_links set revoked_at = now(), revoked_reason = 'Replaced by a new link', revoked_by = auth.uid()
   where case_id = p_case and revoked_at is null;
  insert into public.candidate_links (org_id, case_id, token_hash, token_enc, language, expires_at, created_by)
  values (c.org_id, c.id, p_token_hash, p_token_enc, coalesce(nullif(p_language, ''), 'en'),
          now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60)), auth.uid())
  returning id into v_id;
  insert into public.consent_forms (org_id, case_id) values (c.org_id, c.id) on conflict (case_id) do nothing;
  perform public.log_case_event(p_case, null, 'candidate_link', 'Candidate link created', null,
    jsonb_build_object('link_id', v_id, 'days', p_days), false, false);
  return v_id;
end $$;
revoke execute on function public.issue_candidate_link(uuid, text, text, text, int) from public, anon;
grant execute on function public.issue_candidate_link(uuid, text, text, text, int) to authenticated, service_role;

-- The encrypted secret, for "copy link" and for re-sending (the app decrypts it).
create or replace function public.candidate_link_secret(p_link uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.candidate_links;
begin
  select * into l from public.candidate_links where id = p_link;
  if l.id is null or (auth.uid() is not null and not public.can_manage_candidate(l.case_id)) then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if l.revoked_at is not null or l.expires_at <= now() then raise exception 'this link is no longer active' using errcode = '22023'; end if;
  return l.token_enc;
end $$;
revoke execute on function public.candidate_link_secret(uuid) from public, anon;
grant execute on function public.candidate_link_secret(uuid) to authenticated, service_role;

create or replace function public.record_candidate_link_sent(p_link uuid, p_channels text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.candidate_links;
begin
  select * into l from public.candidate_links where id = p_link for update;
  if l.id is null or (auth.uid() is not null and not public.can_manage_candidate(l.case_id)) then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_channels), 0) = 0 then return; end if;
  update public.candidate_links
     set sent_at = coalesce(sent_at, now()), sent_count = sent_count + 1,
         sent_via = (select array_agg(distinct x) from unnest(sent_via || p_channels) x)
   where id = l.id;
  perform public.log_case_event(l.case_id, null, 'candidate_invited',
    case when l.sent_count = 0 then 'Candidate invited to provide documents' else 'Candidate link sent again' end, null,
    jsonb_build_object('channels', p_channels), true, true);
end $$;
revoke execute on function public.record_candidate_link_sent(uuid, text[]) from public, anon;
grant execute on function public.record_candidate_link_sent(uuid, text[]) to authenticated, service_role;

create or replace function public.revoke_candidate_link(p_link uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.candidate_links;
begin
  select * into l from public.candidate_links where id = p_link for update;
  if l.id is null or not public.can_manage_candidate(l.case_id) then raise exception 'link not found' using errcode = 'P0002'; end if;
  if l.revoked_at is not null then return; end if;
  update public.candidate_links set revoked_at = now(), revoked_reason = nullif(trim(p_reason), ''), revoked_by = auth.uid() where id = l.id;
  perform public.log_case_event(l.case_id, null, 'candidate_link', 'Candidate link turned off', p_reason, '{}'::jsonb, false, false);
end $$;
revoke execute on function public.revoke_candidate_link(uuid, text) from public, anon;
grant execute on function public.revoke_candidate_link(uuid, text) to authenticated, service_role;

-- "Ask candidate": p = { kind, check_id, title, help, due_at,
--   field_key, field_type, options (kind field), category, note (kind document) }
create or replace function public.create_candidate_request(p_case uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_kind text := p ->> 'kind';
  v_check uuid := nullif(p ->> 'check_id', '')::uuid;
  v_req uuid;
  v_title text := nullif(trim(p ->> 'title'), '');
  v_field jsonb;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if v_kind not in ('document', 'field', 'question') then raise exception 'choose what to ask for' using errcode = '22023'; end if;
  if v_check is not null and not exists (select 1 from public.case_checks where id = v_check and case_id = p_case) then
    raise exception 'check not found' using errcode = 'P0002';
  end if;

  if v_kind = 'document' then
    if not public.candidate_providable(coalesce(p ->> 'category', ''), 'documents') then
      raise exception 'the candidate cannot provide that kind of document' using errcode = '22023';
    end if;
    v_title := coalesce(v_title, (select name from public.document_categories where org_id = c.org_id and key = p ->> 'category' and is_active));
    if v_title is null then raise exception 'unknown document category' using errcode = '22023'; end if;
    -- The same document slot request_case_document() would open, without needing cases.update.
    select id into v_req from public.case_check_requirements
     where case_id = p_case and category = p ->> 'category' and case_check_id is not distinct from v_check;
    if v_req is not null then
      update public.case_check_requirements
         set status = 'pending', min_count = greatest(min_count, received_count + 1), requested_note = nullif(trim(p ->> 'note'), ''),
             requested_at = now(), requested_by = auth.uid(), waived_reason = null, waived_by = null, waived_at = null
       where id = v_req;
    else
      insert into public.case_check_requirements (org_id, case_id, case_check_id, category, label, min_count, status, client_visible,
                                                  requested_note, requested_at, requested_by)
      values (c.org_id, p_case, v_check, p ->> 'category', left(v_title, 200), 1, 'pending', false,
              nullif(trim(p ->> 'note'), ''), now(), auth.uid())
      returning id into v_req;
    end if;
    perform public.log_case_event(p_case, v_check, 'document_requested', 'Document requested: ' || left(v_title, 200),
      nullif(trim(p ->> 'note'), ''), jsonb_build_object('category', p ->> 'category', 'from', 'candidate'), false, true);
    perform public.recompute_case(p_case);
  elsif v_kind = 'field' then
    if v_check is null then raise exception 'choose the check this detail belongs to' using errcode = '22023'; end if;
    select f.value into v_field
      from public.case_checks k
      join public.check_type_versions v on v.id = k.check_type_version_id,
           jsonb_array_elements(coalesce(v.schema -> 'fields', '[]'::jsonb)) as f(value)
     where k.id = v_check and f.value ->> 'key' = p ->> 'field_key' and coalesce(f.value ->> 'type', '') <> 'repeatable_group';
    if v_field is null then raise exception 'that detail is not part of this check' using errcode = '22023'; end if;
    v_title := coalesce(v_title, v_field ->> 'label');
  end if;
  if v_title is null then raise exception 'write the question' using errcode = '22023'; end if;

  insert into public.candidate_requests (org_id, case_id, case_check_id, requirement_id, kind, title, help, field_key, field_type, options, due_at, created_by)
  values (c.org_id, p_case, v_check, v_req, v_kind, left(v_title, 200),
          nullif(trim(coalesce(p ->> 'help', p ->> 'note', v_field ->> 'help')), ''),
          case when v_kind = 'field' then p ->> 'field_key' end,
          case when v_kind = 'field' then v_field ->> 'type' end,
          case when v_kind = 'field' then coalesce(v_field -> 'options', '[]'::jsonb) else '[]'::jsonb end,
          nullif(p ->> 'due_at', '')::timestamptz, auth.uid())
  returning id into v_id;
  if v_kind <> 'document' then   -- the document branch logged its own event
    perform public.log_case_event(p_case, v_check, 'request_created', 'New request: ' || left(v_title, 200),
      nullif(trim(p ->> 'help'), ''), jsonb_build_object('request_id', v_id, 'kind', v_kind), false, true);
  end if;
  return v_id;
end $$;
revoke execute on function public.create_candidate_request(uuid, jsonb) from public, anon;
grant execute on function public.create_candidate_request(uuid, jsonb) to authenticated, service_role;

-- accept: the answer is used (the app copies field answers into the check first);
-- reopen: ask again with a note; cancel: withdraw the request.
create or replace function public.review_candidate_request(p_request uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.candidate_requests;
begin
  select * into q from public.candidate_requests where id = p_request for update;
  if q.id is null or not public.can_manage_candidate(q.case_id) then raise exception 'request not found' using errcode = 'P0002'; end if;
  if p_decision = 'accept' then
    if q.status <> 'answered' then raise exception 'there is no answer to accept yet' using errcode = '22023'; end if;
    update public.candidate_requests set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now(), review_note = null where id = q.id;
  elsif p_decision = 'reopen' then
    if coalesce(trim(p_note), '') = '' then raise exception 'tell the candidate what to change' using errcode = '22023'; end if;
    update public.candidate_requests set status = 'open', review_note = trim(p_note), reviewed_by = auth.uid(), reviewed_at = now() where id = q.id;
    perform public.log_case_event(q.case_id, q.case_check_id, 'request_reopened', 'Please check: ' || q.title, trim(p_note),
      jsonb_build_object('request_id', q.id), false, true);
  elsif p_decision = 'cancel' then
    update public.candidate_requests set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now() where id = q.id;
  else
    raise exception 'unknown decision' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.review_candidate_request(uuid, text, text) from public, anon;
grant execute on function public.review_candidate_request(uuid, text, text) to authenticated, service_role;

create or replace function public.post_candidate_message(p_case uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.can_manage_candidate(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'write a message first' using errcode = '22023'; end if;
  insert into public.candidate_messages (org_id, case_id, from_kind, author_id, body)
  select c.org_id, c.id, 'staff', auth.uid(), left(trim(p_body), 4000) from public.cases c where c.id = p_case
  returning id into v_id;
  update public.candidate_messages set read_at = now() where case_id = p_case and from_kind = 'candidate' and read_at is null;
  return v_id;
end $$;
revoke execute on function public.post_candidate_message(uuid, text) from public, anon;
grant execute on function public.post_candidate_message(uuid, text) to authenticated, service_role;

create or replace function public.mark_candidate_messages_read(p_case uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  if not (public.is_staff() and public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  update public.candidate_messages set read_at = now() where case_id = p_case and from_kind = 'candidate' and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.mark_candidate_messages_read(uuid) from public, anon;
grant execute on function public.mark_candidate_messages_read(uuid) to authenticated, service_role;

-- Accept or reject the candidate's consent; or record a consent form staff
-- received another way (p_document, a consent_form document on the case).
create or replace function public.review_consent(p_case uuid, p_accept boolean, p_note text default null, p_document uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.consent_forms;
begin
  if not public.can_manage_candidate(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not (public.has_permission('cases.update') or public.has_permission('qc.pre')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from public.consent_forms where case_id = p_case for update;
  if p_document is not null then
    if not exists (select 1 from public.documents d where d.id = p_document and d.case_id = p_case and d.category = 'consent_form'
                    and d.status in ('uploaded', 'accepted')) then
      raise exception 'upload the signed consent form to the case first' using errcode = '22023';
    end if;
    insert into public.consent_forms (org_id, case_id, status, method, document_id, signed_at, reviewed_by, reviewed_at, review_note)
    select c.org_id, c.id, 'accepted', 'staff', p_document, now(), auth.uid(), now(), nullif(trim(p_note), '') from public.cases c where c.id = p_case
    on conflict (case_id) do update set status = 'accepted', method = 'staff', document_id = excluded.document_id,
      signed_at = coalesce(public.consent_forms.signed_at, now()), reviewed_by = auth.uid(), reviewed_at = now(), review_note = excluded.review_note;
  else
    if f.id is null or f.status not in ('submitted', 'accepted', 'rejected') then
      raise exception 'the candidate has not submitted consent yet' using errcode = '22023';
    end if;
    if not p_accept and coalesce(trim(p_note), '') = '' then raise exception 'tell the candidate what is wrong' using errcode = '22023'; end if;
    update public.consent_forms
       set status = case when p_accept then 'accepted' else 'rejected' end,
           review_note = case when p_accept then null else trim(p_note) end, reviewed_by = auth.uid(), reviewed_at = now()
     where id = f.id;
  end if;
  perform public.log_case_event(p_case, null, case when p_accept or p_document is not null then 'consent_accepted' else 'consent_rejected' end,
    case when p_accept or p_document is not null then 'Consent accepted' else 'Consent form needs to be signed again' end,
    case when not p_accept and p_document is null then trim(p_note) end, '{}'::jsonb, false, true);
end $$;
revoke execute on function public.review_consent(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.review_consent(uuid, boolean, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reminders (the reminder.candidate job; cadence and office hours live in
-- src/domain/candidate/reminders-core.ts)
-- ---------------------------------------------------------------------------

-- Active links whose candidate still owes something.
create or replace function public.candidate_reminder_candidates() returns table (
  link_id uuid, case_id uuid, org_id uuid, reference text, language text, sent_at timestamptz,
  reminders_sent int, last_reminded_at timestamptz, escalated_at timestamptz, expires_at timestamptz,
  candidate_name text, candidate_email text, candidate_phone text, client_name text,
  missing_documents int, open_requests int, consent_missing boolean
)
language sql stable security definer set search_path = '' as $$
  select l.id, c.id, c.org_id, c.reference, l.language, l.sent_at, l.reminders_sent, l.last_reminded_at, l.escalated_at, l.expires_at,
         cd.full_name, cd.email, cd.phone, cl.name,
         (select count(*)::int from public.case_check_requirements r
           where r.case_id = c.id and r.status = 'pending' and r.min_count > r.received_count and public.candidate_providable(r.category, r.stage)),
         (select count(*)::int from public.candidate_requests q where q.case_id = c.id and q.status = 'open'),
         not exists (select 1 from public.consent_forms f where f.case_id = c.id and f.status in ('submitted', 'accepted'))
    from public.candidate_links l
    join public.cases c on c.id = l.case_id
    join public.candidates cd on cd.id = c.candidate_id
    join public.clients cl on cl.id = c.client_id
   where l.revoked_at is null and l.expires_at > now() and l.sent_at is not null
     and c.stage in ('intake', 'documents') and not c.on_hold
$$;
revoke execute on function public.candidate_reminder_candidates() from public, anon, authenticated;

create or replace function public.record_candidate_reminder(p_link uuid, p_step int, p_escalated boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.candidate_links;
begin
  select * into l from public.candidate_links where id = p_link for update;
  if l.id is null then return; end if;
  if p_escalated then
    update public.candidate_links set escalated_at = now() where id = l.id;
    perform public.log_case_event(l.case_id, null, 'candidate_escalated', 'Candidate has not responded to reminders', null, '{}'::jsonb, false, false);
    perform public.notify_case_owner(l.case_id, 'candidate.escalated', 'Candidate has not responded',
      (select reference from public.cases where id = l.case_id));
  else
    update public.candidate_links set reminders_sent = greatest(reminders_sent, p_step), last_reminded_at = now() where id = l.id;
    perform public.log_case_event(l.case_id, null, 'candidate_reminded', 'Reminder ' || p_step || ' sent to the candidate', null,
      jsonb_build_object('step', p_step), false, false);
  end if;
end $$;
revoke execute on function public.record_candidate_reminder(uuid, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Consent before Pre-QC
-- ---------------------------------------------------------------------------
create or replace function public.cases_consent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'pre_qc' and old.stage = 'documents'
     and exists (select 1 from public.candidate_links l where l.case_id = new.id)
     and not exists (select 1 from public.consent_forms f where f.case_id = new.id and f.status in ('submitted', 'accepted')) then
    raise exception 'the candidate has not given consent yet; it is needed before Pre-QC' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger cases_consent_guard before update of stage on public.cases
  for each row execute function public.cases_consent_guard();
revoke execute on function public.cases_consent_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit, row level security, live updates
-- ---------------------------------------------------------------------------
select public.attach_audit('public.candidate_requests');
select public.attach_audit('public.consent_forms');

alter table public.candidate_links enable row level security;
alter table public.candidate_requests enable row level security;
alter table public.candidate_messages enable row level security;
alter table public.consent_forms enable row level security;

-- Staff on the case read these. Candidates never use the API directly; clients use the portal functions (0021).
create policy candidate_links_select on public.candidate_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and public.case_visible(case_id));
create policy candidate_requests_select on public.candidate_requests for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and public.case_visible(case_id));
create policy candidate_messages_select on public.candidate_messages for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and public.case_visible(case_id));
create policy consent_forms_select on public.consent_forms for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and public.case_visible(case_id));

revoke insert, update, delete, truncate on public.candidate_links, public.candidate_requests, public.candidate_messages, public.consent_forms
  from anon, authenticated;
-- The secret's hash and ciphertext stay server-side: staff read the other columns.
revoke select on public.candidate_links from anon, authenticated;
grant select (id, org_id, case_id, language, expires_at, revoked_at, revoked_reason, revoked_by, sent_at, sent_via, sent_count,
              first_opened_at, last_opened_at, open_count, reminders_sent, last_reminded_at, escalated_at, created_by, created_at)
  on public.candidate_links to authenticated;

alter publication supabase_realtime add table public.candidate_requests, public.candidate_messages, public.consent_forms;
