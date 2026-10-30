# Auto-assignment

Migration: `supabase/migrations/0016_assignment.sql`  
Depends on: 0006, 0010

- `staff_skills`, `staff_capacity` (auto-assign switch, limits, regions), `staff_availability` (leave), `assignment_rules` (strategy and weights) and `assignment_events` (every assignment with its plain-language explanation).
- `staff_load_snapshot` gives each person's live, effort-weighted load; the `assign.auto` job (`src/jobs/handlers/assign-auto.ts`) scores people with `src/domain/assignment/assignment-core.ts` and stores the decision with `apply_auto_assignment`, which never overrides a manual choice. With nobody eligible, the case waits in the manager queue.
- Admins, operations managers, client relations and viewers are not auto-assigned unless switched on in Settings → Assignment.
- Manual: `assign_case` (optionally with its unassigned checks) and `assign_check`, both needing `cases.assign`.
