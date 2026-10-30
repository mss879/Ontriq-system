-- =============================================================================
-- 0033_quote_fixes.sql
-- Fixes found while building the quotation screens (Phase 3):
--  * Reading a quotation no longer marks it viewed, so a link prefetch can't;
--    the portal page calls portal_mark_quote_viewed once it is on screen.
--  * Accepting two quotations on the same day no longer leaves price rows
--    that end before they start.
-- Depends on: 0014.
-- =============================================================================

-- One quote with its lines, tiers and client-facing text (never internal notes).
create or replace function public.portal_quote(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote and client_id = v_client and status in ('sent', 'viewed', 'accepted', 'declined', 'expired');
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  return public.portal_quote_row(q) || jsonb_build_object(
    'intro', q.intro, 'scope', q.scope, 'assumptions', q.assumptions, 'tat_text', q.tat_text, 'closing', q.closing,
    'declined_reason', q.declined_reason, 'expected_monthly_volume', q.expected_monthly_volume,
    'can_accept', public.has_permission('portal.quotes.accept'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'kind', i.kind, 'quantity', i.quantity,
                                                           'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'total', i.total) order by i.sort)
                         from public.quote_items i where i.quote_id = q.id), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('min_volume', t.min_volume, 'max_volume', t.max_volume,
                                                           'discount_pct', t.discount_pct, 'note', t.note) order by t.min_volume)
                         from public.quote_tiers t where t.quote_id = q.id), '[]'::jsonb),
    'client_name', (select name from public.clients where id = q.client_id));
end $$;
revoke execute on function public.portal_quote(uuid) from public, anon;
grant execute on function public.portal_quote(uuid) to authenticated, service_role;

create or replace function public.portal_mark_quote_viewed(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  v_id uuid;
begin
  update public.quotes set status = 'viewed', viewed_at = now()
   where id = p_quote and client_id = v_client and status = 'sent'
  returning id into v_id;
  if v_id is not null then perform public.log_quote_event(v_id, 'viewed', null, 'client'); end if;
end $$;
revoke execute on function public.portal_mark_quote_viewed(uuid) from public, anon;
grant execute on function public.portal_mark_quote_viewed(uuid) to authenticated, service_role;

create or replace function public.portal_accept_quote(p_quote uuid, p_name text, p_ip text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.quotes.accept');
  q public.quotes;
  v_today date := (now() at time zone 'Asia/Colombo')::date;
begin
  select * into q from public.quotes where id = p_quote and client_id = v_client for update;
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if q.status not in ('sent', 'viewed') then raise exception 'this quotation can no longer be accepted' using errcode = '22023'; end if;
  if q.valid_until < v_today then raise exception 'this quotation has expired; ask Ontriq for a new one' using errcode = '22023'; end if;
  if length(coalesce(trim(p_name), '')) < 3 then raise exception 'type your full name to accept' using errcode = '22023'; end if;
  update public.quotes set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), accepted_name = trim(p_name), accepted_ip = left(p_ip, 64)
   where id = q.id;
  -- Older open prices for the same checks and packages end yesterday; ones that
  -- only started today end today (contracted_price takes the newest of those).
  update public.client_price_lists p set valid_to = greatest(v_today - 1, p.valid_from)
   where p.client_id = q.client_id and p.valid_to is null
     and (p.check_type_id in (select check_type_id from public.quote_items where quote_id = q.id and check_type_id is not null)
          or p.package_id in (select package_id from public.quote_items where quote_id = q.id and package_id is not null));
  insert into public.client_price_lists (org_id, client_id, check_type_id, package_id, unit_price, currency, source_quote_id, valid_from, created_by)
  select q.org_id, q.client_id, case when i.kind = 'check' then i.check_type_id end, case when i.kind = 'package' then i.package_id end,
         round(i.unit_price * (1 - i.discount_pct / 100), 2), q.currency, q.id, v_today, auth.uid()
    from public.quote_items i
   where i.quote_id = q.id and ((i.kind = 'check' and i.check_type_id is not null) or (i.kind = 'package' and i.package_id is not null));
  update public.clients set status = 'active', payment_terms_days = q.payment_terms_days where id = q.client_id and status = 'prospect';
  perform public.log_quote_event(q.id, 'accepted', trim(p_name), 'client');
  if q.created_by is not null then
    perform public.notify_users(array[q.created_by], 'quote.accepted', 'Quotation ' || q.number || ' accepted',
      (select name from public.clients where id = q.client_id), '/app/quotes/' || q.id, true, 'quote', q.id, q.org_id);
  end if;
end $$;
revoke execute on function public.portal_accept_quote(uuid, text, text) from public, anon;
grant execute on function public.portal_accept_quote(uuid, text, text) to authenticated, service_role;
