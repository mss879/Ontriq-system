-- Adding a candidate by hand, before any case exists.
--
-- A person can be verified for several clients, so a client belongs to a case,
-- not to a candidate. This column only records who a person was added for, so
-- their first case can start from it.

alter table public.candidates
  add column added_for_client_id uuid references public.clients (id) on delete set null;
create index candidates_added_for_client_idx on public.candidates (added_for_client_id);

-- The same NIC is the same person, so a second entry finds the first one.
create or replace function public.add_candidate(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_client public.clients;
  v_name text := trim(coalesce(p ->> 'full_name', ''));
  v_nic text := nullif(p ->> 'nic_canonical', '');
  v_id uuid;
begin
  if not (public.is_staff() and public.has_permission('candidates.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_client from public.clients where id = nullif(p ->> 'client_id', '')::uuid and org_id = v_org;
  if v_client.id is null then raise exception 'client not found' using errcode = 'P0002'; end if;
  if v_client.status not in ('active', 'prospect') then
    raise exception 'this client is %; activate it before adding candidates', v_client.status using errcode = '22023';
  end if;
  if length(v_name) < 2 then raise exception 'enter the candidate''s full name' using errcode = '22023'; end if;

  if v_nic is not null then
    select id into v_id from public.candidates where org_id = v_org and nic_canonical = v_nic;
    if v_id is not null then return jsonb_build_object('candidate_id', v_id, 'reused', true); end if;
  end if;

  begin
    insert into public.candidates (org_id, full_name, nic, nic_canonical, date_of_birth, gender, email, phone, address, district,
                                   preferred_language, created_by, added_for_client_id)
    values (v_org, v_name, nullif(trim(p ->> 'nic'), ''), v_nic, nullif(p ->> 'date_of_birth', '')::date, nullif(p ->> 'gender', ''),
            nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'phone'), ''), nullif(trim(p ->> 'address'), ''),
            nullif(p ->> 'district', ''), coalesce(nullif(p ->> 'preferred_language', ''), 'en'), auth.uid(), v_client.id)
    returning id into v_id;
  exception when unique_violation then
    -- Two people entered the same NIC at the same moment.
    select id into v_id from public.candidates where org_id = v_org and nic_canonical = v_nic;
    return jsonb_build_object('candidate_id', v_id, 'reused', true);
  end;
  return jsonb_build_object('candidate_id', v_id, 'reused', false);
end $$;
revoke execute on function public.add_candidate(jsonb) from public, anon;
grant execute on function public.add_candidate(jsonb) to authenticated;
