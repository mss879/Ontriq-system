-- Reports the assistant makes as PDFs hold staff and money figures, so each is
-- private to the person who asked for it. Without this they would fall to the
-- policy's last branch and open to everyone with settings.manage.

alter policy generated_documents_select on public.generated_documents
  using (org_id = (select public.auth_org_id()) and (select public.is_staff())
    and case kind
      when 'quote' then (select public.can_read_quotes())
      when 'invoice' then (select public.can_read_invoices())
      when 'receipt' then (select public.can_read_invoices())
      when 'credit_note' then (select public.can_read_invoices())
      when 'statement' then (select public.can_read_invoices())
      when 'assistant_report' then created_by = (select auth.uid())
      else case when entity_type = 'case' then public.case_visible(entity_id) else (select public.has_permission('settings.manage')) end
    end
    and (kind <> 'candidate_report' or public.can_read_candidate_report(entity_id)));

-- The figures wait here for the worker that draws the PDF, and are deleted once
-- it has. Job records can be read by more roles than these reports, so they stay
-- out of there. No policies: only the service role can touch this table.
create table public.assistant_report_figures (
  document_id uuid primary key references public.generated_documents (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index assistant_report_figures_org_idx on public.assistant_report_figures (org_id);
alter table public.assistant_report_figures enable row level security;
revoke all on public.assistant_report_figures from public, anon, authenticated;

-- Someone is waiting in the chat, so these go ahead of background work.
insert into public.job_kind_limits (kind, max_running, default_max_attempts, default_priority, description) values
  ('assistant.report', 3, 3, 20, 'Reports the assistant draws as PDFs');
