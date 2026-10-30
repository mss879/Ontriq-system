-- =============================================================================
-- 0022_search.sql
-- Feature: global search for the ⌘K palette. One function searches cases,
-- candidates and clients. It runs as the caller (security invoker), so row
-- level security filters every branch: nobody finds what they cannot open.
-- Depends on: 0003_clients, 0006_cases.
-- =============================================================================

create index cases_search_ref_idx on public.cases using gin (lower(reference) extensions.gin_trgm_ops);
create index cases_search_name_idx on public.cases using gin (lower(candidate_name) extensions.gin_trgm_ops);
create index candidates_search_name_idx on public.candidates using gin (lower(full_name) extensions.gin_trgm_ops);
create index candidates_search_nic_idx on public.candidates (nic);
create index clients_search_name_idx on public.clients using gin (lower(name) extensions.gin_trgm_ops);

create or replace function public.search_everything(p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_raw text := lower(trim(coalesce(p_query, '')));
  v_pat text;
  v_lim int := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if length(v_raw) < 2 then return; end if;
  v_pat := '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select 'case'::text, c.id, c.reference, c.candidate_name || coalesce(' · ' || cl.name, ''), '/app/cases/' || c.id::text
      from public.cases c left join public.clients cl on cl.id = c.client_id
     where lower(c.reference) like v_pat or lower(c.candidate_name) like v_pat or lower(coalesce(c.client_reference, '')) like v_pat
     order by (lower(c.reference) = v_raw) desc, (lower(c.reference) like v_pat) desc, c.received_at desc
     limit v_lim;

  return query
    select 'candidate'::text, cd.id, cd.full_name, coalesce(cd.nic, 'No NIC on file'), '/app/candidates/' || cd.id::text
      from public.candidates cd
     where lower(cd.full_name) like v_pat or lower(coalesce(cd.nic, '')) like v_pat
     order by (lower(cd.full_name) like v_raw || '%') desc, cd.created_at desc
     limit v_lim;

  return query
    select 'client'::text, cl.id, cl.name, cl.code, '/app/clients/' || cl.id::text
      from public.clients cl
     where lower(cl.name) like v_pat or lower(cl.code) like v_pat
     order by (lower(cl.name) like v_raw || '%') desc, cl.name
     limit v_lim;
end $$;
revoke execute on function public.search_everything(text, int) from public, anon;
grant execute on function public.search_everything(text, int) to authenticated, service_role;
