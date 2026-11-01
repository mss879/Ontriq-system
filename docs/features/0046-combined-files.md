# One file filling several document slots (0046)

A client can scan a NIC, a service letter and a police report into one PDF. The fields already filled from a file like that, but the document slots stayed pending, because a slot only counted files uploaded under its own category. Staff had to waive each one.

- **The AI suggests.** The first read lists each document in the file, with its pages and whose it is, in `contains`. `aiClassify` keeps the ones that aren't the file's own type as a `document.classify` suggestion with the field key `contains`. It never ticks a slot.
- **A person decides.** The documents panel shows "This file may hold 4 documents this case needs". Review opens a list to tick, with the pages to correct and the name on each document, so someone else's letter inside a pack is easy to spot. Confirming calls `confirm_requirement_files`, with the same permission as accepting a file.
- **Without the AI.** "In a file already here" on a slot's menu does the same by hand. "Not in this file" undoes either.
- **Counting.** `requirement_files` links a slot to a file, and `sync_requirement_counts` counts each file once. Everything that reads a slot's status follows from that: stage gates, the client portal, the candidate's page. A rejected or replaced file stops counting.
- **Handling.** A file holding a sensitive category becomes sensitive and stays so. Staff without `documents.read_sensitive` then can't open any of it, including pages they could otherwise read. A file holding evidence goes in the report. Removing the last slot takes it back out, unless its own category belongs there.
- **Report.** The whole file is annexed once, as "Combined file", and its cover page lists what it holds. Each check's evidence names the file and page. `case_unreported_evidence` sees evidence through the file.
- **Not coverable.** A fixed annexure such as the screening report stays a file of its own, because it goes to the client untouched.

## Keep

- `contains` stays last in `ClassifySchema`. Placed earlier, it drew false "rotated" flags on clean photos and split CVs into two documents.
- `z.enum` isn't enforced by the API: the SDK turns the list into a text note, and an unlisted word then fails the read when the answer is parsed. `quality_issues` uses `.catch("other")`, because Haiku returned "tilted". The other schemas with a `z.enum` carry the same risk.
