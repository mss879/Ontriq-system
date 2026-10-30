\o /dev/null
-- Fixes from the security review (0038): each test is the attack the review found.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3800000-0000-4000-8000-000000000001', 'admin38@ontriq.test', '{"full_name":"Ama Admin"}'),
  ('a3800000-0000-4000-8000-000000000002', 'viewer38@ontriq.test', '{"full_name":"Vee Viewer"}'),
  ('a3800000-0000-4000-8000-000000000003', 'va38@ontriq.test', '{"full_name":"Vihanga A"}'),
  ('a3800000-0000-4000-8000-000000000004', 'vb38@ontriq.test', '{"full_name":"Vihanga B"}'),
  ('a3800000-0000-4000-8000-000000000005', 'entry38@ontriq.test', '{"full_name":"Eranga Entry"}'),
  ('a3800000-0000-4000-8000-000000000006', 'client38@hemas.test', '{"full_name":"Chamari Client"}'),
  ('a3800000-0000-4000-8000-000000000007', 'super38@ontriq.test', '{"full_name":"Suneth Super"}'),
  ('a3800000-0000-4000-8000-000000000008', 'finance38@ontriq.test', '{"full_name":"Fathima Finance"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('a3800000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('a3800000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'viewer'),
  ('a3800000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a3800000-0000-4000-8000-000000000004'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('a3800000-0000-4000-8000-000000000005'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('a3800000-0000-4000-8000-000000000006'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('a3800000-0000-4000-8000-000000000007'::uuid, 'staff', null::uuid, 'super_admin'),
  ('a3800000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'client_relations')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object('client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'candidate', jsonb_build_object('full_name', 'Nadeeka Weerasinghe', 'nic', '198812345678', 'nic_canonical', '198812345678')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
-- Unowned case at the report stage; verifier A holds the first check, the second belongs to nobody.
do $$
declare k1 uuid; k2 uuid; d1 uuid; d2 uuid;
begin
  select id into k1 from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1;
  select id into k2 from public.case_checks where case_id = current_setting('t.case')::uuid order by sort offset 1 limit 1;
  perform set_config('t.k1', k1::text, false);
  perform set_config('t.k2', k2::text, false);
  update public.cases set stage = 'report', assigned_to = null where id = current_setting('t.case')::uuid;
  update public.case_checks set assigned_to = 'a3800000-0000-4000-8000-000000000003', client_note = 'Confirmed.' where id = k1;
  update public.case_checks set assigned_to = null, client_note = 'Registrar confirmed the degree.' where id = k2;
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, field_key, value)
  values ('00000000-0000-4000-8000-000000000001', 'document.extract', 'case_check', k1, 'nic_number', '{"value":"198812345678"}');
  insert into public.documents (org_id, case_id, client_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind, visibility)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nic', 'a.jpg', 'image/jpeg', 'case-files', 'org/t38/a.jpg', 'uploaded', 'client', 'client')
  returning id into d1;
  insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'nic', 'b.jpg', 'image/jpeg', 'case-files', 'org/t38/b.jpg', 'uploaded', 'staff')
  returning id into d2;
  perform set_config('t.doc', d1::text, false);
  insert into public.document_ai (document_id, org_id, classification) values (d1, '00000000-0000-4000-8000-000000000001', '{"possible_tampering": true, "tampering_notes": "photo looks pasted"}');
  insert into public.notifications (org_id, user_id, type, title, body, entity_type, entity_id)
  values ('00000000-0000-4000-8000-000000000001', 'a3800000-0000-4000-8000-000000000001', 'case.assigned', 'New case for Nadeeka Weerasinghe', 'Nadeeka Weerasinghe · Hemas', 'case', current_setting('t.case')::uuid);
  insert into public.generated_documents (org_id, kind, entity_type, entity_id, version, template_key, title)
  values ('00000000-0000-4000-8000-000000000001', 'invoice', 'invoice', gen_random_uuid(), 1, 'executive', 'INV-T38');
end $$;

-- ================================================================= AI suggestions follow case access
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.ai_suggestions where entity_id = current_setting('t.k1')::uuid), 'data entry read a suggestion on a case they are not on';
end $$;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.ai_suggestions where entity_id = current_setting('t.k1')::uuid), 'the officer on the check should see its suggestion';
end $$;

-- ================================================================= "no owner" no longer passes
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.request_report_draft(current_setting('t.case')::uuid);
    raise exception 'TEST FAILED: the viewer generated a draft on an unowned case';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_report(current_setting('t.case')::uuid);
    raise exception 'TEST FAILED: the viewer submitted a report on an unowned case';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  begin
    perform public.set_check_state(current_setting('t.k2')::uuid, 'awaiting_response');
    raise exception 'TEST FAILED: an officer changed a check that isn''t theirs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_check_remarks(current_setting('t.k2')::uuid, 'Employer confirmed no issues');
    raise exception 'TEST FAILED: an officer rewrote remarks on a check that isn''t theirs';
  exception when insufficient_privilege then null;
  end;
  perform public.set_check_remarks(current_setting('t.k1')::uuid, 'NIC confirmed with the Department of Registration of Persons.');
end $$;
reset role;
update public.cases set on_hold = true, hold_reason = 'test' where id = current_setting('t.case')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_remarks(current_setting('t.k2')::uuid, 'x');
  raise exception 'TEST FAILED: remarks changed on a case on hold';
exception when sqlstate '22023' then null;
end $$;
reset role;
update public.cases set on_hold = false, hold_reason = null where id = current_setting('t.case')::uuid;

-- ================================================================= clients don't see AI readings; PDFs by kind
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert exists (select 1 from public.documents where id = current_setting('t.doc')::uuid), 'the client should see their shared document';
  assert not exists (select 1 from public.document_ai where document_id = current_setting('t.doc')::uuid), 'a client read the AI''s tamper notes';
end $$;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.generated_documents where title = 'INV-T38'), 'an officer saw an invoice PDF';
end $$;
select set_config('request.jwt.claims', '{"sub":"a3800000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.generated_documents where title = 'INV-T38'), 'finance should see the invoice PDF';
end $$;

-- ================================================================= real upload size
reset role;
do $$
declare d uuid;
begin
  insert into storage.objects (bucket_id, name, metadata) values ('case-files', 'org/t38/huge.pdf', '{"size": 31457280}');
  insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind, size_bytes)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'nic', 'huge.pdf', 'application/pdf', 'case-files', 'org/t38/huge.pdf', 'pending_upload', 'candidate', 1000)
  returning id into d;
  begin
    update public.documents set status = 'uploaded' where id = d;
    raise exception 'TEST FAILED: a 30 MB file was accepted because the browser said it was small';
  exception when sqlstate '22023' then null;
  end;
  insert into storage.objects (bucket_id, name, metadata) values ('case-files', 'org/t38/ok.pdf', '{"size": 2048000}');
  insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind, size_bytes)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'nic', 'ok.pdf', 'application/pdf', 'case-files', 'org/t38/ok.pdf', 'pending_upload', 'candidate', 10)
  returning id into d;
  update public.documents set status = 'uploaded' where id = d;
  assert (select size_bytes from public.documents where id = d) = 2048000, 'the real size should replace the declared one';
end $$;

-- ================================================================= erasure with several files, twice
do $$
declare r2 jsonb;
begin
  update public.cases set stage = 'cancelled', cancelled_at = now() where id = current_setting('t.case')::uuid;
  perform set_config('request.jwt.claims', '', true);
  perform public.erase_case(current_setting('t.case')::uuid, 'Candidate asked for deletion');
  assert not exists (select 1 from public.notifications where title like '%Nadeeka%' or body like '%Nadeeka%'), 'notifications still name the candidate';
  -- A second case with files erases too (tombstone paths stay unique).
  r2 := (select jsonb_build_object('id', id) from public.cases where stage = 'cancelled' and erased_at is null limit 1);
  if r2 is not null then
    insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind)
    values ('00000000-0000-4000-8000-000000000001', (r2 ->> 'id')::uuid, 'nic', 'c.jpg', 'image/jpeg', 'case-files', 'org/t38/c.jpg', 'uploaded', 'staff');
    perform public.erase_case((r2 ->> 'id')::uuid, 'Retention period passed');
  end if;
end $$;

rollback;
\echo '  ✓ security review fixes'
