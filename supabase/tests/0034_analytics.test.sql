\o /dev/null
-- Analytics (0034): who may read each summary, and the numbers on a small fixture.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3400000-0000-4000-8000-000000000001', 'admin34@ontriq.test', '{"full_name":"Anu Admin"}'),
  ('a3400000-0000-4000-8000-000000000002', 'ops34@ontriq.test', '{"full_name":"Ova Ops"}'),
  ('a3400000-0000-4000-8000-000000000003', 'verifier34@ontriq.test', '{"full_name":"Vasu Verifier"}'),
  ('a3400000-0000-4000-8000-000000000004', 'client34@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a3400000-0000-4000-8000-000000000005', 'relations34@ontriq.test', '{"full_name":"Ravi Relations"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a3400000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a3400000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('a3400000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a3400000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a3400000-0000-4000-8000-000000000005'::uuid, 'staff', null::uuid, 'client_relations')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';
insert into public.clients (id, org_id, name, code, status)
values ('a3400000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Analytics Test Co', 'ANLT34', 'active');

-- Two cases for the test client: one released on time (green), one open and overdue.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'a3400000-0000-4000-8000-0000000000c1', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'candidate', jsonb_build_object('full_name', 'Released Person')));
  perform set_config('t.done', r ->> 'case_id', false);
  r := public.create_case(jsonb_build_object('client_id', 'a3400000-0000-4000-8000-0000000000c1', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'candidate', jsonb_build_object('full_name', 'Open Person')));
  perform set_config('t.open', r ->> 'case_id', false);
end $$;
reset role;

-- Shape the history directly (triggers off) so the numbers are exact.
set local session_replication_role = replica;
update public.cases set received_at = now() - interval '5 days', stage = 'released', released_at = now() - interval '1 day',
       due_at = now(), final_result = 'green'
 where id = current_setting('t.done')::uuid;
delete from public.stage_history where case_id = current_setting('t.done')::uuid;
insert into public.stage_history (org_id, case_id, from_stage, to_stage, event, at) values
  ('00000000-0000-4000-8000-000000000001', current_setting('t.done')::uuid, null, 'documents', 'created', now() - interval '5 days'),
  ('00000000-0000-4000-8000-000000000001', current_setting('t.done')::uuid, 'documents', 'verification', 'x', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000001', current_setting('t.done')::uuid, 'verification', 'released', 'x', now() - interval '1 day');
update public.cases set received_at = now() - interval '3 days', due_at = now() - interval '1 day', stage = 'verification'
 where id = current_setting('t.open')::uuid;
update public.case_checks set assigned_to = 'a3400000-0000-4000-8000-000000000003', due_at = now() - interval '1 day', state = 'in_progress'
 where case_id = current_setting('t.open')::uuid;
update public.case_checks set assigned_to = 'a3400000-0000-4000-8000-000000000003', state = 'completed', completed_at = now() - interval '2 days'
 where case_id = current_setting('t.done')::uuid;

-- Money: one invoice 35 days late with a part payment, one paid this week.
insert into public.invoices (id, org_id, client_id, number, status, currency, issue_date, due_date, total, amount_paid, balance) values
  ('a3400000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', 'TEST34-1', 'partially_paid', 'LKR',
   current_date - 40, current_date - 35, 10000, 4000, 6000),
  ('a3400000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', 'TEST34-2', 'paid', 'LKR',
   current_date - 5, current_date + 25, 5000, 5000, 0),
  ('a3400000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', null, 'draft', 'LKR',
   current_date - 1, current_date + 29, 99999, 0, 99999);
insert into public.payments (org_id, client_id, invoice_id, amount, method, paid_on) values
  ('00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', 'a3400000-0000-4000-8000-0000000000e1', 4000, 'bank_transfer', current_date - 20),
  ('00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', 'a3400000-0000-4000-8000-0000000000e2', 5000, 'cheque', current_date - 2);
insert into public.credit_notes (org_id, client_id, invoice_id, number, amount, reason) values
  ('00000000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-0000000000c1', 'a3400000-0000-4000-8000-0000000000e1', 'TCN34-1', 250, 'Duplicate check');

-- AI: two runs on the released case, one elsewhere.
insert into public.ai_runs (org_id, capability, model, case_id, cost_usd, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'document.extract', 'claude-sonnet-5-5', current_setting('t.done')::uuid, 0.02, now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000001', 'case.postqc', 'claude-opus-5-5', current_setting('t.done')::uuid, 0.2, now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000001', 'assistant.staff', 'claude-sonnet-5-5', null, 0.03, now() - interval '1 day');
set local session_replication_role = origin;

-- ================================================================= refusals
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.analytics_operations(current_date - 30, current_date);
    raise exception 'TEST FAILED: a verifier read operations analytics';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analytics_revenue(current_date - 30, current_date);
    raise exception 'TEST FAILED: a verifier read revenue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analytics_ai(current_date - 30, current_date);
    raise exception 'TEST FAILED: a verifier read AI cost';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.analytics_operations(current_date - 30, current_date);
    raise exception 'TEST FAILED: a client read operations analytics';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.analytics_revenue(current_date - 30, current_date, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'TEST FAILED: a client read revenue';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================= operations
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare o jsonb; s jsonb;
begin
  begin
    perform public.analytics_operations(current_date, current_date - 1);
    raise exception 'TEST FAILED: a backwards period was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.analytics_operations(current_date - 2000, current_date);
    raise exception 'TEST FAILED: a five-year period was accepted';
  exception when sqlstate '22023' then null;
  end;
  o := public.analytics_operations(current_date - 30, current_date, 'a3400000-0000-4000-8000-0000000000c1');
  s := o -> 'summary';
  assert (s ->> 'received')::int = 2 and (s ->> 'released')::int = 1, 'volumes ' || s::text;
  assert (s ->> 'open_now')::int = 1 and (s ->> 'overdue_now')::int = 1, 'open and overdue ' || s::text;
  assert (s ->> 'sla_met')::int = 1 and (s ->> 'sla_missed')::int = 0, 'SLA ' || s::text;
  assert (s ->> 'avg_tat_hours')::numeric between 95.9 and 96.1, 'turnaround ' || (s ->> 'avg_tat_hours');
  assert (select sum((x ->> 'received')::int) from jsonb_array_elements(o -> 'weekly') x) = 2, 'weekly received';
  assert (select sum((x ->> 'released')::int) from jsonb_array_elements(o -> 'weekly') x) = 1, 'weekly released';
  assert jsonb_array_length(o -> 'weekly') between 5 and 6, 'one row per week, empty weeks included: ' || jsonb_array_length(o -> 'weekly');
  assert o -> 'by_stage' @> '[{"stage":"verification","count":1}]', 'by stage ' || (o -> 'by_stage')::text;
  assert o -> 'stage_hours' @> '[{"stage":"documents","samples":1}]' and o -> 'stage_hours' @> '[{"stage":"verification","samples":1}]', 'stage hours ' || (o -> 'stage_hours')::text;
  assert (select (x ->> 'avg_hours')::numeric from jsonb_array_elements(o -> 'stage_hours') x where x ->> 'stage' = 'verification') between 71.9 and 72.1, 'verification took three days';
  assert o -> 'result_mix' = '[{"result":"green","count":1}]', 'result mix ' || (o -> 'result_mix')::text;
  assert (o -> 'tat_by_package' -> 0 ->> 'released')::int = 1, 'turnaround by package';
  assert o -> 'officers' @> '[{"user_id":"a3400000-0000-4000-8000-000000000003"}]', 'officer missing';
  assert (select (x ->> 'overdue_checks')::int > 0 and (x ->> 'completed')::int > 0 from jsonb_array_elements(o -> 'officers') x
           where x ->> 'user_id' = 'a3400000-0000-4000-8000-000000000003'), 'officer numbers ' || (o -> 'officers')::text;
  assert o -> 'top_clients' @> '[{"name":"Analytics Test Co","received":2,"released":1,"open":1}]', 'top clients ' || (o -> 'top_clients')::text;
  -- Without the client filter the test client is one of several.
  assert (public.analytics_operations(current_date - 30, current_date) -> 'summary' ->> 'received')::int >= 2, 'org-wide volumes';
end $$;

-- ================================================================= revenue (finance: the admin)
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; s jsonb;
begin
  r := public.analytics_revenue(current_date - 60, current_date, 'a3400000-0000-4000-8000-0000000000c1');
  s := r -> 'summary';
  assert r ->> 'currency' = 'LKR', 'currency';
  assert (s ->> 'invoiced')::numeric = 15000 and (s ->> 'invoice_count')::int = 2, 'drafts must not count as invoiced: ' || s::text;
  assert (s ->> 'collected')::numeric = 9000 and (s ->> 'credited')::numeric = 250, 'collected and credited ' || s::text;
  assert (s ->> 'outstanding')::numeric = 6000 and (s ->> 'overdue')::numeric = 6000, 'receivables ' || s::text;
  assert r -> 'aging' @> '[{"bucket":"31-60","amount":6000,"invoices":1}]' and jsonb_array_length(r -> 'aging') = 5, 'aging ' || (r -> 'aging')::text;
  assert (select sum((x ->> 'invoiced')::numeric) from jsonb_array_elements(r -> 'monthly') x) = 15000, 'monthly invoiced';
  assert (select sum((x ->> 'collected')::numeric) from jsonb_array_elements(r -> 'monthly') x) = 9000, 'monthly collected';
  assert r -> 'top_outstanding' @> '[{"name":"Analytics Test Co","amount":6000}]', 'top outstanding';
  r := public.analytics_revenue(current_date - 10, current_date, 'a3400000-0000-4000-8000-0000000000c1');
  assert (r -> 'summary' ->> 'invoiced')::numeric = 5000 and (r -> 'summary' ->> 'collected')::numeric = 5000, 'a shorter period ' || (r -> 'summary')::text;
end $$;

-- Finance (client relations) reads revenue; an operations manager, who has analytics.read but no billing, doesn't.
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert (public.analytics_revenue(current_date - 60, current_date, 'a3400000-0000-4000-8000-0000000000c1') -> 'summary' ->> 'outstanding')::numeric = 6000, 'client relations reads revenue';
end $$;
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.analytics_revenue(current_date - 60, current_date);
  raise exception 'TEST FAILED: an operations manager read revenue';
exception when insufficient_privilege then null;
end $$;

-- ================================================================= AI cost
select set_config('request.jwt.claims', '{"sub":"a3400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare a jsonb;
begin
  a := public.analytics_ai(current_date - 30, current_date);
  assert (a -> 'summary' ->> 'cost_usd')::numeric >= 0.25, 'AI cost ' || (a -> 'summary')::text;
  assert jsonb_array_length(a -> 'daily') = 31, 'one row per day';
  assert a -> 'by_capability' @> '[{"key":"case.postqc"}]' and a -> 'by_model' @> '[{"model":"claude-opus-5-5"}]', 'AI breakdowns';
  assert (select label from jsonb_to_recordset(a -> 'by_capability') as x(key text, label text) where key = 'case.postqc') <> 'case.postqc', 'capability labels';
  assert (a -> 'summary' ->> 'released_cases')::int >= 1 and (a -> 'summary' ->> 'cost_per_released_case')::numeric > 0, 'cost per case';
end $$;
reset role;

rollback;
\echo '  ✓ analytics'
