-- =============================================================================
-- 0021_portal_views.sql
-- Feature: the client portal's window onto cases. Client users have no row
-- level access to cases, checks or the timeline; they read projections from
-- the portal_* functions below, which keep to their own company, leave out
-- internal notes, QC remarks and assignees, rewrite timeline wording, and
-- apply the per-client visibility settings Ontriq controls
-- (client_settings.visibility). Results appear only after release unless
-- Ontriq allows earlier. Clients upload into document slots Ontriq shared
-- with them, open documents Ontriq shared, and get notified in the portal.
-- Quotes and invoices add their own portal functions in 0014 and 0015.
-- Depends on: 0003_clients, 0006_cases, 0007_documents, 0008_candidate_link,
--             0010_notifications_comms (run time only).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's client company, or an error. p_permission narrows it further.
create or replace function public.portal_client(p_permission text default 'portal.cases.read') returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid;
begin
  if not (public.is_client() and public.has_permission('portal.cases.read') and public.has_permission(p_permission)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_client := public.client_id_of_user();
  if v_client is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return v_client;
end $$;
revoke execute on function public.portal_client(text) from public, anon;
grant execute on function public.portal_client(text) to authenticated, service_role;

-- Ontriq's visibility rules for one client, with defaults filled in.
create or replace function public.portal_visibility(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"show_check_progress": true, "show_timeline": true, "show_documents": true,
           "show_results_before_release": false, "show_candidate_progress": true, "hidden_check_types": []}'::jsonb
         || coalesce((select s.visibility from public.client_settings s where s.client_id = p_client), '{}'::jsonb)
$$;
revoke execute on function public.portal_visibility(uuid) from public, anon, authenticated;

-- The same for the signed-in client user (used by the documents policy).
create or replace function public.portal_my_visibility() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_client() then public.portal_visibility(public.client_id_of_user()) else '{}'::jsonb end
$$;
revoke execute on function public.portal_my_visibility() from public, anon;
grant execute on function public.portal_my_visibility() to authenticated, service_role;

-- Is this a case the signed-in client user may see?
create or replace function public.portal_case_visible(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_client() and public.has_permission('portal.cases.read') and exists (
    select 1 from public.cases c
     where c.id = p_case and c.org_id = public.auth_org_id() and c.client_id = public.client_id_of_user() and c.client_visible)
$$;
revoke execute on function public.portal_case_visible(uuid) from public, anon;
grant execute on function public.portal_case_visible(uuid) to authenticated, service_role;

-- What a client calls each stage.
create or replace function public.portal_stage_label(p public.case_stage) returns text
language sql immutable set search_path = '' as $$
  select case p when 'intake' then 'Request received' when 'documents' then 'Collecting documents' when 'pre_qc' then 'Documents under review'
    when 'data_entry' then 'In progress' when 'verification' then 'Verification in progress' when 'post_qc' then 'Quality review'
    when 'report' then 'Report in preparation' when 'approval' then 'Awaiting approval' when 'released' then 'Report available' else 'Cancelled' end
$$;
revoke execute on function public.portal_stage_label(public.case_stage) from public, anon;
grant execute on function public.portal_stage_label(public.case_stage) to authenticated, service_role;

-- Client-visible document slots still waiting for files.
create or replace function public.portal_pending_slots(p_case uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.case_check_requirements r
   where r.case_id = p_case and r.client_visible and r.stage = 'documents' and r.status = 'pending' and r.min_count > r.received_count
$$;
revoke execute on function public.portal_pending_slots(uuid) from public, anon, authenticated;

-- One case as a list row.
create or replace function public.portal_case_row(c public.cases) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'reference', c.reference, 'candidate_name', c.candidate_name, 'position_title', c.position_title,
    'department', c.department, 'client_reference', c.client_reference, 'package_name', c.package_snapshot ->> 'name',
    'stage', c.stage, 'stage_label', public.portal_stage_label(c.stage),
    'status_label', coalesce((select s.client_label from public.client_status_catalog s where s.org_id = c.org_id and s.key = c.status_key),
                             public.portal_stage_label(c.stage)),
    'priority', c.priority, 'on_hold', c.on_hold, 'checks_total', c.checks_total, 'checks_done', c.checks_done,
    'received_at', c.received_at, 'due_at', c.due_at, 'released_at', c.released_at, 'cancelled_at', c.cancelled_at,
    'process_type', c.process_type, 'created_via', c.created_via,
    'needs_documents', case when c.stage in ('intake', 'documents') then public.portal_pending_slots(c.id) else 0 end,
    'final_result', case when c.stage = 'released' then c.final_result end)
$$;
revoke execute on function public.portal_case_row(public.cases) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- p = { q, status: all|action|active|released|cancelled, sort: recent|due, limit, offset }
create or replace function public.portal_cases(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_status text := coalesce(nullif(p ->> 'status', ''), 'all');
  v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 25), 1), 100);
  v_offset int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_out jsonb;
begin
  with matched as (
    select c.id, c.due_at, c.received_at from public.cases c
     where c.client_id = v_client and c.client_visible
       and (v_q is null or c.reference ilike '%' || v_q || '%' or c.candidate_name ilike '%' || v_q || '%'
            or c.client_reference ilike '%' || v_q || '%' or c.position_title ilike '%' || v_q || '%')
       and case v_status
             when 'action' then c.stage in ('intake', 'documents') and public.portal_pending_slots(c.id) > 0
             when 'active' then c.stage not in ('released', 'cancelled')
             when 'released' then c.stage = 'released'
             when 'cancelled' then c.stage = 'cancelled'
             else true end
  ), page as (
    select m.id from matched m
     order by case when p ->> 'sort' = 'due' then m.due_at end asc nulls last, m.received_at desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(public.portal_case_row(c) order by
                        case when p ->> 'sort' = 'due' then c.due_at end asc nulls last, c.received_at desc)
                        from public.cases c where c.id in (select id from page)), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke execute on function public.portal_cases(jsonb) from public, anon;
grant execute on function public.portal_cases(jsonb) to authenticated, service_role;

create or replace function public.portal_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  v_out jsonb;
begin
  with mine as (select * from public.cases where client_id = v_client and client_visible)
  select jsonb_build_object(
    'client', (select jsonb_build_object('id', cl.id, 'name', cl.name, 'code', cl.code, 'sla_days', cl.sla_days) from public.clients cl where cl.id = v_client),
    'counts', jsonb_build_object(
       'total', (select count(*) from mine),
       'active', (select count(*) from mine where stage not in ('released', 'cancelled')),
       'action', (select count(*) from mine where stage in ('intake', 'documents') and public.portal_pending_slots(id) > 0),
       'released_30d', (select count(*) from mine where stage = 'released' and released_at > now() - interval '30 days'),
       'overdue', (select count(*) from mine where stage not in ('released', 'cancelled') and due_at < now())),
    'by_stage', jsonb_build_object(
       'received', (select count(*) from mine where stage = 'intake'),
       'documents', (select count(*) from mine where stage = 'documents'),
       'in_progress', (select count(*) from mine where stage in ('pre_qc', 'data_entry', 'verification', 'post_qc')),
       'report', (select count(*) from mine where stage in ('report', 'approval')),
       'released', (select count(*) from mine where stage = 'released')),
    'avg_tat_days', (select round(avg(extract(epoch from released_at - received_at) / 86400)::numeric, 1)
                       from mine where stage = 'released' and released_at > now() - interval '90 days'),
    'needs_action', coalesce((select jsonb_agg(public.portal_case_row(c) order by c.received_at)
                                from public.cases c
                               where c.id in (select id from mine where stage in ('intake', 'documents') and public.portal_pending_slots(id) > 0
                                               order by received_at limit 5)), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(public.portal_case_row(c) order by c.received_at desc)
                          from public.cases c where c.id in (select id from mine order by received_at desc limit 6)), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke execute on function public.portal_dashboard() from public, anon;
grant execute on function public.portal_dashboard() to authenticated, service_role;

-- One case for the client: progress, client-safe check statuses, the document
-- slots shared with them, shared documents, a rewritten timeline and report status.
create or replace function public.portal_case_detail(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  c public.cases;
  v_vis jsonb;
  v_hidden uuid[];
  v_results boolean;
  v_can_upload boolean := public.has_permission('portal.cases.create');
  v_out jsonb;
begin
  select * into c from public.cases where id = p_case and client_id = v_client and client_visible;
  if c.id is null then raise exception 'case not found' using errcode = 'P0002'; end if;
  v_vis := public.portal_visibility(v_client);
  v_hidden := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_vis -> 'hidden_check_types') x), '{}');
  v_results := c.stage = 'released' or coalesce((v_vis ->> 'show_results_before_release')::boolean, false);

  select jsonb_build_object(
    'case', public.portal_case_row(c) || jsonb_build_object(
              'candidate', (select jsonb_build_object('full_name', cd.full_name, 'nic', cd.nic, 'email', cd.email, 'phone', cd.phone)
                              from public.candidates cd where cd.id = c.candidate_id),
              'instructions', c.instructions,
              'package', jsonb_build_object('name', c.package_snapshot ->> 'name', 'code', c.package_snapshot ->> 'code',
                                            'tat_days', c.package_snapshot -> 'tat_days'),
              'hold_label', case when c.on_hold then 'On hold' end,
              'results_visible', v_results),
    'visibility', v_vis,
    'can_upload', v_can_upload and c.stage in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification'),
    'checks', case when coalesce((v_vis ->> 'show_check_progress')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', k.label, 'key', ct.key, 'icon', ct.icon,
               'state', case when k.state in ('completed', 'discrepancy', 'unable_to_verify') then 'done'
                             when k.state = 'waived' then 'not_required'
                             when k.state = 'pending_info' then 'needs_information'
                             when k.state = 'not_started' then 'not_started'
                             else 'in_progress' end,
               'completed_at', case when k.state in ('completed', 'discrepancy', 'unable_to_verify', 'waived') then k.completed_at end,
               'result_tone', case when v_results then k.result_tone end,
               'result_label', case when v_results then (
                   select o ->> 'label' from public.check_type_versions v, jsonb_array_elements(coalesce(v.schema -> 'result' -> 'options', '[]'::jsonb)) o
                    where v.id = k.check_type_version_id and o ->> 'key' = k.result) end,
               'client_note', case when v_results then k.client_note end,
               'fields', case when v_results then coalesce((
                   select jsonb_agg(jsonb_build_object('label', f ->> 'label', 'value', k.values -> (f ->> 'key')) order by n)
                     from public.check_type_versions v, jsonb_array_elements(coalesce(v.schema -> 'fields', '[]'::jsonb)) with ordinality as x(f, n)
                    where v.id = k.check_type_version_id and coalesce((f -> 'visibility' ->> 'client')::boolean, false)
                      and k.values ? (f ->> 'key')), '[]'::jsonb) else '[]'::jsonb end)
             order by k.sort)
        from public.case_checks k join public.check_types ct on ct.id = k.check_type_id
       where k.case_id = c.id and not (k.check_type_id = any (v_hidden))), '[]'::jsonb) else '[]'::jsonb end,
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'category', r.category, 'label', r.label, 'description', r.description,
               'category_name', dc.name, 'guide', dc.guide, 'check_label', k.label,
               'min_count', r.min_count, 'received_count', r.received_count, 'status', r.status,
               'requested_note', r.requested_note, 'requested_at', r.requested_at)
             order by coalesce(k.sort, 0), dc.sort, r.created_at)
        from public.case_check_requirements r
        left join public.case_checks k on k.id = r.case_check_id
        left join public.document_categories dc on dc.org_id = r.org_id and dc.key = r.category
       where r.case_id = c.id and r.client_visible and r.stage = 'documents' and r.status <> 'waived'), '[]'::jsonb),
    'documents', case when coalesce((v_vis ->> 'show_documents')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'filename', d.filename, 'category', d.category, 'category_name', dc.name, 'label', d.label,
               'from', d.uploaded_by_kind, 'status', d.status, 'created_at', d.created_at, 'mime', d.mime, 'size', d.size_bytes,
               'rejection_reason', case when d.uploaded_by_kind = 'client' then d.rejection_reason end)
             order by d.created_at desc)
        from public.documents d
        left join public.document_categories dc on dc.org_id = d.org_id and dc.key = d.category
       where d.case_id = c.id
         and (d.visibility in ('client', 'report') and d.status in ('uploaded', 'accepted')
              or d.uploaded_by_kind = 'client' and d.status in ('uploaded', 'accepted', 'rejected'))), '[]'::jsonb) else '[]'::jsonb end,
    'candidate_progress', case when coalesce((v_vis ->> 'show_candidate_progress')::boolean, true) then (
      select jsonb_build_object('invited_at', l.sent_at, 'active', l.revoked_at is null and l.expires_at > now(),
                                'opened', l.first_opened_at is not null,
                                'consent', coalesce((select f.status in ('submitted', 'accepted') from public.consent_forms f where f.case_id = c.id), false))
        from public.candidate_links l where l.case_id = c.id and l.sent_at is not null order by l.created_at desc limit 1) end,
    'timeline', case when coalesce((v_vis ->> 'show_timeline')::boolean, true) then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.at, 'title', e.title, 'body', e.body) order by e.at desc)
        from (
          select ev.id, ev.kind, ev.at,
                 case ev.kind
                   when 'created' then 'Request received'
                   when 'stage_changed' then public.portal_stage_label((ev.data ->> 'to')::public.case_stage)
                   when 'hold' then 'Put on hold'
                   when 'resumed' then 'Resumed'
                   when 'check_state' then coalesce(k.label, 'A check') || case when ev.data ->> 'to' = 'waived' then ' is not required' else ' completed' end
                   else ev.title end as title,
                 case when ev.kind in ('document_requested', 'document_rejected') then ev.body end as body
            from public.case_events ev
            left join public.case_checks k on k.id = ev.case_check_id
           where ev.case_id = c.id and ev.visible_to_client and ev.kind <> 'returned'
             and not (ev.kind = 'check_state' and k.check_type_id = any (v_hidden))
           order by ev.at desc limit 80) e), '[]'::jsonb) else '[]'::jsonb end,
    'report', jsonb_build_object(
      'status', case when c.stage = 'released' then 'released' when c.stage in ('report', 'approval') then 'in_preparation'
                     when c.stage = 'cancelled' then 'cancelled' else 'not_ready' end,
      'released_at', c.released_at)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.portal_case_detail(uuid) from public, anon;
grant execute on function public.portal_case_detail(uuid) to authenticated, service_role;

-- Check types the client may build packages from, with Ontriq's list price.
-- Security invoker on purpose: it sees exactly what package_items_price_guard sees.
create or replace function public.portal_price_list() returns table (
  check_type_id uuid, key text, name text, description text, icon text, unit_price numeric, currency text
)
language sql stable security invoker set search_path = '' as $$
  select ct.id, ct.key, ct.name, ct.description, ct.icon,
         coalesce((select max(pi.unit_price) from public.package_items pi join public.packages p on p.id = pi.package_id
                    where pi.check_type_id = ct.id and p.owner_scope = 'org' and p.is_active), 0),
         coalesce((select o.currency from public.orgs o where o.id = ct.org_id), 'LKR')
    from public.check_types ct
   where ct.org_id = (select public.auth_org_id()) and ct.archived_at is null and ct.current_version_id is not null
     and (select public.is_client())
     and not exists (select 1 from public.client_check_type_access a
                      where a.client_id = (select public.client_id_of_user()) and a.check_type_id = ct.id and not a.enabled)
   order by ct.sort, ct.name
$$;
revoke execute on function public.portal_price_list() from public, anon;
grant execute on function public.portal_price_list() to authenticated, service_role;

-- The client company's portal team (names and roles only).
create or replace function public.portal_team() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'membership_id', m.id, 'user_id', m.user_id, 'full_name', p.full_name, 'email', p.email,
             'role_id', r.id, 'role_key', r.key, 'role_name', r.name, 'status', m.status,
             'invited_at', m.invited_at, 'activated_at', m.activated_at, 'is_me', m.user_id = auth.uid())
           order by m.status, p.full_name)
      from public.memberships m
      join public.roles r on r.id = m.role_id
      left join public.profiles p on p.id = m.user_id
     where m.client_id = v_client and m.kind = 'client'), '[]'::jsonb);
end $$;
revoke execute on function public.portal_team() from public, anon;
grant execute on function public.portal_team() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Uploads from the portal (same two steps as staff uploads)
-- ---------------------------------------------------------------------------

-- Into a document slot Ontriq shared, or a CV / other supporting file.
create or replace function public.portal_begin_upload(
  p_case uuid, p_requirement uuid, p_category text, p_filename text, p_mime text, p_size bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.cases.create');
  c public.cases;
  r public.case_check_requirements;
  v_category text;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into c from public.cases where id = p_case and client_id = v_client and client_visible;
  if c.id is null then raise exception 'case not found' using errcode = 'P0002'; end if;
  if c.stage not in ('intake', 'documents', 'pre_qc', 'data_entry', 'verification') then
    raise exception 'this case no longer takes uploads' using errcode = '22023';
  end if;
  if p_requirement is not null then
    select * into r from public.case_check_requirements where id = p_requirement and case_id = c.id and client_visible and status <> 'waived';
    if r.id is null then raise exception 'document slot not found' using errcode = 'P0002'; end if;
    v_category := r.category;
  elsif p_category in ('cv', 'other') then
    v_category := p_category;
  else
    raise exception 'choose where this document belongs' using errcode = '22023';
  end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'upload a PDF, JPEG, PNG, WebP or HEIC file' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then raise exception 'files must be under 25 MB' using errcode = '22023'; end if;

  v_path := 'org/' || c.org_id || '/case/' || c.id || '/' || v_id || '/'
            || left(regexp_replace(lower(coalesce(p_filename, 'file')), '[^a-z0-9._-]+', '-', 'g'), 80);
  insert into public.documents (id, org_id, case_id, case_check_id, candidate_id, client_id, category, label, storage_path, filename, mime, size_bytes,
                                sensitive, visibility, uploaded_by, uploaded_by_kind)
  values (v_id, c.org_id, c.id, r.case_check_id, c.candidate_id, c.client_id, v_category, r.label, v_path,
          left(coalesce(nullif(trim(p_filename), ''), 'file'), 200), p_mime, p_size,
          coalesce((select sensitive from public.document_categories where org_id = c.org_id and key = v_category), false),
          'client', auth.uid(), 'client');
  return jsonb_build_object('id', v_id, 'bucket', 'case-files', 'path', v_path);
end $$;
revoke execute on function public.portal_begin_upload(uuid, uuid, text, text, text, bigint) from public, anon;
grant execute on function public.portal_begin_upload(uuid, uuid, text, text, text, bigint) to authenticated, service_role;

create or replace function public.portal_finalize_upload(p_document uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.cases.create');
  d public.documents;
  v_name text;
begin
  select * into d from public.documents where id = p_document and client_id = v_client and uploaded_by_kind = 'client' for update;
  if d.id is null or d.uploaded_by is distinct from auth.uid() then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.status <> 'pending_upload' then return; end if;
  update public.documents set status = 'uploaded', sha256 = nullif(p_sha256, '') where id = d.id;
  v_name := coalesce((select name from public.document_categories where org_id = d.org_id and key = d.category), d.category);
  perform public.log_case_event(d.case_id, d.case_check_id, 'document_uploaded', v_name || ' uploaded by the client', d.filename,
    jsonb_build_object('document_id', d.id, 'category', d.category, 'by', 'client'), true, false);
  perform public.notify_case_owner(d.case_id, 'client.upload', 'Client uploaded ' || v_name,
    (select reference from public.cases where id = d.case_id));
end $$;
revoke execute on function public.portal_finalize_upload(uuid, text) from public, anon;
grant execute on function public.portal_finalize_upload(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Portal notifications: the client's users hear about what needs them
-- ---------------------------------------------------------------------------
create or replace function public.notify_client_users(p_case uuid, p_type text, p_title text, p_body text default '') returns int
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_users uuid[];
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not c.client_visible then return 0; end if;
  select array_agg(m.user_id) into v_users
    from public.memberships m
   where m.client_id = c.client_id and m.kind = 'client' and m.status = 'active'
     and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission = 'portal.cases.read');
  if coalesce(cardinality(v_users), 0) = 0 then return 0; end if;
  return public.notify_users(v_users, p_type, p_title, coalesce(p_body, ''), '/portal/cases/' || c.id, false, 'case', c.id, c.org_id);
end $$;
revoke execute on function public.notify_client_users(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.case_events_notify_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  if not new.visible_to_client then return null; end if;
  select * into c from public.cases where id = new.case_id;
  if c.id is null then return null; end if;
  if new.kind = 'document_requested' and c.process_type = 'client_supplied' then
    perform public.notify_client_users(c.id, 'portal.documents_needed', c.reference || ': ' || new.title, coalesce(new.body, ''));
  elsif new.kind = 'document_rejected' and coalesce(new.data ->> 'by', '') <> 'candidate'
        and exists (select 1 from public.documents d where d.id = (new.data ->> 'document_id')::uuid and d.uploaded_by_kind = 'client') then
    perform public.notify_client_users(c.id, 'portal.document_rejected', c.reference || ': a document needs replacing', coalesce(new.body, ''));
  elsif new.kind = 'stage_changed' and new.data ->> 'to' = 'documents' and new.data ->> 'from' = 'intake' then
    perform public.notify_client_users(c.id, 'portal.case_accepted', c.reference || ' accepted', 'Ontriq has started work on ' || c.candidate_name || '.');
  elsif new.kind = 'stage_changed' and new.data ->> 'to' = 'released' then
    perform public.notify_client_users(c.id, 'portal.report_released', c.reference || ': report available', c.candidate_name);
  end if;
  return null;
end $$;
create trigger case_events_notify_client after insert on public.case_events
  for each row execute function public.case_events_notify_client();
revoke execute on function public.case_events_notify_client() from public, anon, authenticated;

-- Email copies of notifications, for people who want them (notification_prefs.matrix).
-- Portal notifications email by default; staff choose per event type.
create or replace function public.notifications_queue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pref jsonb;
  v_email boolean;
begin
  select matrix -> new.type into v_pref from public.notification_prefs where user_id = new.user_id;
  v_email := coalesce((v_pref ->> 'email')::boolean, new.type like 'portal.%');
  if v_email then
    perform public.enqueue_job('notify.email', jsonb_build_object('notification_id', new.id), 'notify.email:' || new.id,
                               now() + interval '1 minute', null, 'notification', new.id, null, new.org_id, null);
  end if;
  return null;
end $$;
create trigger notifications_queue_email after insert on public.notifications
  for each row execute function public.notifications_queue_email();
revoke execute on function public.notifications_queue_email() from public, anon, authenticated;

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('notify.email', 4, 5, 60, 'Email a copy of a notification to someone who asked for it')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- Clients open documents Ontriq shared with them (and their own uploads)
-- through /api/files, which reads the row first: this policy decides.
-- ---------------------------------------------------------------------------
create policy documents_select_client on public.documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_client())
         and client_id = (select public.client_id_of_user())
         and (visibility in ('client', 'report') and status in ('uploaded', 'accepted')
              or uploaded_by_kind = 'client' and status in ('uploaded', 'accepted', 'rejected'))
         and coalesce(((select public.portal_my_visibility()) ->> 'show_documents')::boolean, true)
         and public.portal_case_visible(case_id));

-- Client users may log their own downloads (log_document_access already allows any signed-in reader).
