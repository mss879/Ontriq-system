# Invoices and payments

Migration: `supabase/migrations/0015_invoices_payments.sql`  
Depends on: 0003, 0006, 0013, 0014 (calls 0009, 0010 at run time)

- Drafts: per case when its report is released (billing policy `per_case_on_release`), or one invoice per client per month for `monthly_consolidated` (the scheduler drafts last month's on the 1st). A fixed-price package is one line; otherwise one line per counted check, priced from the client's contracted price on the day the case arrived, else the price captured when the case was opened. Drafting is idempotent and never bills a case twice.
- `confirm_invoice` freezes the draft: number INV-YYYY-NNNN (gap-free), taxes from `tax_rates` frozen on the invoice (VAT 18% and SSCL 2.5% are seeded switched off until Ontriq confirms how they apply), due date from the client's terms, PDF by `document.render`.
- Payments (`record_payment`, `payments.record`) can't exceed the balance; each gets a receipt (RCT-…). Credit notes (CN-…) reduce what is owed. Voiding an invoice needs its payments voided first. Nothing is deleted.
- Clients see sent invoices in the portal (marked viewed), download PDFs and receipts, and upload a payment slip (PDF, JPEG, PNG up to 10 MB). Finance sees the slip with the amount, date and reference the AI read (`ai.slip_read`, Haiku; when AI is not set up the slip is simply waiting), then matches or rejects it.
- Reminders (`invoice.reminders`, hourly, office hours): 3 days before the due date, on the day, 7 and 14 days late, then one alert to finance; paused while a slip waits or when staff pause them.
- `client_balance` and `client_statement` (running balance; PDF and CSV at `/api/statements/<client>`) serve both staff and the client's own users.
- Tests: `supabase/tests/0012_reports_money.test.sql`, `tests/unit/pricing.test.ts`.
