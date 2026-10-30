-- =============================================================================
-- 0011_qc.sql
-- Feature: Pre-QC and Post-QC (requirements §1.6). A review records the
-- reviewer, a checklist, remarks and the decision, then moves the case:
--   Pre-QC  approve → data entry      return → document collection
--   Post-QC approve → final report    return → verification (chosen checks reopen)
-- Depends on: 0006_cases.
-- =============================================================================

create table public.qc_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  kind text not null check (kind in ('pre', 'post')),
  decision text not null check (decision in ('approved', 'returned')),
  checklist jsonb not null default '[]'::jsonb,
  remarks text,
  returned_check_ids uuid[] not null default '{}',
  reviewer_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index qc_reviews_org_idx on public.qc_reviews (org_id, created_at desc);
create index qc_reviews_case_idx on public.qc_reviews (case_id, created_at desc);
create index qc_reviews_reviewer_idx on public.qc_reviews (reviewer_id);

create or replace function public.record_qc_review(
  p_case uuid, p_kind text, p_decision text, p_checklist jsonb default '[]'::jsonb, p_remarks text default null, p_return_checks uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  v_id uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or (auth.uid() is not null and not public.case_visible(p_case)) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if p_kind not in ('pre', 'post') or p_decision not in ('approved', 'returned') then raise exception 'unknown QC decision' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.has_permission(case when p_kind = 'pre' then 'qc.pre' else 'qc.post' end) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.on_hold then raise exception 'this case is on hold' using errcode = '22023'; end if;
  if c.stage <> (case when p_kind = 'pre' then 'pre_qc' else 'post_qc' end)::public.case_stage then
    raise exception 'the case is not waiting for %-QC', initcap(p_kind) using errcode = '22023';
  end if;
  if p_decision = 'returned' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'say what needs correcting' using errcode = '22023';
  end if;
  if p_kind = 'post' and p_decision = 'returned' and coalesce(cardinality(p_return_checks), 0) = 0 then
    raise exception 'choose the checks that need more work' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_return_checks, '{}')) x where not exists (select 1 from public.case_checks k where k.id = x and k.case_id = p_case)) then
    raise exception 'a returned check is not part of this case' using errcode = '22023';
  end if;

  insert into public.qc_reviews (org_id, case_id, kind, decision, checklist, remarks, returned_check_ids, reviewer_id)
  values (c.org_id, p_case, p_kind, p_decision, coalesce(p_checklist, '[]'::jsonb), nullif(trim(p_remarks), ''), coalesce(p_return_checks, '{}'), auth.uid())
  returning id into v_id;

  if p_kind = 'post' and p_decision = 'returned' then
    update public.case_checks set state = 'returned', result = null, result_tone = null, completed_at = null
     where case_id = p_case and id = any (p_return_checks);
  end if;

  perform public.log_case_event(p_case, null, 'qc_' || p_kind,
    case p_kind when 'pre' then 'Pre-QC ' else 'Post-QC ' end || case p_decision when 'approved' then 'approved' else 'returned the case' end,
    nullif(trim(p_remarks), ''), jsonb_build_object('review_id', v_id, 'checks', p_return_checks), false, false);

  perform public.move_case(p_case,
    case when p_kind = 'pre' and p_decision = 'approved' then 'data_entry'
         when p_kind = 'pre' then 'documents'
         when p_decision = 'approved' then 'report'
         else 'verification' end::public.case_stage,
    case when p_kind = 'pre' then 'pre_qc_' else 'post_qc_' end || case when p_decision = 'approved' then 'approve' else 'return' end,
    nullif(trim(p_remarks), ''), p_decision = 'returned');
  return v_id;
end $$;
revoke execute on function public.record_qc_review(uuid, text, text, jsonb, text, uuid[]) from public, anon;
grant execute on function public.record_qc_review(uuid, text, text, jsonb, text, uuid[]) to authenticated, service_role;

alter table public.qc_reviews enable row level security;
create policy qc_reviews_select on public.qc_reviews for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.case_visible(case_id));
revoke insert, update, delete, truncate on public.qc_reviews from anon, authenticated;
