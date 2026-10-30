# UI guidelines

How screens are built, so new work stays consistent. Light is the default theme; dark is each person's own choice.

## Colour

- Colour says how something is doing: on track, at risk, late, or a result. A case's position in the flow comes from its step number and the `--stage-*` ramp, not from a hue.
- Tokens live in `src/app/globals.css`. Hex belongs only in the logo, the PDF-twin document preview, the signature canvas, the global error page and the brand gradients.
- The sidebar, heroes and login panel stay navy in both themes. Use `brand-peach` and `on-dark-success` on them.

## Buttons

- `default` (Ontriq blue) is the primary action everywhere in the workspace and portal. One per area of the screen.
- `inverse` (white) is the primary action on a navy surface. `brand` is for the sign-in screens and the landing page.
- `outline` is secondary. `destructive` is for anything that removes, and `ConfirmDialog` guards it.

## Status chips

- A chip marks something worth noticing. When a state is the expected one on every row, print it as plain text. "Active" is the usual example.
- Use `ToneChip` and the helpers around it: `StagePill`, `CheckStatePill`, `ResultBadge`. Use `shownResult()` for a case's result: amber means nothing until every check is done.
- `statusNote()` gives a status only when it says more than the stage does.

## Patterns

| Need | Use |
|---|---|
| Card | `Surface`, or `SURFACE` for a link that is itself a card |
| Headline number | `KpiTile` |
| List | `DataTable` with `ListCard`s for phones; `ROW` and `ROW_LINK` make the row clickable |
| Tabs | `SegmentedTabs` to switch a list, `UnderlineTabs` for sections of an area |
| Progress | `Stepper`, `ChecksProgress` |
| Filters | `ListFilters`, `FilterChips` |
| Dates | `DateField` |
| Empty list | `Empty`, once, in the card a full list would use |
| A section that can fail | `SectionBoundary` around its `Suspense` |
| Where you are | Breadcrumbs come from `nav.ts`; a detail page adds its record with `SetCrumbs` |

## Roles

- The dashboard's first row is chosen by `focusFor()` in `src/app/(staff)/app/page.tsx`. A new role needs a line there.
- Hide what a role can't use. Never show a tile, link or tab that leads somewhere the role can't open.

## Phones

Below `md`, lists become cards. Below `sm`, a stepper becomes one line and a bar. Inside a scrolling list, give cards room with `-m-1 p-1`, or their rings get cut off at the edge.
