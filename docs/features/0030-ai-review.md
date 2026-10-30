# AI review permissions

Migration: `supabase/migrations/0030_ai_review.sql`  
Depends on: 0018, 0029

- AI suggestions can no longer be updated directly (the update policy and grant are gone), so "AI suggested" text can't be rewritten by hand. Every decision goes through `decide_ai_suggestion`.
- `can_decide_ai_suggestion(capability)` decides who may act on which kind (mirrored in `src/domain/ai/suggestions.ts`): extracted field values need `checks.data_entry` or `checks.verify`; document readings `cases.update` or `qc.pre`; tamper signals `qc.pre`, `qc.post` or `cases.update`; consistency `qc.pre` or `qc.post`; the Pre-QC review `qc.pre`; the Post-QC cross-check `qc.post`; drafted remarks `checks.verify`, `qc.post` or `cases.stage.change`; outreach drafts and captured replies `checks.verify`. Only field values, remarks and a reply's result may be edited before they are applied.
- `set_check_remarks` needs `checks.verify`, `qc.post` or `cases.stage.change`; seeing reports (`reports.preview`, which the Viewer role holds) is no longer enough.
- Screens: the case page's AI copilot (consistency, Pre-QC checklist and drafted requests, Post-QC cross-check, drafted remarks, run again), the check page's "Found in the documents" and "AI help" (outreach draft, capture a reply), and the AI reading on each file row.
- Tests: `supabase/tests/0030_ai_review.test.sql`, `tests/unit/ai-suggestions.test.ts`.
