# Ontriq CRM — Cost and Feasibility

Version 1.0 · prices checked 29 October 2026 · USD (LKR at 300)

Generated from `src/domain/ai/cost-model.ts` by `npm run docs:cost`. The PDF is the client-facing version.

## Summary

| | |
|---|---|
| AI per comprehensive case (7 checks) | $0.65 (LKR 196) |
| AI with Sonnet for Post-QC | $0.54 |
| AI per standard case (3 checks) | $0.35 |
| AI per client onboarding with quotation | $0.11 |
| AI per invoice | $0.0006 |
| Staff time saved per comprehensive case | 3.0 hours |

## Cost per task

| Task | Model | Unit | Cost |
|---|---|---|---|
| Classify, quality-check and read one page | Haiku 5.5 | page | $0.0007 |
| Extract the fields for one check | Sonnet 5.5 | check | $0.018 |
| Cross-document consistency check | Sonnet 5.5 | case | $0.036 |
| Pre-QC checklist and drafted requests | Sonnet 5.5 | case | $0.028 |
| Verification outreach draft | Sonnet 5.5 | check | $0.011 |
| Turn a reply into a proposed result | Sonnet 5.5 | check | $0.013 |
| Post-QC cross-check and proposed outcome | Opus 5.5 | case | $0.22 |
| Report findings and summary | Sonnet 5.5 | case | $0.060 |
| Tamper and duplicate signals | Haiku 5.5 | case | $0.0008 |
| Instant feedback on a candidate upload | Haiku 5.5 | upload | $0.0003 |
| Plain-language status for client or candidate | Haiku 5.5 | update | $0.0003 |
| Check a photographed consent form | Haiku 5.5 | form | $0.0003 |
| Explain an auto-assignment | Haiku 5.5 | case | $0.0002 |
| Draft a quotation | Sonnet 5.5 | draft | $0.037 |
| Cover email for a quote or invoice | Haiku 5.5 | email | $0.0003 |
| Read a payment slip | Haiku 5.5 | slip | $0.0003 |
| Draft a nudge to a staff member | Haiku 5.5 | nudge | $0.0003 |
| Staff assistant question | Sonnet 5.5 | question | $0.017 |
| Super Admin command (text or voice) | Opus 5.5 | command | $0.063 |
| Daily manager briefing | Sonnet 5.5 | day | $0.030 |

## Monthly running cost

| Per month | Starter | Growth | Scale |
|---|---:|---:|---:|
| Cases | 50 | 200 | 600 |
| AI | $34.45 | $117 | $324 |
| Netlify Pro | $20.00 | $20.00 | $20.00 |
| Supabase Pro | $25.00 | $25.00 | $25.00 |
| Email | free tier | free tier | $20.00 |
| SMS | $0.45 | $1.80 | $5.40 |
| Voice transcription | $0.045 | $0.090 | $0.15 |
| **Total (USD)** | **$80** | **$164** | **$395** |
| Total (LKR) | LKR 23,984 | LKR 49,182 | LKR 118,504 |

Hosting is provided under a monthly maintenance plan, quoted separately.

## Sources

- Anthropic Claude pricing: https://www.anthropic.com/pricing
- Netlify pricing: https://www.netlify.com/pricing/
- Supabase pricing: https://supabase.com/pricing
- Resend pricing: https://resend.com/pricing
- OpenAI transcription pricing: https://openai.com/api/pricing/
- Sri Lanka SMS rates (local gateway benchmark): https://text.lk
