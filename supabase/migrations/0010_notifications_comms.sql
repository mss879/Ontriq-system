-- =============================================================================
-- 0010_notifications_comms.sql
-- Feature: in-app notifications, email and SMS outboxes, communications log,
--          message templates and tasks.
-- Depends on: 0001_foundation, 0002_audit, 0009_jobs.
-- (case_id foreign keys are added by 0006_cases.)
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  entity_type text,
  entity_id uuid,
  urgent boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- { "<event type>": { "in_app": true, "email": true, "sms": false } }
  matrix jsonb not null default '{}'::jsonb,
  -- { "enabled": true, "start": "21:00", "end": "07:00" }
  quiet_hours jsonb not null default '{"enabled": false, "start": "21:00", "end": "07:00"}'::jsonb,
  digest text not null default 'none' check (digest in ('none', 'daily')),
  updated_at timestamptz not null default now()
);
create trigger notification_prefs_updated_at before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- One batched insert for many recipients (service role).
create or replace function public.notify_users(
  p_user_ids uuid[], p_type text, p_title text, p_body text default '', p_link text default null,
  p_urgent boolean default false, p_entity_type text default null, p_entity_id uuid default null, p_org uuid default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  insert into public.notifications (org_id, user_id, type, title, body, link, urgent, entity_type, entity_id)
  select coalesce(p_org, m.org_id), m.user_id, p_type, p_title, coalesce(p_body, ''), p_link, p_urgent, p_entity_type, p_entity_id
    from public.memberships m
   where m.user_id = any (p_user_ids) and m.status = 'active'
     and (p_org is null or m.org_id = p_org);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Outboxes. Every email/SMS is a row first, then an idempotent job delivers it.
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  to_emails text[] not null check (cardinality(to_emails) > 0),
  cc_emails text[] not null default '{}',
  reply_to text,
  subject text not null,
  html text not null,
  text_body text,
  template_key text,
  payload jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,      -- [{ "storage_path": "...", "filename": "..." }]
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'skipped')),
  provider_id text,
  attempts int not null default 0,
  last_error text,
  entity_type text,
  entity_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index email_outbox_status_idx on public.email_outbox (status, created_at desc);
create index email_outbox_entity_idx on public.email_outbox (entity_type, entity_id);
create trigger email_outbox_updated_at before update on public.email_outbox
  for each row execute function public.set_updated_at();

create table public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  to_phone text not null,
  body text not null,
  template_key text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  provider_id text,
  segments int,
  attempts int not null default 0,
  last_error text,
  entity_type text,
  entity_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index sms_outbox_status_idx on public.sms_outbox (status, created_at desc);
create trigger sms_outbox_updated_at before update on public.sms_outbox
  for each row execute function public.set_updated_at();

-- Queue an email and its delivery job in one transaction (service role).
create or replace function public.queue_email(
  p_to text[], p_subject text, p_html text, p_text text default null,
  p_template_key text default null, p_payload jsonb default '{}'::jsonb,
  p_entity_type text default null, p_entity_id uuid default null,
  p_created_by uuid default null, p_org uuid default null, p_reply_to text default null,
  p_cc text[] default '{}', p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.default_org_id());
  v_id uuid;
begin
  insert into public.email_outbox (org_id, to_emails, cc_emails, reply_to, subject, html, text_body, template_key,
                                   payload, attachments, entity_type, entity_id, created_by)
  values (v_org, p_to, coalesce(p_cc, '{}'), p_reply_to, p_subject, p_html, p_text, p_template_key,
          coalesce(p_payload, '{}'::jsonb), coalesce(p_attachments, '[]'::jsonb), p_entity_type, p_entity_id, p_created_by)
  returning id into v_id;

  perform public.enqueue_job('email.send', jsonb_build_object('outbox_id', v_id), 'email.send:' || v_id,
                             now(), null, 'email_outbox', v_id, null, v_org, p_created_by);
  return v_id;
end $$;

create or replace function public.queue_sms(
  p_to text, p_body text, p_template_key text default null,
  p_entity_type text default null, p_entity_id uuid default null,
  p_created_by uuid default null, p_org uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(p_org, public.default_org_id());
  v_id uuid;
begin
  insert into public.sms_outbox (org_id, to_phone, body, template_key, entity_type, entity_id, created_by)
  values (v_org, p_to, p_body, p_template_key, p_entity_type, p_entity_id, p_created_by)
  returning id into v_id;
  perform public.enqueue_job('sms.send', jsonb_build_object('outbox_id', v_id), 'sms.send:' || v_id,
                             now(), null, 'sms_outbox', v_id, null, v_org, p_created_by);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Communications log (every message to or from a client, candidate or verifier)
-- ---------------------------------------------------------------------------
create table public.communications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  case_id uuid,                        -- FK added in 0006_cases
  client_id uuid references public.clients (id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'phone', 'portal', 'candidate_link', 'letter', 'visit')),
  direction text not null check (direction in ('outbound', 'inbound')),
  counterparty text,                   -- e-mail address, phone or name
  subject text,
  body text not null default '',
  template_key text,
  status text not null default 'logged',
  external_id text,
  email_outbox_id uuid references public.email_outbox (id) on delete set null,
  sms_outbox_id uuid references public.sms_outbox (id) on delete set null,
  visible_to_client boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index communications_case_idx on public.communications (case_id, created_at desc);
create index communications_client_idx on public.communications (client_id, created_at desc);
create trigger a_set_org_id before insert on public.communications
  for each row execute function public.set_org_id();

-- ---------------------------------------------------------------------------
-- Message templates (email, SMS, amendment requests, candidate link texts…)
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null check (kind in ('email', 'sms', 'amendment', 'outreach', 'cover_letter', 'candidate_link', 'nudge')),
  key text not null,
  name text not null,
  language text not null default 'en' check (language in ('en', 'si', 'ta')),
  subject text,
  body text not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key, language)
);
create trigger a_set_org_id before insert on public.templates
  for each row execute function public.set_org_id();
create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

insert into public.templates (org_id, kind, key, name, subject, body, is_system) values
  ('00000000-0000-4000-8000-000000000001', 'email', 'auth.invite', 'Invitation to Ontriq',
   'You''re invited to {{org_name}}',
   E'Hello {{full_name}},\n\n{{inviter_name}} has invited you to {{org_name}} as {{role_name}}.\n\nSet up your account: {{action_url}}\n\nThis link expires in 24 hours.', true),
  ('00000000-0000-4000-8000-000000000001', 'email', 'auth.recovery', 'Password reset',
   'Reset your {{org_name}} password',
   E'Hello {{full_name}},\n\nUse this link to choose a new password: {{action_url}}\n\nIf you didn''t ask for this, you can ignore this email.', true)
on conflict (org_id, key, language) do nothing;

-- ---------------------------------------------------------------------------
-- Tasks (manual and auto-generated follow-ups)
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null,
  description text not null default '',
  assignee_id uuid references auth.users (id) on delete set null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  case_id uuid,                        -- FK added in 0006_cases
  entity_type text,
  entity_id uuid,
  auto_generated boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assignee_open_idx on public.tasks (assignee_id, due_at) where status = 'open';
create index tasks_case_idx on public.tasks (case_id);
create trigger a_set_org_id before insert on public.tasks
  for each row execute function public.set_org_id();
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

select public.attach_audit('public.templates');
select public.attach_audit('public.tasks');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.email_outbox enable row level security;
alter table public.sms_outbox enable row level security;
alter table public.communications enable row level security;
alter table public.templates enable row level security;
alter table public.tasks enable row level security;

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.notifications from anon, authenticated;

create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy email_outbox_select on public.email_outbox for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('settings.manage')) or (select public.has_permission('jobs.read'))
              or created_by = (select auth.uid())));
create policy sms_outbox_select on public.sms_outbox for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('settings.manage')) or (select public.has_permission('jobs.read'))
              or created_by = (select auth.uid())));
revoke insert, update, delete, truncate on public.email_outbox, public.sms_outbox from anon, authenticated;

create policy communications_select on public.communications for select to authenticated
  using (org_id = (select public.auth_org_id())
         and ((select public.is_staff())
              or (visible_to_client and client_id = (select public.client_id_of_user()))));
create policy communications_insert on public.communications for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and created_by = (select auth.uid()));

create policy templates_select on public.templates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy templates_insert on public.templates for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('templates.manage')));
create policy templates_update on public.templates for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('templates.manage')))
  with check (org_id = (select public.auth_org_id()));

create policy tasks_select on public.tasks for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and (assignee_id = (select auth.uid()) or created_by = (select auth.uid())
              or (select public.has_permission('cases.read')) or (select public.has_permission('cases.assign'))));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy tasks_update on public.tasks for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and (assignee_id = (select auth.uid()) or created_by = (select auth.uid()) or (select public.has_permission('cases.assign'))))
  with check (org_id = (select public.auth_org_id()));

revoke execute on function public.notify_users(uuid[], text, text, text, text, boolean, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.queue_email(text[], text, text, text, text, jsonb, text, uuid, uuid, uuid, text, text[], jsonb) from public, anon, authenticated;
revoke execute on function public.queue_sms(text, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.notify_users(uuid[], text, text, text, text, boolean, text, uuid, uuid),
  public.queue_email(text[], text, text, text, text, jsonb, text, uuid, uuid, uuid, text, text[], jsonb),
  public.queue_sms(text, text, text, text, uuid, uuid, uuid) to service_role;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

alter publication supabase_realtime add table public.notifications;
