# Candidate report (0047)

When a candidate has given everything and confirms, the AI writes up what they provided and attaches their files as an appendix.

- **The candidate's last step.** Once nothing is owed, their page asks them to tick a declaration and press Confirm and send, in English, Sinhala or Tamil. `candidate_confirm_submission` checks again that nothing is owed. A second click writes no second report. Anything new after that, such as a file staff asked for, asks them to confirm again and makes a new version.
- **The report.** `ai.candidate_report` waits for uploads still being read, then has `candidate.report` (Sonnet, low) write a summary, facts by area and points to check, from the text already taken from each file. Details, consent and the candidate's own answers come from the database, not the AI. Each file follows the report behind a cover sheet, as A1, A2 and so on, and each fact cites its file. `cleanCandidateReport` drops any reference to a file that doesn't exist.
- **Who sees it.** Staff only, in the Candidate section of the case. It is not a verification report and says so on the first page. Clients see that the candidate confirmed, and never see the report. It carries the candidate's files, so it takes on their rules: if one is sensitive, staff without `documents.read_sensitive` can't open the report or read its summary.
- **When the AI can't help.** With the AI off or not set up, the report still goes out with the facts and the files, and the timeline says it was written without the AI. An outage goes back on the queue. Staff can use Make it again, or Make it now if the candidate never confirmed.
- **Erasure.** The report is a `generated_documents` row and its text is a suggestion on the case, so `erase_case` removes both with the rest.

## Keep

- It comes before verification, so it must never say anything is verified, and never give a result or advice. `npm run ai:eval -- --suites candidateReport` scores this.
- Sonnet, not Haiku. They scored alike at first, but Haiku's summary called one NIC in two formats "a different NIC number". Read the reports, not only the scores.
