-- =============================================================================
-- 0047_candidate_report.sql
-- When a candidate has given everything and confirms, the AI writes up what they
-- provided and attaches their files as an appendix. The report is for Ontriq's
-- staff, says plainly that nothing in it has been verified, and stays out of
-- the client's portal. See docs/features/0047-candidate-report.md.
-- Depends on: 0008, 0013, 0018, 0029, 0030, 0038, 0041.
-- =============================================================================

alter table public.cases add column candidate_confirmed_at timestamptz;

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('ai.candidate_report', 2, 3, 80, 'Write the candidate report and attach their documents')
on conflict (kind) do nothing;

insert into public.ai_capabilities (key, label, description, model, effort, max_tokens, sort) values
  ('candidate.report', 'Candidate report', 'Write up what a candidate provided, before verification', 'claude-sonnet-5-5', 'low', 6000, 30)
on conflict (key) do nothing;

-- What the candidate still owes. Mirrors candidateOutstanding in src/domain/candidate/steps.ts.
create or replace function public.candidate_still_owes(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.case_check_requirements r
                  where r.case_id = p_case and r.status = 'pending' and r.min_count > r.received_count
                    and public.candidate_providable(r.category, r.stage))
      or exists (select 1 from public.candidate_requests q where q.case_id = p_case and q.status = 'open')
      or not exists (select 1 from public.consent_forms f where f.case_id = p_case and f.status in ('submitted', 'accepted'))
$$;
revoke execute on function public.candidate_still_owes(uuid) from public, anon, authenticated;

-- A new file, answer or signature after they confirmed means they should confirm again.
create or replace function public.candidate_gave_more_since(p_case uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d
                  where d.case_id = p_case and d.uploaded_by_kind = 'candidate' and d.status in ('uploaded', 'accepted') and d.created_at > p_at)
      or exists (select 1 from public.candidate_requests q where q.case_id = p_case and q.answered_at > p_at)
      or exists (select 1 from public.consent_forms f where f.case_id = p_case and f.signed_at > p_at)
$$;
revoke execute on function public.candidate_gave_more_since(uuid, timestamptz) from public, anon, authenticated;

-- A new version replaces the last. Erasure already covers these: it clears a
-- case's generated_documents and their files.
create or replace function public.queue_candidate_report(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_version int;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  update public.generated_documents set status = 'superseded'
   where entity_type = 'case' and entity_id = p_case and kind = 'candidate_report' and status in ('queued', 'ready', 'failed');
  -- Staff never read an old summary beside a newer report.
  update public.ai_suggestions set decision = 'superseded'
   where capability = 'candidate.report' and entity_type = 'case' and entity_id = p_case and decision in ('pending', 'accepted');
  select coalesce(max(version), 0) + 1 into v_version from public.generated_documents
   where entity_type = 'case' and entity_id = p_case and kind = 'candidate_report';
  insert into public.generated_documents (org_id, kind, entity_type, entity_id, version, title, status)
  values (c.org_id, 'candidate_report', 'case', p_case, v_version, c.reference || ' candidate report', 'queued')
  returning id into v_id;
  perform public.enqueue_job('ai.candidate_report', jsonb_build_object('document_id', v_id), 'ai.candidate_report:' || v_id,
                             now(), null, 'case', p_case, null, c.org_id, null);
  return v_id;
end $$;
revoke execute on function public.queue_candidate_report(uuid) from public, anon, authenticated;

-- The candidate's last step. Scoped to their link, like the other candidate_* functions.
create or replace function public.candidate_confirm_submission(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := public.candidate_link_case(p_link);
  c public.cases;
begin
  select * into c from public.cases where id = v_case for update;
  if c.stage in ('released', 'cancelled') then raise exception 'this verification is closed' using errcode = '22023'; end if;
  if public.candidate_still_owes(v_case) then raise exception 'something is still needed' using errcode = '22023'; end if;
  -- A second click or a stale tab changes nothing, and writes no second report.
  if c.candidate_confirmed_at is not null and not public.candidate_gave_more_since(v_case, c.candidate_confirmed_at) then return; end if;
  update public.cases set candidate_confirmed_at = now() where id = v_case;
  perform public.queue_candidate_report(v_case);
  perform public.log_case_event(v_case, null, 'candidate_confirmed', 'Candidate confirmed their documents', null, '{}'::jsonb, true, true);
  perform public.notify_case_owner(v_case, 'candidate.confirmed', 'Candidate confirmed their documents', c.reference);
end $$;
revoke execute on function public.candidate_confirm_submission(uuid) from public, anon, authenticated;

-- Staff can make it again: after a failure, or when the candidate never confirmed.
create or replace function public.request_candidate_report(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not public.case_visible(p_case) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not public.can_manage_candidate(p_case) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.stage in ('released', 'cancelled') then raise exception 'this case is closed' using errcode = '22023'; end if;
  if not exists (select 1 from public.documents d where d.case_id = p_case and d.uploaded_by_kind = 'candidate' and d.status in ('uploaded', 'accepted')) then
    raise exception 'the candidate has not uploaded anything yet' using errcode = '22023';
  end if;
  v_id := public.queue_candidate_report(p_case);
  perform public.log_case_event(p_case, null, 'candidate_report_requested', 'Candidate report requested', null, '{}'::jsonb, false, false);
  return v_id;
end $$;
revoke execute on function public.request_candidate_report(uuid) from public, anon;
grant execute on function public.request_candidate_report(uuid) to authenticated, service_role;

-- The report carries the candidate's files, so it takes on their rules. It
-- holds sensitive evidence whenever one of those files is sensitive.
create or replace function public.can_read_candidate_report(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and public.case_visible(p_case) and public.has_permission('documents.read')
     and (public.has_permission('documents.read_sensitive')
          or not exists (select 1 from public.documents d
                          where d.case_id = p_case and d.uploaded_by_kind = 'candidate' and d.sensitive and d.status in ('uploaded', 'accepted')))
$$;
revoke execute on function public.can_read_candidate_report(uuid) from public, anon;
grant execute on function public.can_read_candidate_report(uuid) to authenticated, service_role;

drop policy if exists generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and case kind
           when 'quote' then (select public.can_read_quotes())
           when 'invoice' then (select public.can_read_invoices())
           when 'receipt' then (select public.can_read_invoices())
           when 'credit_note' then (select public.can_read_invoices())
           when 'statement' then (select public.can_read_invoices())
           else case when entity_type = 'case' then public.case_visible(entity_id) else (select public.has_permission('settings.manage')) end
         end
         and (kind <> 'candidate_report' or public.can_read_candidate_report(entity_id)));

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
    'submission', jsonb_build_object('confirmed_at', c.candidate_confirmed_at,
                                     'changed_since', c.candidate_confirmed_at is not null and public.candidate_gave_more_since(c.id, c.candidate_confirmed_at)),
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

create or replace function public.case_ai_suggestions(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_staff() and public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'capability', s.capability, 'entity_type', s.entity_type, 'entity_id', s.entity_id,
                                        'field_key', s.field_key, 'value', s.value, 'confidence', s.confidence, 'rationale', s.rationale,
                                        'source_refs', s.source_refs, 'decision', s.decision, 'created_at', s.created_at) order by s.created_at desc)
      from public.ai_suggestions s
     where (s.capability <> 'candidate.report' or public.can_read_candidate_report(p_case))
       and ((s.entity_type = 'case' and s.entity_id = p_case)
        or (s.entity_type = 'case_check' and s.entity_id in (select id from public.case_checks where case_id = p_case))
        or (s.entity_type = 'document' and s.entity_id in (select id from public.documents where case_id = p_case)))), '[]'::jsonb);
end $$;
revoke execute on function public.case_ai_suggestions(uuid) from public, anon;
grant execute on function public.case_ai_suggestions(uuid) to authenticated, service_role;

create or replace function public.can_decide_ai_suggestion(p_capability text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and case p_capability
    when 'document.extract' then public.has_permission('checks.data_entry') or public.has_permission('checks.verify')
    when 'document.classify' then public.has_permission('cases.update') or public.has_permission('qc.pre')
    when 'candidate.report' then public.has_permission('cases.update') or public.has_permission('qc.pre')
    when 'document.tamper' then public.has_permission('qc.pre') or public.has_permission('qc.post') or public.has_permission('cases.update')
    when 'case.consistency' then public.has_permission('qc.pre') or public.has_permission('qc.post')
    when 'case.preqc' then public.has_permission('qc.pre')
    when 'case.postqc' then public.has_permission('qc.post')
    when 'report.narrative' then public.has_permission('checks.verify') or public.has_permission('qc.post') or public.has_permission('cases.stage.change')
    when 'check.outreach' then public.has_permission('checks.verify')
    when 'check.response' then public.has_permission('checks.verify')
    else public.has_permission('cases.stage.change') or public.has_permission('ai.configure')
  end
$$;
revoke execute on function public.can_decide_ai_suggestion(text) from public, anon;
grant execute on function public.can_decide_ai_suggestion(text) to authenticated, service_role;
