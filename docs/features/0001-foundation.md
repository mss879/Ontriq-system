# Tenancy, people, roles and permissions

Migration: `supabase/migrations/0001_foundation.sql`  
Depends on: none

- Organisations (Ontriq is the single tenant; the schema is tenant-ready).
- Profiles created automatically for every sign-in account.
- Permission catalog (53 permissions) and 11 system roles: Super Admin, Admin, Operations Manager, Verification Officer, QC Officer, Data Entry Officer, Client Relations, Viewer, Client Admin, Client User, Client Viewer.
- Custom designations: any name plus permissions from the catalog.
- Memberships and invitations; invited people activate their own membership when they set a password.
- Helper functions used by every row-level security policy, and guards against privilege escalation.
