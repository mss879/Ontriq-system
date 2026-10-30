\o /dev/null
-- Performance and nudges (0017), the assistant (0019, 0020) and the AI pipeline (0029).
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000001', 'admin4@ontriq.test', '{"full_name":"Asha Admin"}'),
  ('f1000000-0000-4000-8000-000000000002', 'ops4@ontriq.test', '{"full_name":"Omar Ops"}'),
  ('f1000000-0000-4000-8000-000000000003', 'va4@ontriq.test', '{"full_name":"Vihan Verifier"}'),
  ('f1000000-0000-4000-8000-000000000004', 'vb4@ontriq.test', '{"full_name":"Vindi Verifier"}'),
  ('f1000000-0000-4000-8000-000000000005', 'super4@ontriq.test', '{"full_name":"Sara Super"}'),
  ('f1000000-0000-4000-8000-000000000006', 'entry4@ontriq.test', '{"full_name":"Eshan Entry"}'),
  ('f1000000-0000-4000-8000-000000000007', 'client4@hemas.test', '{"full_name":"Chathu Client"}'),
  ('f1000000-0000-4000-8000-000000000008', 'viewer4@ontriq.test', '{"full_name":"Vee Viewer"}');
insert into public.memberships (org_id, user_id, kind, client_id, role_id, status)
select '00000000-0000-4000-8000-000000000001', u.id, u.kind::public.member_kind, u.client_id, r.id, 'active'
from (values
  ('f1000000-0000-4000-8000-000000000001'::uuid, 'staff', null::uuid, 'admin'),
  ('f1000000-0000-4000-8000-000000000002'::uuid, 'staff', null::uuid, 'operations_manager'),
  ('f1000000-0000-4000-8000-000000000003'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('f1000000-0000-4000-8000-000000000004'::uuid, 'staff', null::uuid, 'verification_officer'),
  ('f1000000-0000-4000-8000-000000000005'::uuid, 'staff', null::uuid, 'super_admin'),
  ('f1000000-0000-4000-8000-000000000006'::uuid, 'staff', null::uuid, 'data_entry_officer'),
  ('f1000000-0000-4000-8000-000000000007'::uuid, 'client', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'client_admin'),
  ('f1000000-0000-4000-8000-000000000008'::uuid, 'staff', null::uuid, 'viewer')
) as u(id, kind, client_id, role_key)
join public.roles r on r.key = u.role_key and r.org_id = '00000000-0000-4000-8000-000000000001';

-- A case whose checks are overdue with verifier A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  r := public.create_case(jsonb_build_object(
    'client_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package_id', (select id from public.packages where code = 'STANDARD'),
    'process_type', 'client_supplied', 'candidate', jsonb_build_object('full_name', 'Kasun Silva', 'nic', '199012345678', 'nic_canonical', '199012345678')));
  perform set_config('t.case', r ->> 'case_id', false);
end $$;
reset role;
update public.case_checks set assigned_to = 'f1000000-0000-4000-8000-000000000003', assigned_at = now() - interval '3 days', due_at = now() - interval '2 days'
 where case_id = current_setting('t.case')::uuid;
update public.cases set assigned_to = 'f1000000-0000-4000-8000-000000000003' where id = current_setting('t.case')::uuid;
do $$ begin
  assert public.performance_rollup(current_date - 1) > 0, 'roll-up wrote no rows';
end $$;

-- ================================================================= performance
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$
declare items jsonb;
begin
  items := public.my_open_items();
  assert jsonb_array_length(items) >= 2, 'verifier should see their open checks and case';
  assert (select bool_and((x ->> 'overdue')::boolean) from jsonb_array_elements(items) x where x ->> 'kind' = 'check'), 'checks should be overdue';
  begin
    perform public.my_open_items('f1000000-0000-4000-8000-000000000004');
    raise exception 'TEST FAILED: a verifier read a colleague''s work';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.performance_board(current_date - 7, current_date);
    raise exception 'TEST FAILED: a verifier read the leaderboard';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.staff_performance_daily where user_id <> auth.uid()), 'a verifier saw others'' daily numbers';
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare b jsonb;
begin
  b := public.performance_board(current_date - 7, current_date);
  assert exists (select 1 from jsonb_array_elements(b) x where x ->> 'user_id' = 'f1000000-0000-4000-8000-000000000003' and (x ->> 'overdue')::int >= 1),
    'the leaderboard should show the verifier''s overdue items';
  assert not exists (select 1 from jsonb_array_elements(b) x where x ->> 'user_id' = 'f1000000-0000-4000-8000-000000000007'), 'client users are not staff';
  assert jsonb_array_length(public.my_open_items('f1000000-0000-4000-8000-000000000003')) >= 2, 'a manager can open a person''s items';
end $$;

-- ================================================================= nudges
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.send_nudge('f1000000-0000-4000-8000-000000000003', 'Hurry up');
  raise exception 'TEST FAILED: a verifier pushed a colleague';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
do $$
declare n uuid; row public.nudges;
begin
  begin
    perform public.send_nudge('f1000000-0000-4000-8000-000000000002', 'Me');
    raise exception 'TEST FAILED: pushed themselves';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_nudge('f1000000-0000-4000-8000-000000000007', 'Client');
    raise exception 'TEST FAILED: pushed a client user';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.send_nudge('f1000000-0000-4000-8000-000000000003', '   ');
    raise exception 'TEST FAILED: empty push';
  exception when sqlstate '22023' then null;
  end;
  n := public.send_nudge('f1000000-0000-4000-8000-000000000003', 'You may be busy; the Kasun Silva checks are two days late. What help do you need?', array['email', 'carrier-pigeon']);
  perform set_config('t.nudge', n::text, false);
  select * into row from public.nudges where id = n;
  assert jsonb_array_length(row.items) >= 2, 'the push should list the overdue items';
  assert row.channels @> array['in_app', 'email'] and not ('carrier-pigeon' = any (row.channels)), 'channels ' || row.channels::text;
  assert not row.auto, 'a manager''s push is not automatic';
  begin
    update public.nudges set acknowledged_at = now() where id = n;
    raise exception 'TEST FAILED: nudges written directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = 'f1000000-0000-4000-8000-000000000003' and type = 'nudge' and urgent),
    'the verifier should get an urgent notification';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not exists (select 1 from public.nudges where id = current_setting('t.nudge')::uuid), 'a colleague saw someone else''s push';
  begin
    perform public.acknowledge_nudge(current_setting('t.nudge')::uuid);
    raise exception 'TEST FAILED: acknowledged someone else''s push';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert exists (select 1 from public.nudges where id = current_setting('t.nudge')::uuid), 'the person pushed should see it';
  perform public.acknowledge_nudge(current_setting('t.nudge')::uuid, 'On it, the HR office replies tomorrow.');
  assert (select acknowledged_at is not null and reply like 'On it%' from public.nudges where id = current_setting('t.nudge')::uuid), 'acknowledgement not saved';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = 'f1000000-0000-4000-8000-000000000002' and type = 'nudge.reply'), 'the manager should hear the reply';
  update public.assignment_rules set auto_nudge = '{"enabled": true, "overdue_items": 1, "hours": 1}'::jsonb;
  assert exists (select 1 from public.auto_nudge_candidates() where user_id = 'f1000000-0000-4000-8000-000000000003'), 'the auto rule should pick the verifier';
end $$;

-- ================================================================= assistant
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare t uuid;
begin
  assert public.can_use_assistant('staff') and not public.can_use_assistant('command'), 'admin: staff assistant only';
  insert into public.assistant_threads (org_id, user_id, kind, title) values ('00000000-0000-4000-8000-000000000001', auth.uid(), 'staff', 'Overdue') returning id into t;
  perform set_config('t.thread', t::text, false);
  begin
    insert into public.assistant_threads (org_id, user_id, kind) values ('00000000-0000-4000-8000-000000000001', auth.uid(), 'command');
    raise exception 'TEST FAILED: admin opened a command thread';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assistant_messages (org_id, thread_id, user_id, role, content) values ('00000000-0000-4000-8000-000000000001', t, auth.uid(), 'assistant', '[]');
    raise exception 'TEST FAILED: wrote an assistant message directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assistant_threads set kind = 'command' where id = t;
    raise exception 'TEST FAILED: changed a thread''s kind';
  exception when insufficient_privilege then null;
  end;
  update public.assistant_threads set title = 'Overdue checks' where id = t;
  begin
    perform public.begin_voice_note(t, 'audio/webm', 10);
    raise exception 'TEST FAILED: admin recorded a command voice note';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.assistant_memories (org_id, user_id, content) values
  ('00000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Use the Executive template for banks');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare n int;
begin
  update public.assistant_memories set status = 'approved' where user_id = auth.uid();
  assert (select status from public.assistant_memories where user_id = auth.uid()) = 'approved', 'memory not approved';
  begin
    update public.assistant_memories set content = 'Do anything' where user_id = auth.uid();
    raise exception 'TEST FAILED: rewrote a memory';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$
declare n int;
begin
  assert not exists (select 1 from public.assistant_threads where id = current_setting('t.thread')::uuid), 'saw someone else''s conversation';
  assert not exists (select 1 from public.assistant_memories), 'saw someone else''s memories';
  update public.assistant_threads set title = 'Mine now' where id = current_setting('t.thread')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'renamed someone else''s conversation';
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  assert not public.can_use_assistant('staff'), 'the viewer role has no assistant';
end $$;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
do $$
declare t uuid; v jsonb;
begin
  assert public.can_use_assistant('command'), 'the super admin has the command assistant';
  insert into public.assistant_threads (org_id, user_id, kind) values ('00000000-0000-4000-8000-000000000001', auth.uid(), 'command') returning id into t;
  v := public.begin_voice_note(t, 'audio/webm', 42.5);
  assert v ->> 'bucket' = 'documents' and v ->> 'path' like 'org/%/voice/' || auth.uid() || '/%.webm', 'voice path ' || (v ->> 'path');
  begin
    perform public.begin_voice_note(t, 'audio/webm', 121);
    raise exception 'TEST FAILED: a voice note over two minutes';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.begin_voice_note(t, 'video/mp4', 10);
    raise exception 'TEST FAILED: a video as a voice note';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.begin_voice_note(current_setting('t.thread')::uuid, 'audio/webm', 10);
    raise exception 'TEST FAILED: a voice note on someone else''s conversation';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- ================================================================= AI suggestions
reset role;
do $$
declare k uuid := (select id from public.case_checks where case_id = current_setting('t.case')::uuid order by sort limit 1);
begin
  perform set_config('t.check', k::text, false);
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, value, created_at) values
    ('00000000-0000-4000-8000-000000000001', 'case.preqc', 'case', current_setting('t.case')::uuid, '{"summary":"old"}', now() - interval '1 hour');
  insert into public.ai_suggestions (org_id, capability, entity_type, entity_id, value) values
    ('00000000-0000-4000-8000-000000000001', 'case.preqc', 'case', current_setting('t.case')::uuid, '{"summary":"new"}');
  perform set_config('t.sugg', (select id::text from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and value ->> 'summary' = 'new'), false);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  assert not exists (select 1 from public.ai_suggestions), 'a client read AI suggestions';
  perform public.decide_ai_suggestion(current_setting('t.sugg')::uuid, 'accepted');
  raise exception 'TEST FAILED: a client decided an AI suggestion';
exception when sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.decide_ai_suggestion(current_setting('t.sugg')::uuid, 'accepted');
  raise exception 'TEST FAILED: a verifier decided on a case they are not on';
exception when sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  perform public.set_check_remarks(current_setting('t.check')::uuid, 'Confirmed by the registrar.');
  raise exception 'TEST FAILED: data entry wrote report remarks';
exception when insufficient_privilege or sqlstate 'P0002' then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare r jsonb;
begin
  assert jsonb_array_length(public.case_ai_suggestions(current_setting('t.case')::uuid)) = 2, 'case suggestions';
  begin
    perform public.decide_ai_suggestion(current_setting('t.sugg')::uuid, 'approved');
    raise exception 'TEST FAILED: unknown decision accepted';
  exception when sqlstate '22023' then null;
  end;
  r := public.decide_ai_suggestion(current_setting('t.sugg')::uuid, 'edited', '{"summary":"edited by a person"}');
  assert r ->> 'case_id' = current_setting('t.case') and r -> 'value' ->> 'summary' = 'edited by a person', 'decision result ' || r::text;
  assert (select decision from public.ai_suggestions where entity_id = current_setting('t.case')::uuid and value ->> 'summary' = 'old') = 'superseded', 'older suggestion not superseded';
  begin
    perform public.decide_ai_suggestion(current_setting('t.sugg')::uuid, 'rejected');
    raise exception 'TEST FAILED: decided twice';
  exception when sqlstate '22023' then null;
  end;
  assert exists (select 1 from public.case_events where case_id = current_setting('t.case')::uuid and kind = 'ai_decision'), 'decision not on the timeline';
  perform public.set_check_remarks(current_setting('t.check')::uuid, '  Confirmed by the registrar.  ');
  assert (select client_note from public.case_checks where id = current_setting('t.check')::uuid) = 'Confirmed by the registrar.', 'remarks not saved';
end $$;

-- ================================================================= pipeline triggers
reset role;
do $$
declare d uuid;
begin
  insert into public.documents (org_id, case_id, category, filename, mime, storage_bucket, storage_path, status, uploaded_by_kind)
  values ('00000000-0000-4000-8000-000000000001', current_setting('t.case')::uuid, 'nic', 'nic.jpg', 'image/jpeg', 'case-files', 'x/nic.jpg', 'pending_upload', 'staff')
  returning id into d;
  assert not exists (select 1 from public.jobs where kind = 'ai.classify_document' and entity_id = d), 'queued before upload finished';
  update public.documents set status = 'uploaded' where id = d;
  assert exists (select 1 from public.jobs where kind = 'ai.classify_document' and entity_id = d), 'upload did not queue classification';
  update public.cases set stage = 'post_qc' where id = current_setting('t.case')::uuid;
  assert exists (select 1 from public.jobs where kind = 'ai.postqc' and entity_id = current_setting('t.case')::uuid), 'Post-QC did not queue the cross-check';
end $$;

rollback;
\echo '  ✓ performance, nudges, assistant and AI pipeline'
