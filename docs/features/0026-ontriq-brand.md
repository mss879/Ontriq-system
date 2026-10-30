# Ontriq brand defaults — `0026_ontriq_brand.sql`

Sets the organisation's branding to the real Ontriq brand from the website: logo blue `#0C5A9A`, accent orange `#F75834`, and the company's address, phone, email and website. These feed quotations, invoices, reports, emails and the Settings page.

It only replaces placeholders (the colours 0001 seeded before the brand was known, and blank details), so a change made in Settings → Organisation is never overwritten. Depends on 0001. Test: `supabase/tests/0026_brand.test.sql`.
