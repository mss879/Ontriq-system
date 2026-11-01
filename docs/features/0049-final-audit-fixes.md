# Final audit fixes

`0049_final_audit_fixes.sql`, with `supabase/tests/0049_final_audit.test.sql`, `supabase/tests/0049_independent_audit.test.sql` and `supabase/tests/0049_last_read.test.sql`. Independent readers checked the build twice after 0048, each from the client's documents and the code. Every finding was confirmed in the code before it was fixed, and each one has a test that replays it. The requirement-by-requirement result is in [the audit](../verification/requirements-audit-2026-10-31.md).

Hold rule used throughout: on hold, staff work and everything outbound stops. The client and the candidate can still send in what was asked for. Notes and the contact log stay open, because they record what happened.

Evidence rule used throughout: after verification only someone with `qc.post` or `cases.stage.change` may change evidence. At approval nobody may: the report goes back first.

## Confidentiality (spec 6.4)

| Finding | Fix |
|---|---|
| A client user could read the organisation row, the status catalog and the contact log through the API. | `orgs_select`, `client_status_catalog_select` and `communications_select` are staff-only. Clients read `portal_org_profile()`. |
| A file staff uploaded reached the client or candidate before anyone reviewed it. | Staff uploads start invisible to both, whatever the slot says. A reviewer's reason goes only to the person who uploaded the file. |
| Hidden checks still counted in portal totals. | `portal_check_row_hidden` drives every count. Progress is empty when a client's progress view is off. |
| A client could attach a case to an existing candidate by guessing an id. | Clients can't reuse by id. `create_case` returns only the case id and reference to them. What they typed stays in `cases.intake_candidate`. |
| A client request could silently match someone with the same NIC and another name. | The case opens with `candidate_match_open`. Staff decide with `resolve_candidate_match`, and Pre-QC waits for that. |
| Notification emails to portal users carried case details. | Emails for portal users say what happened and link to the portal. |
| Sensitive evidence could go out inside the report with no decision. | The approver must tick that it can go. `report_download` keeps the rule, and `sensitive_open_to_caller` lets the case owner open their own evidence. |
| Some helpers could be run by anyone. | Execute revoked from `public` and `anon`. |

## Workflow (spec 2, 3, 5, 10)

| Finding | Fix |
|---|---|
| A held case could still be changed. | `require_case_open` guards staff work on checks, documents, requests, links and messages. |
| Evidence could change after QC without anyone seeing. | `require_evidence_unlocked` guards uploads, moves, visibility and row links. |
| Type 2 could pass the contact step with neither a call nor a formal request. | `candidate_contact_gap`: Pre-QC needs a sent page or formal email, and a logged call. |
| A status name could differ between staff and client, or be missing for the client. | New statuses need client wording. `Returned to Data Entry` and `Returned to Verification` show the client "Data Entry in Progress" and "Verification in Progress". |
| QC could save an empty or wrong checklist. | `record_qc_review` checks it against Settings. A category with `needs_original` needs an original or certified copy. Post-QC re-checks evidence per record. |
| A returned check gave its owner no signal. | Each check sent back writes its own event and notifies its officer. |
| Clients got two notifications for one stage move. | `move_case` marks the transaction, and `cases_status_notify` stays quiet for it. |
| A check could be saved during Data Entry by anyone, but ownership was never enforced in verification. | `save_check_values` checks ownership during verification, and format at every stage. |
| Unable to Verify needed every detail filled in. | It needs the entry fields only, because the source never answered. |
| A check's tone could disagree with its state. | `set_check_state` refuses it and falls back to safe labels. |
| Stopping a revised report cancelled the case. | It returns to Released, and the client keeps the released report. |
| The check-order setting used a list copied in two places. | `flowchart_check_order()` holds it. Off by default. |

## Documents (spec 7)

| Finding | Fix |
|---|---|
| A file in the wrong check stayed there. | `refile_document` moves it, with a Move dialog on the panel. |
| Withholding a file gave no reason. | `set_document_visibility` takes one and the report notes that a file was withheld. |
| The CV and the signed form weren't owed by every case. | `cases_consent_slot` adds a required CV slot. Online consent fills the consent slot. A drawn signature doesn't count as a document. |
| A case-level file could fill slots for several checks by accident. | It fills a slot only when one slot of that category exists. |
| A combined file couldn't say which records it covered. | `requirement_files.record_keys`, chosen in the link dialog. |
| A candidate report holds the candidate's files, and could outgrow a bucket sized for quotations. | The `documents` bucket takes 50 MiB. Uploads stay at 25 MB a file. |

## Candidates (spec 2.2)

| Finding | Fix |
|---|---|
| A form could be answered after it was closed, or carry made-up columns. | `candidate_answer_request` refuses closed requests and strips keys the form doesn't have. |
| Using an answer overwrote what staff had entered. | `applyAnswer` reports clashes, and staff choose in a dialog before `accept_candidate_answer` saves. |
| The candidate page showed English field names. | Field and option labels are translated into Sinhala and Tamil, with a shared answer control. |
| Sending the BGV form left the case's status out of date. | `issue_bgv_form` recomputes it. |

## The report (spec 4.7, 7, 8, 9)

| Finding | Fix |
|---|---|
| The report said files were attached before anyone knew they would be. | `planAnnexures` reads each file first, so the report states what it really holds: embedded, attached, unreadable, damaged, unsupported or left out. |
| A PDF with no pages counted as evidence. | It's damaged, and Send for approval stops until it is replaced or a manager says why it can go. |
| Sinhala and Tamil text printed as boxes. | Report fonts fall back per character across Latin, Sinhala and Tamil. |
| Phone photos printed sideways. | JPEG orientation is read and applied. |
| Approval compared a hash the browser sent. | `case_report_stamp` is read in the database at approval and again at release. |
| The approver could change the result with no reason. | A result different from the proposal needs one, kept with the report. |
| A release could go to people who can't read cases. | Recipients need `portal.cases.read`. Release defaults to everyone at the client, and `add_report_recipients` adds people later. |
| Lost evidence could still be released. | `release_report` refuses and asks for a new draft. |
| An erased case could be revised. | `revise_report` refuses. |
| The public page covered only the first file of a split report. | `verify_report` lists every part, and each part's fingerprint can be checked. |

## Erasure

| Finding | Fix |
|---|---|
| Erasing a case left personal data in notifications, assistant threads and audit details. | `erase_case` scrubs them. Audit entries keep the case id so the record of erasure stands. |
| Erasing a case also erased a candidate another live case needed. | The erased case moves to an anonymous candidate record. |
| A file that failed to delete was forgotten. | `storage_deletions` holds it, and the worker retries through `drainStorageDeletions`. |

## Second pass: the independent audits

Four more readers then went through the finished build: two against the client's documents line by line, one trying to break it, and one checking that the screens still match the rules. None found a requirement missing. What they did find:

### Access and data

| Finding | Fix |
|---|---|
| An upload begun while allowed could be finalized after Post-QC, so a file joined the evidence after sign-off. | Finalizing checks the same gates as beginning, for clients, candidates and staff. |
| A note written to the candidate appeared in the client's portal. | A note is shown only to whoever it was written to. |
| A recorded discrepancy or sanctions hit could be waived into a clean report. | Refused. A finding is corrected by reopening the check, in the open. |
| Rejected consent didn't stop a case. | Pre-QC approval and Start verification both refuse it (`case_consent_missing`). |
| Officers could read the contact log of cases they can't open. | `communications_select` follows `case_visible`. |
| Any `settings.manage` holder could switch off staff two-step sign-in. | `orgs_guard` keeps it to the Super Admin. |
| A Viewer could read the AI's summary of a candidate's files. | The table policy applies `can_read_candidate_report`. |
| Three helper functions answered any signed-in user. | `candidate_contact_gap` and the evidence gap helpers are internal. `report_sensitive_files` answers staff only. |
| A client could change an approved package, or set its currency and turnaround. | Those columns are Ontriq's, and changing its checks sends it back for approval (`package_items_client_review`). |
| A Client Viewer could read quotations through the API. | The functions need `portal.quotes.accept`, like their pages. |
| A confirmed invoice's issue date could be edited. | It freezes on confirmation. |
| Unreviewed consent could be overwritten after release. | Signing closes with verification. |
| Packages offered to selected clients never reached them. | `packages_select` reads the offer through `package_offered_to_me`. `portal_price_list` and the price guard read list prices as definers. |

### Money

| Finding | Fix |
|---|---|
| A quoted price for a sum-priced package was never billed. | An agreed package price is the package's price however it is built up, and a kind of check added later bills on top. |
| Voiding an invoice left its credit note live. | An invoice with a credit note can't be voided. |
| Clients saw invoices nobody sent them. | A client's statement leaves out confirmed invoices. |
| A case under revision missed monthly billing, and the invoice job could die. | Released once is billable. The scheduler tries for the first seven days of the month. |
| Custom-selection cases priced checks at 0. | They take the list price, as `add_case_check` does. |

### Reports

| Finding | Fix |
|---|---|
| Stopping a revision could leave unapproved results on the client's screen. | A revision stops only at the report stages and only if the case still matches the released report. Otherwise it finishes with a new version. |
| Stopping a revision said a report was available. | It says the revision stopped and the released report stands. |
| An old finding could print beside Clear. | The outcome form shows the existing note, an empty note clears it, and open checks print no remarks. Staff can reword remarks at verification, Post-QC and report without the AI. |
| A revision's release defaulted to everyone. | It starts from the last version's named people. |
| The portal said "Not ready yet" above a working download during a revision. | It says the report is being revised, keeps the download, and shows no deadline. |
| The public page disagreed with the PDF on the version, and a final nobody released read as issued. | `verify_report` counts issues as the PDF does, and an unreleased final reads as not issued. |
| Two runs of a render could overwrite each other. | Each run writes its own file, and the first to finish stands. |
| The portal showed more than the PDF for unfinished checks. | Notes and fields show for finished checks only. |
| A stale draft could reach the approver, and the approver's copy could change. | `submit_report` checks the stamp, and details the report prints lock at approval. |
| PDF page numbers ignored the annexures. | The footer reads "Report page". |
| A whole-case file was missing from its check's Evidence line. | The report names it under the check that was waiting for it. |

### Workflow

| Finding | Fix |
|---|---|
| A client could be asked for a document they couldn't send. | Requests, and rejecting an outside file, stop when uploads close, and say to send the case back first (`require_uploads_open`). |
| "Needs info" didn't say what was needed. | It sends a real question to the client or candidate, then the check waits. |
| Clients weren't told when documents were first needed. | They hear when a case opens and when a request is accepted. An import tells them once. |
| "Back to documents" didn't say what was needed. | What staff write reaches whoever provides the documents. |
| A request to a client with no portal users went nowhere. | Staff are warned to contact them directly (`case_portal_readers`). |
| A corrected candidate email was ignored, and reminders used a different address. | A correction replaces what the client typed, and links and reminders use one address. |
| A link could go out while a NIC match was open. | Refused until a person decides. |
| A Type 2 case reached Pre-QC with its BGV form unanswered, and an SMS passed as the formal request. | Pre-QC waits for the form, or for a manager to withdraw it. The page by email, or a logged email or letter, is the formal request. |
| The police report wasn't collected before Pre-QC. | It is, as both flowcharts draw it. A manager or QC can waive it with a reason when it comes later. Cases keep the version they started on. |
| Two employers and one file gave an error with no fix on screen. | A received slot on a multi-row check offers "In a file already here" and Waive. |
| Evidence could drop out of the report silently. | A file moved into a report-bound type goes in the report, and a new version keeps its place. |
| Waiving a check left its documents asked for. | Its open slots are waived with it, and reopening asks again. |
| Only the case owner could send a case back to documents. | Whoever finds the gap can: data entry at that stage, and an officer on one of the checks. |
| Resuming a case sent two notices, and more of the hold's edges were open. | One notice. Messages, link resends and reviews respect the hold. |
| A closed case kept asking. | Open questions close with the case. |
| AI remarks landed on the wrong check when a case had two of one type. | Each check gets its own key. |
| `/api/health` and `/setup` showed integration status to anyone. | Health gives detail only with the secret, and setup redirects once the database is connected. |

### Screens

| Finding | Fix |
|---|---|
| Phone numbers the form accepts were quietly refused. | The database stops only what isn't a number, and the screen reads the saved result. |
| Post-QC sign-off was refused with a bare check name. | It says what is wrong, warns at Post-QC, and QC can put a file in the report. |
| Start verification sent a Data Entry Officer to "We couldn't find that". | They land on My work. |
| Controls that could only fail stayed on screen. | On hold, after uploads close, and for roles the rules refuse, they're hidden: requests, Use answer, Reject, Record, Original, Send for approval, Send anyway, Cancel on a reworked revision, Revise on an erased case. |
| The evidence lock wasn't shown at Post-QC and Report. | The panel says who can change evidence. |
| The portal and candidate page said false things on closed cases. | They say uploads have closed, count nothing as owed, and the consent card closes too. Refusals reach candidates in their language. |
| Officers saw a blank client name, and QC's client link bounced. | `case_client_name` gives the name, and the link shows only to those who can follow it. |
| QC Officers never saw Waive, and other officers' forms looked editable. | Waive shows, and a form that can't be saved says whose it is. |
| Report files removed by retention gave raw JSON. | The version says the file was removed, and the archive says when a role can't open one (`reports_closed_to_caller`). |
| Staff wording reached clients. | A paused client reads "new requests are paused". |
| Stale wording. | Reject, request and package text now say what happens. Late slots read "Needed before Post-QC". |

## The last read

A final reader checked from the code that every problem above was closed. Of 76, it confirmed 53, found 23 only partly closed and none still open in full, and it found 13 new ones. A last reader then went through those fixes and found none of high severity, 4 of medium and 7 of low. `0049_last_read.test.sql` replays them, running the paths a compile can't check, and the walkthrough drives the ones a person would see. One needed no change: a payment on an unsent invoice moves the invoice on, so a client's statement shows both, and a test holds that.

| Finding | Fix |
|---|---|
| "Record a paper form" always failed. A variable in `review_consent` had the same name as a table alias, which shows only when the statement runs. | Renamed, with a test that runs that path. A scan of every function found no other clash. |
| A Data Entry officer's "Back to documents" lost the message and landed on a missing page, because they can't open the case once it goes back. | The message goes with the move, inside `case_transition`, and they land on My work. |
| A link nobody used stopped a client-supplied case at Start verification, saying consent was rejected. | `case_consent_missing` stops a client-supplied case only on a rejected form. Type 2 always needs consent. |
| Consent rejected during verification stopped nothing after that. | Send to Post-QC and Post-QC approval test it. |
| A candidate's consent file could be rejected from the file list, leaving the consent standing and the candidate with no slot to replace it. | Refused there. The row points to the Candidate section, where sending it back tells the candidate. |
| A discrepancy could be waived once the check was reopened or came back from Post-QC. | `case_checks.discrepancy_at` stays until a new outcome is recorded. |
| An old finding was filled in under a Verified outcome, and printed beside a clear result. | The box starts empty and offers the old note. Discrepancy and Unable to verify still start from it. |
| A revision of a report released before stamps existed could always be stopped, and Stop was offered where it would be refused. | The migration stamps released reports. `revision_can_stop` decides for the database and the page, and no stamp means it can't stop. |
| After uploads closed, the candidate was told to confirm and then refused, read "All received" beside files that never came, and still saw document requests. | No confirm step once uploads close, the page says they have closed, and open document requests stop showing. Two more refusals reach them in their language. |
| "Send back" and "Ask again" stayed after uploads closed. AI remarks showed on hold, at Post-QC and to officers who don't own the check. | Hidden, and `remarksLocked` says why. Asking again for a document is refused in the database too. |
| The Release button could stay dead when nobody named last time could still read cases. | The form then opens to everyone. |
| A plain whole-case file printed as "Combined file". | `for_check` counts it for its check without calling it combined. |
| On Type 2 the client read "Information needed" with nothing to answer, and got "returned for correction" with no detail. | The check reads "Waiting for the candidate", and no such notice goes out. The case status stays Pending Information, the client's own word for it. |
| Waiving a check or a slot left the candidate's request open, and it held up their confirmation and the BGV gate. | The request closes with it. Bringing the check back asks again. |
| A month drafted early left later cases unbilled. | They join the draft. Once it has gone out, they get an invoice of their own. |
| Needs info and document requests said "Sent" when nobody could read them. | Staff are warned, as they are for questions. |
| A link resend queued the message and only then met the hold. | It checks first. |
| Any staff member could read the filename of a sensitive document by id. | `report_sensitive_files` follows `case_visible`. |
| The Candidate card showed the record's contact while links used the one the client typed, and choosing the record's address changed nothing. | The card shows what the case uses. A changed contact replaces the typed one, and an unchanged one leaves the typed one and the record alone. |
| Client Relations' uploads failed on "Belongs to", and left a row behind. | The choice shows only to those who may make it, and a new version keeps its row by itself. |
| Officers saw blank client names in lists. QC was offered client pages it can't open. | `case_client_names` fills the lists, and search leaves those hits out. |
| Erased cases offered links to files that are gone. | Staff read "File erased", the candidate report and signed-form links go, and the portal lists no files. |
| A slot asked for again during the work said "Needed before Pre-QC", as did optional ones. | It moves to the verification stage. Optional slots say so. |
| The report section said "Released to" for a case hidden from the client. | It says the case is hidden, and who can't see it. |
| Sending consent back changed the candidate's page and told nobody. | They're emailed, and staff are warned if they have no working link. A waived check that comes back tells them too. |
| Waiving a check left the client's question on it open, so the case kept reading as waiting for them. | The question closes with the check. Whoever brings the check back asks again if they still need the answer. |
| A waived check returned by Post-QC or from the report kept its slots waived, so it could be finished with no evidence. | `restore_waived_check` runs on every road back. |
| Two runs for one month could bill a case twice, a run during confirmation could add lines at nothing, and saving an open draft removed lines added meanwhile. | Runs for one client's month take turns, the draft is locked while lines join it, and saving removes only lines the form opened with. |
| The candidate was emailed about requests made of the client. | On a client-supplied case they aren't. Their timeline no longer shows a return that isn't theirs either. |
| Accepted consent couldn't be sent back on screen, though the rules allow it. | Send back shows until uploads close. |
| Cancelling a held case sent a stray status notice first. | Lifting the hold stays quiet, as it does for a stage move. |
| "Add people" stayed on a report whose file was gone. | It's hidden, as Revise is. |
| A revision whose named readers had all left opened to everyone without asking. | The person releasing chooses, and the dialog says why. |

## Left as they are

| Item | Why |
|---|---|
| Annexure pages carry no page number | They are the originals, unaltered. The footer reads "Report page", and the page count on the verify page includes them. |
| A case can be hidden from the client while on hold | It sends nothing, so the hold has nothing to stop. |
| A revision already running when 0049 is applied can't be stopped | Its report has no stamp, so nothing shows the case still matches. Finishing the revision works as usual. The backfill covers released cases only. |
| Invoices keep the candidate's name after erasure | They are financial records. |
| The nine stages are fixed | Statuses are configurable. Stages drive the rules. |
| Check order is off by default | The flowcharts show an order, and the client hasn't said it must be enforced. It's one switch in Settings. |
| Built-in statuses can't be switched off | Their wording can change, and Ontriq can add its own. When one applies follows from the stage. |
| Consent slot can be waived with a reason | The waiver and reason stay in the audit log. |
| No printable BGV form | Type 2 uses the candidate's page. The client hasn't said a paper form is needed. |
| Hidden checks still print in the final report | Hiding controls the portal. Settings says so. |
| NIC prints on the report cover | The spec lists "Candidate Name or another approved candidate identifier" as options. |
| Own statuses clear when a case changes stage | They describe work inside one stage. |
| Candidate status wording shows in English | Client wording is typed by Ontriq in one language. |
| A Post-QC return shows the client fewer completed checks | That is accurate progress. |
| The service role is unrestricted | It runs only on the server and in the worker. |

## The check before the first demo

A last pass on 1 November read the client's documents again and attacked the access rules with scripts.

| What changed | Why |
|---|---|
| A client's answer moves its check back to in progress | The case kept reading Pending Information with nothing left for the client to do |
| Before release, a finished check shows a plain tick | A green tick on a check that could not be verified read as a pass |
| A held case shows Paused in the portal | Its clock is stopped, so it can't be overdue |
| The portal shows one employer per line | A multi-employer history ran together as one line |
| A released case tells a person who isn't on the report where the results went | It said results would appear after release |
| The candidate's page keeps a second record's own name | Two education records both read Education |
| Staff check forms start with the candidate's name filled in | Every check asked for it again |
| A date outside 1900 to 2100 is refused | A mistyped year printed as a believable two-digit date |
| A long employer row in the report wraps across pages | A row kept whole ran off the page and lost its end |
| A final report is dated by its approval | Drawing it again gives the same report |
| A check type in a package can't be archived | Cases on that package then failed with a misleading message |

The demo data now builds through the same rules: a case at every status for the client signed in, findings on the check they belong to, a letter tied to each employer, and report dates that match the case. Names of checks and police fields use the client's own words in the demo data, set the way Ontriq would in Settings. The built-in names stay as they are until Ontriq confirms them.
