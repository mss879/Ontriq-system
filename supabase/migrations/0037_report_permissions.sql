-- =============================================================================
-- 0037_report_permissions.sql
-- Generating a report draft needed only reports.preview, which the read-only
-- Viewer role holds. It now also needs the case owner, cases.stage.change or
-- reports.approve, the same rule as sending a draft for approval.
-- Depends on: 0012.
-- =============================================================================

create or replace function public.request_report_draft(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  -- Seeing reports isn't enough (the Viewer role can): the case owner, someone who moves stages, or an approver.
  if auth.uid() is not null and not (public.has_permission('reports.preview')
       and (public.has_permission('cases.stage.change') or public.has_permission('reports.approve') or c.assigned_to = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
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
