-- =============================================================================
-- 0029_ai_pipeline.sql
-- Feature: when the AI capabilities run (plan §8). Triggers queue jobs:
--   a file finishes uploading      → ai.classify_document (type, quality, text)
--   a check's documents are read   → ai.extract_fields (from the classify job)
--   a case enters Pre-QC           → ai.consistency, then ai.preqc_copilot
--   a case enters Post-QC          → ai.postqc (cross-check, proposed result)
--   a case enters the report stage → ai.narrative (remarks and summary)
-- The handlers skip quietly when AI is not set up or a capability is off.
-- Nothing the AI produces changes a case by itself: suggestions wait in
-- ai_suggestions until a person accepts, edits or rejects them
-- (decide_ai_suggestion); accepted field values and remarks are written by
-- the app through the normal functions, with the person's permissions.
-- Depends on: 0006, 0007, 0009, 0018.
-- =============================================================================

create or replace function public.documents_queue_ai() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'uploaded' and old.status = 'pending_upload' then
    perform public.enqueue_job('ai.classify_document', jsonb_build_object('document_id', new.id), 'ai.classify_document:' || new.id,
                               now(), null, 'document', new.id, null, new.org_id, null);
  end if;
  return null;
end $$;
create trigger documents_queue_ai after update of status on public.documents
  for each row execute function public.documents_queue_ai();
revoke execute on function public.documents_queue_ai() from public, anon, authenticated;

create or replace function public.cases_queue_ai() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_round text := to_char(now(), 'YYYYMMDDHH24MISS');
begin
  if new.stage is not distinct from old.stage then return null; end if;
  if new.stage = 'pre_qc' then
    perform public.enqueue_job('ai.consistency', jsonb_build_object('case_id', new.id, 'then', 'ai.preqc_copilot'), 'ai.consistency:' || new.id || ':' || v_round,
                               now(), null, 'case', new.id, null, new.org_id, null);
  elsif new.stage = 'post_qc' then
    perform public.enqueue_job('ai.postqc', jsonb_build_object('case_id', new.id), 'ai.postqc:' || new.id || ':' || v_round,
                               now(), null, 'case', new.id, null, new.org_id, null);
  elsif new.stage = 'report' then
    perform public.enqueue_job('ai.narrative', jsonb_build_object('case_id', new.id), 'ai.narrative:' || new.id || ':' || v_round,
                               now(), null, 'case', new.id, null, new.org_id, null);
  end if;
  return null;
end $$;
create trigger cases_queue_ai after update of stage on public.cases
  for each row execute function public.cases_queue_ai();
revoke execute on function public.cases_queue_ai() from public, anon, authenticated;

-- Accept, edit or reject a suggestion on a case the person can see. Earlier
-- pending suggestions for the same field are superseded when a newer one is decided.
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

-- Remarks for the report (the check's client_note) without changing its state:
-- accepted AI narrative, or a person's own wording.
create or replace function public.set_check_remarks(p_check uuid, p_remarks text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or not public.case_visible(k.case_id) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  if not (public.has_permission('checks.verify') or public.has_permission('reports.preview') or public.has_permission('cases.stage.change')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage in ('approval', 'released', 'cancelled') then raise exception 'remarks are locked once the report is with the approver' using errcode = '22023'; end if;
  update public.case_checks set client_note = nullif(trim(p_remarks), ''), updated_by = auth.uid() where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'remarks_updated', k.label || ': remarks updated', null, '{}'::jsonb, false, false);
end $$;
revoke execute on function public.set_check_remarks(uuid, text) from public, anon;
grant execute on function public.set_check_remarks(uuid, text) to authenticated, service_role;

-- Suggestions on a case, newest first, for the case page (staff on the case).
create or replace function public.case_ai_suggestions(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_staff() and public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'capability', s.capability, 'entity_type', s.entity_type, 'entity_id', s.entity_id,
                                        'field_key', s.field_key, 'value', s.value, 'confidence', s.confidence, 'rationale', s.rationale,
                                        'source_refs', s.source_refs, 'decision', s.decision, 'created_at', s.created_at) order by s.created_at desc)
      from public.ai_suggestions s
     where (s.entity_type = 'case' and s.entity_id = p_case)
        or (s.entity_type = 'case_check' and s.entity_id in (select id from public.case_checks where case_id = p_case))
        or (s.entity_type = 'document' and s.entity_id in (select id from public.documents where case_id = p_case))), '[]'::jsonb);
end $$;
revoke execute on function public.case_ai_suggestions(uuid) from public, anon;
grant execute on function public.case_ai_suggestions(uuid) to authenticated, service_role;

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('ai.classify_document', 4, 3, 60, 'Classify an upload, check quality and read its text'),
  ('ai.extract_fields', 3, 3, 70, 'Extract check fields from documents'),
  ('ai.consistency', 2, 3, 90, 'Compare documents within a case'),
  ('ai.preqc_copilot', 2, 3, 90, 'Draft the Pre-QC checklist and requests'),
  ('ai.postqc', 1, 3, 90, 'Cross-check a case before reporting'),
  ('ai.narrative', 2, 3, 90, 'Draft report findings and summary'),
  ('ai.outreach_draft', 2, 3, 90, 'Draft verification outreach'),
  ('ai.response_capture', 2, 3, 70, 'Turn a verifier response into a proposed result'),
  ('sla.scan', 1, 1, 120, 'Scan for SLA risks'),
  ('briefing.daily', 1, 2, 120, 'Write the daily manager briefing'),
  ('assign.rebalance', 1, 2, 90, 'Propose workload rebalancing'),
  ('retention.purge', 1, 1, 200, 'Purge data past its retention period')
on conflict (kind) do nothing;

alter publication supabase_realtime add table public.document_ai;
