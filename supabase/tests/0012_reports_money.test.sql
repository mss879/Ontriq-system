\o /dev/null
-- Final reports (0012), quotations (0014), invoices and payments (0015).
begin;

-- ---------------------------------------------------------------- people
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', 'admin@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('e1000000-0000-4000-8000-000000000002', 'ops@ontriq.test', '{"full_name":"Oshan Ops"}'),
  ('e1000000-0000-4000-8000-000000000003', 'relations@ontriq.test', '{"full_name":"Rukshan Relations"}'),
  ('e1000000-0000-4000-8000-000000000004', 'entry@ontriq.test', '{"full_name":"Dilini Entry"}'),
  ('e1000000-0000-4000-8000-000000000005', 'admin@hemas.test', '{"full_name":"Hema Admin"}'),
  ('e1000000-0000-4000-8000-000000000006', 'viewer@hemas.test', '{"full_name":"Hiru Viewer"}'),
  ('e1000000-0000-4000-8000-000000000007', 'user@other.test', '{"full_name":"Other User"}'),
  ('e1000000-0000-4000-8000-000000000008', 'super@ontriq.test', '{"full_name":"Sam Super"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('e1000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('e1000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('e1000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'client_relations'),
  ('e1000000-0000-4000-8000-000000000004'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('e1000000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('e1000000-0000-4000-8000-000000000006'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_viewer'),
  ('e1000000-0000-4000-8000-000000000007'::uuid, 'client', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'client_user'),
  ('e1000000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'super_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';
update public.package_items set unit_price = 2000 where check_type_id = (select id from public.check_types where key = 'nic');
update public.package_items set unit_price = 3500 where check_type_id = (select id from public.check_types where key = 'education');
update public.package_items set unit_price = 4000 where check_type_id = (select id from public.check_types where key = 'employment');

-- ================================================================= quotations
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare q uuid; r jsonb;
begin
  insert into public.quotes (org_id, client_id, title, intro, valid_until)
  values ('00000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hemas verification services', 'Thank you', current_date + 30)
  returning id into q;
  perform set_config('t.quote', q::text, false);
  insert into public.quote_items (org_id, quote_id, sort, kind, check_type_id, description, quantity, unit_price, discount_pct) values
    ('00000000-0000-4000-8000-000000000001', q, 10, 'check', (select id from public.check_types where key = 'nic'), 'NIC verification', 1, 2000, 10),
    ('00000000-0000-4000-8000-000000000001', q, 20, 'check', (select id from public.check_types where key = 'education'), 'Education', 2, 3500, 0);
  assert (select total from public.quotes where id = q) = 8800, 'quote total should be 1800 + 7000';
  r := public.confirm_quote(q);
  assert r ->> 'number' ~ '^QT-\d{4}-\d{4}$', 'quote number ' || (r ->> 'number');
  assert exists (select 1 from public.jobs where kind = 'document.render' and entity_id = (r ->> 'document_id')::uuid), 'quote PDF not queued';
  begin
    update public.quotes set intro = 'changed' where id = q;
    raise exception 'TEST FAILED: a confirmed quote was edited';
  exception when sqlstate '22023' then null;
  end;
  begin
    update public.quotes set status = 'accepted' where id = q;
    raise exception 'TEST FAILED: staff set a quote status directly';
  exception when insufficient_privilege then null;
  end;
  perform public.mark_quote_sent(q, array['hema@hemas.test']);
end $$;
reset role;

-- The client sees and accepts it; a viewer can't; another company can't see it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.portal_accept_quote(current_setting('t.quote')::uuid, 'Hiru Viewer');
    raise exception 'TEST FAILED: a client viewer accepted a quotation';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.portal_quote(current_setting('t.quote')::uuid);
    raise exception 'TEST FAILED: another company opened the quotation';
  exception when insufficient_privilege or sqlstate 'P0002' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
do $$
declare d jsonb;
begin
  assert jsonb_array_length(public.portal_quotes()) = 1, 'client should see one quotation';
  d := public.portal_quote(current_setting('t.quote')::uuid);
  assert d ->> 'status' = 'sent' and jsonb_array_length(d -> 'items') = 2, 'reading a quote must not mark it viewed';
  perform public.portal_mark_quote_viewed(current_setting('t.quote')::uuid);
  d := public.portal_quote(current_setting('t.quote')::uuid);
  assert d ->> 'status' = 'viewed', 'quote should be viewed once shown';
  assert d::text not like '%internal_notes%', 'internal notes reached the client';
  perform public.portal_accept_quote(current_setting('t.quote')::uuid, 'Hema Admin', '203.0.113.5');
  assert (select status from public.quotes where id = current_setting('t.quote')::uuid) is null, 'clients must not read quotes directly';
end $$;
reset role;
do $$ begin
  assert (select status from public.quotes where id = current_setting('t.quote')::uuid) = 'accepted', 'quote not accepted';
  assert public.contracted_price('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.check_types where key = 'nic'), null) = 1800,
    'contracted NIC price should carry the 10% discount';
  assert exists (select 1 from public.notifications where user_id = 'e1000000-0000-4000-8000-000000000003' and type = 'quote.accepted'), 'creator not told';
end $$;

-- ================================================================= reports
-- A case ready for its report (set up directly: the workflow itself is tested in 0006).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'package_id', (select id from public.packages where code = 'STANDARD'), 'candidate', jsonb_build_object('full_name', 'Nimal Perera Silva')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
update public.case_checks set state = 'completed', result = 'clear', result_tone = 'green', values_valid = true, completed_at = now()
 where case_id = current_setting('t.case')::uuid;
-- No files in this fixture, so its slots are waived: submit_report refuses evidence missing from the report (0048).
update public.case_check_requirements set status = 'waived' where case_id = current_setting('t.case')::uuid;
update public.cases set stage = 'report', status_key = 'final_report_in_progress' where id = current_setting('t.case')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.request_report_draft(current_setting('t.case')::uuid);
    raise exception 'TEST FAILED: someone without reports.preview made a draft';
  exception when insufficient_privilege or sqlstate 'P0002' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare d uuid;
begin
  begin
    perform public.submit_report(current_setting('t.case')::uuid);
    raise exception 'TEST FAILED: sent for approval without a draft';
  exception when sqlstate '22023' then null;
  end;
  d := public.request_report_draft(current_setting('t.case')::uuid);
  perform set_config('t.draft', d::text, false);
  assert (select version from public.report_versions where id = d) = 1, 'first draft is version 1';
  assert exists (select 1 from public.jobs where kind = 'report.render' and entity_id = d), 'render not queued';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select public.report_render_started(current_setting('t.draft')::uuid);
select public.report_render_done(current_setting('t.draft')::uuid, true, '{"reference":"x"}', 'hash-1', 'org/x/report-v1.pdf', 'sha-1', 4, 9000);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare f uuid;
begin
  perform public.submit_report(current_setting('t.case')::uuid);
  assert (select stage from public.cases where id = current_setting('t.case')::uuid) = 'approval', 'not in approval';
  begin
    perform public.approve_report(current_setting('t.case')::uuid, current_setting('t.draft')::uuid, 'green', 'hash-CHANGED');
    raise exception 'TEST FAILED: approved a draft of a case that changed';
  exception when sqlstate '22023' then null;
  end;
  f := public.approve_report(current_setting('t.case')::uuid, current_setting('t.draft')::uuid, 'green', 'hash-1');
  perform set_config('t.final', f::text, false);
  assert (select final_result from public.cases where id = current_setting('t.case')::uuid) = 'green', 'final result not set';
  assert (select kind || ':' || version from public.report_versions where id = f) = 'final:2', 'final should be version 2';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select public.report_render_done(current_setting('t.final')::uuid, true, null, null, 'org/x/report-v2.pdf', 'sha-2', 5, 12000);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.release_report(current_setting('t.case')::uuid, '{}');
    raise exception 'TEST FAILED: the approver released their own report';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.release_report(current_setting('t.case')::uuid, array['e1000000-0000-4000-8000-000000000007'::uuid]);
    raise exception 'TEST FAILED: released to another company''s user';
  exception when sqlstate '22023' then null;
  end;
  perform public.release_report(current_setting('t.case')::uuid, array['e1000000-0000-4000-8000-000000000005'::uuid]);
end $$;
reset role;
do $$ begin
  assert (select stage from public.cases where id = current_setting('t.case')::uuid) = 'released', 'case not released';
  assert (select status from public.report_versions where id = current_setting('t.final')::uuid) = 'released', 'final not released';
  assert exists (select 1 from public.jobs where kind = 'invoice.draft' and entity_id = current_setting('t.case')::uuid), 'per-case billing not queued';
  assert exists (select 1 from public.notifications where user_id = 'e1000000-0000-4000-8000-000000000005' and type = 'portal.report_released'), 'client not told';
end $$;

-- Downloads: the client gets the released final; another company and drafts stay closed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert public.report_download(current_setting('t.final')::uuid, '1.2.3.4') ->> 'path' = 'org/x/report-v2.pdf', 'client could not download';
  assert public.portal_report(current_setting('t.case')::uuid) ->> 'version_id' = current_setting('t.final'), 'portal report missing';
  begin
    perform public.report_download(current_setting('t.draft')::uuid);
    raise exception 'TEST FAILED: a client downloaded a draft';
  exception when sqlstate 'P0002' then null;
  end;
  assert (select count(*) from public.report_versions) = 0, 'clients must not read report versions directly';
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.report_download(current_setting('t.final')::uuid);
    raise exception 'TEST FAILED: another company downloaded the report';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$
declare v jsonb;
begin
  v := public.verify_report(current_setting('t.final')::uuid);
  assert v ->> 'status' = 'valid' and v ->> 'candidate' = 'N. P. S.', 'verify output ' || v::text;
  assert v::text not like '%green%', 'the verify page must not reveal the result';
  assert public.verify_report(current_setting('t.draft')::uuid) is null, 'drafts must not verify';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.report_downloads where report_version_id = current_setting('t.final')::uuid and who = 'client') = 1, 'download not logged';
end $$;

-- ================================================================= invoices and payments
update public.tax_rates set is_active = true where code = 'VAT';
select set_config('request.jwt.claims', '', true);
set local role service_role;
select set_config('t.invoice', public.draft_case_invoice(current_setting('t.case')::uuid)::text, false);
do $$ begin
  assert public.draft_case_invoice(current_setting('t.case')::uuid) = current_setting('t.invoice')::uuid, 'drafting is not idempotent';
end $$;
reset role;
do $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = current_setting('t.invoice')::uuid;
  -- NIC at the contracted 1800 and Education at 1800? No: education was quoted at 3500 (no discount); employment from the package 4000.
  assert (select count(*) from public.invoice_items where invoice_id = i.id) = 3, 'three lines expected';
  assert i.net_total = 1800 + 3500 + 4000, 'net should use contracted prices, else the package: ' || i.net_total;
  assert i.tax_total = round(i.net_total * 0.18, 2) and i.total = i.net_total + i.tax_total, 'VAT not applied';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.confirm_invoice(current_setting('t.invoice')::uuid);
  assert r ->> 'number' ~ '^INV-\d{4}-\d{4}$', 'invoice number';
  begin
    update public.invoices set message = 'changed' where id = current_setting('t.invoice')::uuid;
    raise exception 'TEST FAILED: a confirmed invoice was edited';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.invoice_items (org_id, invoice_id, description, unit_price) values ('00000000-0000-4000-8000-000000000001', current_setting('t.invoice')::uuid, 'extra', 1);
    raise exception 'TEST FAILED: a line was added to a confirmed invoice';
  exception when sqlstate '22023' then null;
  end;
  perform public.mark_invoice_sent(current_setting('t.invoice')::uuid, array['accounts@hemas.test']);
end $$;
reset role;
update public.tax_rates set is_active = false where code = 'VAT';
do $$ begin
  assert (select tax_total > 0 from public.invoices where id = current_setting('t.invoice')::uuid), 'confirmed tax lines must stay frozen';
end $$;

-- The client sees it and uploads a slip; a viewer can't; finance matches it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  begin
    perform public.portal_invoices();
    raise exception 'TEST FAILED: a client viewer opened invoices';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
do $$
declare d jsonb; s jsonb;
begin
  d := public.portal_invoice(current_setting('t.invoice')::uuid);
  assert d ->> 'status' = 'sent', 'reading an invoice must not mark it viewed';
  perform public.portal_mark_invoice_viewed(current_setting('t.invoice')::uuid);
  d := public.portal_invoice(current_setting('t.invoice')::uuid);
  assert d ->> 'status' = 'viewed', 'invoice should be viewed once shown';
  assert d ? 'template_key', 'the portal needs the invoice design';
  assert (public.portal_invoices() -> 'balance' ->> 'outstanding')::numeric > 0, 'outstanding balance missing';
  s := public.portal_begin_slip(current_setting('t.invoice')::uuid, 'slip.pdf', 'application/pdf', 1000, 'Paid half');
  perform public.portal_finalize_slip((s ->> 'id')::uuid);
  perform set_config('t.slip', s ->> 'id', false);
  begin
    perform public.portal_begin_slip(current_setting('t.invoice')::uuid, 'x.exe', 'application/x-msdownload', 10);
    raise exception 'TEST FAILED: an executable slip was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select status from public.payment_slips where id = current_setting('t.slip')::uuid) = 'pending', 'slip not pending';
  assert exists (select 1 from public.jobs where kind = 'ai.slip_read' and entity_id = current_setting('t.slip')::uuid), 'slip reading not queued';
  assert exists (select 1 from public.notifications where user_id = 'e1000000-0000-4000-8000-000000000003' and type = 'payment.slip'), 'finance not told';
  assert (select paused from public.invoice_reminder_candidates() where invoice_id = current_setting('t.invoice')::uuid), 'reminders should pause while a slip waits';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare i public.invoices; half numeric;
begin
  select * into i from public.invoices where id = current_setting('t.invoice')::uuid;
  half := round(i.total / 2, 2);
  begin
    perform public.record_payment(i.id, i.total + 1, 'bank_transfer');
    raise exception 'TEST FAILED: an overpayment was recorded';
  exception when sqlstate '22023' then null;
  end;
  perform public.record_payment(i.id, half, 'bank_transfer', 'BOC-123', current_date, current_setting('t.slip')::uuid);
  assert (select status from public.invoices where id = i.id) = 'partially_paid', 'should be partially paid';
  assert (select status from public.payment_slips where id = current_setting('t.slip')::uuid) = 'matched', 'slip not matched';
  begin
    perform public.void_invoice(i.id, 'mistake');
    raise exception 'TEST FAILED: voided an invoice with payments';
  exception when sqlstate '22023' then null;
  end;
  perform public.issue_credit_note(i.id, 100, 'Goodwill');
  perform public.record_payment(i.id, (select balance from public.invoices where id = i.id), 'cheque', 'CHQ-9');
  assert (select status from public.invoices where id = i.id) = 'paid', 'should be paid';
  assert (select count(*) from public.generated_documents where kind = 'receipt') = 2, 'two receipts expected';
  assert (select count(*) from public.generated_documents where kind = 'credit_note') = 1, 'credit note PDF expected';
end $$;
reset role;

-- Statement and documents for the client.
update public.generated_documents set status = 'ready' where entity_type = 'invoice' and entity_id = current_setting('t.invoice')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
do $$
declare st jsonb;
begin
  st := public.client_statement('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date - 30, current_date + 1);
  assert jsonb_array_length(st -> 'lines') = 4, 'invoice, two payments and a credit note expected: ' || (st -> 'lines')::text;
  assert (st ->> 'closing')::numeric = 0, 'statement should close at zero, got ' || (st ->> 'closing');
  assert exists (select 1 from public.generated_documents where entity_id = current_setting('t.invoice')::uuid), 'client cannot see their invoice PDF';
  begin
    perform public.client_statement('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date - 30, current_date);
    raise exception 'TEST FAILED: a client read another company''s statement';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert not exists (select 1 from public.generated_documents where entity_id = current_setting('t.invoice')::uuid), 'another company saw the invoice PDF';
  assert jsonb_array_length(public.portal_invoices() -> 'invoices') = 0, 'another company saw invoices';
end $$;
reset role;

-- A revision keeps the released report available until the new one is released.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.revise_report(current_setting('t.case')::uuid, 'Employer name corrected');
  assert (select stage from public.cases where id = current_setting('t.case')::uuid) = 'report', 'revision should reopen the report stage';
  assert (select status from public.report_versions where id = current_setting('t.final')::uuid) = 'released', 'released version must stay available';
end $$;
reset role;

rollback;
\echo '  ✓ reports, quotations, invoices and payments'
