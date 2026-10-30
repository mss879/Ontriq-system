# Packages and request templates

Migration: `supabase/migrations/0005_packages_templates.sql` (visibility rule replaced by 0027)  
Depends on: 0003, 0004

- `packages` belong to Ontriq (`owner_scope = 'org'`) or to one client (`'client'`, built in the portal in Phase 2). Pricing is the sum of item prices or a fixed price; TAT days and a default process type.
- `package_items` hold a unit price per check. Clients never set prices: a trigger copies Ontriq's list price onto client-built items.
- `package_client_visibility` limits an Ontriq package to chosen clients; `client_check_type_access` turns individual checks off for a client.
- `request_templates` are one-click starting points for new cases (package, process type, priority, defaults), ordered by favourites and use.
