# Simulation SIM-VCFLHQ

Target: `shceiblsjtvwlnkjhkof.supabase.co`. Run: 2026-10-30T19:06:37.076Z. Result: **155 of 155 checks passed**.

## Setting up a throwaway team and two client companies

| Check | Result |
|---|---|
| Admin creates two client companies | Pass |
| Client settings are created automatically | Pass |
| Admin adds a contact to each company | Pass |
| Admin adds every designation to the team as an invitation | Pass |

## Authentication and two-step verification

| Check | Result |
|---|---|
| Everyone signs in with their password | Pass |
| An invited person has no access until they accept | Pass |
| Everyone accepts their invitation | Pass |
| Two-step is off: staff work without a code | Pass |
| A wrong authenticator code is rejected | Pass |
| Every staff member enrols an authenticator and reaches aal2 | Pass |
| Tokens carry the routing kind the proxy relies on | Pass |
| Tokens verify through getClaims | Pass |
| JWT signing algorithm recorded | Pass |
| Public sign-up is turned off | Pass |
| A wrong password is rejected | Pass |
| Passwords shorter than 10 characters are refused | Pass |
| Team invite: setup link, set password, accept, enrol, then access | Pass |
| Re-inviting an existing person falls back to a magic link | Pass |
| Password recovery link resets the password | Pass |

## Role-based access: what every designation can see and do

| Check | Result |
|---|---|
| Super admin (19 rules) | Pass |
| Admin (19 rules) | Pass |
| Operations manager (19 rules) | Pass |
| Client relations (19 rules) | Pass |
| Qc officer (19 rules) | Pass |
| Verification officer (19 rules) | Pass |
| Data entry officer (19 rules) | Pass |
| Viewer (19 rules) | Pass |
| Client admin, company A (21 rules) | Pass |
| Client user, company A (21 rules) | Pass |
| Client viewer, company A (21 rules) | Pass |
| Client user, company B (21 rules) | Pass |

## Escalation guards and instant revocation

| Check | Result |
|---|---|
| Nobody can change their own designation | Pass |
| An admin cannot make someone a Super Admin | Pass |
| A designation change takes effect on the next request | Pass |
| Suspending someone cuts access immediately | Pass |
| The command assistant permission cannot be granted | Pass |
| Portal permissions cannot be given to staff designations | Pass |
| Custom designations accept catalogue permissions | Pass |
| The Super Admin designation cannot be edited | Pass |
| A client admin cannot invite into another company | Pass |
| A client user cannot read another company's contacts | Pass |
| A client user cannot probe client codes | Pass |

## Anonymous visitors (no session)

| Check | Result |
|---|---|
| See no clients | Pass |
| See no audit entries | Pass |
| See no team members | Pass |
| Cannot call access helpers | Pass |
| Cannot read queue depth | Pass |
| Cannot accept invitations | Pass |

## Background jobs and the email outbox (real worker code)

| Check | Result |
|---|---|
| Email is queued with its delivery job in one step | Pass |
| Jobs of an unknown kind are accepted for dead-lettering | Pass |
| The worker drains the queue | Pass |
| The email job succeeded and the outbox row was settled | Pass |
| A job with no handler is dead-lettered with a reason | Pass |
| A viewer cannot retry a job | Pass |
| An operations manager can retry a dead job | Pass |
| The sweeper runs | Pass |

## Notifications and live updates

| Check | Result |
|---|---|
| A notification arrives live for its owner only | Pass |
| Each person reads only their own notifications | Pass |
| Marking notifications read only touches your own | Pass |

## File storage

| Check | Result |
|---|---|
| A browser can upload through a signed upload link | Pass |
| The documents bucket refuses disallowed file types | Pass |
| Signed-in users cannot read private files directly | Pass |
| Private files are not public | Pass |
| A 60-second signed link serves the exact file | Pass |
| Logos in org-assets are publicly served | Pass |

## Document numbering, AI cost ledger and rate limits

| Check | Result |
|---|---|
| Numbering is sequential (on a throwaway series) | Pass |
| The three document designs are available to staff | Pass |
| AI calls are priced from the rate table | Pass |
| Rate limits stop the third hit in a window | Pass |

## Audit trail

| Check | Result |
|---|---|
| Creating a client is recorded with who did it | Pass |
| Designation changes are recorded with the changed field | Pass |
| Nobody can delete audit entries | Pass |

## Case engine: one case from receipt to the final report

| Check | Result |
|---|---|
| Staff create a case: checks and document requirements come from the package | Pass |
| The same person is matched by NIC whichever card they show | Pass |
| The assignment job gives both cases to the only qualified officer, with reasons | Pass |
| Each role sees the cases it should | Pass |
| Missing documents block Pre-QC, with the reason | Pass |
| Documents upload through signed links and count towards requirements | Pass |
| Sensitive evidence is hidden from staff without access | Pass |
| A manager waives the rest and sends the case to Pre-QC | Pass |
| Pre-QC can return the case, then approve it | Pass |
| Data entry checks every field against the check's form before verification | Pass |
| Verification: results are recorded by the officer, and a red result cannot be marked clear | Pass |
| Post-QC sends a check back, then approves the case for the report | Pass |
| The timeline and stage history record every step | Pass |
| Hold and cancel follow permissions | Pass |
| Client portal requests start at intake, for their own company only | Pass |
| Search finds cases for staff and nothing for clients | Pass |
| Check type drafts can be saved and discarded without touching published versions | Pass |
| Client-built packages always carry Ontriq's price | Pass |

## Candidate link and client portal

| Check | Result |
|---|---|
| Staff open a candidate-collected case and issue the candidate's link | Pass |
| The link opens for the candidate and shows only what they may see | Pass |
| The candidate uploads into a document slot straight to private storage | Pass |
| A link can never reach another case | Pass |
| Staff ask the candidate a question, the candidate answers, staff accept it | Pass |
| Pre-QC waits for the candidate's consent | Pass |
| Turning the link off ends the candidate's access at once | Pass |
| Clients see their own cases through the portal, without internal notes | Pass |
| Clients upload into a slot Ontriq shared with them, and only there | Pass |
| Clients open documents Ontriq shared, never internal ones | Pass |
| Client users hear about documents Ontriq needs, by email too | Pass |
| Staff can't use the portal functions, and visibility settings apply | Pass |
| Reminders pick up candidates who still owe something | Pass |

## Final report, quotations, invoices and payments

| Check | Result |
|---|---|
| Ontriq drafts the report: the real render job builds the PDF with its fingerprint | Pass |
| Approval checks the case didn't change after the draft, and a green result needs every check clear | Pass |
| A second person releases it; the client can download it and the public can verify it | Pass |
| Per-case billing drafts the invoice on release, priced from the case | Pass |
| Live quotations or invoices exist: numbered quotation and invoice steps skipped to keep numbers gap-free | Pass |

## AI review, performance and nudges, the assistant, analytics and data protection

| Check | Result |
|---|---|
| Uploads queued the AI document reading, and it finishes cleanly with or without an AI key | Pass |
| AI suggestions wait for the right person: QC decides the Pre-QC review, data entry can't, nobody edits one directly | Pass |
| Managers see the leaderboard; officers see only their own work | Pass |
| A manager pushes an officer, who acknowledges and replies; others can't push | Pass |
| Conversations with the assistant are private, and only the Super Admin gets the command assistant | Pass |
| Analytics: operations for managers, money for finance only | Pass |
| Only a case's owner, a stage manager or an approver can generate its report draft | Pass |
| Erasing a cancelled case removes its personal data but keeps a candidate another case needs | Pass |

## The app at http://localhost:3200 against this backend

| Check | Result |
|---|---|
| The sign-in page renders with the Ontriq brand | Pass |
| Private pages send signed-out visitors to sign in | Pass |
| The scheduler endpoint refuses callers without the secret | Pass |
| The scheduler endpoint runs with the secret | Pass |
| The health check passes | Pass |
| An emailed invite link signs the person in and opens account setup | Pass |
| Two-step is off: staff open the app with a password alone | Pass |
| Staff with two-step verification open the dashboard | Pass |
| Admins see the whole team on the Team page | Pass |
| The Team page stays closed to a viewer | Pass |
| Admins open Settings | Pass |
| Settings stay closed to a viewer | Pass |
| Client users are routed to their own portal | Pass |
| Staff are kept out of the portal | Pass |
| A case document opens only for staff allowed to see it | Pass |
| The case page opens for its officer | Pass |
| Global search answers staff over the API | Pass |
| A candidate link opens the private page and leaves the address bar | Pass |
| An unknown candidate link shows the expired page | Pass |
| Clients open their case in the portal; other companies can't | Pass |
| Staff see the candidate panel and the client's portal settings | Pass |
| Every portal page opens for a client admin with their own data | Pass |
| A client viewer can't open team management or new requests | Pass |
| The candidate downloads their consent form | Pass |
| The public verify page confirms a released report | Pass |
| Report and invoice PDFs open for the client and stay closed to others | Pass |
| Clients open a shared document; internal ones stay closed | Pass |
| Phase 4 and 5 pages open for the right people | Pass |
| The cases CSV export works for staff and is refused to clients | Pass |
| Ask Ontriq answers over its stream (or says AI isn't set up) and stores the conversation | Pass |

## Cleaning up everything the simulation created

| Check | Result |
|---|---|
| Remove quotations, invoices, payments and reset document numbers | Pass |
| Remove case data and reset the case counter | Pass |
| Remove files | Pass |
| Remove AI suggestions, pushes, conversations and erasure records | Pass |
| Remove jobs, outbox, AI runs, counters and limits | Pass |
| Remove invitations, designations and client companies | Pass |
| Remove the throwaway people | Pass |
| Remove the simulation's audit entries | Pass |
| Nothing from the simulation is left behind | Pass |
