-- =============================================================================
-- 0019_assistant.sql
-- Feature: Ask Ontriq, the staff assistant. Conversations (threads and
-- messages) are private to their owner. The assistant answers with text and
-- artifacts (tables, record cards, links). It never writes on its own: any
-- change is proposed as an action (a "confirm card"); the person confirms,
-- the app re-checks their permission and performs it, and reversible actions
-- can be undone for ten minutes. Memories are standing instructions the
-- owner approved. Reads run as the person, so row level security applies.
-- Depends on: 0001, 0018.
-- =============================================================================

create table public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'staff' check (kind in ('staff', 'command')),
  title text not null default 'New conversation',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_threads_user_idx on public.assistant_threads (user_id, updated_at desc);
create index assistant_threads_org_idx on public.assistant_threads (org_id);
create trigger a_set_org_id before insert on public.assistant_threads
  for each row execute function public.set_org_id();
create trigger assistant_threads_updated_at before update on public.assistant_threads
  for each row execute function public.set_updated_at();

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  thread_id uuid not null references public.assistant_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null default '[]'::jsonb,     -- [{ type: text|table|cards|metrics|links|action|error, ... }]
  status text not null default 'done' check (status in ('streaming', 'done', 'error', 'working')),
  model text,
  run_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index assistant_messages_thread_idx on public.assistant_messages (thread_id, created_at);
create index assistant_messages_user_idx on public.assistant_messages (user_id);
create index assistant_messages_org_idx on public.assistant_messages (org_id);
create trigger a_set_org_id before insert on public.assistant_messages
  for each row execute function public.set_org_id();

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  thread_id uuid not null references public.assistant_threads (id) on delete cascade,
  message_id uuid references public.assistant_messages (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null,
  input jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,       -- what the card shows: title, lines, items
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'done', 'failed', 'cancelled', 'undone')),
  result jsonb,
  undo jsonb,                                        -- how to reverse it, when reversible
  undo_until timestamptz,
  error text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index assistant_actions_thread_idx on public.assistant_actions (thread_id, created_at);
create index assistant_actions_message_idx on public.assistant_actions (message_id);
create index assistant_actions_user_idx on public.assistant_actions (user_id, created_at desc);
create index assistant_actions_org_idx on public.assistant_actions (org_id);
create trigger a_set_org_id before insert on public.assistant_actions
  for each row execute function public.set_org_id();

create table public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (length(content) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source_message_id uuid references public.assistant_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_memories_user_idx on public.assistant_memories (user_id, status);
create index assistant_memories_org_idx on public.assistant_memories (org_id);
create index assistant_memories_source_idx on public.assistant_memories (source_message_id);
create trigger a_set_org_id before insert on public.assistant_memories
  for each row execute function public.set_org_id();
create trigger assistant_memories_updated_at before update on public.assistant_memories
  for each row execute function public.set_updated_at();

-- Who may use which assistant.
create or replace function public.can_use_assistant(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() and case p_kind
    when 'command' then public.is_super_admin()
    else public.has_permission('ai.assistant') end
$$;
revoke execute on function public.can_use_assistant(text) from public, anon;
grant execute on function public.can_use_assistant(text) to authenticated, service_role;

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_actions enable row level security;
alter table public.assistant_memories enable row level security;

-- Private to their owner. Messages and actions are written by the server (service role)
-- after it has checked the owner; the owner may rename or archive threads and decide memories.
create policy assistant_threads_select on public.assistant_threads for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy assistant_threads_insert on public.assistant_threads for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()) and public.can_use_assistant(kind));
create policy assistant_threads_update on public.assistant_threads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy assistant_messages_select on public.assistant_messages for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy assistant_actions_select on public.assistant_actions for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy assistant_memories_select on public.assistant_memories for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy assistant_memories_update on public.assistant_memories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.assistant_messages, public.assistant_actions from anon, authenticated;
revoke insert, delete, truncate on public.assistant_memories from anon, authenticated;
revoke delete, truncate on public.assistant_threads from anon, authenticated;
revoke update on public.assistant_threads from authenticated;
grant update (title, archived_at) on public.assistant_threads to authenticated;
revoke update on public.assistant_memories from authenticated;
grant update (status) on public.assistant_memories to authenticated;

alter publication supabase_realtime add table public.assistant_messages, public.assistant_actions;
