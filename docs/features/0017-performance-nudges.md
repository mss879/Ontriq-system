# Staff performance and nudges

Migration: `supabase/migrations/0017_performance_nudges.sql`  
Depends on: 0016 (calls 0010 at run time)

- `staff_open_items(user)` is the one definition of "open work": unfinished checks and cases a person owns, with `overdue` (past due) and `at_risk` (due within a day). Cases on hold don't count.
- `performance_rollup(day)` (job `performance.rollup`, 00:30 Colombo, for the day before) fills `staff_performance_daily`: checks completed, cases closed, average turnaround, on time vs late, QC returns, minutes to first action, overdue at the end of the day, pushes received.
- `performance_board(from, to)` (`staff.performance.read`) returns raw totals per person plus live open, overdue and at-risk counts. The app scores them (`src/domain/performance/score-core.ts`: throughput 40 %, timeliness 30 %, quality 20 %, responsiveness 10 %, weights editable in `assignment_rules.performance_weights`). `my_open_items()` lets anyone see their own work; managers can open anyone's.
- `send_nudge(to, message, channels, items)` (`staff.nudge`): never yourself, only active staff, message required; lists the overdue and at-risk items when none are given; always in-app (urgent, bypasses quiet hours) plus email or SMS when chosen. `acknowledge_nudge(id, reply)` is for the person pushed only; a reply notifies the sender.
- Automatic pushes (`nudge.auto`, hourly): `assignment_rules.auto_nudge` `{enabled, overdue_items, hours}` picks people with that many items overdue for that long, at most one automatic push a day; a second within a week escalates to everyone with `staff.nudge`.
- Row level security: people see their own daily numbers and pushes; managers with `staff.performance.read` see the team. Nothing is written directly.
- Tests: `supabase/tests/0017_phase4.test.sql`.
