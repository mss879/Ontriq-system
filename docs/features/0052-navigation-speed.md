# Navigation speed

`0052_navigation_speed.sql`, with app changes. Results are in `docs/verification/speed-2026-11-01.md`.

Menu clicks felt slow on the live site. A warm page takes about 0.25 s, so the wait wasn't the render. Each hover ran a prefetch on a Netlify function, and the click that followed either waited for it or needed a second instance, which takes about 5 s to start.

## What changed

- **Static shells:** `getViewer()` calls `prefetch()` before reading the session, so each route's App Shell holds no session data and comes from static output. Prefetching a page no longer runs any server code, and Netlify serves repeat prefetches from its durable cache without reaching a function.
- **Menus prefetch:** sidebar, portal and section tabs pass `prefetch="auto"` to `src/components/link.tsx`, so a page's title and skeleton are ready before the first click. Links in tables stay hover-only.
- **30-second reuse:** `experimental.staleTimes.dynamic` keeps a visited page in the browser for 30 seconds. Reopening it makes no server call.
- **Membership:** page views reuse a membership for 60 seconds per session, in memory on each function instance. Server Actions and Route Handlers always read it fresh, which also drops the reused copy, so a person's own change shows on the next page. Row level security still guards every page read, and the one page that reads with the service role, the invoice page's recipient list, asks `hasFreshPermission()` first.
- **Case rules:** `case_visible()` ran for every row a query touched, several lookups each. 16 policies now use `visible_case_ids()`, built once per query. On tables where `case_id` is a required foreign key, `sees_all_cases()` skips even that for people who can read every case. The rules are the same. At 5,000 cases an officer's case list went from 1.7 s to 3 ms in the database.
- **Stage counts:** `case_stage_counts()` counts in SQL. The old code fetched every active case, and past the API's 1,000-row limit its totals would have been wrong.
- **First load:** the assistant, command palette and keyboard shortcuts load after the page, through `src/components/layout/lazy-overlays.tsx`.
- **Fewer overlapping requests:** a hidden tab waits for live updates and catches up on return, and the minute job enqueues its recurring work together.

## Keep in mind

- **A save must clear the browser's pages.** Call `refresh()` or `revalidatePath()` in the Server Action, or a page reopened within 30 seconds shows the old data. Autosaves that skip this need the guard in `QuoteBuilder`, which refreshes once on leaving. Without it a quick return can load an older draft, and the next save overwrites newer work. `scripts/dev/freshness-check.ts` proves this one.
- **Session reads stay below `prefetch()`.** A new read of `cookies()` or `headers()` in a route's shell puts every prefetch of that route back on a function. `scripts/dev/check-static-shells.ts` fails the build in CI if that happens.
- **Two tables can't use the shortcut.** `communications.case_id` and `generated_documents.entity_id` have no foreign key, so a row can outlive its case, and those rows stayed hidden from everyone under `case_visible()`. `communications` uses the list without the shortcut, and `generated_documents` still uses `case_visible()`. The clean-up in `scripts/seed-demo.ts` and `scripts/simulate.ts` can leave such rows behind.
- **A page that reads with the service role checks fresh.** Use `hasFreshPermission()`, because row level security can't stop that read and the reused membership may be up to a minute old.
- **The app can deploy before the migration.** `stageCounts()` falls back to counting rows when `case_stage_counts` is missing, so the dashboard and board stay correct in between. Remove that branch once 0052 is on hosted. The case rule speed-up needs the migration.
- **Don't set `ensureStatic` on a layout.** It would reach the `[caseId]`-style routes and start background page generation for each URL.

## Tools

- `scripts/dev/nav-timing.ts` times a menu walk for any role, holding back requests by the delays measured on live.
- `scripts/dev/freshness-check.ts` checks shells, quick returns, your own changes, quote drafts and sign-out in a real browser.
- `scripts/dev/live-probe.sh` times each layer of the live site from this machine, with no sign-in.
- `scripts/db/rls-volume.sql` times the case rules at about 5,000 cases, then rolls back.
