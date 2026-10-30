-- =============================================================================
-- 0018_ai.sql
-- Feature: AI capability routing, cost ledger, suggestions, budgets, batches.
-- Depends on: 0001_foundation, 0002_audit.
--
-- Every model call writes one ai_runs row priced from ai_cost_rates, so spend
-- can be reported per client, case, capability and month, and compared with
-- the Cost and Feasibility document.
-- =============================================================================

create table public.ai_cost_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'anthropic',
  model text not null,
  unit text not null default 'mtok' check (unit in ('mtok', 'minute')),
  input_rate numeric(12, 6) not null,           -- USD per million input tokens, or per minute
  output_rate numeric(12, 6) not null default 0,
  cache_read_rate numeric(12, 6) not null default 0,
  cache_write_rate numeric(12, 6) not null default 0,
  batch_discount numeric(4, 3) not null default 0.5,
  effective_from date not null default current_date,
  notes text not null default '',
  unique (model, effective_from)
);

-- List prices used by the plan (verify before each cost-document version).
insert into public.ai_cost_rates (provider, model, unit, input_rate, output_rate, cache_read_rate, cache_write_rate, effective_from, notes) values
  ('anthropic', 'claude-haiku-5-5', 'mtok', 0.10, 0.50, 0.01, 0.125, '2026-10-01',
   'Prompts up to 100K tokens; $0.50 / $2.50 beyond 100K'),
  ('anthropic', 'claude-sonnet-5-5', 'mtok', 2.00, 10.00, 0.20, 2.50, '2026-10-01', ''),
  ('anthropic', 'claude-opus-5-5', 'mtok', 4.00, 20.00, 0.20, 5.00, '2026-10-01', ''),
  ('openai', 'gpt-4o-mini-transcribe', 'minute', 0.003, 0, 0, 0, '2026-10-01', 'Speech-to-text for voice notes')
on conflict (model, effective_from) do nothing;

-- Which model and effort each capability uses (editable in Settings → AI).
create table public.ai_capabilities (
  key text primary key,
  label text not null,
  description text not null default '',
  model text not null,
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  max_tokens int not null default 4000,
  enabled boolean not null default true,
  sort int not null default 0
);
insert into public.ai_capabilities (key, label, description, model, effort, max_tokens, sort) values
  ('document.classify', 'Document classification and quality', 'Type, readability, copy or original, OCR text', 'claude-haiku-5-5', 'low', 2000, 1),
  ('document.extract', 'Field extraction', 'Pre-fill check fields from documents with confidence', 'claude-sonnet-5-5', 'medium', 4000, 2),
  ('case.consistency', 'Cross-document consistency', 'Compare names, NIC, dates and institutions', 'claude-sonnet-5-5', 'medium', 4000, 3),
  ('case.preqc', 'Pre-QC copilot', 'Checklist and drafted amendment requests', 'claude-sonnet-5-5', 'medium', 4000, 4),
  ('check.outreach', 'Outreach drafts', 'Verification emails and call scripts', 'claude-sonnet-5-5', 'low', 2000, 5),
  ('check.response', 'Response capture', 'Turn a reply into a proposed result', 'claude-sonnet-5-5', 'medium', 2000, 6),
  ('case.postqc', 'Post-QC cross-check', 'Audit checks against evidence, propose Green/Amber/Red', 'claude-opus-5-5', 'high', 16000, 7),
  ('report.narrative', 'Report narrative', 'Findings, remarks and executive summary', 'claude-sonnet-5-5', 'medium', 8000, 8),
  ('assistant.staff', 'Ask Ontriq', 'Staff assistant over the data each user may see', 'claude-sonnet-5-5', 'low', 4000, 9),
  ('assistant.command', 'Command assistant', 'Super Admin assistant with reach across the system', 'claude-opus-5-5', 'low', 6000, 10),
  ('assign.explain', 'Assignment explanations', 'Explain why a case went to a person', 'claude-haiku-5-5', 'low', 500, 11),
  ('assign.rebalance', 'Workload rebalancing', 'Propose moves when someone is overloaded', 'claude-sonnet-5-5', 'medium', 3000, 12),
  ('briefing.daily', 'Daily briefing', 'Morning summary for managers', 'claude-sonnet-5-5', 'low', 2000, 13),
  ('candidate.guide', 'Candidate upload guide', 'Instant feedback on candidate uploads', 'claude-haiku-5-5', 'low', 500, 14),
  ('portal.explain', 'Plain-language explainers', 'Case and invoice explainers for clients and candidates', 'claude-haiku-5-5', 'low', 600, 15),
  ('document.tamper', 'Tamper and duplicate signals', 'Edited-document heuristics and duplicate detection', 'claude-haiku-5-5', 'low', 800, 16),
  ('commercial.draft', 'Quotation and invoice drafting', 'Intro, scope, assumptions, terms', 'claude-sonnet-5-5', 'medium', 4000, 17),
  ('commercial.cover_email', 'Cover emails', 'Short cover emails for quotes and invoices', 'claude-haiku-5-5', 'low', 600, 18),
  ('payment.slip', 'Payment slip reading', 'Amount, date, bank and reference from a slip', 'claude-haiku-5-5', 'low', 600, 19),
  ('consent.check', 'Consent form check', 'Confirm a photographed consent form is signed and legible', 'claude-haiku-5-5', 'low', 600, 20),
  ('team.nudge', 'Nudge drafting', 'Constructive messages for staff who are behind', 'claude-haiku-5-5', 'low', 600, 21),
  ('voice.transcribe', 'Voice transcription', 'Super Admin voice notes', 'gpt-4o-mini-transcribe', 'low', 0, 22)
on conflict (key) do nothing;

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  capability text not null,
  provider text not null default 'anthropic',
  model text not null,
  prompt_version text,
  source text,                         -- code path that made the call (markAiSource)
  case_id uuid,
  client_id uuid,
  document_id uuid,
  job_id uuid references public.jobs (id) on delete set null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  audio_seconds numeric(10, 2) not null default 0,
  batch boolean not null default false,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms int,
  status text not null default 'ok' check (status in ('ok', 'error', 'refused', 'truncated')),
  stop_reason text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_runs_org_created_idx on public.ai_runs (org_id, created_at desc);
create index ai_runs_capability_idx on public.ai_runs (capability, created_at desc);
create index ai_runs_client_idx on public.ai_runs (client_id, created_at desc) where client_id is not null;
create index ai_runs_case_idx on public.ai_runs (case_id) where case_id is not null;

-- Price a call from the rate in force on the call date.
create or replace function public.price_ai_usage(
  p_model text, p_input int, p_output int, p_cache_read int default 0, p_cache_write int default 0,
  p_audio_seconds numeric default 0, p_batch boolean default false, p_at timestamptz default now()
) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((
    select case r.unit
      when 'minute' then r.input_rate * (coalesce(p_audio_seconds, 0) / 60.0)
      else ((coalesce(p_input, 0) * r.input_rate + coalesce(p_output, 0) * r.output_rate) * case when p_batch then r.batch_discount else 1 end
            + coalesce(p_cache_read, 0) * r.cache_read_rate + coalesce(p_cache_write, 0) * r.cache_write_rate) / 1000000.0
    end
    from public.ai_cost_rates r
    where r.model = p_model and r.effective_from <= p_at::date
    order by r.effective_from desc
    limit 1
  ), 0)::numeric(12, 6)
$$;

create or replace function public.ai_runs_price() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cost_usd = 0 then
    new.cost_usd := public.price_ai_usage(new.model, new.input_tokens, new.output_tokens, new.cache_read_tokens,
                                          new.cache_write_tokens, new.audio_seconds, new.batch, new.created_at);
  end if;
  return new;
end $$;
create trigger ai_runs_price before insert on public.ai_runs
  for each row execute function public.ai_runs_price();

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  run_id uuid references public.ai_runs (id) on delete set null,
  capability text not null,
  entity_type text not null,
  entity_id uuid not null,
  field_key text,
  value jsonb not null,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  rationale text,
  source_refs jsonb not null default '[]'::jsonb,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'edited', 'rejected', 'superseded')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_suggestions_entity_idx on public.ai_suggestions (entity_type, entity_id, created_at desc);
create index ai_suggestions_pending_idx on public.ai_suggestions (org_id, created_at desc) where decision = 'pending';

create table public.ai_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  capability text,                     -- null = whole organisation
  daily_usd numeric(10, 2),
  monthly_usd numeric(10, 2),
  action text not null default 'alert' check (action in ('alert', 'pause')),
  alerted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, capability)
);
create trigger a_set_org_id before insert on public.ai_budgets
  for each row execute function public.set_org_id();
create trigger ai_budgets_updated_at before update on public.ai_budgets
  for each row execute function public.set_updated_at();
insert into public.ai_budgets (org_id, capability, daily_usd, monthly_usd, action) values
  ('00000000-0000-4000-8000-000000000001', null, 25, 400, 'alert'),
  ('00000000-0000-4000-8000-000000000001', 'assistant.command', 5, 60, 'pause')
on conflict do nothing;

create table public.ai_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  provider_batch_id text not null unique,
  capability text not null,
  status text not null default 'submitted' check (status in ('submitted', 'ended', 'collected', 'failed', 'cancelled')),
  request_count int not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Spend summary for the usage dashboard and the cost document (v2+).
create or replace function public.ai_cost_summary(p_from timestamptz, p_to timestamptz, p_group text default 'capability')
returns table (group_key text, runs bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql stable security definer set search_path = '' as $$
  select case p_group
           when 'model' then r.model
           when 'client' then coalesce(r.client_id::text, 'none')
           when 'day' then to_char(r.created_at at time zone 'Asia/Colombo', 'YYYY-MM-DD')
           when 'month' then to_char(r.created_at at time zone 'Asia/Colombo', 'YYYY-MM')
           else r.capability
         end as group_key,
         count(*), sum(r.input_tokens)::bigint, sum(r.output_tokens)::bigint, sum(r.cost_usd)
  from public.ai_runs r
  where r.org_id = coalesce(public.auth_org_id(), public.default_org_id())
    and r.created_at >= p_from and r.created_at < p_to
    and (auth.uid() is null or ((select public.is_staff())
         and ((select public.has_permission('ai.usage.read')) or (select public.has_permission('ai.configure')))))
  group by 1
  order by 5 desc
$$;
revoke execute on function public.ai_cost_summary(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.ai_cost_summary(timestamptz, timestamptz, text) to authenticated, service_role;

select public.attach_audit('public.ai_capabilities', 'key');
select public.attach_audit('public.ai_budgets');
select public.attach_audit('public.ai_cost_rates');

alter table public.ai_cost_rates enable row level security;
alter table public.ai_capabilities enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.ai_budgets enable row level security;
alter table public.ai_batches enable row level security;

create policy ai_cost_rates_select on public.ai_cost_rates for select to authenticated using ((select public.is_staff()));
create policy ai_cost_rates_write on public.ai_cost_rates for insert to authenticated
  with check ((select public.is_staff()) and (select public.has_permission('ai.configure')));
create policy ai_capabilities_select on public.ai_capabilities for select to authenticated using ((select public.is_staff()));
create policy ai_capabilities_update on public.ai_capabilities for update to authenticated
  using ((select public.is_staff()) and (select public.has_permission('ai.configure')))
  with check ((select public.is_staff()));
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
         and ((select public.has_permission('ai.usage.read')) or (select public.has_permission('ai.configure'))
              or created_by = (select auth.uid())));
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy ai_suggestions_decide on public.ai_suggestions for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()))
  with check (org_id = (select public.auth_org_id()) and decided_by = (select auth.uid()));
create policy ai_budgets_select on public.ai_budgets for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()));
create policy ai_budgets_write on public.ai_budgets for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('ai.configure')))
  with check (org_id = (select public.auth_org_id()));
create policy ai_batches_select on public.ai_batches for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_staff()) and (select public.has_permission('ai.configure')));
revoke insert, update, delete, truncate on public.ai_runs, public.ai_batches from anon, authenticated;
revoke insert, delete, truncate on public.ai_suggestions from anon, authenticated;

alter publication supabase_realtime add table public.ai_suggestions;
