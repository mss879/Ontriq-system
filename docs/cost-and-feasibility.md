# Ontriq CRM — Cost and Feasibility

Version 1.3 · prices checked 31 October 2026 · USD (LKR at 335)

Generated from `src/domain/ai/cost-model.ts` by `npm run docs:cost`. The PDF is the client-facing version.

## Summary

| | |
|---|---|
| AI per comprehensive case (7 checks) | $0.27 (LKR 89) |
| AI per comprehensive case as one combined PDF | $0.50 |
| AI per standard case (3 checks) | $0.13 |
| AI per standard case as one combined PDF | $0.16 |
| AI per client onboarding with quotation | $0.018 |
| AI per invoice | $0.0003 |
| Staff time saved per comprehensive case | 3.0 hours |

## Cost per task

| Task | Model | Unit | Cost |
|---|---|---|---|
| Read one page: type, quality, text, translation, signs of editing | Haiku 5.5 | page | $0.0008 |
| Fill the fields for one check | Sonnet 5.5 | check | $0.017 |
| Write the candidate report once they confirm | Sonnet 5.5 | case | $0.038 |
| Compare everything across documents | Haiku 5.5 | case | $0.002 |
| Pre-QC checklist and drafted requests | Haiku 5.5 | case | $0.001 |
| Draft the verification email and call script | Haiku 5.5 | check | $0.0004 |
| Turn a verifier's reply into a proposed result | Sonnet 5.5 | check | $0.009 |
| Post-QC cross-check and proposed outcome | Sonnet 5.5 | case | $0.018 |
| Report remarks and summary | Sonnet 5.5 | case | $0.013 |
| Draft a quotation | Sonnet 5.5 | draft | $0.006 |
| Read a payment slip | Haiku 5.5 | slip | $0.0003 |
| Draft a nudge to a staff member | Haiku 5.5 | nudge | $0.0001 |
| Staff assistant question | Sonnet 5.5 | question | $0.005 |
| Super Admin command | Opus 5.5 | command | $0.012 |
| Daily manager briefing | Haiku 5.5 | day | $0.0001 |

## Monthly running cost

| Per month | Starter | Growth | Scale |
|---|---:|---:|---:|
| Cases | 50 | 200 | 600 |
| AI | $13.18 | $48.61 | $140 |
| Netlify Pro | $20.00 | $20.00 | $20.00 |
| Supabase Pro | $25.00 | $25.00 | $25.00 |
| Email | free plan | $20.00 | $20.00 |
| SMS | $0.45 | $1.80 | $5.40 |
| Voice transcription | $0.045 | $0.090 | $0.15 |
| **Total (USD)** | **$59** | **$116** | **$211** |
| Total (LKR) | LKR 19,656 | LKR 38,693 | LKR 70,682 |

Any month: $45 for hosting and the database, plus about $0.23 a case, plus a few dollars for the assistants. Add $20 for email above about 113 cases a month.

Hosting is provided under a monthly maintenance plan, quoted separately.

## Sources

- Claude pricing: https://claude.com/pricing
- Netlify pricing: https://www.netlify.com/pricing/
- Supabase pricing: https://supabase.com/pricing
- Supabase compute sizes: https://supabase.com/docs/guides/platform/compute-and-disk
- Resend pricing: https://resend.com/pricing
- OpenAI transcription pricing: https://openai.com/api/pricing/
- Sri Lanka SMS rates (local gateway benchmark): https://text.lk
- USD to LKR, Federal Reserve series: https://alfred.stlouisfed.org/series?seid=DEXSLUS
