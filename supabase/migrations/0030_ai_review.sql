-- =============================================================================
-- 0030_ai_review.sql
-- Feature: who may decide which AI suggestion. Until now any staff member
-- could update any column of a suggestion directly (its value, capability or
-- confidence), so "AI suggested" text could be rewritten by hand. Decisions
-- now go only through decide_ai_suggestion, which also checks the person may
-- decide that kind of suggestion (mirrored in src/domain/ai/suggestions.ts,
-- DECIDE_PERMISSIONS) and only lets them edit the value of the kinds people
-- edit before applying (field values, remarks, a reply's result).
-- Report remarks (set_check_remarks) are written by the officers, QC and
-- managers; reports.preview alone (held by Viewer) no longer allows it.
-- Depends on: 0018, 0029.
-- =============================================================================

drop policy if exists ai_suggestions_decide on public.ai_suggestions;
revoke update on public.ai_suggestions from anon, authenticated;

create or replace function public.can_decide_ai_suggestion(p_capability text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and case p_capability
    when 'document.extract' then public.has_permission('checks.data_entry') or public.has_permission('checks.verify')
    when 'document.classify' then public.has_permission('cases.update') or public.has_permission('qc.pre')
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
  if p_decision = 'edited' and s.capability not in ('document.extract', 'report.narrative', 'check.response', 'case.preqc', 'case.consistency', 'case.postqc') then
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

create or replace function public.set_check_remarks(p_check uuid, p_remarks text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.case_checks;
  c public.cases;
begin
  select * into k from public.case_checks where id = p_check for update;
  if k.id is null or not public.case_visible(k.case_id) then raise exception 'check not found' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = k.case_id;
  if not (public.has_permission('checks.verify') or public.has_permission('qc.post') or public.has_permission('cases.stage.change')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.stage in ('approval', 'released', 'cancelled') then raise exception 'remarks are locked once the report is with the approver' using errcode = '22023'; end if;
  update public.case_checks set client_note = nullif(trim(p_remarks), ''), updated_by = auth.uid() where id = p_check;
  perform public.log_case_event(k.case_id, k.id, 'remarks_updated', k.label || ': remarks updated', null, '{}'::jsonb, false, false);
end $$;
revoke execute on function public.set_check_remarks(uuid, text) from public, anon;
grant execute on function public.set_check_remarks(uuid, text) to authenticated, service_role;
