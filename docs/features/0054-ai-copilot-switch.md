# AI copilot switch

`0054_ai_copilot_switch.sql`, with app changes.

Ontriq found the AI panels at every step of a case too much and too big. A Super Admin can now hide them for everyone from Settings → Organisation → AI copilot. It starts off.

## What it hides

With the switch off, case and check screens show only the case:

- **Case page:** the AI copilot section (consistency, Pre-QC and Post-QC reviews, the drafted summary and remarks, and its ask-the-candidate and request-documents shortcuts), the "found by AI" count on each check, and the AI's write-up of the candidate report (the report file itself stays).
- **Check page:** the outreach draft, reply capture and drafted remarks panel, and the values read from files. Those values are no longer filled into empty fields either.
- **Documents, on both pages:** the AI chip on each file, the "may hold documents this case needs" cards and the photocopy hint. A check's file list no longer adds files only the AI tied to it.

Turning it back on brings everything back, including suggestions made while it was off.

## What it doesn't change

- **AI jobs keep running.** Uploads are still read and reviews still drafted under each capability's switch in Settings → AI, so they cost the same. Turn capabilities off there to stop the work and the spend.
- **The Command assistant and Ask Ontriq** are not affected, nor are the AI touches outside cases: payment slips, quotation drafting, client suggestions and the morning briefing.
- No feature code was removed.

## How it works

- `orgs.ai_copilot_enabled`, default `false`. `orgs_guard` lets only a Super Admin change it, the same rule as two-step sign-in. `orgs` is audited (0002), so each change lands in the audit log with who made it.
- `getCopilotOn` in `src/lib/server/ai/queries.ts` reads it. The case and check pages skip their AI queries when it's off, so the screens also load a little less.
