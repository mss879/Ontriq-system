# Clients

Migration: `supabase/migrations/0003_clients.sql`  
Depends on: 0001, 0002

- Client companies with SLA days, payment terms, billing policy, default document template and AI opt-out.
- Contacts (one primary) and per-client settings for visibility, portal options and notifications.
- Client users only ever see their own company.

## Adding a client while creating a case

The client step of a new case, and bulk import, have a **New client** button for people with `clients.manage`. It asks only for the name, code and an optional email, then carries on with that client selected and nothing lost. Everything else takes the usual defaults and can be changed on the client's page. A search that finds nothing offers to add that name, and a name already on file offers the existing client instead of a duplicate.
