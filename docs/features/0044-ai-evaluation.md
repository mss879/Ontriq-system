# AI evaluation and routing (0044, 0045)

Every AI feature was scored against the real models, fixed, and moved to the cheapest model that held its score. The results are in [ai-evaluation-2026-10-31.md](../verification/ai-evaluation-2026-10-31.md), and [scripts/ai-eval](../../scripts/ai-eval/README.md) re-runs them.

- **Routing (0044).** Consistency, Pre-QC, outreach and the briefing move to Haiku. Post-QC moves from Opus to Sonnet. A capability already changed in Settings → AI is left alone.
- **Search (0045).** `search_everything` matches each word, so a name without its middle name is found.
- **Prompts.** All prompts now live in `src/lib/ai/prompts`, each with a new version. The text each job sends lives in `src/jobs/ai/content.ts`, which the evaluation shares, so it scores what production asks.
- **Failures.** `runStructured` stops a call at 150 seconds, or at `limitMs`. A transient failure returns `unavailable`, and jobs put those back on the queue.
- **Rules to keep.** The first read of a document stays blind: never give `classifyPrompt` the candidate's name. Extraction's instructions go before the documents, with the reminder after them. NIC facts come from `parseNic`, not the model. `contains` stays last in the classify schema ([0046](0046-combined-files.md)).

Run `npm run ai:eval` after changing a prompt or a model, and read the answers as well as the scores.
