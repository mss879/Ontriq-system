-- =============================================================================
-- 0014_quotations.sql
-- Feature: quotations and contracted price lists. Staff build a quote (items
-- from packages, checks or free lines; optional volume tiers; intro, scope,
-- assumptions, turnaround and closing text, which AI can draft), confirm it
-- (number QT-YYYY-NNNN, totals recomputed here, PDF rendered by the
-- document.render job), send it, and the client accepts it in the portal with
-- a typed signature (name, time, IP), declines it, or asks a question.
-- Acceptance writes the client's price list and makes a prospect active.
-- A change after confirmation is a new version; versions are never edited.
-- Depends on: 0003_clients, 0004_check_types, 0005_packages_templates,
--             0013_document_system. Calls 0009 and 0010 at run time.
-- =============================================================================

create table public.client_price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  check_type_id uuid references public.check_types (id) on delete cascade,
  package_id uuid references public.packages (id) on delete cascade,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  currency text not null default 'LKR',
  source_quote_id uuid,                -- FK below, after quotes
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((check_type_id is null) <> (package_id is null))
);
create index client_price_lists_org_idx on public.client_price_lists (org_id);
create index client_price_lists_client_idx on public.client_price_lists (client_id, valid_from desc);
create index client_price_lists_check_idx on public.client_price_lists (check_type_id);
create index client_price_lists_package_idx on public.client_price_lists (package_id);
create index client_price_lists_created_by_idx on public.client_price_lists (created_by);
create trigger a_set_org_id before insert on public.client_price_lists
  for each row execute function public.set_org_id();

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  contact_id uuid references public.client_contacts (id) on delete set null,
  number text,
  version int not null default 1,
  parent_id uuid references public.quotes (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'superseded')),
  template_key text not null default 'executive' check (template_key in ('executive', 'modern', 'classic')),
  currency text not null default 'LKR',
  issue_date date not null default (now() at time zone 'Asia/Colombo')::date,
  valid_until date not null default ((now() at time zone 'Asia/Colombo')::date + 30),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 180),
  title text not null default 'Background verification services',
  intro text not null default '',
  scope text not null default '',
  assumptions text not null default '',
  tat_text text not null default '',
  closing text not null default '',
  internal_notes text not null default '',
  expected_monthly_volume int check (expected_monthly_volume is null or expected_monthly_volume >= 0),
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  document_id uuid references public.generated_documents (id) on delete set null,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_name text,
  accepted_ip text,
  declined_at timestamptz,
  declined_reason text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number, version)
);
create index quotes_org_idx on public.quotes (org_id, created_at desc);
create index quotes_client_idx on public.quotes (client_id, created_at desc);
create index quotes_contact_idx on public.quotes (contact_id);
create index quotes_parent_idx on public.quotes (parent_id);
create index quotes_document_idx on public.quotes (document_id);
create index quotes_confirmed_by_idx on public.quotes (confirmed_by);
create index quotes_accepted_by_idx on public.quotes (accepted_by);
create index quotes_created_by_idx on public.quotes (created_by);
create trigger a_set_org_id before insert on public.quotes
  for each row execute function public.set_org_id();
create trigger quotes_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();
alter table public.client_price_lists add constraint client_price_lists_source_quote_fk
  foreign key (source_quote_id) references public.quotes (id) on delete set null;
create index client_price_lists_source_quote_idx on public.client_price_lists (source_quote_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  sort int not null default 100,
  kind text not null default 'check' check (kind in ('package', 'check', 'custom')),
  package_id uuid references public.packages (id) on delete set null,
  check_type_id uuid references public.check_types (id) on delete set null,
  description text not null,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  total numeric(14, 2) not null default 0
);
create index quote_items_org_idx on public.quote_items (org_id);
create index quote_items_quote_idx on public.quote_items (quote_id, sort);
create index quote_items_package_idx on public.quote_items (package_id);
create index quote_items_check_idx on public.quote_items (check_type_id);
create trigger a_set_org_id before insert on public.quote_items
  for each row execute function public.set_org_id();

-- Volume discounts offered on the quote ("51–200 cases a month: 10% off").
create table public.quote_tiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  min_volume int not null check (min_volume >= 0),
  max_volume int,
  discount_pct numeric(5, 2) not null check (discount_pct between 0 and 100),
  note text not null default ''
);
create index quote_tiers_org_idx on public.quote_tiers (org_id);
create index quote_tiers_quote_idx on public.quote_tiers (quote_id, min_volume);
create trigger a_set_org_id before insert on public.quote_tiers
  for each row execute function public.set_org_id();

create table public.quote_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  kind text not null,
  body text,
  actor_id uuid references auth.users (id) on delete set null,
  actor_kind text not null default 'staff' check (actor_kind in ('staff', 'client', 'system')),
  at timestamptz not null default now()
);
create index quote_events_org_idx on public.quote_events (org_id, at desc);
create index quote_events_quote_idx on public.quote_events (quote_id, at);
create index quote_events_actor_idx on public.quote_events (actor_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.log_quote_event(p_quote uuid, p_kind text, p_body text default null, p_actor_kind text default 'staff') returns void
language sql security definer set search_path = '' as $$
  insert into public.quote_events (org_id, quote_id, kind, body, actor_id, actor_kind)
  select q.org_id, q.id, p_kind, p_body, auth.uid(), p_actor_kind from public.quotes q where q.id = p_quote
$$;
revoke execute on function public.log_quote_event(uuid, text, text, text) from public, anon, authenticated;

-- Totals from the items (mirrors src/domain/pricing/quote-core.ts).
create or replace function public.recompute_quote(p_quote uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.quote_items
     set total = round(quantity * unit_price * (1 - discount_pct / 100), 2)
   where quote_id = p_quote;
  update public.quotes q
     set subtotal = coalesce(x.gross, 0), discount_total = coalesce(x.gross - x.net, 0), total = coalesce(x.net, 0)
    from (select round(sum(quantity * unit_price), 2) as gross, round(sum(total), 2) as net from public.quote_items where quote_id = p_quote) x
   where q.id = p_quote;
end $$;
revoke execute on function public.recompute_quote(uuid) from public, anon, authenticated;

create or replace function public.quote_items_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_quote(coalesce(new.quote_id, old.quote_id));
  return null;
end $$;
create trigger quote_items_after_change after insert or update of quantity, unit_price, discount_pct or delete on public.quote_items
  for each row when (pg_trigger_depth() < 1) execute function public.quote_items_after_change();
revoke execute on function public.quote_items_after_change() from public, anon, authenticated;

-- Confirmed quotes are frozen: items, tiers and text change only in a new version.
create or replace function public.quotes_freeze_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if tg_table_name = 'quotes' then
    if old.status <> 'draft' and auth.uid() is not null
       and (new.intro, new.scope, new.assumptions, new.tat_text, new.closing, new.title, new.valid_until, new.payment_terms_days, new.template_key, new.client_id)
           is distinct from (old.intro, old.scope, old.assumptions, old.tat_text, old.closing, old.title, old.valid_until, old.payment_terms_days, old.template_key, old.client_id) then
      raise exception 'this quotation is confirmed; make a new version to change it' using errcode = '22023';
    end if;
    return new;
  end if;
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  if v_status is distinct from 'draft' and auth.uid() is not null then
    raise exception 'this quotation is confirmed; make a new version to change it' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger quotes_freeze_guard before update on public.quotes
  for each row execute function public.quotes_freeze_guard();
create trigger quote_items_freeze_guard before insert or update or delete on public.quote_items
  for each row execute function public.quotes_freeze_guard();
create trigger quote_tiers_freeze_guard before insert or update or delete on public.quote_tiers
  for each row execute function public.quotes_freeze_guard();
revoke execute on function public.quotes_freeze_guard() from public, anon, authenticated;

-- Staff who see quotes and who may change them.
create or replace function public.can_read_quotes() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (public.has_permission('quotes.manage') or public.has_permission('quotes.send')
                                or public.has_permission('clients.read') or public.has_permission('clients.manage'))
$$;
revoke execute on function public.can_read_quotes() from public, anon;
grant execute on function public.can_read_quotes() to authenticated, service_role;

-- The price a client pays for a check type or package on a date (contracted, else none).
create or replace function public.contracted_price(p_client uuid, p_check uuid, p_package uuid, p_on date default current_date) returns numeric
language sql stable security definer set search_path = '' as $$
  select p.unit_price from public.client_price_lists p
   where p.client_id = p_client
     and (p.check_type_id = p_check or p.package_id = p_package)
     and p.valid_from <= p_on and (p.valid_to is null or p.valid_to >= p_on)
   order by p.valid_from desc, p.created_at desc limit 1
$$;
revoke execute on function public.contracted_price(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.contracted_price(uuid, uuid, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff transitions
-- ---------------------------------------------------------------------------

-- Lock the draft: number, totals, PDF.
create or replace function public.confirm_quote(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_doc uuid;
  v_job uuid;
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null or q.org_id <> public.auth_org_id() then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('quotes.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if q.status <> 'draft' then raise exception 'this quotation is already confirmed' using errcode = '22023'; end if;
  if not exists (select 1 from public.quote_items where quote_id = q.id) then raise exception 'add at least one line' using errcode = '22023'; end if;
  if q.valid_until < q.issue_date then raise exception 'the quotation would already be expired' using errcode = '22023'; end if;
  perform public.recompute_quote(q.id);
  update public.quotes
     set status = 'confirmed', number = coalesce(number, public.next_document_number('quote', q.org_id)),
         confirmed_by = auth.uid(), confirmed_at = now()
   where id = q.id
  returning * into q;
  insert into public.generated_documents (org_id, kind, entity_type, entity_id, version, template_key, title, created_by)
  values (q.org_id, 'quote', 'quote', q.id, q.version, q.template_key, q.number || ' · ' || q.title, auth.uid())
  on conflict (entity_type, entity_id, kind, version) do update set status = 'queued'
  returning id into v_doc;
  v_job := public.enqueue_job('document.render', jsonb_build_object('document_id', v_doc), 'document.render:' || v_doc,
                              now(), null, 'generated_document', v_doc, null, q.org_id, auth.uid());
  update public.generated_documents set job_id = v_job where id = v_doc;
  update public.quotes set document_id = v_doc where id = q.id;
  perform public.log_quote_event(q.id, 'confirmed', q.number);
  return jsonb_build_object('number', q.number, 'document_id', v_doc, 'total', q.total);
end $$;
revoke execute on function public.confirm_quote(uuid) from public, anon;
grant execute on function public.confirm_quote(uuid) to authenticated, service_role;

create or replace function public.mark_quote_sent(p_quote uuid, p_to text[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_users uuid[];
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null or q.org_id <> public.auth_org_id() then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('quotes.send')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if q.status not in ('confirmed', 'sent', 'viewed') then raise exception 'confirm the quotation before sending it' using errcode = '22023'; end if;
  update public.quotes set status = case when status = 'confirmed' then 'sent' else status end, sent_at = coalesce(sent_at, now()) where id = q.id;
  perform public.log_quote_event(q.id, 'sent', array_to_string(p_to, ', '));
  -- Client admins who may accept see it in the portal.
  select array_agg(m.user_id) into v_users from public.memberships m
   where m.client_id = q.client_id and m.kind = 'client' and m.status = 'active'
     and exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id and rp.permission = 'portal.quotes.accept');
  if coalesce(cardinality(v_users), 0) > 0 then
    perform public.notify_users(v_users, 'portal.quote_sent', 'Quotation ' || q.number || ' is ready', q.title,
      '/portal/quotes/' || q.id, false, 'quote', q.id, q.org_id);
  end if;
end $$;
revoke execute on function public.mark_quote_sent(uuid, text[]) from public, anon;
grant execute on function public.mark_quote_sent(uuid, text[]) to authenticated, service_role;

-- A new draft version copying this one (the old one is superseded unless accepted or declined).
create or replace function public.revise_quote(p_quote uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_id uuid;
begin
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null or q.org_id <> public.auth_org_id() then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if not (public.is_staff() and public.has_permission('quotes.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if q.status = 'draft' then raise exception 'edit the draft directly' using errcode = '22023'; end if;
  if exists (select 1 from public.quotes where parent_id = q.id and status = 'draft') then raise exception 'a new version is already being drafted' using errcode = '22023'; end if;
  insert into public.quotes (org_id, client_id, contact_id, number, version, parent_id, template_key, currency, valid_until, payment_terms_days,
                             title, intro, scope, assumptions, tat_text, closing, internal_notes, expected_monthly_volume, created_by)
  values (q.org_id, q.client_id, q.contact_id, q.number,
          (select max(version) + 1 from public.quotes where org_id = q.org_id and number = q.number), q.id, q.template_key, q.currency,
          greatest(q.valid_until, (now() at time zone 'Asia/Colombo')::date + 30), q.payment_terms_days,
          q.title, q.intro, q.scope, q.assumptions, q.tat_text, q.closing, q.internal_notes, q.expected_monthly_volume, auth.uid())
  returning id into v_id;
  insert into public.quote_items (org_id, quote_id, sort, kind, package_id, check_type_id, description, quantity, unit_price, discount_pct)
  select org_id, v_id, sort, kind, package_id, check_type_id, description, quantity, unit_price, discount_pct from public.quote_items where quote_id = q.id;
  insert into public.quote_tiers (org_id, quote_id, min_volume, max_volume, discount_pct, note)
  select org_id, v_id, min_volume, max_volume, discount_pct, note from public.quote_tiers where quote_id = q.id;
  if q.status not in ('accepted', 'declined') then
    update public.quotes set status = 'superseded' where id = q.id;
  end if;
  perform public.recompute_quote(v_id);
  perform public.log_quote_event(q.id, 'revised', 'Version ' || (select version from public.quotes where id = v_id));
  return v_id;
end $$;
revoke execute on function public.revise_quote(uuid) from public, anon;
grant execute on function public.revise_quote(uuid) to authenticated, service_role;

-- Sent quotes past their date expire (scheduler, daily).
create or replace function public.expire_quotes() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.quotes set status = 'expired'
   where status in ('sent', 'viewed') and valid_until < (now() at time zone 'Asia/Colombo')::date;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.expire_quotes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Portal
-- ---------------------------------------------------------------------------
create or replace function public.portal_quote_row(q public.quotes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', q.id, 'number', q.number, 'version', q.version, 'title', q.title,
    'status', case when q.status in ('sent', 'viewed') and q.valid_until < (now() at time zone 'Asia/Colombo')::date then 'expired' else q.status end,
    'currency', q.currency, 'issue_date', q.issue_date, 'valid_until', q.valid_until, 'payment_terms_days', q.payment_terms_days,
    'subtotal', q.subtotal, 'discount_total', q.discount_total, 'total', q.total, 'template_key', q.template_key,
    'sent_at', q.sent_at, 'accepted_at', q.accepted_at, 'accepted_name', q.accepted_name, 'declined_at', q.declined_at,
    'document_ready', exists (select 1 from public.generated_documents g where g.id = q.document_id and g.status = 'ready'))
$$;
revoke execute on function public.portal_quote_row(public.quotes) from public, anon, authenticated;

create or replace function public.portal_quotes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
begin
  return coalesce((select jsonb_agg(public.portal_quote_row(q) order by q.sent_at desc nulls last)
                     from public.quotes q
                    where q.client_id = v_client and q.status in ('sent', 'viewed', 'accepted', 'declined', 'expired')), '[]'::jsonb);
end $$;
revoke execute on function public.portal_quotes() from public, anon;
grant execute on function public.portal_quotes() to authenticated, service_role;

-- One quote with its lines, tiers and client-facing text (never internal notes). Marks it viewed.
create or replace function public.portal_quote(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client();
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote and client_id = v_client and status in ('sent', 'viewed', 'accepted', 'declined', 'expired');
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if q.status = 'sent' then
    update public.quotes set status = 'viewed', viewed_at = now() where id = q.id returning * into q;
    perform public.log_quote_event(q.id, 'viewed', null, 'client');
  end if;
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

-- Accept with a typed signature. Writes the contracted prices.
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
  -- Older open prices for the same checks and packages end yesterday.
  update public.client_price_lists p set valid_to = v_today - 1
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

create or replace function public.portal_respond_quote(p_quote uuid, p_action text, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.quotes.accept');
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote and client_id = v_client for update;
  if q.id is null then raise exception 'quotation not found' using errcode = 'P0002'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'write a short note first' using errcode = '22023'; end if;
  if p_action = 'decline' then
    if q.status not in ('sent', 'viewed') then raise exception 'this quotation can no longer be declined' using errcode = '22023'; end if;
    update public.quotes set status = 'declined', declined_at = now(), declined_reason = left(trim(p_text), 2000) where id = q.id;
  elsif p_action <> 'question' then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.log_quote_event(q.id, case p_action when 'decline' then 'declined' else 'question' end, left(trim(p_text), 2000), 'client');
  if q.created_by is not null then
    perform public.notify_users(array[q.created_by], 'quote.' || p_action,
      'Quotation ' || q.number || case p_action when 'decline' then ' declined' else ': question from the client' end,
      left(trim(p_text), 300), '/app/quotes/' || q.id, true, 'quote', q.id, q.org_id);
  end if;
end $$;
revoke execute on function public.portal_respond_quote(uuid, text, text) from public, anon;
grant execute on function public.portal_respond_quote(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security: staff edit drafts directly; transitions use the functions.
-- Clients read through the portal functions only.
-- ---------------------------------------------------------------------------
select public.attach_audit('public.quotes');
select public.attach_audit('public.quote_items');
select public.attach_audit('public.client_price_lists');

alter table public.client_price_lists enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_tiers enable row level security;
alter table public.quote_events enable row level security;

create policy client_price_lists_select on public.client_price_lists for select to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.can_read_quotes()) or (select public.has_permission('invoices.manage'))));
create policy client_price_lists_write on public.client_price_lists for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')));
create policy client_price_lists_update on public.client_price_lists for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy quotes_select on public.quotes for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.can_read_quotes()));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')) and status = 'draft');
create policy quotes_update on public.quotes for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')))
  with check (org_id = (select public.auth_org_id()));
-- Status, numbers and acceptance move only through the functions above.
revoke update on public.quotes from authenticated;
grant update (client_id, contact_id, template_key, currency, issue_date, valid_until, payment_terms_days, title, intro, scope, assumptions,
              tat_text, closing, internal_notes, expected_monthly_volume) on public.quotes to authenticated;

create policy quote_items_select on public.quote_items for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.quotes q where q.id = quote_id));
create policy quote_items_insert on public.quote_items for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')));
create policy quote_items_update on public.quote_items for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')))
  with check (org_id = (select public.auth_org_id()));
create policy quote_items_delete on public.quote_items for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')));

create policy quote_tiers_select on public.quote_tiers for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.quotes q where q.id = quote_id));
create policy quote_tiers_insert on public.quote_tiers for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')));
create policy quote_tiers_update on public.quote_tiers for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')))
  with check (org_id = (select public.auth_org_id()));
create policy quote_tiers_delete on public.quote_tiers for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('quotes.manage')));

create policy quote_events_select on public.quote_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.quotes q where q.id = quote_id));
revoke insert, update, delete, truncate on public.quote_events from anon, authenticated;
revoke delete, truncate on public.quotes, public.client_price_lists from anon, authenticated;

-- Clients see the generated PDF of a quote sent to them (and, from 0015, their invoices).
create or replace function public.client_can_see_document(p_kind text, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_client() then return false; end if;
  if p_kind = 'quote' then
    return exists (select 1 from public.quotes q where q.id = p_entity and q.client_id = public.client_id_of_user()
                     and q.status in ('sent', 'viewed', 'accepted', 'declined', 'expired') and public.has_permission('portal.quotes.accept'));
  end if;
  return false;
end $$;
revoke execute on function public.client_can_see_document(text, uuid) from public, anon;
grant execute on function public.client_can_see_document(text, uuid) to authenticated, service_role;

create policy generated_documents_select_client on public.generated_documents for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_client()) and status = 'ready'
         and public.client_can_see_document(kind, entity_id));

alter publication supabase_realtime add table public.quotes;
