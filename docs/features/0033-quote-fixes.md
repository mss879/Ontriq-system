# Quotation fixes

Migration: `supabase/migrations/0033_quote_fixes.sql`  
Depends on: 0014

- Reading a quotation (`portal_quote`) no longer marks it viewed, so a link prefetch can't. The portal page calls `portal_mark_quote_viewed` from the browser once the quotation is on screen.
- Accepting two quotations on the same day no longer leaves contracted prices that end before they start; the newest price wins.
- Answers to quotations in the portal are limited to 20 per person per 10 minutes.
