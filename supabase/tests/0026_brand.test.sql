\o /dev/null
-- The Ontriq brand defaults are in place and never overwrite a Settings edit.
begin;
do $$
declare
  b jsonb;
begin
  select branding into b from public.orgs where id = '00000000-0000-4000-8000-000000000001';
  assert b ->> 'primary_color' = '#0C5A9A', 'primary colour not set: ' || coalesce(b ->> 'primary_color', 'null');
  assert b ->> 'accent_color' = '#F75834', 'accent colour not set';
  assert b ->> 'email' = 'info@ontriq.com', 'company email not set';
  assert b ->> 'display_name' = 'Ontriq', 'display name lost';
end $$;
update public.orgs set branding = branding || '{"primary_color":"#112233","phone":"+94 11 000 0000"}'
 where id = '00000000-0000-4000-8000-000000000001';
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
do $$ begin
  assert (select branding ->> 'primary_color' from public.orgs where id = '00000000-0000-4000-8000-000000000001') = '#112233',
    'a Settings colour was overwritten';
  assert (select branding ->> 'phone' from public.orgs where id = '00000000-0000-4000-8000-000000000001') = '+94 11 000 0000',
    'a Settings phone number was overwritten';
end $$;
rollback;
\echo '  ✓ Ontriq brand defaults'
