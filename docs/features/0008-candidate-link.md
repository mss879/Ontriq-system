# Candidate link

Migration: `supabase/migrations/0008_candidate_link.sql`  
Depends on: 0006, 0007 (calls 0009 and 0010 at run time only)

- Candidates have no account. Staff issue one link per case (`issue_candidate_link`): the server makes a random 256-bit secret, stores only its SHA-256 and an AES-256-GCM copy sealed with `CANDIDATE_SESSION_SECRET` (so staff can copy or re-send it), and the link expires after 7–60 days (default 14). Issuing a new link turns the old one off. Candidate-collected cases (Process Type 2) send it automatically when staff create the case or accept a portal request.
- Opening `/c/<secret>` swaps the secret for a signed cookie scoped to `/c` (60 minutes, renewed by every action) and leaves the address bar. Every read and write after that goes through `candidate_*` functions that only the service role may call, and each one re-checks the link (revoked, expired or cancelled ends access at once).
- `candidate_link_view` is the whole page: welcome details, checks by name, the document slots the candidate can provide (never field-verification, police or sanction slots), staff requests, messages, consent and a timeline rewritten in candidate wording. No results, internal notes, assignees or other people's data.
- `candidate_requests`: staff ask for a document (opens or re-opens a slot), one detail of a check (validated against the check's schema), or a free question; the candidate answers on the page; staff accept, ask again with a note, or withdraw. Accepting a detail copies it into the check (the app validates it first).
- `candidate_messages`: a simple thread. `consent_forms`: signed on the page (typed name, optional drawn signature) or a photographed paper form, with IP and time; staff accept or reject, or record a paper form they received another way.
- Consent before Pre-QC: once a link has been issued, a case cannot enter Pre-QC until consent is submitted or accepted (trigger on `cases`; the case page explains it).
- Reminders: the hourly `reminder.candidate` job reminds candidates who still owe documents, answers or consent on days 1, 3 and 5 in office hours (Monday to Saturday, 08:00–18:00 Sri Lanka time), by email and SMS, then tells the case owner once (`src/domain/candidate/reminders-core.ts`).
- Emails are in the candidate's language (English, Sinhala, Tamil); SMS stays in English. The Sinhala and Tamil wording needs Ontriq's review before launch.
- Tests: `supabase/tests/0008_candidate_portal.test.sql`, `tests/unit/candidate.test.ts`; hosted checks in `scripts/simulate.ts`.
