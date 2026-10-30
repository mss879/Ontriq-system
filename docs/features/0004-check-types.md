# Check type builder

Migration: `supabase/migrations/0004_check_types.sql`  
Depends on: 0001, 0002

- Tables: `document_categories` (with candidate-facing guidance and a "sensitive" flag), `check_types`, `check_type_versions`.
- A check type's definition is JSON described by `src/domain/check-types/schema.ts`: fields (13 types, including NIC, district and repeating groups, each filled in at data entry or at verification), document requirements, result options with green/amber/red tones, SLA days, location-bound flag, and a fixed annexure (Global Sanction).
- Versions: edit a draft (`save_check_type_draft`), then `publish_check_type`. A published version is frozen by trigger; cases keep the version they started with. `discard_check_type_draft` throws a draft away.
- Writes to versions go only through those functions; staff with `check_types.manage` may rename, reorder or archive types.
