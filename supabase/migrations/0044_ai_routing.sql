-- 0044: AI routing from the evaluation of 31 October 2026
-- (docs/verification/ai-evaluation-2026-10-31.md). Each capability moves to the
-- cheapest model and effort that held its score over repeated runs. Field
-- extraction, report remarks, replies and quotations stay on Claude Sonnet 5.5,
-- where the text matters most or a cheaper model did worse. A capability
-- someone has already changed in Settings → AI is left alone.

update public.ai_capabilities set model = 'claude-haiku-5-5', effort = 'low'
 where (key, model, effort) in (
   ('case.consistency', 'claude-sonnet-5-5', 'medium'),
   ('case.preqc', 'claude-sonnet-5-5', 'medium'),
   ('check.outreach', 'claude-sonnet-5-5', 'low'),
   ('briefing.daily', 'claude-sonnet-5-5', 'low')
 );

update public.ai_capabilities set model = 'claude-sonnet-5-5', effort = 'medium'
 where key = 'case.postqc' and model = 'claude-opus-5-5' and effort = 'high';

-- Claude Sonnet 5.5 cached reads are $0.10 a million tokens (claude.com/pricing, 31 October 2026).
update public.ai_cost_rates set cache_read_rate = 0.10 where model = 'claude-sonnet-5-5' and cache_read_rate = 0.20;
