# Client package visibility fix

Migration: `supabase/migrations/0027_packages_client_select.sql`  
Depends on: 0005

- Replaces the clients' packages visibility rule with one that reads the row's own columns. The old rule asked a function that cannot see a row inserted by the same statement, so a client creating a package with `RETURNING` was refused. Found by the hosted simulation; covered in `supabase/tests/0006_case_engine.test.sql`.
