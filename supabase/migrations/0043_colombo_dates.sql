-- =============================================================================
-- 0043_colombo_dates.sql
-- The hosted database runs in UTC, and Sri Lanka is 5.5 hours ahead. Between
-- midnight and 05:30 in Colombo, "today" in UTC is still yesterday, so a price
-- accepted in those hours (valid from Colombo's today) wasn't found by a lookup
-- that defaulted to the UTC date. Dates that mean a business day now use Colombo.
-- Depends on: 0014, 0018.
-- =============================================================================

create or replace function public.contracted_price(p_client uuid, p_check uuid, p_package uuid, p_on date default ((now() at time zone 'Asia/Colombo')::date)) returns numeric
language sql stable security definer set search_path = '' as $$
  select p.unit_price from public.client_price_lists p
   where p.client_id = p_client
     and (p.check_type_id = p_check or p.package_id = p_package)
     and p.valid_from <= p_on and (p.valid_to is null or p.valid_to >= p_on)
   order by p.valid_from desc, p.created_at desc limit 1
$$;
revoke execute on function public.contracted_price(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.contracted_price(uuid, uuid, uuid, date) to authenticated, service_role;

alter table public.client_price_lists alter column valid_from set default ((now() at time zone 'Asia/Colombo')::date);
