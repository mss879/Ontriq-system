-- 0026 Ontriq brand defaults
-- The real brand and company details, taken from the Ontriq website
-- (ontriq.com): logo blue #0C5A9A, accent orange #F75834, and the contact
-- block. 0001 seeded placeholder colours before the brand was known.
-- Depends on 0001.
--
-- Only placeholders are replaced: a colour still at its 0001 default, or a
-- detail that is still blank. Anything changed in Settings is left alone, so
-- this is safe to apply to a live system.

update public.orgs o
set branding = o.branding
  || case when coalesce(o.branding ->> 'primary_color', '#163A7A') = '#163A7A'
          then jsonb_build_object('primary_color', '#0C5A9A') else '{}'::jsonb end
  || case when coalesce(o.branding ->> 'accent_color', '#1F8A5B') = '#1F8A5B'
          then jsonb_build_object('accent_color', '#F75834') else '{}'::jsonb end
  || case when coalesce(o.branding ->> 'address', '') = ''
          then jsonb_build_object('address', '107 Colombo - Galle Main Rd, Dehiwala-Mount Lavinia, Sri Lanka') else '{}'::jsonb end
  || case when coalesce(o.branding ->> 'phone', '') = ''
          then jsonb_build_object('phone', '+94 77 999 6940') else '{}'::jsonb end
  || case when coalesce(o.branding ->> 'email', '') = ''
          then jsonb_build_object('email', 'info@ontriq.com') else '{}'::jsonb end
  || case when coalesce(o.branding ->> 'website', '') = ''
          then jsonb_build_object('website', 'https://www.ontriq.com') else '{}'::jsonb end
where o.id = '00000000-0000-4000-8000-000000000001';
