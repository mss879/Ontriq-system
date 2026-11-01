# AI evaluation

Scores every AI feature against the real model, on invented documents and cases whose right answers are known. Every call goes through the app's own code. Generated files and raw answers stay outside the repo, in `~/.ontriq/ai-eval`.

Needs `ANTHROPIC_API_KEY` in `.env.local`. Each run spends real money, and `AI_EVAL_CAP` (dollars, default 20) stops it. Identical requests are answered from a disk cache, so re-running costs nothing.

```bash
npm run ai:docs
```

```bash
npm run ai:eval -- --repeat 3 --run final
```

```bash
npm run ai:eval -- --suites extract --arms s-low,s-medium,h-low --repeat 3 --run compare
```

```bash
npm run ai:e2e
```

```bash
npm run ai:assistant -- --base http://localhost:3101
```

`ai:eval` scores one suite per capability. An arm is a model and effort: `h`, `s` or `o` for Haiku, Sonnet or Opus, then `low`, `medium` or `high`. With no `--arms`, each suite runs on its production routing, which `CURRENT` in `suites.ts` must keep matching. `--only id,id` narrows document suites to named files.

`ai:e2e` and `ai:assistant` run on the local stack only: real uploads, triggers, worker, ledger and endpoint. `npm run ai:e2e -- --pack` stops after the combined PDF, with its slots waiting for a person. `npm run ai:e2e -- --candidate` plays a candidate up to their last step and prints their link, so confirming can be done in a browser.

Read the answers as well as the scores. The checks only cover what someone thought to test, and several real faults passed them until a person read the output.
