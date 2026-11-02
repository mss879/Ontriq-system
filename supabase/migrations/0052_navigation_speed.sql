-- Reads that stay fast as the data grows.
--
-- case_visible() ran for every row a query touched, and each call made several
-- lookups of its own. At 5,000 cases an officer's case list spent 1.7 seconds in
-- the database. The rules don't change: visible_case_ids() is case_visible() as a
-- list, built once per query. People who can read every case skip even that, on
-- tables where case_id is a required foreign key, so the case is known to exist.
-- communications has no such key, so a row can outlive its case, and it keeps the
-- list. generated_documents has none either and keeps case_visible(), as do the
-- functions that ask about one case.

create or replace function public.sees_all_cases() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and public.has_permission('cases.read')
$$;

-- One branch per reason someone may see a case, so each uses its own index.
create or replace function public.visible_case_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id
    from public.cases c
   where c.org_id = (select public.auth_org_id())
     and (select public.is_staff())
     and (select public.has_permission('cases.read'))
  union
  select c.id
    from public.cases c
   where c.org_id = (select public.auth_org_id())
     and (select public.is_staff())
     and c.assigned_to = (select auth.uid())
  union
  select c.id
    from public.cases c
   where c.org_id = (select public.auth_org_id())
     and (select public.is_staff())
     and (select public.has_permission('checks.data_entry'))
     and c.stage = 'data_entry'
  union
  select cc.case_id
    from public.case_checks cc
    join public.cases c on c.id = cc.case_id
   where cc.assigned_to = (select auth.uid())
     and c.org_id = (select public.auth_org_id())
     and (select public.is_staff())
$$;

revoke execute on function public.sees_all_cases() from public, anon;
revoke execute on function public.visible_case_ids() from public, anon;
grant execute on function public.sees_all_cases(), public.visible_case_ids() to authenticated, service_role;

alter policy cases_select on public.cases
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or id in (select public.visible_case_ids())));

alter policy case_checks_select on public.case_checks
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy case_events_select on public.case_events
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy case_check_requirements_select on public.case_check_requirements
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy assignment_events_select on public.assignment_events
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy qc_reviews_select on public.qc_reviews
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy stage_history_select on public.stage_history
  using (org_id = (select public.auth_org_id()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));

alter policy candidate_links_select on public.candidate_links
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy candidate_messages_select on public.candidate_messages
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy candidate_requests_select on public.candidate_requests
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy client_requests_select on public.client_requests
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));
alter policy consent_forms_select on public.consent_forms
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));

alter policy communications_select on public.communications
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (case_id is null or case_id in (select public.visible_case_ids())));

alter policy candidates_select on public.candidates
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (
    (select public.has_permission('cases.read')) or (select public.has_permission('candidates.manage'))
    or exists (select 1 from public.cases c where c.candidate_id = candidates.id and c.id in (select public.visible_case_ids()))));

alter policy documents_select on public.documents
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('documents.read'))
    and (not sensitive or public.sensitive_open_to_caller(case_id, case_check_id))
    and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));

alter policy report_versions_select on public.report_versions
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('reports.preview'))
    and ((select public.sees_all_cases()) or case_id in (select public.visible_case_ids())));

-- The dashboard and the board counted stages by fetching every active case, and
-- the API stops at 1,000 rows, so past that the totals would be wrong as well as slow.
create or replace function public.case_stage_counts(p_stages public.case_stage[])
returns table (stage public.case_stage, total integer, on_hold integer)
language sql stable security invoker set search_path = '' as $$
  select c.stage, count(*)::integer, (count(*) filter (where c.on_hold))::integer
    from public.cases c
   where c.stage = any (p_stages)
   group by c.stage
$$;

revoke execute on function public.case_stage_counts(public.case_stage[]) from public, anon;
grant execute on function public.case_stage_counts(public.case_stage[]) to authenticated, service_role;
