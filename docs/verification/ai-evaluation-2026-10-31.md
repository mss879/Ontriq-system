# AI evaluation, 31 October 2026

Every AI feature was run against the real models for the first time, scored against known right answers, fixed, and re-scored. 1,566 live calls cost $10.59 in total. None was refused.

## Result

Final scores, each suite run three times on the routing in `0044_ai_routing.sql`.

| Feature | Model and effort | Checks passed | Cost a call, before | Cost a call, now |
|---|---|---|---|---|
| Read and classify a document | Haiku, low | 632 of 639 | $0.0008 | $0.0007 |
| Fill a check's fields | Sonnet, medium | 576 of 576 | $0.0144 | $0.0136 |
| Consistency across documents | Haiku, low | 99 of 99 | $0.0116 | $0.0004 |
| Pre-QC checklist and requests | Haiku, low | 54 of 54 | $0.0183 | $0.0008 |
| Post-QC cross-check | Sonnet, medium | 96 of 96 | $0.0488 | $0.0058 |
| Report remarks | Sonnet, medium | 213 of 213 | $0.0095 | $0.0065 |
| Outreach email and call script | Haiku, low | 111 of 111 | $0.0082 | $0.0004 |
| Reading a verifier's reply | Sonnet, medium | 143 of 144 | $0.0065 | $0.0058 |
| Daily briefing | Haiku, low | 48 of 48 | $0.0051 | $0.0002 |
| Staff nudge | Haiku, low | 48 of 48 | $0.0001 | $0.0001 |
| Quotation text | Sonnet, medium | 87 of 87 | $0.0054 | $0.0049 |
| Payment slip | Haiku, low | 51 of 51 | $0.0003 | $0.0003 |
| Ask Ontriq, through the live endpoint | Sonnet, low | Part of 87 of 87 | not run | $0.003, about 3 seconds |
| Command assistant, through the live endpoint | Opus, low | Part of 87 of 87 | not run | $0.006 to $0.01, about 4 seconds |

Together: 2,158 of 2,166 scored checks, and 87 of 87 for the assistants. Costs are averages from the run and include some cache hits.

The cost model now plans $0.22 for a seven-check case, down from $0.65, and about $51 of AI a month at 200 cases, down from $117. Two real cases through the whole pipeline agree: $0.10 for six separate files to report stage, and $0.15 to read one four-page PDF into seven checks.

## What was tested

- 28 invented documents in English, Sinhala and Tamil: NICs, certificates, service letters, Grama Niladhari and police reports, a CV, a reference form, payment slips and one PDF holding four documents. Some were aged into tilted phone photos, and others blurred, darkened, turned, cropped, uploaded to the wrong slot, edited, or carrying instructions aimed at the AI.
- 15 whole-case fixtures with planted problems, 8 verifier replies, and briefing, nudge and quotation scenarios.
- Two real cases through uploads, triggers, the worker, suggestions and the ledger, then on the check screens signed in.
- 15 assistant questions as Admin, Verification Officer and Super Admin, including a case that doesn't exist, a request to fake a result and a question beyond the person's role.

## What was wrong, and is now fixed

Accuracy and honesty:

- **Post-QC could not read the evidence.** It was given file names only, so a clear result over a police report showing a court case went unnoticed. It now reads the text and cites the case number.
- **A blurred file produced an invented name**, stored as the document's text and passed to later checks. Unreadable files now store nothing and aren't extracted.
- **Payment dates were read month first.** 03/04/2026 came back as 4 March.
- **"To present" couldn't be expressed**, so every current job and residence came back incomplete.
- **The consistency check missed a real discrepancy**: the English translation sat past the point where the text was cut. English now comes first, and each document gets more room.
- **Sonnet proposed Red for contradictions nobody had confirmed.** Red now requires a recorded discrepancy.
- **Post-QC raised noise on clean cases**, including whether the candidate suited the job, which turned a clean case Amber.
- **A clean old NIC was accused of tampering** after a date was miscalculated from its number. NIC facts now come from `parseNic` in code, which counts February as 29 days as the Department does.
- **Instructions hidden in a document were ignored but never reported.** Staff are now always told, by a rule in code.

Client-facing text:

- **Report remarks leaked working notes**, such as "the data provided does not state", and printed dates as 2026-09-25.
- **One misread letter reached the client report.** "Sanduni" was read as "Saduni", which then became a consistency issue, a client request, an outreach question and a report remark. Extraction now knows the declared name. See the rule below.
- **Call scripts contained `[Name]` placeholders.**
- **A signatory was invented as a referee** on the combined PDF.
- **The briefing padded itself** with what the figures don't show, and invented a data-feed worry on a quiet day.
- **The firm nudge wasn't firm.**

Candidates and staff:

- **8 of 23 readable files were flagged "rotated"** for a slight tilt, which would have asked candidates to upload them again.
- **Pre-QC couldn't say what a wrong file was.** It now gets what the file looks like.

Reliability and cost:

- **Search only matched whole phrases**, in Ask Ontriq and the search box, so "Nimali Perera" missed Nimali Sanduni Perera. Fixed in `0045_search_words.sql`.
- **Transient API failures were dropped.** Rate limits and outages finished as "skipped" and were never retried. They now go back on the queue.
- **Calls could hang.** Five stalled during testing, one for 305 seconds. Calls now stop at 150 seconds, or 20 seconds when a person is waiting.
- **Every new upload re-read all of a check's files.** Only the new file is read in full now, and earlier ones go as text.

## Two findings worth keeping

**The first read must stay blind.** Giving the document reader the candidate's name fixed misspellings, but in one run of three Haiku rewrote another person's service letter into the candidate's name. That would hide the fraud Ontriq exists to catch. Only extraction knows the declared name, on the rule that it settles spelling and never identity. Sonnet held to it in all 20 runs on other people's documents, and so did the blind read.

**Instructions must come before the documents.** Putting documents first, to cache them across checks, lost the employers from the combined PDF in 7 of 8 runs at low effort, with no error. Fields, then documents, then a short reminder found them in 16 of 16.

## Why each model was chosen

- **Haiku** matched Sonnet on consistency, Pre-QC, outreach and briefings, at about a twentieth of the price. On consistency it did better, because Sonnet raised false alarms.
- **Sonnet stays on field extraction.** Haiku misread the pen-style Sinhala certificate there, and Sonnet read it correctly from context.
- **Sonnet stays on report remarks and quotations.** Haiku passed the scoring but wrote that the employment record "confirmed" a job title the employer had denied, and the saving is small.
- **Sonnet stays on replies.** Haiku misjudged a Sinhala call note and an out-of-office message.
- **Post-QC moved from Opus to Sonnet.** Medium scored as well as Opus at about a third of the price of Opus medium.
- **Thinking stays on.** It costs little, and Sonnet at low or medium effort mostly doesn't use it.

## What still falls short

- **Haiku's raw text misreads pen-style Sinhala letters.** Six of the eight failed checks are one certificate, read as "Thimali" and "Pathadura". In this font න and ත look alike. Field extraction reads it correctly, and the reviews treat a one-letter difference as a likely misread, marked low.
- **A school name was mistranslated once in three runs.** The transcript is wrong in that run, and extraction is right.
- **One Sinhala call note came back Pending rather than Clear** in one run of three. That errs on the safe side.

## What this doesn't prove

- **These are invented documents.** Fonts on clean pages are easier than real photos and real handwriting. Before relying on it, run 30 to 50 real, consented documents, especially handwritten Sinhala and Tamil.
- **Scenario counts are small** for the review and writing features, from 2 to 8 each. These are strong signals, not guarantees.
- **Not tested:** voice transcription (no provider key), and a real Cfirst PDF.
- **Photo size:** a 12MP photo costs about 4,800 tokens, and shrinking it to 1,600px would halve that. It wasn't changed, because accuracy can't be shown without real photos.
- **People still decide.** Every result here is a suggestion that a person accepts, edits or rejects.

Six capabilities in Settings → AI have no code behind them: `assign.explain`, `assign.rebalance`, `candidate.guide`, `portal.explain`, `commercial.cover_email` and `consent.check`. They spend nothing and do nothing. Fixed wording from the document check covers candidate upload feedback.

## Added later the same day: combined files (classify-v4)

The first read now lists what a file holds ([0046](../features/0046-combined-files.md)). The suite gained two packs: one with another person's letter inside, and one sent to a single slot.

| Run | Result |
|---|---|
| All 27 documents, three repeats | 816 of 828 |
| Files that tripped the first version, twelve repeats each | 495 of 497 |
| A combined PDF through the real pipeline | Four documents found, right pages, no slot ticked |

- **The 12 failures:** 6 are the pen-style Sinhala certificate already described. 4 are one sideways photo, read correctly but not flagged in two runs. 2 are a page number left blank on a pack's first document, which a person can type.
- **The 2 failures in the second run:** calls that hit the time limit, which jobs retry.
- **A correction to the results above.** The clean NIC with a placeholder portrait was marked as possibly edited in about half of reads on classify-v3 (6 of 12). Three repeats happened to miss it. The rule now says a plain portrait or a patterned number isn't a sign of editing, and it was flagged in none of 23.

## Cost model 1.2

The Cost and Feasibility document was rebuilt from these results. The model now plans $0.23 for a seven-check case from separate files and $0.46 from one 12-page PDF. The running cost is about $57, $110 and $194 a month at 50, 200 and 600 cases.

- Six AI calls that were never built came out of the model.
- Sonnet cached reads are $0.10 a million tokens, not $0.20. `0044_ai_routing.sql` corrects the ledger's rate.
- The document's promise that clients can opt out of AI was removed. `clients.ai_opt_out` exists, but nothing reads it.

## Candidate report (candidate-report-v1)

Six scenarios on Haiku and Sonnet, then 447 of 450 on Sonnet low over five repeats, at $0.012 a report. A real one on five files cost $0.021. The 3 failures are wording: one one-sentence summary, and two mentions of answers that were never asked for.

Haiku cost a sixteenth as much and scored the same at first, but its reports wrongly said a letter gave a different NIC number when it was the same number in the old format. The scoring was tightened to catch that, and Sonnet was chosen.

Cost model 1.3 adds the report to every case: $0.27 for a seven-check case from separate files, and about $59, $116 and $211 a month.
