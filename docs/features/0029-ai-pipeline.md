# AI pipeline triggers and decisions

Migration: `supabase/migrations/0029_ai_pipeline.sql`  
Depends on: 0006, 0007, 0009, 0018

- Triggers queue the AI work as the case moves: a finished upload queues `ai.classify_document` (Haiku: type, readability, quality, OCR text, tamper signals), which queues `ai.extract_fields` for its check (Sonnet); entering Pre-QC queues `ai.consistency` then the Pre-QC copilot; Post-QC queues the cross-check (Opus); Final report queues the narrative (Sonnet). Outreach drafts and reply capture run on request. Handlers: `src/jobs/handlers/ai-jobs.ts`; prompts and output schemas: `src/lib/ai/prompts/index.ts`.
- Every result is an `ai_suggestions` row. Nothing is applied on its own: `decide_ai_suggestion(id, accepted|edited|rejected, value)` records a person's decision (staff on the case only; once), supersedes older pending ones and logs it on the case timeline. `set_check_remarks` writes accepted report wording (needs `checks.verify`, `reports.preview` or `cases.stage.change`; locked once the report is with the approver).
- `case_ai_suggestions(case)` feeds the case page's copilot.
- When `ANTHROPIC_API_KEY` is not set the jobs finish as skipped and the screens say AI isn't set up.
- Tests: `supabase/tests/0017_phase4.test.sql`.
