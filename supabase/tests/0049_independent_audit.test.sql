\o /dev/null
-- What the independent audits of the finished build found (second half of 0049).
-- Each block replays a finding: what used to get through no longer does.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b4900000-0000-4000-8000-000000000001', 'admin@b49.test', '{"full_name":"Ama Admin"}'),
  ('b4900000-0000-4000-8000-000000000002', 'officer@b49.test', '{"full_name":"Vihanga Officer"}'),
  ('b4900000-0000-4000-8000-000000000003', 'qc@b49.test', '{"full_name":"Kumari QC"}'),
  ('b4900000-0000-4000-8000-000000000004', 'clientadmin@b49.test', '{"full_name":"Chamari Client"}'),
  ('b4900000-0000-4000-8000-000000000005', 'clientviewer@b49.test', '{"full_name":"Upul Viewer"}'),
  ('b4900000-0000-4000-8000-000000000006', 'viewer@b49.test', '{"full_name":"Vidu Viewer"}'),
  ('b4900000-0000-4000-8000-000000000007', 'ops@b49.test', '{"full_name":"Oshan Ops"}'),
  ('b4900000-0000-4000-8000-000000000008', 'entry@b49.test', '{"full_name":"Dilini Entry"}'),
  ('b4900000-0000-4000-8000-000000000009', 'super@b49.test', '{"full_name":"Sam Super"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('b4900000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('b4900000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('b4900000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'qc_officer'),
  ('b4900000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('b4900000-0000-4000-8000-000000000005'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_viewer'),
  ('b4900000-0000-4000-8000-000000000006'::uuid, 'staff', null::uuid, 'viewer'),
  ('b4900000-0000-4000-8000-000000000007'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('b4900000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('b4900000-0000-4000-8000-000000000009'::uuid, 'staff', null::uuid, 'super_admin')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';
update public.package_items set unit_price = 2000 where check_type_id = (select id from public.check_types where key = 'nic');
update public.package_items set unit_price = 3500 where check_type_id = (select id from public.check_types where key = 'police');
update public.package_items set unit_price = 3000 where check_type_id = (select id from public.check_types where key = 'education');
update public.package_items set unit_price = 4000 where check_type_id = (select id from public.check_types where key = 'employment');

-- Two cases to work on: one the client supplies, one the candidate does.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'candidate', jsonb_build_object('full_name', 'Type One')));
  perform set_config('t.one', r ->> 'case_id', false);
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Type Two', 'email', 'two@example.test')));
  perform set_config('t.two', r ->> 'case_id', false);
  perform set_config('t.two_candidate', r ->> 'candidate_id', false);
end $$;
reset role;

-- ---------------------------------------------------------------- the client hears what is needed when a case opens
do $$ begin
  assert exists (select 1 from public.notifications where entity_id = current_setting('t.one')::uuid and type = 'portal.documents_needed'), 'a staff-made case told the client nothing';
  assert not exists (select 1 from public.notifications where entity_id = current_setting('t.two')::uuid and type = 'portal.documents_needed'), 'the candidate provides these, not the client';
end $$;

-- ---------------------------------------------------------------- an upload begun before a lock doesn't finish after it
do $$
declare c uuid := current_setting('t.one')::uuid;
begin
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by, uploaded_by_kind) values
    ('b4900000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'late-client.pdf', 'application/pdf', 'x/1.pdf', 'pending_upload', 'b4900000-0000-4000-8000-000000000004', 'client'),
    ('b4900000-1111-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'late-staff.pdf', 'application/pdf', 'x/2.pdf', 'pending_upload', 'b4900000-0000-4000-8000-000000000002', 'staff');
  update public.cases set stage = 'post_qc', assigned_to = 'b4900000-0000-4000-8000-000000000002' where id = c;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_finalize_upload('b4900000-1111-4000-8000-000000000001');
  raise exception 'TEST FAILED: a client file arrived after Post-QC';
exception when sqlstate '22023' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.finalize_document_upload('b4900000-1111-4000-8000-000000000002');
  raise exception 'TEST FAILED: an officer''s file arrived after Post-QC';
exception when insufficient_privilege then null;
end $$;
reset role;
update public.cases set stage = 'documents' where id = current_setting('t.one')::uuid;
do $$ begin
  assert (select status from public.documents where id = 'b4900000-1111-4000-8000-000000000001') = 'pending_upload', 'the refused upload should not have landed';
end $$;

-- ---------------------------------------------------------------- a note to one person stays with them
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.create_candidate_request(current_setting('t.one')::uuid, jsonb_build_object('kind', 'document', 'category', 'nic_copy', 'note', 'The end date on your form looks wrong'));
  perform public.request_case_document(current_setting('t.two')::uuid, null, 'nic_copy', 'NIC copy', 'Your photo was blurred');
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_case_detail(current_setting('t.one')::uuid)::text not like '%end date on your form%', 'a note to the candidate reached the portal';
  assert public.portal_case_detail(current_setting('t.two')::uuid)::text not like '%photo was blurred%', 'a note to the candidate reached the portal';
end $$;
reset role;

-- ---------------------------------------------------------------- a finding can't be waived away, and a waived check asks for nothing
do $$
declare c uuid := current_setting('t.one')::uuid;
begin
  update public.cases set stage = 'verification' where id = c;
  update public.case_checks set state = 'discrepancy', result = 'discrepancy', result_tone = 'red', client_note = 'The name differs' where case_id = c and label like 'NIC%';
  update public.case_checks set state = 'in_progress', values = '{"sanctions_found":"yes"}' where case_id = c and label like 'Criminal%';
  perform set_config('t.nic', (select id::text from public.case_checks where case_id = c and label like 'NIC%'), false);
  perform set_config('t.police', (select id::text from public.case_checks where case_id = c and label like 'Criminal%'), false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_state(current_setting('t.nic')::uuid, 'waived', null, 'Client dropped it');
  raise exception 'TEST FAILED: a discrepancy was waived';
exception when sqlstate '22023' then
  assert sqlerrm like '%can''t be waived%', sqlerrm;
end $$;
do $$ begin
  perform public.set_check_state(current_setting('t.police')::uuid, 'waived', null, 'Client dropped it');
  raise exception 'TEST FAILED: a sanctions hit was waived';
exception when sqlstate '22023' then
  assert sqlerrm like '%can''t be waived%', sqlerrm;
end $$;
reset role;
update public.case_checks set values = '{}' where id = current_setting('t.police')::uuid;
update public.cases set stage = 'documents' where id = current_setting('t.one')::uuid;
update public.case_checks set state = 'not_started', result = null, result_tone = null, client_note = null where id = current_setting('t.nic')::uuid;
set local role authenticated;
do $$
declare k uuid := current_setting('t.police')::uuid;
begin
  assert exists (select 1 from public.case_check_requirements where case_check_id = k and category = 'police_report' and status = 'pending' and stage = 'documents'), 'the police report comes with the documents';
  perform public.set_check_state(k, 'waived', null, 'The client removed this check');
  assert not exists (select 1 from public.case_check_requirements where case_check_id = k and status = 'pending'), 'a waived check still asked for its documents';
end $$;
reset role;
update public.cases set stage = 'verification' where id = current_setting('t.one')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid := current_setting('t.police')::uuid;
begin
  perform public.set_check_state(k, 'in_progress');
  assert exists (select 1 from public.case_check_requirements where case_check_id = k and status = 'pending'), 'bringing the check back should ask again';
end $$;
reset role;
update public.cases set stage = 'documents' where id = current_setting('t.one')::uuid;

-- ---------------------------------------------------------------- rejected consent stops the case
do $$
declare c uuid := current_setting('t.two')::uuid;
begin
  insert into public.consent_forms (org_id, case_id, status, method) values ('00000000-0000-4000-8000-000000000001', c, 'submitted', 'esign');
  update public.cases set stage = 'pre_qc' where id = c;
  update public.consent_forms set status = 'rejected' where case_id = c;
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  update public.orgs set settings = jsonb_set(settings, '{workflow}', coalesce(settings -> 'workflow', '{}'::jsonb) || '{"qc_checklists":{"pre":[],"post":[]}}') where id = '00000000-0000-4000-8000-000000000001';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.record_qc_review(current_setting('t.two')::uuid, 'pre', 'approved', '[{"item":"Readable","ok":true}]');
  raise exception 'TEST FAILED: Pre-QC approved with rejected consent';
exception when sqlstate '22023' then
  assert sqlerrm like '%consent%', sqlerrm;
end $$;
reset role;

-- ---------------------------------------------------------------- staff see the contact log of cases they can see
do $$ begin
  insert into public.communications (org_id, case_id, channel, direction, counterparty, body)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.two')::uuid, 'phone', 'outbound', 'Private person', 'Private call notes');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.communications where counterparty = 'Private person'), 'an officer read the contact log of a case they can''t open';
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.communications where counterparty = 'Private person'), 'the admin should read it';
end $$;
reset role;

-- ---------------------------------------------------------------- only a Super Admin turns two-step off
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  update public.orgs set mfa_required_for_staff = not mfa_required_for_staff where id = '00000000-0000-4000-8000-000000000001';
  raise exception 'TEST FAILED: an admin changed two-step sign-in';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2"}', true);
do $$
declare v boolean;
begin
  update public.orgs set mfa_required_for_staff = not mfa_required_for_staff where id = '00000000-0000-4000-8000-000000000001' returning mfa_required_for_staff into v;
  assert v is not null, 'the Super Admin should be able to';
  update public.orgs set mfa_required_for_staff = not mfa_required_for_staff where id = '00000000-0000-4000-8000-000000000001';
end $$;
reset role;

-- ---------------------------------------------------------------- the AI's reading follows the report's gate
do $$
declare c uuid := current_setting('t.two')::uuid;
begin
  update public.cases set assigned_to = 'b4900000-0000-4000-8000-000000000002' where id = c;
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, sensitive)
  values ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'police_report', 'p.pdf', 'application/pdf', 'x/p.pdf', 'accepted', 'candidate', true);
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, value)
  values ('00000000-0000-4000-8000-000000000001', 'candidate.report', 'case', c, '{"summary":"A sensitive reading"}');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.ai_suggestions where capability = 'candidate.report' and entity_id = current_setting('t.two')::uuid), 'a viewer read the AI''s summary of sensitive files';
end $$;
reset role;

-- ---------------------------------------------------------------- helpers tell nobody anything
do $$ begin
  assert not has_function_privilege('authenticated', 'public.candidate_contact_gap(uuid)', 'execute'), 'a helper is open to anyone signed in';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d uuid;
begin
  select id into d from public.documents where filename = 'p.pdf';
  assert d is null, 'the client should not see this file';
end $$;
reset role;
set local role authenticated;
do $$ begin
  assert cardinality(public.report_sensitive_files(jsonb_build_object('annexures', jsonb_build_array(jsonb_build_object('document_id', (select id from public.documents where filename = 'late-client.pdf')))))) = 0, 'a client read a file name';
end $$;
reset role;

-- ---------------------------------------------------------------- packages reach who they were offered to, and stay Ontriq's
do $$
declare p uuid;
begin
  insert into public.packages (id, org_id, owner_scope, code, name, visibility, is_active)
  values ('b4900000-2222-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'org', 'B49-SELECTED', 'Selected clients', 'selected', true);
  insert into public.package_client_visibility (org_id, package_id, client_id)
  values ('00000000-0000-4000-8000-000000000001', 'b4900000-2222-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare p uuid;
begin
  assert exists (select 1 from public.packages where id = 'b4900000-2222-4000-8000-000000000001'), 'a package offered to this client never reached them';
  insert into public.packages (org_id, owner_scope, client_id, code, name, tat_days, currency)
  values ('00000000-0000-4000-8000-000000000001', 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'B49-OWN', 'Our own', 1, 'USD') returning id into p;
  assert (select currency from public.packages where id = p) = 'LKR', 'a client set the currency';
  assert (select tat_days from public.packages where id = p) <> 1, 'a client set their own turnaround';
  perform set_config('t.own', p::text, false);
  begin
    update public.packages set tat_days = 1 where id = p;
    raise exception 'TEST FAILED: a client shortened a package''s turnaround';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.client_settings set portal = portal || '{"client_packages_need_approval": true}' where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.packages set needs_approval = false, is_active = true where id = current_setting('t.own')::uuid;
set local role authenticated;
do $$
declare p uuid := current_setting('t.own')::uuid;
begin
  insert into public.package_items (org_id, package_id, check_type_id, unit_price)
  values ('00000000-0000-4000-8000-000000000001', p, (select id from public.check_types where key = 'nic'), 1);
  assert (select needs_approval and not is_active from public.packages where id = p), 'changing an approved package should send it back to Ontriq';
  assert (select unit_price from public.package_items where package_id = p) = 2000, 'a client-built package takes the list price';
end $$;
reset role;

-- ---------------------------------------------------------------- quotations follow their pages
insert into public.quotes (id, org_id, client_id, title, status, sent_at)
values ('b4900000-3333-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Secret prices', 'sent', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.portal_quote('b4900000-3333-4000-8000-000000000001');
  raise exception 'TEST FAILED: a client viewer read a quotation';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_quote('b4900000-3333-4000-8000-000000000001') ->> 'title' = 'Secret prices', 'a client admin should read it';
end $$;
reset role;

-- ---------------------------------------------------------------- what was quoted is what is billed
select set_config('request.jwt.claims', '', true);
do $$
declare c uuid := current_setting('t.one')::uuid; v_total numeric; i uuid;
begin
  insert into public.client_price_lists (org_id, client_id, package_id, unit_price)
  values ('00000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.packages where code = 'ESSENTIAL'), 4200);
  select sum(unit_price) into v_total from public.case_invoice_lines(c);
  assert v_total = 4200, 'the agreed package price should be the price billed, got ' || v_total;
  assert (select count(*) from public.case_invoice_lines(c)) = 1, 'a package price is one line';
  -- A kind of check added later comes on top.
  update public.cases set package_snapshot = jsonb_set(package_snapshot, '{items}', (package_snapshot -> 'items') || jsonb_build_array(
    jsonb_build_object('check_type_id', (select id from public.check_types where key = 'education'), 'unit_price', 3000, 'added', true))) where id = c;
  insert into public.case_checks (org_id, case_id, check_type_id, check_type_version_id, label, sort)
  select org_id, c, id, current_version_id, 'Education', 90 from public.check_types where key = 'education';
  select sum(unit_price) into v_total from public.case_invoice_lines(c);
  assert v_total = 7200, 'an added check should bill on top, got ' || v_total;
  -- Released once is billable, even while a revision runs.
  update public.cases set stage = 'report', released_at = now() where id = c;
  i := public.draft_case_invoice(c);
  assert i is not null, 'a case under revision should still be invoiced';
  perform set_config('t.invoice', i::text, false);
  update public.invoices set status = 'confirmed', number = 'INV-B49-1', issue_date = current_date where id = i;
  update public.cases set stage = 'documents', released_at = null where id = c;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(public.client_statement('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date - 1, current_date + 1) -> 'lines') l where l ->> 'reference' = 'INV-B49-1'),
    'a client''s statement showed an invoice nobody sent them';
end $$;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare i uuid := current_setting('t.invoice')::uuid;
begin
  update public.invoices set issue_date = current_date - 30 where id = i;
  raise exception 'TEST FAILED: a confirmed invoice was backdated';
exception when sqlstate '22023' then null;
end $$;
reset role;
do $$
declare i uuid := current_setting('t.invoice')::uuid;
begin
  insert into public.credit_notes (org_id, client_id, invoice_id, number, amount, reason)
  select org_id, client_id, id, 'CN-B49-1', 100, 'test' from public.invoices where id = i;
end $$;
set local role authenticated;
do $$ begin
  perform public.void_invoice(current_setting('t.invoice')::uuid, 'Wrong client');
  raise exception 'TEST FAILED: an invoice with a credit note was voided';
exception when sqlstate '22023' then null;
end $$;
reset role;

-- ---------------------------------------------------------------- the public page says what the file says
do $$
declare c uuid := current_setting('t.one')::uuid;
begin
  insert into public.report_versions (id, org_id, case_id, version, kind, status, released_at, sha256) values
    ('b4900000-4444-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 1, 'draft', 'ready', null, 'a'),
    ('b4900000-4444-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, 2, 'final', 'released', now(), 'b'),
    ('b4900000-4444-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', c, 3, 'final', 'superseded', null, 'c');
  assert public.verify_report('b4900000-4444-4000-8000-000000000002') ->> 'version' = '1', 'the first issue is v1, as the PDF says';
  assert public.verify_report('b4900000-4444-4000-8000-000000000003') ->> 'status' = 'not_released', 'a final nobody released read as issued';
end $$;

-- ---------------------------------------------------------------- the portal shows no more than the report
do $$
declare c uuid := current_setting('t.one')::uuid;
begin
  update public.cases set stage = 'released', final_result = 'green' where id = c;
  update public.case_checks set state = 'in_progress', client_note = 'Old finding' where id = current_setting('t.nic')::uuid;
  insert into public.client_requests (org_id, case_id, question) values ('00000000-0000-4000-8000-000000000001', c, 'Left open');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.portal_case_detail(current_setting('t.one')::uuid)::text not like '%Old finding%', 'an open check showed an old finding';
end $$;
reset role;
do $$
declare c uuid := current_setting('t.two')::uuid;
begin
  -- A closed case asks nobody for anything.
  insert into public.client_requests (org_id, case_id, question) values ('00000000-0000-4000-8000-000000000001', c, 'Still open');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.cancel_case(current_setting('t.two')::uuid, 'Candidate withdrew');
end $$;
reset role;
do $$ begin
  assert (select status from public.client_requests where question = 'Still open') = 'closed', 'a cancelled case kept asking the client';
end $$;

-- ---------------------------------------------------------------- the right person hears
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
    'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Typed Person', 'email', 'wrong@example.test', 'phone', '0771111111')));
  perform set_config('t.typed', r ->> 'case_id', false);
end $$;
reset role;
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  perform set_config('t.typed_candidate', (select candidate_id::text from public.cases where id = c), false);
  update public.cases set stage = 'documents' where id = c;
  insert into public.candidate_links (id, org_id, case_id, token_hash, expires_at, sent_at, sent_via, language)
  select 'b4900000-5555-4000-8000-000000000001', org_id, id, 'b49hash', now() + interval '1 day', now(), array['sms'], 'en' from public.cases where id = c;
end $$;
do $$
declare r record;
begin
  select * into r from public.candidate_reminder_candidates() where link_id = 'b4900000-5555-4000-8000-000000000001';
  assert r.candidate_email = 'wrong@example.test', 'the reminder should reach who the link reached: ' || coalesce(r.candidate_email, 'null');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.update_candidate(current_setting('t.typed_candidate')::uuid, '{"email":"right@example.test"}');
end $$;
reset role;
do $$
declare r record; c uuid := current_setting('t.typed')::uuid;
begin
  assert (select intake_candidate ->> 'email' from public.cases where id = c) = 'right@example.test', 'a correction should replace what the client typed';
  assert (select intake_candidate ->> 'phone' from public.cases where id = c) = '0771111111', 'a correction leaves the rest';
  -- An SMS is not the formal request the flowchart asks for.
  insert into public.communications (org_id, case_id, channel, direction, counterparty, body)
  values ('00000000-0000-4000-8000-000000000001', c, 'phone', 'outbound', 'Typed Person', 'Spoke to them');
  assert public.candidate_contact_gap(c) like '%by email%', 'an SMS alone should not count: ' || coalesce(public.candidate_contact_gap(c), 'null');
  update public.candidate_links set sent_via = array['sms', 'email'] where id = 'b4900000-5555-4000-8000-000000000001';
  assert public.candidate_contact_gap(c) is null, 'the page by email is the formal request';
end $$;
-- A case with a NIC on file under another name gets no link until a person looks.
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  update public.cases set candidate_match_open = true where id = c;
end $$;
set local role authenticated;
do $$ begin
  perform public.issue_candidate_link(current_setting('t.typed')::uuid, 'b49hash2', null, 'en', 14);
  raise exception 'TEST FAILED: a link went out before anyone checked the match';
exception when sqlstate '22023' then
  assert sqlerrm like '%check that first%', sqlerrm;
end $$;
reset role;
update public.cases set candidate_match_open = false where id = current_setting('t.typed')::uuid;

-- ---------------------------------------------------------------- the BGV form comes before Pre-QC, and Type 2 asks for what a candidate can send
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  insert into public.consent_forms (org_id, case_id, status, method) values ('00000000-0000-4000-8000-000000000001', c, 'accepted', 'esign');
  insert into public.candidate_requests (org_id, case_id, kind, title, form) values ('00000000-0000-4000-8000-000000000001', c, 'question', 'BGV part', true);
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  begin
    perform public.case_transition(c, 'submit_pre_qc');
    raise exception 'TEST FAILED: Pre-QC started with the BGV form unanswered';
  exception when sqlstate '22023' then
    assert sqlerrm like '%BGV form%', sqlerrm;
  end;
  begin
    perform public.request_case_document(c, null, 'sanction_report', 'Screening report', 'Please send');
    raise exception 'TEST FAILED: a candidate was asked for what only Ontriq has';
  exception when sqlstate '22023' then
    assert sqlerrm like '%can''t provide%', sqlerrm;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- phone numbers the form accepts are accepted
do $$
declare f jsonb := '{"type":"phone"}';
begin
  assert public.field_value_ok(f, '"0112345678 ext. 205"'), 'an extension should pass';
  assert public.field_value_ok(f, '"077.123.4567"'), 'dots should pass';
  assert public.field_value_ok(f, '"+94-11-2345678 #12"'), 'a hash extension should pass';
  assert not public.field_value_ok(f, '"call me"'), 'words are not a number';
end $$;

-- ---------------------------------------------------------------- evidence keeps its place
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  update public.cases set stage = 'post_qc' where id = c;
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind, visibility) values
    ('b4900000-1111-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'moved.pdf', 'application/pdf', 'x/m.pdf', 'accepted', 'staff', 'internal'),
    ('b4900000-1111-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'shown.pdf', 'application/pdf', 'x/s.pdf', 'accepted', 'staff', 'internal'),
    ('b4900000-1111-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'parent.pdf', 'application/pdf', 'x/v.pdf', 'accepted', 'staff', 'report');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb;
begin
  -- Post-QC can put a file in the report, and nothing more.
  perform public.set_document_visibility('b4900000-1111-4000-8000-000000000004', 'report');
  assert (select visibility from public.documents where id = 'b4900000-1111-4000-8000-000000000004') = 'report', 'QC should be able to put evidence in the report';
  begin
    perform public.set_document_visibility('b4900000-1111-4000-8000-000000000004', 'client');
    raise exception 'TEST FAILED: QC shared a file with the client';
  exception when insufficient_privilege then null;
  end;
  -- Moved into a kind of evidence, it goes in the report.
  perform public.refile_document('b4900000-1111-4000-8000-000000000003', null, 'service_letter');
  assert (select visibility from public.documents where id = 'b4900000-1111-4000-8000-000000000003') = 'report', 'a file moved into evidence stayed internal';
  -- A new version keeps its place.
  d := public.begin_document_upload(current_setting('t.typed')::uuid, null, 'other', 'parent-2.pdf', 'application/pdf', 100, 'b4900000-1111-4000-8000-000000000005');
  assert (select visibility from public.documents where id = (d ->> 'id')::uuid) = 'report', 'a new version fell out of the report';
exception when insufficient_privilege then
  raise exception 'TEST FAILED: %', sqlerrm;
end $$;
reset role;

-- ---------------------------------------------------------------- resuming a case says so once
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  update public.cases set stage = 'documents' where id = c;
  update public.documents set status = 'accepted' where case_id = c;
  perform public.recompute_case(c);
  delete from public.notifications where entity_id = c;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_case_hold(current_setting('t.typed')::uuid, true, 'Client asked');
  perform public.set_case_hold(current_setting('t.typed')::uuid, false);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where entity_id = current_setting('t.typed')::uuid and title like '%resumed%' and user_id = 'b4900000-0000-4000-8000-000000000004') = 1, 'resuming should say so once';
  assert (select count(*) from public.notifications where entity_id = current_setting('t.typed')::uuid and user_id = 'b4900000-0000-4000-8000-000000000004') = 2, 'a hold and a resume are two notices';
end $$;

-- ---------------------------------------------------------------- on hold, nothing goes out
do $$ begin
  update public.cases set on_hold = true where id = current_setting('t.typed')::uuid;
end $$;
set local role authenticated;
do $$ begin
  perform public.post_candidate_message(current_setting('t.typed')::uuid, 'Hello');
  raise exception 'TEST FAILED: a message went out on hold';
exception when sqlstate '22023' then null;
end $$;
do $$ begin
  perform public.record_candidate_link_sent('b4900000-5555-4000-8000-000000000001', array['email']);
  raise exception 'TEST FAILED: a link was sent again on hold';
exception when sqlstate '22023' then null;
end $$;
reset role;
update public.cases set on_hold = false where id = current_setting('t.typed')::uuid;

-- ---------------------------------------------------------------- whoever finds the gap can send it back
do $$ begin
  update public.cases set stage = 'data_entry' where id = current_setting('t.typed')::uuid;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.case_transition(current_setting('t.typed')::uuid, 'return_to_documents', 'The letter is for another employer') = 'documents', 'data entry should be able to send it back';
end $$;
reset role;

-- ---------------------------------------------------------------- a stale draft doesn't reach the approver, and the approver's copy stays still
do $$
declare c uuid := current_setting('t.typed')::uuid;
begin
  update public.cases set stage = 'report', on_hold = false where id = c;
  insert into public.report_versions (id, org_id, case_id, version, kind, status, source_stamp, annexures)
  values ('b4900000-4444-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', c, 1, 'draft', 'ready', 'an old stamp', '[]');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.submit_report(current_setting('t.typed')::uuid);
  raise exception 'TEST FAILED: a stale draft went for approval';
exception when sqlstate '22023' then
  assert sqlerrm like '%changed after this draft%', sqlerrm;
end $$;
reset role;
update public.cases set stage = 'approval' where id = current_setting('t.typed')::uuid;
set local role authenticated;
do $$ begin
  begin
    perform public.update_case_details(current_setting('t.typed')::uuid, '{"position_title":"Changed"}');
    raise exception 'TEST FAILED: the approver''s copy changed under them';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.update_candidate(current_setting('t.typed_candidate')::uuid, '{"full_name":"Someone Else"}');
    raise exception 'TEST FAILED: the candidate''s name changed under the approver';
  exception when sqlstate '22023' then null;
  end;
  perform public.update_candidate(current_setting('t.typed_candidate')::uuid, '{"phone":"0772222222"}');
end $$;
reset role;

-- ---------------------------------------------------------------- monthly billing misses nobody
do $$
declare c uuid := current_setting('t.typed')::uuid; m date := date_trunc('month', (now() at time zone 'Asia/Colombo')::date)::date;
begin
  update public.clients set billing_policy = 'monthly_consolidated' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  update public.cases set stage = 'report', released_at = now() where id = c;
  assert exists (select 1 from public.monthly_billing_due(m) where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'a case under revision was skipped by monthly billing';
end $$;

rollback;
\o
\echo '  ✓ independent audit'
