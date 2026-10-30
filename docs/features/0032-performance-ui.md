# Performance page and Push

Migration: `supabase/migrations/0032_performance_ui.sql`  
Depends on: 0010, 0017, 0021

- `send_nudge` links the in-app notice to the dashboard banner and, when email is chosen, really sends the email copy (before, it went only if the person had email on for pushes in their preferences). The email job uses the same key as the preferences trigger, so it is never sent twice.
- `auto_nudge_candidates` escalates a second automatic push in a week only when `assignment_rules.auto_nudge.escalate` is on (the default).
- Screens: `/app/team/performance` (leaderboard for 7, 30 or 90 days, heatmap, per-person drill-down, Push, Rebalance; people without `staff.performance.read` see their own scorecard), the dashboard's push banner, morning briefing and "My scorecard" tiles, and the performance weights and automatic push rule in Settings → Assignment.
- Rebalance is rules-based: it proposes moving open checks from people over capacity or with overdue work to the least-loaded qualified person; the manager ticks the moves and each goes through `assign_check` with a reason.
- Tests: `tests/unit/performance.test.ts`; nudges in `supabase/tests/0017_phase4.test.sql`.
