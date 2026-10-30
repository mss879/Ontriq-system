-- =============================================================================
-- 0036_billing_fixes.sql
-- Fixes found while building the billing screens (Phase 3):
--  * Reading an invoice in the portal no longer marks it viewed (a prefetch
--    could); the page calls portal_mark_invoice_viewed once it is on screen.
--    It now also returns the invoice's design and contact for the preview.
--  * A client's balance leaves out confirmed invoices that haven't been sent
--    (they can't see those); staff still see them as outstanding.
--  * Staff with ai.configure can add a budget for a capability.
--  * The escalation notice says how many days late the invoice really is.
-- Depends on: 0015, 0018.
-- =============================================================================

create or replace function public.portal_invoice(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.invoices.view');
  i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice and client_id = v_client and status not in ('draft', 'confirmed');
  if i.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
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
    'document_id', i.document_id, 'template_key', i.template_key,
    'contact_name', (select ct.name from public.client_contacts ct where ct.id = i.contact_id),
    'contact_title', (select ct.title from public.client_contacts ct where ct.id = i.contact_id));
end $$;
revoke execute on function public.portal_invoice(uuid) from public, anon;
grant execute on function public.portal_invoice(uuid) to authenticated, service_role;

create or replace function public.portal_mark_invoice_viewed(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.portal_client('portal.invoices.view');
  v_id uuid;
begin
  update public.invoices set status = 'viewed', viewed_at = now()
   where id = p_invoice and client_id = v_client and status = 'sent'
  returning id into v_id;
  if v_id is not null then perform public.log_invoice_event(v_id, 'viewed', null, null, 'client'); end if;
end $$;
revoke execute on function public.portal_mark_invoice_viewed(uuid) from public, anon;
grant execute on function public.portal_mark_invoice_viewed(uuid) to authenticated, service_role;

create or replace function public.client_balance(p_client uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'outstanding', coalesce(sum(balance) filter (where status in ('sent', 'viewed', 'partially_paid') or (status = 'confirmed' and not public.is_client())), 0),
    'overdue', coalesce(sum(balance) filter (where status in ('sent', 'viewed', 'partially_paid') and due_date < (now() at time zone 'Asia/Colombo')::date), 0),
    'open_invoices', count(*) filter (where status in ('sent', 'viewed', 'partially_paid') or (status = 'confirmed' and not public.is_client())),
    'currency', coalesce(min(currency), 'LKR'))
    from public.invoices
   where client_id = p_client
     and ((public.can_read_invoices() and org_id = public.auth_org_id())
          or (public.is_client() and client_id = public.client_id_of_user() and public.has_permission('portal.invoices.view'))
          or auth.uid() is null)
$$;
revoke execute on function public.client_balance(uuid) from public, anon;
grant execute on function public.client_balance(uuid) to authenticated, service_role;

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
      'invoice.overdue', 'Invoice ' || i.number || ' is ' || ((now() at time zone 'Asia/Colombo')::date - i.due_date) || ' days overdue', (select name from public.clients where id = i.client_id),
      '/app/invoices/' || i.id, true, 'invoice', i.id, i.org_id);
  end if;
end $$;
revoke execute on function public.record_invoice_reminder(uuid, text, text[]) from public, anon, authenticated;

create policy ai_budgets_insert on public.ai_budgets for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('ai.configure')));
