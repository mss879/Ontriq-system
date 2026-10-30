# Global search

Migration: `supabase/migrations/0022_search.sql`  
Depends on: 0003, 0006

- `search_everything(query, limit)` searches cases (reference, candidate, client reference), candidates (name, NIC) and clients (name, code). It runs as the caller, so row level security filters every result. Trigram indexes keep it fast.
- Used by the ⌘K palette through `/api/search`.
