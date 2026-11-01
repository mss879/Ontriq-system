\o /dev/null
-- What the last read of the 0049 fixes found. Each block replays one of its
-- scenarios, including the paths a compile can't check.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c4900000-0000-4000-8000-000000000001', 'admin@c49.test', '{"full_name":"Ama Admin"}'),
  ('c4900000-0000-4000-8000-000000000002', 'officer@c49.test', '{"full_name":"Vihanga Officer"}'),
  ('c4900000-0000-4000-8000-000000000003', 'qc@c49.test', '{"full_name":"Kumari QC"}'),
  ('c4900000-0000-4000-8000-000000000004', 'clientadmin@c49.test', '{"full_name":"Chamari Client"}'),
  ('c4900000-0000-4000-8000-000000000007', 'ops@c49.test', '{"full_name":"Oshan Ops"}'),
  ('c4900000-0000-4000-8000-000000000008', 'entry@c49.test', '{"full_name":"Dilini Entry"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('c4900000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('c4900000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('c4900000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'qc_officer'),
  ('c4900000-0000-4000-8000-000000000004'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('c4900000-0000-4000-8000-000000000007'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('c4900000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'data_entry_officer')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';
update public.package_items set unit_price = 2000 where check_type_id = (select id from public.check_types where key = 'nic');
update public.package_items set unit_price = 3500 where check_type_id = (select id from public.check_types where key = 'police');
update public.orgs set settings = jsonb_set(settings, '{workflow}', coalesce(settings -> 'workflow', '{}'::jsonb) || '{"qc_checklists":{"pre":[],"post":[]}}') where id = '00000000-0000-4000-8000-000000000001';

-- Four cases, two of each kind, kept apart so one scenario can't lean on another.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb; n int := 0; v text;
begin
  foreach v in array array['one', 'money', 'held', 'late'] loop
    r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
      'candidate', jsonb_build_object('full_name', 'Type One ' || v)));
    perform set_config('t.' || v, r ->> 'case_id', false);
  end loop;
  foreach v in array array['two', 'paper', 'waive'] loop
    r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
      'process_type', 'candidate_collected', 'candidate', jsonb_build_object('full_name', 'Type Two ' || v, 'email', v || '@example.test')));
    perform set_config('t.' || v, r ->> 'case_id', false);
    perform set_config('t.' || v || '_candidate', r ->> 'candidate_id', false);
  end loop;
end $$;
reset role;

-- ---------------------------------------------------------------- a paper consent form can be recorded
do $$ begin
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by, uploaded_by_kind) values
    ('c4900000-1111-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', current_setting('t.paper')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'consent_form', 'paper.pdf', 'application/pdf', 'x/p.pdf', 'uploaded', 'c4900000-0000-4000-8000-000000000001', 'staff'),
    ('c4900000-1111-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', current_setting('t.paper')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'consent_form', 'signed-photo.jpg', 'image/jpeg', 'x/s.jpg', 'uploaded', null, 'candidate');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.paper')::uuid;
begin
  perform public.review_consent(c, true, 'Signed in person', 'c4900000-1111-4000-8000-000000000001');
  assert (select status from public.consent_forms where case_id = c) = 'accepted', 'the paper form should stand as consent';
  assert (select method from public.consent_forms where case_id = c) = 'staff', 'the method should say staff recorded it';
end $$;
-- Consent is reviewed as consent. The file row would leave the form standing and the candidate with no way to replace it.
do $$ begin
  perform public.review_document('c4900000-1111-4000-8000-000000000001', false, 'Wrong form');
  raise exception 'TEST FAILED: the file behind accepted consent was rejected';
exception when sqlstate '22023' then
  assert sqlerrm like '%Candidate section%', sqlerrm;
end $$;
do $$ begin
  perform public.review_document('c4900000-1111-4000-8000-000000000002', false, 'Blurred');
  raise exception 'TEST FAILED: the candidate''s consent photo was rejected from the file row';
exception when sqlstate '22023' then
  assert sqlerrm like '%Candidate section%', sqlerrm;
end $$;
reset role;

-- ---------------------------------------------------------------- whoever sends a case back, the message goes with it
update public.cases set stage = 'data_entry', assigned_to = null where id in (current_setting('t.one')::uuid, current_setting('t.two')::uuid);
delete from public.notifications where entity_id in (current_setting('t.one')::uuid, current_setting('t.two')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.case_transition(current_setting('t.one')::uuid, 'return_to_documents', 'The NIC photo is blurred. Please send a clearer one.');
  perform public.case_transition(current_setting('t.two')::uuid, 'return_to_documents', 'Your service letter is for another employer.');
  assert not public.case_visible(current_setting('t.one')::uuid), 'data entry should lose the case once it goes back: that is why the message goes with the move';
end $$;
reset role;
do $$
declare one uuid := current_setting('t.one')::uuid; two uuid := current_setting('t.two')::uuid;
begin
  assert exists (select 1 from public.client_requests where case_id = one and status = 'open' and question like 'The NIC photo%'), 'the client should have the question';
  assert exists (select 1 from public.notifications where entity_id = one and type = 'portal.information_needed'), 'the client should hear what is needed';
  assert not exists (select 1 from public.notifications where entity_id = one and type = 'portal.case_status'), 'the question says it all';
  assert (select body from public.candidate_messages where case_id = two and from_kind = 'staff') like 'Your service letter%', 'the candidate should have the message';
  assert not exists (select 1 from public.client_requests where case_id = two), 'a candidate''s message never falls through to the client';
  assert not exists (select 1 from public.notifications where entity_id = two and type like 'portal.%'), 'the client has nothing to do on a Type 2 return';
  assert (select stage from public.cases where id = one) = 'documents', 'the case should be back at documents';
end $$;

-- ---------------------------------------------------------------- an unused link doesn't stop a client-supplied case
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare l uuid;
begin
  l := public.issue_candidate_link(current_setting('t.one')::uuid, repeat('a', 64), 'sealed');
  perform public.revoke_candidate_link(l, 'Not needed after all');
end $$;
reset role;
do $$
declare one uuid := current_setting('t.one')::uuid;
begin
  assert (select status from public.consent_forms where case_id = one) = 'pending', 'the link should have opened a consent row';
  assert not public.case_consent_missing(one), 'an unused link stopped a client-supplied case';
  update public.consent_forms set status = 'rejected' where case_id = one;
  assert public.case_consent_missing(one), 'a rejected form stops any case';
  update public.consent_forms set status = 'accepted' where case_id = one;
  assert not public.case_consent_missing(one), 'accepted consent is enough';
end $$;

-- ---------------------------------------------------------------- consent rejected during verification stops the case too
do $$
declare two uuid := current_setting('t.two')::uuid;
begin
  insert into public.consent_forms (org_id, case_id, status, method) values ('00000000-0000-4000-8000-000000000001', two, 'submitted', 'esign');
  update public.cases set stage = 'verification', returned_at = null where id = two;
  update public.consent_forms set status = 'rejected' where case_id = two;
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = two;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.case_transition(current_setting('t.two')::uuid, 'submit_post_qc', 'It can''t wait');
  raise exception 'TEST FAILED: the case left verification with rejected consent';
exception when sqlstate '22023' then
  assert sqlerrm like '%consent%', sqlerrm;
end $$;
reset role;
update public.cases set stage = 'post_qc' where id = current_setting('t.two')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.record_qc_review(current_setting('t.two')::uuid, 'post', 'approved', '[{"item":"Readable","ok":true}]');
  raise exception 'TEST FAILED: Post-QC approved with rejected consent';
exception when sqlstate '22023' then
  assert sqlerrm like '%consent%', sqlerrm;
end $$;

-- ---------------------------------------------------------------- nobody is asked for a file that can't come in
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.review_consent(current_setting('t.two')::uuid, false, 'Please sign again');
  raise exception 'TEST FAILED: consent went back after uploads closed';
exception when sqlstate '22023' then
  assert sqlerrm like '%uploads closed%', sqlerrm;
end $$;
reset role;
do $$
declare two uuid := current_setting('t.two')::uuid;
begin
  insert into public.candidate_requests (id, org_id, case_id, kind, title, status) values
    ('c4900000-2222-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', two, 'document', 'Service letter', 'answered'),
    ('c4900000-2222-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', two, 'question', 'When did you leave?', 'answered');
end $$;
set local role authenticated;
do $$ begin
  perform public.review_candidate_request('c4900000-2222-4000-8000-000000000001', 'reopen', 'A clearer copy please');
  raise exception 'TEST FAILED: a document was asked for after uploads closed';
exception when sqlstate '22023' then
  assert sqlerrm like '%uploads closed%', sqlerrm;
end $$;
do $$ begin
  -- A question can still be answered at this stage.
  perform public.review_candidate_request('c4900000-2222-4000-8000-000000000002', 'reopen', 'Which month?');
  assert (select status from public.candidate_requests where id = 'c4900000-2222-4000-8000-000000000002') = 'open', 'a question goes back to the candidate';
end $$;
reset role;

-- ---------------------------------------------------------------- a finding is corrected, never waived away
update public.cases set stage = 'verification' where id = current_setting('t.late')::uuid;
update public.case_checks set values_valid = true, state = 'in_progress' where case_id = current_setting('t.late')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.late')::uuid; k uuid;
begin
  select id into k from public.case_checks where case_id = c order by sort limit 1;
  perform set_config('t.late_check', k::text, false);
  perform public.set_check_state(k, 'discrepancy', null, 'Registry disagrees', 'The name differs from the register');
  assert (select discrepancy_at from public.case_checks where id = k) is not null, 'the discrepancy should be on record';
  perform public.set_check_state(k, 'in_progress');
  assert (select discrepancy_at from public.case_checks where id = k) is not null, 'reopening leaves the discrepancy on record';
end $$;
do $$ begin
  perform public.set_check_state(current_setting('t.late_check')::uuid, 'waived', null, 'Client dropped it');
  raise exception 'TEST FAILED: a reopened discrepancy was waived';
exception when sqlstate '22023' then
  assert sqlerrm like '%can''t be waived%', sqlerrm;
end $$;
reset role;
-- Sent back from Post-QC, the same.
update public.case_checks set state = 'returned', result = null, result_tone = null where id = current_setting('t.late_check')::uuid;
set local role authenticated;
do $$ begin
  perform public.set_check_state(current_setting('t.late_check')::uuid, 'waived', null, 'Client dropped it');
  raise exception 'TEST FAILED: a discrepancy returned from Post-QC was waived';
exception when sqlstate '22023' then
  assert sqlerrm like '%can''t be waived%', sqlerrm;
end $$;
do $$
declare k uuid := current_setting('t.late_check')::uuid;
begin
  perform public.set_check_state(k, 'unable_to_verify', null, 'Registry closed', 'The registry could not confirm');
  assert (select discrepancy_at from public.case_checks where id = k) is null, 'a new outcome replaces the old one';
  perform public.set_check_state(k, 'waived', null, 'The client removed this check');
  assert (select state from public.case_checks where id = k) = 'waived', 'with no finding on record the check can be waived';
end $$;
reset role;

-- ---------------------------------------------------------------- a waived check or slot asks nobody for anything
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.waive')::uuid; k uuid; q uuid; q2 uuid;
begin
  select k2.id into k from public.case_checks k2 where k2.case_id = c and exists (select 1 from public.case_check_requirements r where r.case_check_id = k2.id) order by k2.sort limit 1;
  perform set_config('t.waive_check', k::text, false);
  q := public.create_candidate_request(c, jsonb_build_object('kind', 'question', 'check_id', k, 'title', 'Which branch was it?'));
  perform set_config('t.waive_request', q::text, false);
  perform public.set_check_state(k, 'waived', null, 'The client removed this check');
  assert (select status from public.candidate_requests where id = q) = 'cancelled', 'a waived check still asked the candidate';
  -- One slot on its own.
  q2 := public.create_candidate_request(c, jsonb_build_object('kind', 'document', 'category', 'other', 'title', 'Anything else'));
  perform public.waive_requirement((select requirement_id from public.candidate_requests where id = q2), 'Not needed');
  assert (select status from public.candidate_requests where id = q2) = 'cancelled', 'a waived slot still asked the candidate';
end $$;
reset role;
update public.cases set stage = 'verification' where id = current_setting('t.waive')::uuid;
set local role authenticated;
do $$
declare k uuid := current_setting('t.waive_check')::uuid; q uuid := current_setting('t.waive_request')::uuid;
begin
  perform public.set_check_state(k, 'in_progress');
  assert (select status from public.candidate_requests where id = q) = 'open', 'bringing the check back should ask again';
  assert (select review_note from public.candidate_requests where id = q) is null, 'the note was ours, not the candidate''s to read';
end $$;
reset role;

-- ---------------------------------------------------------------- a revision stops only if the case still says what was released
do $$
declare c uuid := current_setting('t.held')::uuid; v_stamp text;
begin
  update public.cases set stage = 'report', released_at = now() where id = c;
  insert into public.report_versions (id, org_id, case_id, version, kind, status, released_at, final_result, annexures)
  values ('c4900000-4444-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', c, 2, 'final', 'released', now(), 'green', '[]');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not public.revision_can_stop(current_setting('t.held')::uuid), 'a report with no stamp can''t be shown to match';
end $$;
do $$ begin
  perform public.cancel_case(current_setting('t.held')::uuid, 'Never mind');
  raise exception 'TEST FAILED: a revision of a report with no stamp was stopped';
exception when sqlstate '22023' then
  assert sqlerrm like '%finish the revision%', sqlerrm;
end $$;
reset role;
do $$
declare c uuid := current_setting('t.held')::uuid;
begin
  update public.report_versions set source_stamp = public.case_report_stamp(c) where case_id = c;
end $$;
set local role authenticated;
do $$ begin
  assert public.revision_can_stop(current_setting('t.held')::uuid), 'nothing changed, so it can stop';
end $$;
reset role;
update public.case_checks set client_note = 'Reworded' where id = (select id from public.case_checks where case_id = current_setting('t.held')::uuid order by sort limit 1);
set local role authenticated;
do $$ begin
  assert not public.revision_can_stop(current_setting('t.held')::uuid), 'a changed finding can''t stand behind the released report';
end $$;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert public.revision_can_stop(current_setting('t.held')::uuid) is null, 'someone who can''t see the case learns nothing';
end $$;
reset role;

-- ---------------------------------------------------------------- what a report's sensitive files are is for those who see the case
do $$ begin
  insert into public.documents (id, org_id, case_id, client_id, category, filename, mime, storage_path, status, sensitive, uploaded_by_kind) values
    ('c4900000-1111-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', current_setting('t.held')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'police_report', 'private-report.pdf', 'application/pdf', 'x/r.pdf', 'accepted', true, 'staff');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert cardinality(public.report_sensitive_files('{"annexures":[{"document_id":"c4900000-1111-4000-8000-000000000003"}]}')) = 0, 'an officer read a filename from a case they can''t open';
end $$;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert cardinality(public.report_sensitive_files('{"annexures":[{"document_id":"c4900000-1111-4000-8000-000000000003"}]}')) = 1, 'the admin sees the case';
end $$;
reset role;

-- ---------------------------------------------------------------- a payment on an unsent invoice leaves nothing orphaned on the statement
do $$
declare c uuid := current_setting('t.money')::uuid;
begin
  update public.cases set stage = 'released', released_at = now() where id = c;
  perform set_config('t.money_invoice', public.draft_case_invoice(c)::text, false);
end $$;
do $$
declare i uuid := current_setting('t.money_invoice')::uuid;
begin
  update public.invoices set status = 'confirmed', number = 'INV-C49-1', issue_date = current_date, due_date = current_date + 30 where id = i;
  perform public.recompute_invoice(i);
  assert (select status from public.invoices where id = i) = 'confirmed', 'it starts unsent';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare i uuid := current_setting('t.money_invoice')::uuid;
begin
  perform public.record_payment(i, 100, 'bank_transfer', 'BANK-1');
  assert (select status from public.invoices where id = i) = 'partially_paid', 'a payment moves the invoice on';
end $$;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare l jsonb := public.client_statement('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date - 1, current_date + 1) -> 'lines';
begin
  assert exists (select 1 from jsonb_array_elements(l) x where x ->> 'kind' = 'payment' and x ->> 'reference' = 'BANK-1'), 'the payment should print';
  assert exists (select 1 from jsonb_array_elements(l) x where x ->> 'kind' = 'invoice' and x ->> 'reference' = 'INV-C49-1'), 'a credit with no invoice beside it';
end $$;
reset role;

-- ---------------------------------------------------------------- a month drafted early leaves nobody unbilled
select set_config('request.jwt.claims', '', true);
do $$
declare
  m date := date_trunc('month', (now() at time zone 'Asia/Colombo')::date)::date;
  a uuid := current_setting('t.one')::uuid; b uuid := current_setting('t.late')::uuid; d uuid := current_setting('t.paper')::uuid;
  v1 uuid; v2 uuid; v3 uuid;
  cl uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_policy text := (select billing_policy from public.clients where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
begin
  update public.clients set billing_policy = 'monthly_consolidated' where id = cl;
  update public.cases set released_at = null, stage = 'documents' where client_id = cl and id not in (a, current_setting('t.money')::uuid);
  update public.cases set stage = 'released', released_at = now() where id = a;
  v1 := public.draft_monthly_invoice(cl, m);
  assert v1 is not null, 'the month should draft';
  update public.cases set stage = 'released', released_at = now() where id = b;
  assert exists (select 1 from public.monthly_billing_due(m) where client_id = cl), 'the later case is still due';
  v2 := public.draft_monthly_invoice(cl, m);
  assert v2 = v1, 'a later case joins the draft';
  assert (select count(distinct case_id) from public.invoice_items where invoice_id = v1) = 2, 'both cases should be on it';
  assert (select count(distinct sort) from public.invoice_items where invoice_id = v1) = (select count(*) from public.invoice_items where invoice_id = v1), 'lines keep their order';
  assert not exists (select 1 from public.monthly_billing_due(m) where client_id = cl), 'nothing is due any more';
  update public.invoices set status = 'confirmed', number = 'INV-C49-2', issue_date = current_date where id = v1;
  update public.cases set stage = 'released', released_at = now() where id = d;
  v3 := public.draft_monthly_invoice(cl, m);
  assert v3 <> v1, 'once the month went out, a later case gets its own invoice';
  assert (select count(distinct case_id) from public.invoice_items where invoice_id = v3) = 1, 'only the new case';
  assert not exists (select 1 from public.monthly_billing_due(m) where client_id = cl), 'everything is billed';
  assert public.draft_monthly_invoice(cl, m) = v1, 'with nothing new, the month''s invoice comes back';
  update public.cases set stage = 'documents', released_at = null where id in (a, b, d);
  update public.clients set billing_policy = v_policy where id = cl;
end $$;

-- ---------------------------------------------------------------- the public page, on an erased case
do $$
declare c uuid := current_setting('t.held')::uuid;
begin
  insert into public.report_versions (id, org_id, case_id, version, kind, status, final_result, annexures)
  values ('c4900000-4444-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', c, 1, 'final', 'superseded', 'green', '[]');
  update public.cases set erased_at = now() where id = c;
  assert public.verify_report('c4900000-4444-4000-8000-000000000002') ->> 'status' = 'not_released', 'a final never released wasn''t issued, erased or not';
  assert public.verify_report('c4900000-4444-4000-8000-000000000001') ->> 'status' = 'erased', 'a released one reads as erased';
  update public.cases set erased_at = null where id = c;
end $$;

-- ---------------------------------------------------------------- the portal says who is being waited for, and lists no dead files
do $$
declare t1 uuid := current_setting('t.one')::uuid; t2 uuid := current_setting('t.paper')::uuid;
begin
  update public.case_checks set state = 'pending_info' where case_id in (t1, t2);
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind) values
    ('00000000-0000-4000-8000-000000000001', t1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'their-file.pdf', 'application/pdf', 'x/c.pdf', 'uploaded', 'client');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare d jsonb;
begin
  d := public.portal_case_detail(current_setting('t.one')::uuid);
  assert d -> 'checks' -> 0 ->> 'state' = 'needs_information', 'on a client-supplied case the client was asked';
  assert jsonb_array_length(d -> 'documents') > 0, 'their own file should list';
  d := public.portal_case_detail(current_setting('t.paper')::uuid);
  assert d -> 'checks' -> 0 ->> 'state' = 'waiting_for_candidate', 'on Type 2 the client has nothing to answer';
  assert d -> 'case' -> 'checks' -> 0 ->> 'state' = 'waiting_for_candidate', 'the list says the same';
end $$;
reset role;
update public.cases set erased_at = now() where id = current_setting('t.one')::uuid;
set local role authenticated;
do $$ begin
  assert jsonb_array_length(public.portal_case_detail(current_setting('t.one')::uuid) -> 'documents') = 0, 'erased files can''t be opened, so they aren''t listed';
end $$;
reset role;
update public.cases set erased_at = null where id = current_setting('t.one')::uuid;

-- ---------------------------------------------------------------- a corrected contact replaces what the client typed, even with what's on file
update public.cases set intake_candidate = '{"full_name":"Type Two waive","email":"typed@example.test","phone":"0771111111"}' where id = current_setting('t.waive')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.waive')::uuid; p uuid := current_setting('t.waive_candidate')::uuid;
begin
  perform public.update_candidate(p, '{"address":"12 Galle Road"}');
  assert (select intake_candidate ->> 'email' from public.cases where id = c) = 'typed@example.test', 'saving something else leaves the typed contact';
  assert (select email from public.candidates where id = p) = 'waive@example.test', 'and the record';
  perform public.update_candidate(p, '{"email":"waive@example.test"}');
  assert (select intake_candidate ->> 'email' from public.cases where id = c) = 'waive@example.test', 'staff chose the address on file';
end $$;
reset role;

-- ---------------------------------------------------------------- a new version keeps its row, without anyone asking
do $$
declare c uuid := current_setting('t.late')::uuid; k uuid;
begin
  update public.cases set stage = 'documents' where id = c;
  select id into k from public.case_checks where case_id = c order by sort limit 1;
  insert into public.documents (id, org_id, case_id, client_id, case_check_id, category, filename, mime, storage_path, status, record_key, uploaded_by_kind) values
    ('c4900000-1111-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', k, 'other', 'first.pdf', 'application/pdf', 'x/f.pdf', 'rejected', 'employers.0', 'staff');
  perform set_config('t.late_check', k::text, false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.begin_document_upload(current_setting('t.late')::uuid, current_setting('t.late_check')::uuid, 'other', 'second.pdf', 'application/pdf', 100, 'c4900000-1111-4000-8000-000000000004');
  assert (select record_key from public.documents where id = (r ->> 'id')::uuid) = 'employers.0', 'a new version fell off its row';
end $$;
reset role;

-- ---------------------------------------------------------------- lists name the client for those who work the case
update public.cases set stage = 'data_entry' where id = current_setting('t.late')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$
declare v_name text;
begin
  assert not exists (select 1 from public.clients), 'data entry has no access to client records';
  select client_name into v_name from public.case_client_names(array[current_setting('t.late')::uuid]);
  assert v_name is not null, 'the list needs the name of a case they work';
  assert not exists (select 1 from public.case_client_names(array[current_setting('t.money')::uuid])), 'not of a case they can''t see';
end $$;
reset role;

-- ---------------------------------------------------------------- a slot asked for again during the work is due by the end of verification
update public.cases set stage = 'verification' where id = current_setting('t.late')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.late')::uuid; r uuid; v_cat text; k uuid;
begin
  select id, category, case_check_id into r, v_cat, k from public.case_check_requirements where case_id = c and stage = 'documents' order by created_at limit 1;
  assert r = public.request_case_document(c, k, v_cat, 'Asked again', 'A clearer copy please'), 'it should reopen the slot';
  assert (select stage from public.case_check_requirements where id = r) = 'verification', 'the slot still says it is due before Pre-QC';
end $$;
reset role;

-- ---------------------------------------------------------------- a waived check that comes back needs its evidence again
update public.cases set stage = 'documents', on_hold = false, erased_at = null where id = current_setting('t.paper')::uuid;
update public.case_checks set state = 'not_started' where case_id = current_setting('t.paper')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.paper')::uuid; k uuid; q uuid;
begin
  select k2.id into k from public.case_checks k2 where k2.case_id = c and exists (select 1 from public.case_check_requirements r where r.case_check_id = k2.id and r.status = 'pending') order by k2.sort limit 1;
  perform set_config('t.back_check', k::text, false);
  q := public.create_candidate_request(c, jsonb_build_object('kind', 'question', 'check_id', k, 'title', 'Which branch?'));
  perform set_config('t.back_request', q::text, false);
  perform public.set_check_state(k, 'waived', null, 'The client removed this check');
  assert not exists (select 1 from public.case_check_requirements where case_check_id = k and status = 'pending'), 'the slots go with the check';
end $$;
reset role;
update public.cases set stage = 'post_qc' where id = current_setting('t.paper')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare k uuid := current_setting('t.back_check')::uuid; q uuid := current_setting('t.back_request')::uuid;
begin
  perform public.record_qc_review(current_setting('t.paper')::uuid, 'post', 'returned', '[]', 'This check is needed after all', array[k]);
  assert (select state from public.case_checks where id = k) = 'returned', 'the check should be back';
  assert exists (select 1 from public.case_check_requirements where case_check_id = k and status = 'pending'), 'a returned check could be finished with no evidence';
  assert (select status from public.candidate_requests where id = q) = 'open', 'and the candidate is asked again';
end $$;
reset role;
-- From the report stage, the same.
do $$
declare k uuid := current_setting('t.back_check')::uuid; q uuid := current_setting('t.back_request')::uuid;
begin
  update public.cases set stage = 'verification' where id = current_setting('t.paper')::uuid;
  update public.candidate_requests set status = 'answered' where id = q;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_state(current_setting('t.back_check')::uuid, 'waived', null, 'Not needed after all');
end $$;
reset role;
update public.cases set stage = 'report' where id = current_setting('t.paper')::uuid;
set local role authenticated;
do $$
declare k uuid := current_setting('t.back_check')::uuid;
begin
  perform public.return_to_verification(current_setting('t.paper')::uuid, 'It is needed', array[k]);
  assert exists (select 1 from public.case_check_requirements where case_check_id = k and status = 'pending'), 'a check returned from the report kept its evidence waived';
end $$;
reset role;

-- ---------------------------------------------------------------- a waived check stops asking the client too
do $$
declare c uuid := current_setting('t.money')::uuid;
begin
  update public.cases set stage = 'verification', released_at = null where id = c;
  update public.case_checks set state = 'in_progress' where case_id = c;
  perform set_config('t.q_check', (select id::text from public.case_checks where case_id = c order by sort limit 1), false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$
declare c uuid := current_setting('t.money')::uuid; k uuid := current_setting('t.q_check')::uuid; q uuid;
begin
  q := public.create_client_request(c, k, 'Which branch was this?');
  assert (select status_key from public.cases where id = c) = 'pending_information', 'the case should wait for the answer';
  perform public.set_check_state(k, 'waived', null, 'The client removed this check');
  assert (select status from public.client_requests where id = q) = 'closed', 'the client was still asked about a waived check';
  assert (select status_key from public.cases where id = c) <> 'pending_information', 'the case still reads as waiting for them';
end $$;
reset role;

-- ---------------------------------------------------------------- cancelling a held case tells the client once
do $$
declare c uuid := current_setting('t.late')::uuid;
begin
  update public.cases set stage = 'documents', on_hold = false, manual_status_key = null, returned_at = null where id = c;
  update public.case_check_requirements set status = 'waived', waived_reason = 'test' where case_id = c;
  update public.case_checks set state = 'not_started' where case_id = c;
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_path, status, uploaded_by_kind) values
    ('00000000-0000-4000-8000-000000000001', c, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', 'in.pdf', 'application/pdf', 'x/in.pdf', 'uploaded', 'client');
  perform public.recompute_case(c);
  assert (select status_key from public.cases where id = c) = 'document_review', 'the scenario needs a case in document review, got ' || (select status_key from public.cases where id = c);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_case_hold(current_setting('t.late')::uuid, true, 'Waiting for the client');
end $$;
reset role;
delete from public.notifications where entity_id = current_setting('t.late')::uuid;
set local role authenticated;
do $$ begin
  perform public.cancel_case(current_setting('t.late')::uuid, 'Candidate withdrew');
end $$;
reset role;
do $$
declare c uuid := current_setting('t.late')::uuid;
begin
  assert not exists (select 1 from public.notifications where entity_id = c and type = 'portal.case_status' and title like '%review%'), 'lifting the hold told the client the case was in document review';
  assert exists (select 1 from public.notifications where entity_id = c and type = 'portal.case_status' and lower(title) like '%cancelled%'), 'the cancellation should reach them';
end $$;

-- ---------------------------------------------------------------- a return is the candidate's to read only if it is theirs to act on
do $$
declare t1 uuid := current_setting('t.one')::uuid; t2 uuid := current_setting('t.two')::uuid;
begin
  assert not (select visible_to_candidate from public.case_events where case_id = t1 and kind = 'returned' order by at desc limit 1), 'the message went to the client, and the candidate has nothing to do';
  assert (select visible_to_candidate from public.case_events where case_id = t2 and kind = 'returned' order by at desc limit 1), 'on Type 2 the candidate hears of it';
end $$;

-- ---------------------------------------------------------------- a client's answer hands the check back to Ontriq
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select set_config('t.answer_case', (public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'ESSENTIAL'),
  'candidate', jsonb_build_object('full_name', 'Type One answer'))) ->> 'case_id'), false);
reset role;
do $$
declare c public.cases; k uuid; q uuid;
begin
  select * into c from public.cases where id = current_setting('t.answer_case')::uuid;
  select id into k from public.case_checks where case_id = c.id order by sort limit 1;
  update public.case_checks set state = 'pending_info' where id = k;
  insert into public.client_requests (org_id, case_id, case_check_id, question, status)
  values (c.org_id, c.id, k, 'When did they leave?', 'open') returning id into q;
  perform public.recompute_case(c.id);
  assert (select status_key from public.cases where id = c.id) = 'pending_information', 'the question puts the case on the client';
  perform set_config('t.answer_check', k::text, false);
  perform set_config('t.answer_q', q::text, false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c4900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
select public.portal_answer_request(current_setting('t.answer_q')::uuid, 'The 30th of June');
reset role;
do $$
begin
  assert (select state from public.case_checks where id = current_setting('t.answer_check')::uuid) = 'in_progress', 'the answer hands the check back';
  assert (select status_key from public.cases where id = current_setting('t.answer_case')::uuid) <> 'pending_information', 'the case stops waiting on the client';
end $$;

rollback;
\o
\echo '  ✓ last read of the fixes'
