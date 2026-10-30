-- =============================================================================
-- 0020_super_assistant.sql
-- Feature: the Super Admin's command assistant and its voice notes. The
-- command assistant uses the same threads, messages and confirm cards as Ask
-- Ontriq (0019) with kind 'command', a wider tool set and Opus; only the
-- Super Admin may use it (ai.super_assistant is not grantable to other
-- designations). Voice notes are recorded in the browser, stored privately,
-- transcribed, and purged after 30 days (the transcript stays in the thread).
-- Depends on: 0013 (documents bucket), 0018, 0019.
-- =============================================================================

create table public.assistant_voice_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid references public.assistant_threads (id) on delete set null,
  storage_path text,
  mime text not null,
  duration_s numeric(8, 2),
  status text not null default 'pending_upload' check (status in ('pending_upload', 'uploaded', 'transcribed', 'failed', 'purged')),
  transcript text,
  language text,
  provider text,
  cost_usd numeric(12, 6) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index assistant_voice_notes_user_idx on public.assistant_voice_notes (user_id, created_at desc);
create index assistant_voice_notes_org_idx on public.assistant_voice_notes (org_id);
create index assistant_voice_notes_thread_idx on public.assistant_voice_notes (thread_id);
create trigger a_set_org_id before insert on public.assistant_voice_notes
  for each row execute function public.set_org_id();

-- Step 1 of a voice note upload (the server then mints a signed upload URL in the documents bucket).
create or replace function public.begin_voice_note(p_thread uuid, p_mime text, p_duration numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_path text;
  v_ext text;
begin
  if not public.can_use_assistant('command') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mime not in ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav') then raise exception 'unsupported audio format' using errcode = '22023'; end if;
  if coalesce(p_duration, 0) <= 0 or p_duration > 120 then raise exception 'voice notes can be up to two minutes' using errcode = '22023'; end if;
  if p_thread is not null and not exists (select 1 from public.assistant_threads t where t.id = p_thread and t.user_id = auth.uid()) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  v_ext := case p_mime when 'audio/webm' then 'webm' when 'audio/mp4' then 'm4a' when 'audio/mpeg' then 'mp3' when 'audio/ogg' then 'ogg' else 'wav' end;
  v_path := 'org/' || public.auth_org_id() || '/voice/' || auth.uid() || '/' || v_id || '.' || v_ext;
  insert into public.assistant_voice_notes (id, org_id, user_id, thread_id, storage_path, mime, duration_s)
  values (v_id, public.auth_org_id(), auth.uid(), p_thread, v_path, p_mime, p_duration);
  return jsonb_build_object('id', v_id, 'bucket', 'documents', 'path', v_path);
end $$;
revoke execute on function public.begin_voice_note(uuid, text, numeric) from public, anon;
grant execute on function public.begin_voice_note(uuid, text, numeric) to authenticated, service_role;

-- Voice notes past 30 days lose their audio (retention.purge job); transcripts stay.
create or replace function public.voice_notes_to_purge() returns table (id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.storage_path from public.assistant_voice_notes v
   where v.purged_at is null and v.storage_path is not null and v.created_at < now() - interval '30 days'
$$;
revoke execute on function public.voice_notes_to_purge() from public, anon, authenticated;

alter table public.assistant_voice_notes enable row level security;
create policy assistant_voice_notes_select on public.assistant_voice_notes for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
revoke insert, update, delete, truncate on public.assistant_voice_notes from anon, authenticated;

insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('stt.transcribe', 2, 3, 40, 'Transcribe a voice note'),
  ('assistant.task', 2, 2, 40, 'Finish an assistant request in the background')
on conflict (kind) do nothing;
