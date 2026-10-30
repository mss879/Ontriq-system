-- =============================================================================
-- 0034_analytics.sql
-- Feature: Analytics (plan §10.1, Phase 5). Three read-only summaries for the
-- Analytics page and its CSV exports: operations (volumes, turnaround, SLA,
-- results, workload), revenue (invoiced, collected, receivables and aging)
-- and AI cost. Each is one call returning jsonb, computed in the database so
-- no rows leave it, bucketed by Sri Lanka time, for the caller's org only.
-- Who may call:
--   operations: staff with analytics.read
--   revenue:    staff with billing.export or invoices.manage (finance only)
--   AI cost:    staff with analytics.read or ai.usage.read
-- Depends on: 0006, 0015, 0018.
-- =============================================================================

-- The period as Colombo-local instants: [from 00:00, to + 1 day 00:00).
create or replace function public.analytics_window(p_from date, p_to date) returns tstzrange
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'choose a start date on or before the end date' using errcode = '22023'; end if;
  if p_to - p_from > 1100 then raise exception 'choose a period of three years or less' using errcode = '22023'; end if;
  return tstzrange((p_from::timestamp at time zone 'Asia/Colombo'), ((p_to + 1)::timestamp at time zone 'Asia/Colombo'), '[)');
end $$;
revoke execute on function public.analytics_window(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create or replace function public.analytics_operations(p_from date, p_to date, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  w tstzrange;
  v_out jsonb;
begin
  if not (public.is_staff() and public.has_permission('analytics.read')) then raise exception 'not allowed' using errcode = '42501'; end if;
  w := public.analytics_window(p_from, p_to);

  with c as (
    select * from public.cases where org_id = v_org and (p_client is null or client_id = p_client)
  ),
  released as (
    select c.*, extract(epoch from c.released_at - c.received_at) / 3600.0 as tat_hours
      from c where c.stage = 'released' and c.released_at <@ w
  ),
  weeks as (
    select generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '1 week')::date as week
  ),
  hist as (
    select h.case_id, h.to_stage, h.at,
           lead(h.at) over (partition by h.case_id order by h.at, h.id) as left_at
      from public.stage_history h join c on c.id = h.case_id
  ),
  stays as (
    select to_stage, extract(epoch from left_at - at) / 3600.0 as hours
      from hist where left_at is not null and at <@ w and to_stage not in ('released', 'cancelled')
  ),
  open_checks as (
    select k.assigned_to, k.due_at
      from public.case_checks k join c on c.id = k.case_id
     where k.assigned_to is not null and c.stage not in ('released', 'cancelled')
       and k.state not in ('completed', 'discrepancy', 'unable_to_verify', 'waived')
  ),
  done_checks as (
    select k.assigned_to from public.case_checks k join c on c.id = k.case_id
     where k.assigned_to is not null and k.completed_at <@ w and k.state in ('completed', 'discrepancy', 'unable_to_verify')
  ),
  officers as (
    select u.user_id,
           count(*) filter (where u.kind = 'open') as open_checks,
           count(*) filter (where u.kind = 'open' and u.due_at < now()) as overdue_checks,
           count(*) filter (where u.kind = 'done') as completed
      from (select assigned_to as user_id, 'open' as kind, due_at from open_checks
            union all select assigned_to, 'done', null::timestamptz from done_checks) u
     group by u.user_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'summary', jsonb_build_object(
      'received', (select count(*) from c where c.received_at <@ w),
      'released', (select count(*) from released),
      'cancelled', (select count(*) from c where c.stage = 'cancelled' and c.cancelled_at <@ w),
      'open_now', (select count(*) from c where c.stage not in ('released', 'cancelled')),
      'overdue_now', (select count(*) from c where c.stage not in ('released', 'cancelled') and not c.on_hold and c.due_at < now()),
      'on_hold_now', (select count(*) from c where c.stage not in ('released', 'cancelled') and c.on_hold),
      'avg_tat_hours', (select round(avg(tat_hours)::numeric, 1) from released),
      'median_tat_hours', (select round((percentile_cont(0.5) within group (order by tat_hours))::numeric, 1) from released),
      'sla_met', (select count(*) from released where due_at is not null and released_at <= due_at),
      'sla_missed', (select count(*) from released where due_at is not null and released_at > due_at)),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', wk.week,
               'received', (select count(*) from c where (c.received_at at time zone 'Asia/Colombo')::date >= wk.week
                              and (c.received_at at time zone 'Asia/Colombo')::date < wk.week + 7 and c.received_at <@ w),
               'released', (select count(*) from released r where (r.released_at at time zone 'Asia/Colombo')::date >= wk.week
                              and (r.released_at at time zone 'Asia/Colombo')::date < wk.week + 7))
             order by wk.week)
        from weeks wk), '[]'::jsonb),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('stage', s.stage, 'count', s.n, 'on_hold', s.held) order by s.stage)
        from (select c.stage, count(*) as n, count(*) filter (where c.on_hold) as held
                from c where c.stage not in ('released', 'cancelled') group by c.stage) s), '[]'::jsonb),
    'stage_hours', coalesce((
      select jsonb_agg(jsonb_build_object('stage', s.to_stage, 'avg_hours', s.avg_h, 'median_hours', s.med_h, 'samples', s.n) order by s.to_stage)
        from (select to_stage, round(avg(hours)::numeric, 1) as avg_h,
                     round((percentile_cont(0.5) within group (order by hours))::numeric, 1) as med_h, count(*) as n
                from stays group by to_stage) s), '[]'::jsonb),
    'tat_by_package', coalesce((
      select jsonb_agg(jsonb_build_object('package', p.name, 'released', p.n, 'avg_hours', p.avg_h, 'median_hours', p.med_h,
                                          'sla_met', p.met, 'sla_missed', p.missed) order by p.n desc, p.name)
        from (select coalesce(nullif(r.package_snapshot ->> 'name', ''), 'Custom selection') as name, count(*) as n,
                     round(avg(r.tat_hours)::numeric, 1) as avg_h,
                     round((percentile_cont(0.5) within group (order by r.tat_hours))::numeric, 1) as med_h,
                     count(*) filter (where r.due_at is not null and r.released_at <= r.due_at) as met,
                     count(*) filter (where r.due_at is not null and r.released_at > r.due_at) as missed
                from released r group by 1) p), '[]'::jsonb),
    'result_mix', coalesce((
      select jsonb_agg(jsonb_build_object('result', m.result, 'count', m.n)
                       order by array_position(array['green', 'amber', 'red', 'none'], m.result))
        from (select coalesce(r.final_result, 'none') as result, count(*) as n from released r group by 1) m), '[]'::jsonb),
    'officers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', coalesce(pr.full_name, pr.email, 'Team member'),
                                          'open_checks', o.open_checks, 'overdue_checks', o.overdue_checks, 'completed', o.completed)
                       order by o.open_checks desc, o.overdue_checks desc, coalesce(pr.full_name, pr.email))
        from officers o left join public.profiles pr on pr.id = o.user_id), '[]'::jsonb),
    'top_clients', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', t.client_id, 'name', t.name, 'received', t.received, 'released', t.released, 'open', t.open)
                       order by t.received desc, t.name)
        from (select cl.id as client_id, cl.name,
                     count(*) filter (where c.received_at <@ w) as received,
                     count(*) filter (where c.stage = 'released' and c.released_at <@ w) as released,
                     count(*) filter (where c.stage not in ('released', 'cancelled')) as open
                from c join public.clients cl on cl.id = c.client_id
               group by cl.id, cl.name
              having count(*) filter (where c.received_at <@ w) > 0 or count(*) filter (where c.stage not in ('released', 'cancelled')) > 0
               order by 3 desc, 2 limit 10) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.analytics_operations(date, date, uuid) from public, anon;
grant execute on function public.analytics_operations(date, date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Revenue and receivables
-- ---------------------------------------------------------------------------
create or replace function public.analytics_revenue(p_from date, p_to date, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  v_today date := (now() at time zone 'Asia/Colombo')::date;
  v_currency text;
  v_out jsonb;
begin
  if not (public.is_staff() and (public.has_permission('billing.export') or public.has_permission('invoices.manage'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.analytics_window(p_from, p_to);
  -- One currency per report: the organisation's main one (LKR unless most invoices say otherwise).
  select coalesce((select i.currency from public.invoices i where i.org_id = v_org and i.number is not null
                    group by i.currency order by count(*) desc, i.currency limit 1), 'LKR') into v_currency;

  with inv as (
    select i.* from public.invoices i
     where i.org_id = v_org and i.number is not null and i.status not in ('draft', 'void') and i.currency = v_currency
       and (p_client is null or i.client_id = p_client)
  ),
  issued as (select * from inv where issue_date between p_from and p_to),
  open_inv as (
    select inv.*, case when inv.due_date is null or inv.due_date >= v_today then 0 else v_today - inv.due_date end as days_late
      from inv where inv.status in ('confirmed', 'sent', 'viewed', 'partially_paid') and inv.balance > 0
  ),
  pay as (
    select p.* from public.payments p join public.invoices i on i.id = p.invoice_id
     where p.org_id = v_org and p.voided_at is null and i.currency = v_currency and p.paid_on between p_from and p_to
       and (p_client is null or p.client_id = p_client)
  ),
  credits as (
    select n.* from public.credit_notes n join public.invoices i on i.id = n.invoice_id
     where n.org_id = v_org and n.status = 'issued' and i.currency = v_currency
       and (n.created_at at time zone 'Asia/Colombo')::date between p_from and p_to
       and (p_client is null or n.client_id = p_client)
  ),
  months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') m
  ),
  buckets as (
    select * from (values (1, 'current'), (2, '1-30'), (3, '31-60'), (4, '61-90'), (5, '90+')) b(ord, bucket)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', v_currency,
    'other_currency_invoices', (select count(*) from public.invoices i where i.org_id = v_org and i.number is not null
                                  and i.status not in ('draft', 'void') and i.currency <> v_currency
                                  and (p_client is null or i.client_id = p_client)),
    'summary', jsonb_build_object(
      'invoiced', coalesce((select sum(total) from issued), 0),
      'invoice_count', (select count(*) from issued),
      'collected', coalesce((select sum(amount) from pay), 0),
      'payment_count', (select count(*) from pay),
      'credited', coalesce((select sum(amount) from credits), 0),
      'outstanding', coalesce((select sum(balance) from open_inv), 0),
      'overdue', coalesce((select sum(balance) from open_inv where days_late > 0), 0),
      'open_invoices', (select count(*) from open_inv)),
    'aging', (
      select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'amount', coalesce(a.amount, 0), 'invoices', coalesce(a.n, 0)) order by b.ord)
        from buckets b
        left join (select case when days_late = 0 then 'current' when days_late <= 30 then '1-30' when days_late <= 60 then '31-60'
                               when days_late <= 90 then '61-90' else '90+' end as bucket,
                          sum(balance) as amount, count(*) as n
                     from open_inv group by 1) a on a.bucket = b.bucket),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
               'month', m.month,
               'invoiced', coalesce((select sum(total) from issued where to_char(issue_date, 'YYYY-MM') = m.month), 0),
               'collected', coalesce((select sum(amount) from pay where to_char(paid_on, 'YYYY-MM') = m.month), 0))
             order by m.month)
        from months m),
    'top_billed', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', t.client_id, 'name', t.name, 'amount', t.amount, 'invoices', t.n) order by t.amount desc, t.name)
        from (select cl.id as client_id, cl.name, sum(i.total) as amount, count(*) as n
                from issued i join public.clients cl on cl.id = i.client_id
               group by cl.id, cl.name order by 3 desc, 2 limit 10) t), '[]'::jsonb),
    'top_outstanding', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', t.client_id, 'name', t.name, 'amount', t.amount, 'overdue', t.overdue, 'invoices', t.n)
                       order by t.amount desc, t.name)
        from (select cl.id as client_id, cl.name, sum(o.balance) as amount, sum(o.balance) filter (where o.days_late > 0) as overdue, count(*) as n
                from open_inv o join public.clients cl on cl.id = o.client_id
               group by cl.id, cl.name order by 3 desc, 2 limit 10) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.analytics_revenue(date, date, uuid) from public, anon;
grant execute on function public.analytics_revenue(date, date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- AI cost
-- ---------------------------------------------------------------------------
create or replace function public.analytics_ai(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.auth_org_id();
  w tstzrange;
  v_out jsonb;
begin
  if not (public.is_staff() and (public.has_permission('analytics.read') or public.has_permission('ai.usage.read'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  w := public.analytics_window(p_from, p_to);

  with runs as (
    select * from public.ai_runs r where r.org_id = v_org and r.created_at <@ w
  ),
  released as (
    select c.id from public.cases c where c.org_id = v_org and c.stage = 'released' and c.released_at <@ w
  ),
  case_cost as (
    -- Every AI call ever made for the cases released in the period, so a case's whole journey counts.
    select coalesce(sum(r.cost_usd), 0) as cost from public.ai_runs r where r.org_id = v_org and r.case_id in (select id from released)
  ),
  days as (
    select generate_series(p_from::timestamp, p_to::timestamp, interval '1 day')::date as day
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'summary', jsonb_build_object(
      'cost_usd', coalesce((select round(sum(cost_usd), 4) from runs), 0),
      'runs', (select count(*) from runs),
      'failed_runs', (select count(*) from runs where status <> 'ok'),
      'input_tokens', coalesce((select sum(input_tokens) from runs), 0),
      'output_tokens', coalesce((select sum(output_tokens) from runs), 0),
      'cache_read_tokens', coalesce((select sum(cache_read_tokens) from runs), 0),
      'released_cases', (select count(*) from released),
      'cost_per_released_case', case when (select count(*) from released) = 0 then null
                                     else round((select cost from case_cost) / (select count(*) from released), 4) end),
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'cost_usd', coalesce((select round(sum(cost_usd), 4) from runs where (created_at at time zone 'Asia/Colombo')::date = d.day), 0),
               'runs', (select count(*) from runs where (created_at at time zone 'Asia/Colombo')::date = d.day))
             order by d.day)
        from days d),
    'by_capability', coalesce((
      select jsonb_agg(jsonb_build_object('key', x.capability, 'label', coalesce(cap.label, x.capability), 'runs', x.n, 'cost_usd', x.cost,
                                          'input_tokens', x.inp, 'output_tokens', x.outp) order by x.cost desc, x.capability)
        from (select capability, count(*) as n, round(sum(cost_usd), 4) as cost, sum(input_tokens) as inp, sum(output_tokens) as outp
                from runs group by capability) x
        left join public.ai_capabilities cap on cap.key = x.capability), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(jsonb_build_object('model', x.model, 'runs', x.n, 'cost_usd', x.cost) order by x.cost desc, x.model)
        from (select model, count(*) as n, round(sum(cost_usd), 4) as cost from runs group by model) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.analytics_ai(date, date) from public, anon;
grant execute on function public.analytics_ai(date, date) to authenticated, service_role;
