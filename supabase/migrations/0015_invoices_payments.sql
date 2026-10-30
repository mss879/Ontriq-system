-- =============================================================================
-- 0015_invoices_payments.sql
-- Feature: invoicing and payments. Invoices are drafted per case when its
-- report is released (billing policy per_case_on_release) or monthly for a
-- client (monthly_consolidated), priced from the client's contracted prices
-- (0014) or the package snapshot taken when the case was opened. Staff review
-- the draft, confirm it (number INV-YYYY-NNNN, taxes from tax_rates frozen on
-- the invoice, due date from the client's terms, PDF by document.render) and
-- send it. Payments are recorded by staff, or a client uploads a payment slip
-- in the portal which staff match to the invoice (AI reads slips in Phase 4).
-- Credit notes reduce what is owed; nothing is deleted (void instead).
-- The reminder ladder and statements read the functions at the end.
-- Depends on: 0003, 0006, 0013, 0014. Calls 0009 and 0010 at run time.
-- =============================================================================

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  name text not null,
  rate numeric(6, 3) not null check (rate >= 0 and rate < 100),
  inclusive boolean not null default false,
  is_active boolean not null default false,
  sort int not null default 100,
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create trigger a_set_org_id before insert on public.tax_rates
  for each row execute function public.set_org_id();
create trigger tax_rates_updated_at before update on public.tax_rates
  for each row execute function public.set_updated_at();
-- Sri Lanka: VAT 18% and SSCL 2.5%. Off until Ontriq confirms how they apply (plan §22).
insert into public.tax_rates (org_id, code, name, rate, inclusive, is_active, sort)
select o.id, x.code, x.name, x.rate, false, false, x.sort
  from public.orgs o
 cross join (values ('VAT', 'Value Added Tax', 18.0, 10), ('SSCL', 'Social Security Contribution Levy', 2.5, 20)) as x(code, name, rate, sort)
on conflict (org_id, code) do nothing;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  contact_id uuid references public.client_contacts (id) on delete set null,
  number text,
  kind text not null default 'case' check (kind in ('case', 'monthly', 'manual')),
  source_key text,                     -- case:<id> or monthly:<client>:<yyyy-mm>; makes drafting idempotent
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'sent', 'viewed', 'partially_paid', 'paid', 'void')),
  template_key text not null default 'executive' check (template_key in ('executive', 'modern', 'classic')),
  currency text not null default 'LKR',
  issue_date date,
  due_date date,
  period_from date,
  period_to date,
  message text not null default '',    -- printed on the invoice
  internal_notes text not null default '',
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  net_total numeric(14, 2) not null default 0,
  tax_lines jsonb not null default '[]'::jsonb,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  amount_credited numeric(14, 2) not null default 0,
  balance numeric(14, 2) not null default 0,
  document_id uuid references public.generated_documents (id) on delete set null,
  reminders_paused boolean not null default false,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);
create unique index invoices_source_key_uq on public.invoices (org_id, source_key) where source_key is not null and status <> 'void';
create index invoices_org_idx on public.invoices (org_id, created_at desc);
create index invoices_client_idx on public.invoices (client_id, issue_date desc);
create index invoices_open_idx on public.invoices (org_id, due_date) where status in ('sent', 'viewed', 'partially_paid');
create index invoices_contact_idx on public.invoices (contact_id);
create index invoices_document_idx on public.invoices (document_id);
create index invoices_confirmed_by_idx on public.invoices (confirmed_by);
create index invoices_created_by_idx on public.invoices (created_by);
create trigger a_set_org_id before insert on public.invoices
  for each row execute function public.set_org_id();
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sort int not null default 100,
  case_id uuid references public.cases (id) on delete set null,
  case_check_id uuid references public.case_checks (id) on delete set null,
  description text not null,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  total numeric(14, 2) not null default 0
);
create index invoice_items_org_idx on public.invoice_items (org_id);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort);
create index invoice_items_case_idx on public.invoice_items (case_id);
create index invoice_items_check_idx on public.invoice_items (case_check_id);
create trigger a_set_org_id before insert on public.invoice_items
  for each row execute function public.set_org_id();

create table public.payment_slips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete set null,      -- the invoice the client says it pays
  storage_bucket text not null default 'documents',
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  sha256 text,
  status text not null default 'pending_upload' check (status in ('pending_upload', 'pending', 'matched', 'rejected')),
  client_note text,
  ai_extraction jsonb not null default '{}'::jsonb,
  rejection_reason text,
  uploaded_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index payment_slips_org_idx on public.payment_slips (org_id, status, created_at desc);
create index payment_slips_client_idx on public.payment_slips (client_id);
create index payment_slips_invoice_idx on public.payment_slips (invoice_id);
create index payment_slips_uploaded_by_idx on public.payment_slips (uploaded_by);
create index payment_slips_reviewed_by_idx on public.payment_slips (reviewed_by);
create trigger a_set_org_id before insert on public.payment_slips
  for each row execute function public.set_org_id();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('bank_transfer', 'cheque', 'cash', 'card', 'online', 'other')),
  reference text,
  paid_on date not null,
  notes text,
  slip_id uuid references public.payment_slips (id) on delete set null,
  receipt_number text,
  receipt_document_id uuid references public.generated_documents (id) on delete set null,
  recorded_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);
create index payments_org_idx on public.payments (org_id, paid_on desc);
create index payments_client_idx on public.payments (client_id, paid_on desc);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_slip_idx on public.payments (slip_id);
create index payments_receipt_document_idx on public.payments (receipt_document_id);
create index payments_recorded_by_idx on public.payments (recorded_by);
create trigger a_set_org_id before insert on public.payments
  for each row execute function public.set_org_id();

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  number text not null,
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null,
  status text not null default 'issued' check (status in ('issued', 'void')),
  document_id uuid references public.generated_documents (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index credit_notes_client_idx on public.credit_notes (client_id);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);
create index credit_notes_document_idx on public.credit_notes (document_id);
create index credit_notes_created_by_idx on public.credit_notes (created_by);
create trigger a_set_org_id before insert on public.credit_notes
  for each row execute function public.set_org_id();

create table public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  step text not null,                 -- before_due, due, late_7, late_14, escalated
  sent_at timestamptz not null default now(),
  to_emails text[] not null default '{}',
  unique (invoice_id, step)
);
create index invoice_reminders_org_idx on public.invoice_reminders (org_id, sent_at desc);

create table public.invoice_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind text not null,
  body text,
  amount numeric(14, 2),
  actor_id uuid references auth.users (id) on delete set null,
  actor_kind text not null default 'staff' check (actor_kind in ('staff', 'client', 'system')),
  at timestamptz not null default now()
);
create index invoice_events_org_idx on public.invoice_events (org_id, at desc);
create index invoice_events_invoice_idx on public.invoice_events (invoice_id, at);
create index invoice_events_actor_idx on public.invoice_events (actor_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.log_invoice_event(p_invoice uuid, p_kind text, p_body text default null, p_amount numeric default null, p_actor_kind text default 'staff')
returns void
language sql security definer set search_path = '' as $$
  insert into public.invoice_events (org_id, invoice_id, kind, body, amount, actor_id, actor_kind)
  select i.org_id, i.id, p_kind, p_body, p_amount, auth.uid(), p_actor_kind from public.invoices i where i.id = p_invoice
$$;
revoke execute on function public.log_invoice_event(uuid, text, text, numeric, text) from public, anon, authenticated;

create or replace function public.can_read_invoices() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (public.has_permission('invoices.manage') or public.has_permission('invoices.send')
                                or public.has_permission('payments.record') or public.has_permission('billing.export'))
$$;
revoke execute on function public.can_read_invoices() from public, anon;
grant execute on function public.can_read_invoices() to authenticated, service_role;

-- Totals, taxes, paid and balance (mirrors src/domain/pricing/invoice-core.ts).
-- Drafts take the current active tax rates; confirmed invoices keep the rates frozen in tax_lines.
create or replace function public.recompute_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_gross numeric;
  v_net numeric;
  v_lines jsonb;
  v_tax numeric := 0;
  v_incl numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_credit numeric;
  t record;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null then return; end if;
  if i.status = 'draft' then   -- confirmed lines are final
    update public.invoice_items set total = round(quantity * unit_price * (1 - discount_pct / 100), 2) where invoice_id = i.id;
  end if;
  select coalesce(round(sum(quantity * unit_price), 2), 0), coalesce(round(sum(total), 2), 0) into v_gross, v_net
    from public.invoice_items where invoice_id = i.id;

  if i.status = 'draft' then
    v_lines := '[]'::jsonb;
    for t in select code, name, rate, inclusive from public.tax_rates where org_id = i.org_id and is_active order by sort loop
      v_lines := v_lines || jsonb_build_object('code', t.code, 'name', t.name, 'rate', t.rate, 'inclusive', t.inclusive,
        'amount', case when t.inclusive then round(v_net - v_net / (1 + t.rate / 100), 2) else round(v_net * t.rate / 100, 2) end);
    end loop;
  else
    v_lines := i.tax_lines;
  end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0), coalesce(sum((x ->> 'amount')::numeric) filter (where (x ->> 'inclusive')::boolean), 0)
    into v_tax, v_incl from jsonb_array_elements(v_lines) x;
  v_total := v_net + v_tax - v_incl;   -- inclusive taxes are already inside the net amount
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = i.id and voided_at is null;
  select coalesce(sum(amount), 0) into v_credit from public.credit_notes where invoice_id = i.id and status = 'issued';

  update public.invoices
     set subtotal = v_gross, discount_total = v_gross - v_net, net_total = v_net, tax_lines = v_lines, tax_total = v_tax,
         total = v_total, amount_paid = v_paid, amount_credited = v_credit, balance = greatest(v_total - v_paid - v_credit, 0),
         status = case
           when status in ('draft', 'void') then status
           when v_total > 0 and v_total - v_paid - v_credit <= 0.004 then 'paid'
           when v_paid + v_credit > 0 then 'partially_paid'
           when sent_at is null then 'confirmed'
           when viewed_at is not null then 'viewed'
           else 'sent' end,
         paid_at = case when status not in ('draft', 'void') and v_total > 0 and v_total - v_paid - v_credit <= 0.004 then coalesce(paid_at, now()) else null end
   where id = i.id;
end $$;
revoke execute on function public.recompute_invoice(uuid) from public, anon, authenticated;

create or replace function public.invoice_items_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger invoice_items_after_change after insert or update of quantity, unit_price, discount_pct or delete on public.invoice_items
  for each row when (pg_trigger_depth() < 1) execute function public.invoice_items_after_change();
revoke execute on function public.invoice_items_after_change() from public, anon, authenticated;

-- Only drafts change; afterwards credit notes and payments do the talking.
create or replace function public.invoices_freeze_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_table_name = 'invoices' then
    if old.status <> 'draft' and (new.message, new.client_id, new.template_key, new.period_from, new.period_to, new.contact_id)
       is distinct from (old.message, old.client_id, old.template_key, old.period_from, old.period_to, old.contact_id) then
      raise exception 'this invoice is confirmed; issue a credit note or void it instead' using errcode = '22023';
    end if;
    return new;
  end if;
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then
    raise exception 'this invoice is confirmed; issue a credit note or void it instead' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger invoices_freeze_guard before update on public.invoices
  for each row execute function public.invoices_freeze_guard();
create trigger invoice_items_freeze_guard before insert or update or delete on public.invoice_items
  for each row execute function public.invoices_freeze_guard();
revoke execute on function public.invoices_freeze_guard() from public, anon, authenticated;

-- One case as invoice lines: a fixed-price package is one line; otherwise one
-- line per counted check. Contracted price on the date the case was received,
-- else the price captured when the case was opened.
create or replace function public.case_invoice_lines(p_case uuid) returns table (
  case_id uuid, case_check_id uuid, description text, unit_price numeric, sort int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.cases;
  v_on date;
  v_snap jsonb;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return; end if;
  v_on := (c.received_at at time zone 'Asia/Colombo')::date;
  v_snap := c.package_snapshot;
  if v_snap ->> 'pricing_mode' = 'fixed' and c.package_id is not null then
    return query select c.id, null::uuid,
      coalesce(v_snap ->> 'name', 'Verification package') || ' · ' || c.reference || ' · ' || c.candidate_name,
      coalesce(public.contracted_price(c.client_id, null, c.package_id, v_on), (v_snap ->> 'fixed_price')::numeric, 0), 10;
    return;
  end if;
  return query
    select c.id, k.id, k.label || ' · ' || c.reference || ' · ' || c.candidate_name,
           coalesce(public.contracted_price(c.client_id, k.check_type_id, null, v_on),
                    (select (it ->> 'unit_price')::numeric from jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) it
                      where it ->> 'check_type_id' = k.check_type_id::text limit 1), 0),
           k.sort
      from public.case_checks k
     where k.case_id = c.id and k.state <> 'waived'
     order by k.sort;
end $$;
revoke execute on function public.case_invoice_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Drafting (the invoice.draft job, or staff)
-- ---------------------------------------------------------------------------
create or replace function public.draft_case_invoice(p_case uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
  cl public.clients;
  v_id uuid;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('invoices.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into c from public.cases where id = p_case;
  if c.id is null or (auth.uid() is not null and c.org_id <> public.auth_org_id()) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if c.stage <> 'released' then raise exception 'cases are invoiced once their report is released' using errcode = '22023'; end if;
  select * into cl from public.clients where id = c.client_id;
  select id into v_id from public.invoices where org_id = c.org_id and source_key = 'case:' || c.id and status <> 'void';
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void') then
    return null;   -- already billed on another invoice (e.g. monthly)
  end if;
  insert into public.invoices (org_id, client_id, kind, source_key, template_key, currency, contact_id, created_by)
  values (c.org_id, c.client_id, 'case', 'case:' || c.id, coalesce(nullif(cl.default_template, ''), 'executive'),
          coalesce(c.package_snapshot ->> 'currency', 'LKR'),
          (select id from public.client_contacts where client_id = c.client_id and receives_invoices order by is_primary desc, created_at limit 1),
          auth.uid())
  returning id into v_id;
  insert into public.invoice_items (org_id, invoice_id, sort, case_id, case_check_id, description, unit_price)
  select c.org_id, v_id, l.sort, l.case_id, l.case_check_id, l.description, l.unit_price from public.case_invoice_lines(c.id) l;
  perform public.recompute_invoice(v_id);
  perform public.log_invoice_event(v_id, 'drafted', c.reference, null, case when auth.uid() is null then 'system' else 'staff' end);
  perform public.notify_users(
    (select array_agg(m.user_id) from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
      where m.org_id = c.org_id and m.kind = 'staff' and m.status = 'active' and rp.permission in ('invoices.manage', '*')),
    'invoice.drafted', 'Invoice drafted for ' || c.reference, cl.name, '/app/invoices/' || v_id, false, 'invoice', v_id, c.org_id);
  return v_id;
end $$;
revoke execute on function public.draft_case_invoice(uuid) from public, anon;
grant execute on function public.draft_case_invoice(uuid) to authenticated, service_role;

-- Every released, unbilled case of a client in a month, on one invoice.
create or replace function public.draft_monthly_invoice(p_client uuid, p_month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  cl public.clients;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_key text;
  v_id uuid;
  v_cases int;
begin
  if auth.uid() is not null and not (public.is_staff() and public.has_permission('invoices.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cl from public.clients where id = p_client;
  if cl.id is null or (auth.uid() is not null and cl.org_id <> public.auth_org_id()) then raise exception 'client not found' using errcode = 'P0002'; end if;
  v_key := 'monthly:' || cl.id || ':' || to_char(v_from, 'YYYY-MM');
  select id into v_id from public.invoices where org_id = cl.org_id and source_key = v_key and status <> 'void';
  if v_id is not null then return v_id; end if;
  select count(*) into v_cases from public.cases c
   where c.client_id = cl.id and c.stage = 'released' and (c.released_at at time zone 'Asia/Colombo')::date between v_from and v_to
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void');
  if v_cases = 0 then return null; end if;
  insert into public.invoices (org_id, client_id, kind, source_key, template_key, period_from, period_to, contact_id, created_by)
  values (cl.org_id, cl.id, 'monthly', v_key, coalesce(nullif(cl.default_template, ''), 'executive'), v_from, v_to,
          (select id from public.client_contacts where client_id = cl.id and receives_invoices order by is_primary desc, created_at limit 1), auth.uid())
  returning id into v_id;
  insert into public.invoice_items (org_id, invoice_id, sort, case_id, case_check_id, description, unit_price)
  select cl.org_id, v_id, row_number() over (order by c.released_at, l.sort)::int, l.case_id, l.case_check_id, l.description, l.unit_price
    from public.cases c, public.case_invoice_lines(c.id) l
   where c.client_id = cl.id and c.stage = 'released' and (c.released_at at time zone 'Asia/Colombo')::date between v_from and v_to
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void');
  perform public.recompute_invoice(v_id);
  perform public.log_invoice_event(v_id, 'drafted', to_char(v_from, 'Month YYYY') || ': ' || v_cases || ' case(s)', null,
    case when auth.uid() is null then 'system' else 'staff' end);
  return v_id;
end $$;
revoke execute on function public.draft_monthly_invoice(uuid, date) from public, anon;
grant execute on function public.draft_monthly_invoice(uuid, date) to authenticated, service_role;

-- Clients billed monthly whose previous month has unbilled released cases (scheduler, 1st of the month).
create or replace function public.monthly_billing_due(p_month date) returns table (client_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct c.client_id from public.cases c join public.clients cl on cl.id = c.client_id
   where cl.billing_policy = 'monthly_consolidated' and c.stage = 'released'
     and (c.released_at at time zone 'Asia/Colombo')::date between date_trunc('month', p_month)::date
                                                               and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
     and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id where it.case_id = c.id and i.status <> 'void')
$$;
revoke execute on function public.monthly_billing_due(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff transitions
-- ---------------------------------------------------------------------------
create or replace function public.queue_document_render(p_kind text, p_entity_type text, p_entity uuid, p_template text, p_title text, p_org uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_doc uuid;
  v_job uuid;
begin
  insert into public.generated_documents (org_id, kind, entity_type, entity_id, version, template_key, title, created_by)
  values (p_org, p_kind, p_entity_type, p_entity,
          coalesce((select max(version) + 1 from public.generated_documents where entity_type = p_entity_type and entity_id = p_entity and kind = p_kind), 1),
          p_template, p_title, auth.uid())
  returning id into v_doc;
  update public.generated_documents set status = 'superseded'
   where entity_type = p_entity_type and entity_id = p_entity and kind = p_kind and id <> v_doc and status in ('queued', 'ready', 'failed');
  v_job := public.enqueue_job('document.render', jsonb_build_object('document_id', v_doc), 'document.render:' || v_doc,
                              now(), null, 'generated_document', v_doc, null, p_org, auth.uid());
  update public.generated_documents set job_id = v_job where id = v_doc;
  return v_doc;
end $$;
revoke execute on function public.queue_document_render(text, text, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.confirm_invoice(p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_terms int;
  v_doc uuid;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('invoices.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status <> 'draft' then raise exception 'this invoice is already confirmed' using errcode = '22023'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = i.id) then raise exception 'add at least one line' using errcode = '22023'; end if;
  perform public.recompute_invoice(i.id);   -- freezes the draft's current tax lines
  select payment_terms_days into v_terms from public.clients where id = i.client_id;
  update public.invoices
     set status = 'confirmed', number = coalesce(number, public.next_document_number('invoice', i.org_id)),
         issue_date = coalesce(issue_date, (now() at time zone 'Asia/Colombo')::date),
         due_date = coalesce(due_date, coalesce(issue_date, (now() at time zone 'Asia/Colombo')::date) + coalesce(v_terms, 30)),
         confirmed_by = auth.uid(), confirmed_at = now()
   where id = i.id
  returning * into i;
  if i.total <= 0 then raise exception 'the invoice total is zero; check the prices before confirming' using errcode = '22023'; end if;
  v_doc := public.queue_document_render('invoice', 'invoice', i.id, i.template_key, i.number, i.org_id);
  update public.invoices set document_id = v_doc where id = i.id;
  perform public.log_invoice_event(i.id, 'confirmed', i.number, i.total);
  return jsonb_build_object('number', i.number, 'document_id', v_doc, 'total', i.total, 'due_date', i.due_date);
end $$;
revoke execute on function public.confirm_invoice(uuid) from public, anon;
grant execute on function public.confirm_invoice(uuid) to authenticated, service_role;

create or replace function public.mark_invoice_sent(p_invoice uuid, p_to text[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_users uuid[];
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('invoices.send')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status in ('draft', 'void') then raise exception 'confirm the invoice before sending it' using errcode = '22023'; end if;
  update public.invoices set status = case when status = 'confirmed' then 'sent' else status end, sent_at = coalesce(sent_at, now()) where id = i.id;
  perform public.log_invoice_event(i.id, 'sent', array_to_string(p_to, ', '));
  select array_agg(m.user_id) into v_users from public.memberships m
   where m.client_id = i.client_id and m.kind = 'client' and m.status = 'active'
     and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission = 'portal.invoices.view');
  if coalesce(cardinality(v_users), 0) > 0 then
    perform public.notify_users(v_users, 'portal.invoice_sent', 'Invoice ' || i.number || ' is ready',
      i.currency || ' ' || to_char(i.total, 'FM999,999,999,990.00') || ' due ' || to_char(i.due_date, 'DD Mon YYYY'),
      '/portal/invoices/' || i.id, false, 'invoice', i.id, i.org_id);
  end if;
end $$;
revoke execute on function public.mark_invoice_sent(uuid, text[]) from public, anon;
grant execute on function public.mark_invoice_sent(uuid, text[]) to authenticated, service_role;

create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_on date default null, p_slip uuid default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_id uuid;
  v_receipt text;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('payments.record')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status in ('draft', 'void') then raise exception 'payments are recorded against confirmed invoices' using errcode = '22023'; end if;
  if i.status = 'paid' then raise exception 'this invoice is already paid' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'enter the amount received' using errcode = '22023'; end if;
  if p_amount > i.balance + 0.004 then raise exception 'that is more than the % % still owed', i.currency, to_char(i.balance, 'FM999,999,990.00') using errcode = '22023'; end if;
  if p_method not in ('bank_transfer', 'cheque', 'cash', 'card', 'online', 'other') then raise exception 'choose how it was paid' using errcode = '22023'; end if;
  if p_slip is not null and not exists (select 1 from public.payment_slips s where s.id = p_slip and s.client_id = i.client_id and s.status = 'pending') then
    raise exception 'that payment slip is not waiting to be matched' using errcode = '22023';
  end if;
  v_receipt := public.next_document_number('receipt', i.org_id);
  insert into public.payments (org_id, client_id, invoice_id, amount, method, reference, paid_on, notes, slip_id, receipt_number, recorded_by)
  values (i.org_id, i.client_id, i.id, round(p_amount, 2), p_method, nullif(trim(p_reference), ''),
          coalesce(p_paid_on, (now() at time zone 'Asia/Colombo')::date), nullif(trim(p_notes), ''), p_slip, v_receipt, auth.uid())
  returning id into v_id;
  if p_slip is not null then
    update public.payment_slips set status = 'matched', invoice_id = i.id, reviewed_by = auth.uid(), reviewed_at = now() where id = p_slip;
  end if;
  perform public.recompute_invoice(i.id);
  update public.payments set receipt_document_id = public.queue_document_render('receipt', 'payment', v_id, i.template_key, v_receipt, i.org_id)
   where id = v_id;
  perform public.log_invoice_event(i.id, 'payment', coalesce(nullif(trim(p_reference), ''), p_method), round(p_amount, 2));
  return v_id;
end $$;
revoke execute on function public.record_payment(uuid, numeric, text, text, date, uuid, text) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, date, uuid, text) to authenticated, service_role;

create or replace function public.void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.id is null or p.org_id <> public.auth_org_id() then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('payments.record')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p.voided_at is not null then return; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the payment is voided' using errcode = '22023'; end if;
  update public.payments set voided_at = now(), void_reason = trim(p_reason) where id = p.id;
  if p.slip_id is not null then update public.payment_slips set status = 'pending', reviewed_by = null, reviewed_at = null where id = p.slip_id; end if;
  perform public.recompute_invoice(p.invoice_id);
  perform public.log_invoice_event(p.invoice_id, 'payment_voided', trim(p_reason), p.amount);
end $$;
revoke execute on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated, service_role;

create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('invoices.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status = 'void' then return; end if;
  if exists (select 1 from public.payments where invoice_id = i.id and voided_at is null) then
    raise exception 'void its payments first, or issue a credit note' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the invoice is voided' using errcode = '22023'; end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = trim(p_reason), balance = 0 where id = i.id;
  update public.generated_documents set status = 'void' where entity_type = 'invoice' and entity_id = i.id and status = 'ready';
  perform public.log_invoice_event(i.id, 'voided', trim(p_reason));
end $$;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated, service_role;

create or replace function public.issue_credit_note(p_invoice uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_id uuid;
  v_number text;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.org_id <> public.auth_org_id() then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('invoices.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.status in ('draft', 'void') then raise exception 'credit notes apply to confirmed invoices' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > i.balance + 0.004 then raise exception 'a credit note can be up to the % still owed', to_char(i.balance, 'FM999,999,990.00') using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'say why the credit is given' using errcode = '22023'; end if;
  v_number := public.next_document_number('credit_note', i.org_id);
  insert into public.credit_notes (org_id, client_id, invoice_id, number, amount, reason, created_by)
  values (i.org_id, i.client_id, i.id, v_number, round(p_amount, 2), trim(p_reason), auth.uid())
  returning id into v_id;
  update public.credit_notes set document_id = public.queue_document_render('credit_note', 'credit_note', v_id, i.template_key, v_number, i.org_id)
   where id = v_id;
  perform public.recompute_invoice(i.id);
  perform public.log_invoice_event(i.id, 'credit_note', v_number || ': ' || trim(p_reason), round(p_amount, 2));
  return v_id;
end $$;
revoke execute on function public.issue_credit_note(uuid, numeric, text) from public, anon;
grant execute on function public.issue_credit_note(uuid, numeric, text) to authenticated, service_role;

-- Staff match a client's slip (record_payment with p_slip) or reject it with a reason.
create or replace function public.reject_payment_slip(p_slip uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.payment_slips;
  v_users uuid[];
begin
  select * into s from public.payment_slips where id = p_slip for update;
  if s.id is null or s.org_id <> public.auth_org_id() then raise exception 'payment slip not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('payments.record')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'this slip is not waiting to be matched' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'tell the client what is wrong' using errcode = '22023'; end if;
  update public.payment_slips set status = 'rejected', rejection_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  select array[s.uploaded_by] into v_users;
  if s.uploaded_by is not null then
    perform public.notify_users(v_users, 'portal.slip_rejected', 'We could not match your payment slip', trim(p_reason),
      '/portal/invoices' || coalesce('/' || s.invoice_id, ''), true, 'payment_slip', s.id, s.org_id);
  end if;
end $$;
revoke execute on function public.reject_payment_slip(uuid, text) from public, anon;
grant execute on function public.reject_payment_slip(uuid, text) to authenticated, service_role;

-- What a client owes now.
create or replace function public.client_balance(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'outstanding', coalesce(sum(balance) filter (where status in ('sent', 'viewed', 'partially_paid', 'confirmed')), 0),
    'overdue', coalesce(sum(balance) filter (where status in ('sent', 'viewed', 'partially_paid') and due_date < (now() at time zone 'Asia/Colombo')::date), 0),
    'open_invoices', count(*) filter (where status in ('sent', 'viewed', 'partially_paid', 'confirmed')),
    'currency', coalesce(min(currency), 'LKR'))
    from public.invoices
   where client_id = p_client
     and ((public.can_read_invoices() and org_id = public.auth_org_id())
          or (public.is_client() and client_id = public.client_id_of_user() and public.has_permission('portal.invoices.view'))
          or auth.uid() is null)
$$;
revoke execute on function public.client_balance(uuid) from public, anon;
grant execute on function public.client_balance(uuid) to authenticated, service_role;

-- Statement lines with a running balance (invoices debit; payments and credit notes credit).
create or replace function public.client_statement(p_client uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok boolean := (public.can_read_invoices() and exists (select 1 from public.clients where id = p_client and org_id = public.auth_org_id()))
               or (public.is_client() and p_client = public.client_id_of_user() and public.has_permission('portal.invoices.view'));
  v_opening numeric;
  v_lines jsonb;
begin
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  with tx as (
    select i.issue_date as d, 'invoice' as kind, i.number as ref, i.total as debit, 0::numeric as credit, i.id as id
      from public.invoices i where i.client_id = p_client and i.status not in ('draft', 'void')
    union all
    select p.paid_on, 'payment', coalesce(p.reference, p.receipt_number), 0, p.amount, p.id
      from public.payments p where p.client_id = p_client and p.voided_at is null
    union all
    select (n.created_at at time zone 'Asia/Colombo')::date, 'credit_note', n.number, 0, n.amount, n.id
      from public.credit_notes n where n.client_id = p_client and n.status = 'issued'
  )
  select coalesce(sum(debit - credit), 0) into v_opening from tx where d < p_from;
  with tx as (
    select i.issue_date as d, 'invoice' as kind, i.number as ref, i.total as debit, 0::numeric as credit, i.id as id
      from public.invoices i where i.client_id = p_client and i.status not in ('draft', 'void')
    union all
    select p.paid_on, 'payment', coalesce(p.reference, p.receipt_number), 0, p.amount, p.id
      from public.payments p where p.client_id = p_client and p.voided_at is null
    union all
    select (n.created_at at time zone 'Asia/Colombo')::date, 'credit_note', n.number, 0, n.amount, n.id
      from public.credit_notes n where n.client_id = p_client and n.status = 'issued'
  )
  , running as (
    select d, kind, ref, debit, credit,
           v_opening + sum(debit - credit) over (order by d, kind desc, ref rows unbounded preceding) as balance
      from tx where d between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'kind', kind, 'reference', ref, 'debit', debit, 'credit', credit, 'balance', balance)
           order by d, kind desc, ref), '[]'::jsonb)
    into v_lines from running;
  return jsonb_build_object('client', (select jsonb_build_object('id', id, 'name', name, 'code', code) from public.clients where id = p_client),
    'from', p_from, 'to', p_to, 'opening', v_opening, 'lines', v_lines,
    'closing', v_opening + coalesce((select sum((x ->> 'debit')::numeric - (x ->> 'credit')::numeric) from jsonb_array_elements(v_lines) x), 0));
end $$;
revoke execute on function public.client_statement(uuid, date, date) from public, anon;
grant execute on function public.client_statement(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reminders (invoice.reminders job; ladder in src/domain/pricing/invoice-chase-core.ts)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_reminder_candidates() returns table (
  invoice_id uuid, org_id uuid, client_id uuid, client_name text, number text, currency text, total numeric, balance numeric,
  due_date date, steps_sent text[], paused boolean, to_emails text[]
)
language sql stable security definer set search_path = '' as $$
  select i.id, i.org_id, i.client_id, cl.name, i.number, i.currency, i.total, i.balance, i.due_date,
         coalesce((select array_agg(r.step) from public.invoice_reminders r where r.invoice_id = i.id), '{}'),
         i.reminders_paused or exists (select 1 from public.payment_slips s where s.invoice_id = i.id and s.status = 'pending'),
         coalesce((select array_agg(distinct e) from (
             select lower(cc.email) e from public.client_contacts cc where cc.client_id = i.client_id and cc.receives_invoices and cc.email is not null
             union
             select lower(p.email) from public.memberships m join public.profiles p on p.id = m.user_id
              where m.client_id = i.client_id and m.kind = 'client' and m.status = 'active' and p.email is not null
                and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission = 'portal.invoices.view')) x), '{}')
    from public.invoices i join public.clients cl on cl.id = i.client_id
   where i.status in ('sent', 'viewed', 'partially_paid') and i.balance > 0 and i.due_date is not null
$$;
revoke execute on function public.invoice_reminder_candidates() from public, anon, authenticated;

create or replace function public.record_invoice_reminder(p_invoice uuid, p_step text, p_to text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice;
  if i.id is null then return; end if;
  insert into public.invoice_reminders (org_id, invoice_id, step, to_emails) values (i.org_id, i.id, p_step, coalesce(p_to, '{}'))
  on conflict (invoice_id, step) do nothing;
  perform public.log_invoice_event(i.id, 'reminder', p_step, i.balance, 'system');
  if p_step = 'escalated' then
    perform public.notify_users(
      (select array_agg(m.user_id) from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
        where m.org_id = i.org_id and m.kind = 'staff' and m.status = 'active' and rp.permission in ('invoices.send', '*')),
      'invoice.overdue', 'Invoice ' || i.number || ' is 14 days overdue', (select name from public.clients where id = i.client_id),
      '/app/invoices/' || i.id, true, 'invoice', i.id, i.org_id);
  end if;
end $$;
revoke execute on function public.record_invoice_reminder(uuid, text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Portal
-- ---------------------------------------------------------------------------
create or replace function public.portal_invoice_row(i public.invoices) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'number', i.number, 'kind', i.kind,
    'status', case when i.status in ('sent', 'viewed', 'partially_paid') and i.due_date < (now() at time zone 'Asia/Colombo')::date then 'overdue' else i.status end,
    'currency', i.currency, 'issue_date', i.issue_date, 'due_date', i.due_date, 'period_from', i.period_from, 'period_to', i.period_to,
    'total', i.total, 'amount_paid', i.amount_paid, 'amount_credited', i.amount_credited, 'balance', i.balance, 'paid_at', i.paid_at,
    'document_ready', exists (select 1 from public.generated_documents g where g.id = i.document_id and g.status = 'ready'),
    'slip_pending', exists (select 1 from public.payment_slips s where s.invoice_id = i.id and s.status = 'pending'))
$$;
revoke execute on function public.portal_invoice_row(public.invoices) from public, anon, authenticated;

create or replace function public.portal_invoices() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.invoices.view');
begin
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(public.portal_invoice_row(i) order by i.issue_date desc, i.number desc)
                            from public.invoices i where i.client_id = v_client and i.status not in ('draft', 'confirmed')), '[]'::jsonb),
    'balance', public.client_balance(v_client),
    'slips', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'invoice_id', s.invoice_id, 'filename', s.filename, 'status', s.status,
                                                          'rejection_reason', s.rejection_reason, 'created_at', s.created_at) order by s.created_at desc)
                         from public.payment_slips s where s.client_id = v_client and s.status <> 'pending_upload'), '[]'::jsonb));
end $$;
revoke execute on function public.portal_invoices() from public, anon;
grant execute on function public.portal_invoices() to authenticated, service_role;

create or replace function public.portal_invoice(p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.invoices.view');
  i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice and client_id = v_client and status not in ('draft', 'confirmed');
  if i.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if i.status = 'sent' then
    update public.invoices set status = 'viewed', viewed_at = now() where id = i.id returning * into i;
    perform public.log_invoice_event(i.id, 'viewed', null, null, 'client');
  end if;
  return public.portal_invoice_row(i) || jsonb_build_object(
    'message', i.message, 'subtotal', i.subtotal, 'discount_total', i.discount_total, 'net_total', i.net_total,
    'tax_lines', i.tax_lines, 'tax_total', i.tax_total, 'can_pay', public.has_permission('portal.payments.upload'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', it.description, 'quantity', it.quantity, 'unit_price', it.unit_price,
                                                           'discount_pct', it.discount_pct, 'total', it.total) order by it.sort)
                         from public.invoice_items it where it.invoice_id = i.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'paid_on', p.paid_on,
                                                              'receipt_number', p.receipt_number,
                                                              'receipt_ready', exists (select 1 from public.generated_documents g where g.id = p.receipt_document_id and g.status = 'ready'),
                                                              'receipt_document_id', p.receipt_document_id) order by p.paid_on)
                            from public.payments p where p.invoice_id = i.id and p.voided_at is null), '[]'::jsonb),
    'credit_notes', coalesce((select jsonb_agg(jsonb_build_object('number', n.number, 'amount', n.amount, 'reason', n.reason, 'document_id', n.document_id))
                                from public.credit_notes n where n.invoice_id = i.id and n.status = 'issued'), '[]'::jsonb),
    'document_id', i.document_id);
end $$;
revoke execute on function public.portal_invoice(uuid) from public, anon;
grant execute on function public.portal_invoice(uuid) to authenticated, service_role;

-- A slip for an invoice: step 1 (row + path in the private documents bucket).
create or replace function public.portal_begin_slip(p_invoice uuid, p_filename text, p_mime text, p_size bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.payments.upload');
  i public.invoices;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into i from public.invoices where id = p_invoice and client_id = v_client;
  if i.id is null or i.status not in ('sent', 'viewed', 'partially_paid') then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'upload a PDF, JPEG or PNG' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then raise exception 'slips must be under 10 MB' using errcode = '22023'; end if;
  v_path := 'org/' || i.org_id || '/client/' || i.client_id || '/slips/' || v_id || '/'
            || left(regexp_replace(lower(coalesce(p_filename, 'slip')), '[^a-z0-9._-]+', '-', 'g'), 80);
  insert into public.payment_slips (id, org_id, client_id, invoice_id, storage_path, filename, mime, size_bytes, client_note, uploaded_by)
  values (v_id, i.org_id, i.client_id, i.id, v_path, left(coalesce(nullif(trim(p_filename), ''), 'slip'), 200), p_mime, p_size, nullif(trim(p_note), ''), auth.uid());
  return jsonb_build_object('id', v_id, 'bucket', 'documents', 'path', v_path);
end $$;
revoke execute on function public.portal_begin_slip(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.portal_begin_slip(uuid, text, text, bigint, text) to authenticated, service_role;

create or replace function public.portal_finalize_slip(p_slip uuid, p_sha256 text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.payments.upload');
  s public.payment_slips;
begin
  select * into s from public.payment_slips where id = p_slip and client_id = v_client and uploaded_by = auth.uid() for update;
  if s.id is null then raise exception 'payment slip not found' using errcode = 'P0002'; end if;
  if s.status <> 'pending_upload' then return; end if;
  update public.payment_slips set status = 'pending', sha256 = nullif(p_sha256, '') where id = s.id;
  if s.invoice_id is not null then perform public.log_invoice_event(s.invoice_id, 'slip_uploaded', s.filename, null, 'client'); end if;
  perform public.notify_users(
    (select array_agg(m.user_id) from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
      where m.org_id = s.org_id and m.kind = 'staff' and m.status = 'active' and rp.permission in ('payments.record', '*')),
    'payment.slip', 'Payment slip from ' || (select name from public.clients where id = s.client_id),
    coalesce((select number from public.invoices where id = s.invoice_id), ''), '/app/payments', false, 'payment_slip', s.id, s.org_id);
  perform public.enqueue_job('ai.slip_read', jsonb_build_object('slip_id', s.id), 'ai.slip_read:' || s.id,
                             now(), null, 'payment_slip', s.id, null, s.org_id, auth.uid());
end $$;
revoke execute on function public.portal_finalize_slip(uuid, text) from public, anon;
grant execute on function public.portal_finalize_slip(uuid, text) to authenticated, service_role;

-- Invoices, credit notes and receipts for the client's documents policy (0014).
create or replace function public.client_can_see_document(p_kind text, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_client() then return false; end if;
  if p_kind = 'quote' then
    return exists (select 1 from public.quotes q where q.id = p_entity and q.client_id = public.client_id_of_user()
                     and q.status in ('sent', 'viewed', 'accepted', 'declined', 'expired') and public.has_permission('portal.quotes.accept'));
  end if;
  if not public.has_permission('portal.invoices.view') then return false; end if;
  if p_kind = 'invoice' then
    return exists (select 1 from public.invoices i where i.id = p_entity and i.client_id = public.client_id_of_user() and i.status not in ('draft', 'confirmed'));
  elsif p_kind = 'receipt' then
    return exists (select 1 from public.payments p where p.id = p_entity and p.client_id = public.client_id_of_user() and p.voided_at is null);
  elsif p_kind = 'credit_note' then
    return exists (select 1 from public.credit_notes n where n.id = p_entity and n.client_id = public.client_id_of_user() and n.status = 'issued');
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
select public.attach_audit('public.invoices');
select public.attach_audit('public.invoice_items');
select public.attach_audit('public.payments');
select public.attach_audit('public.payment_slips');
select public.attach_audit('public.credit_notes');
select public.attach_audit('public.tax_rates');

alter table public.tax_rates enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_slips enable row level security;
alter table public.payments enable row level security;
alter table public.credit_notes enable row level security;
alter table public.invoice_reminders enable row level security;
alter table public.invoice_events enable row level security;

create policy tax_rates_select on public.tax_rates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('settings.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy invoices_select on public.invoices for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('invoices.manage'))
              and status = 'draft' and kind = 'manual' and source_key is null);
create policy invoices_update on public.invoices for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('invoices.manage')))
  with check (org_id = (select public.auth_org_id()));
revoke update on public.invoices from authenticated;
grant update (contact_id, template_key, message, internal_notes, period_from, period_to, issue_date, reminders_paused) on public.invoices to authenticated;

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy invoice_items_insert on public.invoice_items for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('invoices.manage')));
create policy invoice_items_update on public.invoice_items for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('invoices.manage')))
  with check (org_id = (select public.auth_org_id()));
create policy invoice_items_delete on public.invoice_items for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('invoices.manage')));

create policy payment_slips_select on public.payment_slips for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy payments_select on public.payments for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy invoice_reminders_select on public.invoice_reminders for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));
create policy invoice_events_select on public.invoice_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_invoices()));

revoke insert, update, delete, truncate on public.payment_slips, public.payments, public.credit_notes, public.invoice_reminders, public.invoice_events
  from anon, authenticated;
revoke delete, truncate on public.invoices, public.tax_rates from anon, authenticated;
revoke insert on public.tax_rates from anon, authenticated;

alter publication supabase_realtime add table public.invoices, public.payment_slips;
