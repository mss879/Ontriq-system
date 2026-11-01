-- 0045: search matches each word, not the whole phrase. "Nimali Perera" now
-- finds Nimali Sanduni Perera, in the search box and in Ask Ontriq, where
-- people leave out middle names and ge-names. Found by the AI evaluation.

create or replace function public.search_everything(p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_raw text := lower(trim(coalesce(p_query, '')));
  v_pat text;
  v_words text[];
  v_lim int := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if length(v_raw) < 2 then return; end if;
  v_pat := '%' || replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_words := array(
    select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      from regexp_split_to_table(v_raw, '\s+') as w
     where w <> ''
  );

  return query
    select 'case'::text, c.id, c.reference, c.candidate_name || coalesce(' · ' || cl.name, ''), '/app/cases/' || c.id::text
      from public.cases c left join public.clients cl on cl.id = c.client_id
     where lower(c.reference) like v_pat or lower(c.candidate_name) like all (v_words) or lower(coalesce(c.client_reference, '')) like v_pat
     order by (lower(c.reference) = v_raw) desc, (lower(c.reference) like v_pat) desc, c.received_at desc
     limit v_lim;

  return query
    select 'candidate'::text, cd.id, cd.full_name, coalesce(cd.nic, 'No NIC on file'), '/app/candidates/' || cd.id::text
      from public.candidates cd
     where lower(cd.full_name) like all (v_words) or lower(coalesce(cd.nic, '')) like v_pat
     order by (lower(cd.full_name) like v_raw || '%') desc, cd.created_at desc
     limit v_lim;

  return query
    select 'client'::text, cl.id, cl.name, cl.code, '/app/clients/' || cl.id::text
      from public.clients cl
     where lower(cl.name) like all (v_words) or lower(cl.code) like v_pat
     order by (lower(cl.name) like v_raw || '%') desc, cl.name
     limit v_lim;
end $$;
revoke execute on function public.search_everything(text, int) from public, anon;
grant execute on function public.search_everything(text, int) to authenticated, service_role;
