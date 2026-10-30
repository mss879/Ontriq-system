-- Development sample data. Safe to run repeatedly. Never contains auth users:
-- create the first Super Admin with `npm run bootstrap:admin`.
insert into public.clients (id, org_id, name, code, legal_name, industry, email, phone, sla_days, payment_terms_days, status)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000001',
   'Hemas Holdings', 'HEMAS', 'Hemas Holdings PLC', 'Conglomerate', 'hr@hemas.example', '+94112300000', 7, 30, 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-4000-8000-000000000001',
   'Ceylon Fintech', 'CEYFIN', 'Ceylon Fintech (Pvt) Ltd', 'Financial services', 'people@ceylonfintech.example', '+94114500000', 5, 14, 'active')
on conflict (id) do nothing;

insert into public.client_contacts (org_id, client_id, name, title, email, phone, is_primary, receives_invoices)
select '00000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'Nadeesha Perera', 'Head of Talent', 'nadeesha@hemas.example', '+94771234567', true, true
where not exists (select 1 from public.client_contacts where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.client_contacts (org_id, client_id, name, title, email, phone, is_primary, receives_invoices)
select '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'Ruwan Jayasinghe', 'HR Manager', 'ruwan@ceylonfintech.example', '+94779876543', true, true
where not exists (select 1 from public.client_contacts where client_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
