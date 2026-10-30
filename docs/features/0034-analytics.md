# Analytics and exports

Migration: `supabase/migrations/0034_analytics.sql`  
Depends on: 0006, 0015, 0018

- `analytics_operations(from, to, client)` (`analytics.read`): cases received and released per week, open cases by stage, average and median hours per stage, turnaround per package, on-time rate, result mix, open and overdue checks per officer, top clients. All dates in Sri Lanka time.
- `analytics_revenue(from, to, client)` (`billing.export` or `invoices.manage`; finance only, so the Viewer and Operations Manager roles don't see money): invoiced, collected, credited, outstanding and overdue, aging buckets, monthly invoiced against collected, top clients by billing and by balance. One currency (the most used); others are counted in a note.
- `analytics_ai(from, to)` (`analytics.read` or `ai.usage.read`): cost per day, capability and model, and cost per released case.
- `/app/analytics`: Operations, Revenue and AI cost tabs with period presets and a client filter in the URL; charts are inline SVG with screen-reader tables.
- CSV exports (UTF-8 with BOM, formula-safe): `/api/exports/cases` (the list's filters, row level security applies), `/api/exports/audit` (`audit.read`), `/api/exports/analytics?section=…`.
- Bulk import at `/app/cases/import` (`cases.create`): pick the client, package or template and process type, upload a CSV, fix row errors in the preview, create up to 200 cases; candidate-collected cases get their link straight away.
- Tests: `supabase/tests/0034_analytics.test.sql`, `tests/unit/analytics.test.ts`, `tests/unit/import.test.ts`.
