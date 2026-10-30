# Billing fixes

Migration: `supabase/migrations/0036_billing_fixes.sql`  
Depends on: 0015, 0018

- Reading an invoice in the portal no longer marks it viewed; the page calls `portal_mark_invoice_viewed` once it is on screen. `portal_invoice` also returns the invoice's design and contact, so the portal preview matches the PDF.
- A client's balance in the portal leaves out confirmed invoices that haven't been sent yet; staff still count them as outstanding.
- Staff with `ai.configure` can add a budget for a capability.
- The overdue escalation notice says how many days late the invoice really is.
