# Live updates and saved views

Migration: `supabase/migrations/0023_realtime_views_settings.sql`  
Depends on: 0006, 0007, 0016

- Adds cases, checks, events, requirements, documents and assignments to Supabase Realtime; screens refresh when rows they show change (`src/hooks/use-realtime-refresh.ts`). Realtime honours row level security.
- `saved_views` store named filters for the cases list, private or shared.
