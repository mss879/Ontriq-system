# Quotations and contracted prices

Migration: `supabase/migrations/0014_quotations.sql`  
Depends on: 0003, 0004, 0005, 0013 (calls 0009, 0010 at run time)

- Staff with `quotes.manage` build drafts directly (row level security): lines from packages, check types or free text with quantity and discount, volume tiers, and the intro, scope, assumptions, turnaround and closing text (AI can draft these; prices never come from the AI).
- `confirm_quote` freezes the draft: number QT-YYYY-NNNN (gap-free), totals recomputed, PDF rendered by `document.render` in the chosen design (Executive, Modern, Classic). Changes afterwards are a new version (`revise_quote`).
- `mark_quote_sent` (`quotes.send`) notifies the client's admins. In the portal they view it (marked viewed), accept with a typed name (time and IP recorded), decline with a reason, or ask a question.
- Acceptance writes `client_price_lists` (discounted unit prices from the quote; older prices end the day before) and makes a prospect client active. `contracted_price` gives the price on a date; invoices use it first.
- Sent quotations expire after their valid-until date (scheduler, daily).
- Tests: `supabase/tests/0012_reports_money.test.sql`.
