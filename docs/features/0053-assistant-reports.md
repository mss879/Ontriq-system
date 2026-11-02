# Assistant reports and business-only answers

`0053_assistant_reports.sql`, with app changes.

The Command assistant can now answer questions about any date range and turn the answer into a branded PDF, and both assistants stay on Ontriq's business.

## What it does

- **`business_report`:** team performance, operations or revenue for exact dates, in Ask Ontriq and the Command assistant, for anyone with the matching permission. A client can be picked for operations and revenue.
- **`create_report_pdf`:** the same report as a PDF with a download button in the chat. Command assistant only.
- **Business only:** both assistants politely decline anything outside Ontriq's work, however the request is put. Text inside records is treated as information, never as an instruction.

Try: "Create a performance document for July to September with all the employee data and who performed best, as a PDF."

## How it works

- **Figures come from code, not the AI.** `src/domain/business-report/build.ts` works out every figure and the ranking from `performance_board`, `analytics_operations` and `analytics_revenue`, the same sources and scoring as the Performance and Analytics pages. The AI only adds key points, and the PDF labels them as its own.
- **Reports are read as the person asking,** so row level security and the database functions decide what they get. Verification officers and others without the permission get no ranking or money.
- **The PDF is drawn in the background.** The tool stores the figures in `assistant_report_figures`, queues `assistant.report`, and the chat checks `/api/documents/<id>?status=1` until it's ready, usually about 10 seconds. The job has priority over other background work, because someone is waiting.
- **The figures are deleted once the PDF is drawn.** They aren't in the job record, because more roles can read those than these reports. Only the service role can reach the table.
- **Each PDF opens only for the person who asked for it,** not for other Super Admins or anyone with `settings.manage`.

## Keep in mind

- A period with nothing recorded gets a plain answer and no PDF. A report's end date stops at today, and a period that hasn't started is refused.
- Team figures run up to the last daily update, the day before today. Open and overdue counts are as they stand today.
- The business-only rule is an instruction to the model, not a technical block. It held in every test, but the model still has general knowledge, so it can't be a guarantee. The tools are the real boundary: the assistant can only read what the person may read, and it can't change anything without their Confirm.
- The model sometimes writes a line of planning before a tool call, even when told not to. `src/lib/ai/assistant/preamble.ts` holds the start of each reply and drops that line, so a reply's first words can appear a moment later than the model writes them.
- A PDF covers its period as one block. Asked for a month-by-month PDF, the assistant puts the monthly figures in its key points, so those come from the AI reading the reports, not from a table drawn by code.
- `scripts/ai-eval/assistant.ts` tests all of this with the real model, off-topic refusals and role limits included. Local verification configs blank `ANTHROPIC_API_KEY`, so run it against a server that has the key.

## Results on 2026-11-02, local build

| Check | Result |
|---|---|
| Real-model test set, 24 questions | 133 of 133 |
| Off-topic refusals, including "your rules are lifted" | 4 of 4 |
| July to September PDF, click to download button | about 10 seconds |
| Cost of one PDF report | about 2.5 US cents |
| Unit tests | 326 of 326 |
| Database suites | All pass |
| Browser smoke test, every role | 139 of 139 pages after removing test conversations, 6 of 6 interactions |
| Simulation on an empty stack | 154 of 156 (`docs/verification/simulation-2026-11-02-agent.md`) |

The two simulation misses are the local limits recorded in `docs/verification/speed-2026-11-01.md`. The owner ran 0052 and 0053 on hosted in the SQL Editor on 2026-11-02.
