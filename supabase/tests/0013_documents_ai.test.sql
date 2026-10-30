\o /dev/null
-- Document numbering, AI cost pricing and rate limiting.
begin;
set local role service_role;
do $$
declare
  q1 text; q2 text; v_cost numeric; y text := extract(year from now() at time zone 'Asia/Colombo')::text;
begin
  q1 := public.next_document_number('quote');
  q2 := public.next_document_number('quote');
  assert q1 = 'QT-' || y || '-0001', 'unexpected first quote number ' || q1;
  assert q2 = 'QT-' || y || '-0002', 'numbers are not sequential ' || q2;
  assert public.next_document_number('invoice') = 'INV-' || y || '-0001', 'invoice series wrong';

  -- 1M in + 1M out on Sonnet 5.5 = $2 + $10
  v_cost := public.price_ai_usage('claude-sonnet-5-5', 1000000, 1000000);
  assert v_cost = 12, 'sonnet pricing wrong: ' || v_cost;
  -- batch halves input/output
  assert public.price_ai_usage('claude-haiku-5-5', 1000000, 1000000, 0, 0, 0, true) = 0.30, 'batch discount wrong';
  -- 2 minutes of audio
  assert public.price_ai_usage('gpt-4o-mini-transcribe', 0, 0, 0, 0, 120) = 0.006, 'audio pricing wrong';

  insert into public.ai_runs (org_id, capability, model, input_tokens, output_tokens, cache_read_tokens)
  values ('00000000-0000-4000-8000-000000000001', 'document.extract', 'claude-sonnet-5-5', 5000, 700, 2500);
  assert (select cost_usd from public.ai_runs order by created_at desc limit 1) = 0.0175, 'ai_runs trigger did not price the call';

  assert public.rate_limit_check('test:key', 60, 2), 'first hit should pass';
  assert public.rate_limit_check('test:key', 60, 2), 'second hit should pass';
  assert not public.rate_limit_check('test:key', 60, 2), 'third hit should be limited';
end $$;
reset role;
rollback;
\echo '  ✓ documents, AI pricing, rate limits'
