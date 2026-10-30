# Case engine

Migration: `supabase/migrations/0006_cases.sql`  
Depends on: 0003, 0004, 0005, 0009, 0010

- `candidates` are matched by NIC: old and new cards share one 12-digit canonical form (`src/domain/nic-core.ts`), unique per org.
- `cases` carry a gapless reference (`ONT-2026-000123`), a frozen package snapshot, process type (Type 1 client supplies documents, Type 2 Ontriq collects), stage, configurable status, hold and return flags, proposed and final results, counts, owner and due date (working days, Asia/Colombo).
- `case_checks` (one per check, pinned to its check type version), `case_check_requirements` (documents per check), `stage_history`, `case_events` (the timeline, with client and candidate visibility flags) and `client_status_catalog`.
- Every write is a security definer function that checks permission and the workflow rules: `create_case`, `case_transition`, `set_case_hold`, `cancel_case`, `update_case_details`, `update_candidate`, `save_check_values`, `set_check_state`, `add_case_note`, `request_case_document`, `waive_requirement`. The tables are read-only to signed-in users.
- Visibility (`case_visible`): staff with `cases.read` see all cases; officers see cases they own or hold a check on; data entry officers see the data entry queue. Client users read cases through portal views in Phase 2.
- Rules mirrored for the UI in `src/domain/workflow/*` (tested in `tests/unit/workflow.test.ts`); the database is the authority (tested in `supabase/tests/0006_case_engine.test.sql`).
