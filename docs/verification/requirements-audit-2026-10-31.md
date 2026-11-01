# Requirements audit

Date: 31 October to 1 November 2026. This compares the finished build in `Documents/ontiq-new` with the client's two documents, `Ontriq CRM Requirements.pdf` (11 pages) and `BGV -Outflow.pdf` (two flowcharts), line by line.

## Verdict

Every requirement in the two documents is built. 189 of the 204 rows are done and verified. 8 are built but need the live deployment to prove them, and 7 are built on a reading Ontriq should confirm. No row is partial or missing.

| Result | Count |
|---|---|
| Yes: built and verified | 189 |
| Yes, but only a deployment can prove it | 8 |
| Yes, and Ontriq should confirm the reading | 7 |
| Partial | 0 |
| No | 0 |
| **Total** | **204** |

The fixed-template annexure and email delivery are the rows that need deployment. Everything else ran on the local stack.

## How this was checked

| Check | Result |
|---|---|
| Unit tests | 301 of 301 |
| Database suites on a clean Postgres, every migration applied | All passed, including a suite that replays each audit finding |
| Type check, lint, production build | Clean |
| Full simulation against the production build, every role, on the local stack | 153 of 155. The other two need hosted: live updates and the password rule |
| Browser smoke test, 11 roles, desktop, phone and dark mode | 139 of 139 page views clean, 6 of 6 interactions passed |
| Walkthrough of the real screens, each step signed in as the right role | 47 of 47 steps, screenshots reviewed |
| Demo data seeded through the app's own functions on the final rules | 65 cases at every stage, 21 released |
| A released report read page by page | Sinhala and Tamil print correctly |
| AI evaluation on invented documents | 2,158 of 2,166, before this work. See `ai-evaluation-2026-10-31.md` |

"Verified" in the tables below uses these letters: T is an automated test, S is the end-to-end simulation, W is a person's path driven through the real screens, and C is a read of the code.

Independent readers audited the finished build, working from the client's documents and the code and not from this project's notes:

| Reader | What they found |
|---|---|
| Sections 1 to 5, 7 and both flowcharts, line by line | 127 items: 117 met, 10 partly met, none missing. 12 defects. |
| Sections 6, 8 to 11, line by line, with real report renders | No line missing, 8 partly met. 14 defects, 1 of them high. |
| Trying to break it | 29 problems, 3 of them high. |
| Screens against the final rules | 30 problems, 3 of them high. 513 database calls all matched their functions. |
| A reader who checked that every reported problem is closed | Of 76: 53 closed, 23 partly closed, none still open in full, and 13 new. |
| A last reader of those fixes, given only the code | No high-severity problems. 4 medium and 7 low, all fixed. |

Each finding was confirmed in the code first. All of them were fixed, or recorded below as a decision. The fixes are listed in [Final audit fixes](../features/0049-final-audit-fixes.md), and `supabase/tests/0049_independent_audit.test.sql` and `0049_last_read.test.sql` replay them.

## Questions for Ontriq

The build covers each of these. Ontriq should say whether the reading is right.

| Question | What the build does today |
|---|---|
| "BGV form": is it the consent form, or a separate application form? | Type 1 has a form slot. Type 2 has a form on the candidate's page plus consent. There is no printable form. |
| "Reference form": a document, or the record of the call? | Each referee has "Details confirmed" and "Spoken to on", and a reference form slot takes a file. |
| "Global sanctions screening details": which details? | Name, date of birth, NIC or passport, and nationality. |
| Must steps 2 to 8 run in order? | Any order by default, with a switch in Settings, Workflow. |
| Should referee contact details print in the report? | They print. Staff-only HR contacts don't. |
| Should clients see "Returned for Correction" for a Post-QC return? | They see normal progress, because these returns are Ontriq's own. |
| Is the second-person release rule wanted? | Whoever approves can't release, unless they're the Super Admin. |
| Is 24 months right before released PDFs are erased? | That is the default, and it's set per client. |
| Should the police report really hold up Pre-QC? | Both flowcharts collect it first, so it does. A manager or QC can waive it with a reason when it comes later. |
| Is it enough that statuses can be renamed and added? | Built-in statuses can't be switched off. A new stage needs a developer. |

## Before this reaches the client

| Item | Why |
|---|---|
| Push migrations 0044 to 0049 to the hosted database | The hosted project stops at 0043, so none of this work is live there yet. |
| Run the simulation on hosted | Two checks can only pass there: live updates, and the 10-character password rule. |
| Verify the sending domain and set up Notify.lk | Email and SMS are queued but not sent until then. |
| Try a real Cfirst report | The fixed annexure was tested on sample PDFs. |
| Have Sinhala and Tamil read by a native speaker | The wording on the candidate's page was checked for rendering, not language. |

The full list is in [Production readiness](../production-readiness.md).

## Every requirement

### 1. Introduction

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 1.1 | Manage the whole process, from case initiation and document collection to verification, QC and the Final Report | Yes | `0006`, `0011`, `0012`, `0048` | T S W | Cases |
| 1.2 | All verification checks under one candidate case | Yes | `case_checks`, `create_case` | T S W | Case page |
| 1.3 | Record the required information | Yes | `builtin.ts`, `validate.ts` | T S | Check page |
| 1.4 | Upload supporting evidence | Yes | `0007_documents.sql`, `uploader.tsx` | T S | Case page, Documents |
| 1.5 | Monitor case progress | Yes | `cases-table.tsx`, `board.tsx`, `stage-rail.tsx` | T W | Cases, My work |
| 1.6 | Generate a consolidated Final Background Verification Report | Yes | `report-render.ts`, `assemble.ts` | T S | Case page, Report |
| 1.7 | Clients view the progress of their cases | Yes | `portal_case_detail` | T S W | Portal case page |
| 1.8 | Clients check the current status of each verification | Yes | `portal_case_detail` checks list | T S W | Portal case page, Checks |
| 1.9 | Clients access finalized reports where authorized | Yes | `report_download`, `report_open_to_caller` | T S | Portal Reports |

### 2.1 Process Type 1: client-initiated

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 2.1.0 | Client provides the CV or resume, available documents and other information | Yes | `request-form.tsx`, portal CV upload | T S | Portal New request |
| 2.1.1 | Client Initiation: receive the request and create the case | Yes | `create_case` for staff and portal | T S W | New case, Portal New request |
| 2.1.2 | Document Collection from the client or case records | Yes | `portal_begin_upload`, staff upload | T S | Portal case page |
| 2.1.3 | Pre-QC / Document Review: completeness, readability, consistency | Yes | `record_qc_review`, Pre-QC checklist | T S W | Case page, Record Pre-QC decision |
| 2.1.4 | Document Correction: request missing or corrected documents, review once received | Yes | `sendAmendmentRequest`, `case_transition`, `request_case_document`. Staff are warned if nobody can read it | T S | Pre-QC return, Questions for the client |
| 2.1.5 | Data Entry | Yes | Stage `data_entry`, `check-form.tsx` | T S | Check page |
| 2.1.6 | Verification: conduct the checks and record findings | Yes | `set_check_state` | T S | Check page |
| 2.1.7 | Post-QC / Final QC | Yes | `record_qc_review` | T S W | Case page, Record Post-QC decision |
| 2.1.8 | Final Report Generation after quality approval | Yes | `request_report_draft`, `approve_report` | T S | Case page, Report |
| 2.1.9 | Report Release to authorized recipients | Yes | `release_report`, `report_recipients` | T S | Case page, Report |

### 2.2 Process Type 2: candidate contact

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 2.2.1 | Client Initiation | Yes | `create_case`, process type stored per case | T S W | New case |
| 2.2.2 | Candidate Contact: contact, explain, request documents through formal communication | Yes | Email lists the documents. Pre-QC needs the page by email or a logged email or letter, and a logged call. A corrected address replaces what the client typed | T W | Candidate and Contacts sections |
| 2.2.3 | Document Collection: receive and upload the candidate's documents | Yes | `candidate_begin_upload`, `document-slot.tsx` | T S | Candidate page |
| 2.2.4 | Pre-QC / Document Review | Yes | As 2.1.3, consent needed first | T S | Case page |
| 2.2.5 | Document Follow-up: request missing or corrected documents | Yes | `create_candidate_request`, reminders, messages | T S W | Candidate section |
| 2.2.6 | Data Entry | Yes | As 2.1.5, plus the BGV form's answers | T W | Check page |
| 2.2.7 | Verification | Yes | As 2.1.6 | T S | Check page |
| 2.2.8 | Post-QC / Final QC | Yes | As 2.1.7 | T S | Case page |
| 2.2.9 | Final Report Generation | Yes | As 2.1.8 | T S | Case page |
| 2.2.10 | Report Release | Yes | As 2.1.9 | T S | Case page |
| 2.2.11 | Verification, evidence, QC and reporting rules apply to both methods | Yes | One workflow, `process_type` only changes document collection | T C | Both |

### 3. Overall workflow

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 3.1 | Case Creation → Document Collection → Pre-QC → Data Entry → Verification → Post-QC → Final Report → Final Approval → Report Release | Yes | `stages.ts`, `case_transition` | T S | Stage rail |
| 3.2 | Incomplete documents or information are returned for correction or follow-up at the relevant stage | Yes | Pre-QC to documents, Post-QC to verification or data entry, data entry or verification to documents by whoever finds the gap, approver to report, report to verification | T W | Case actions |
| 3.3 | Each check tracked individually, with an overall case status | Yes | `case_checks.state`, `recompute_case` | T S | Cases, Case page |

### 4.1 Education Verification, Primary / Secondary

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.1.1 | Candidate Name | Yes | `candidate_name` | T | Check page |
| 4.1.2 | Student ID / Roll Number / Index Number | Yes | `student_number` | T | Check page |
| 4.1.3 | College / Institution | Yes | `institution` | T | Check page |
| 4.1.4 | Year of Completion | Yes | `year_of_completion`, prints as 2015 | T | Check page |
| 4.1.5 | Degree or Qualification | Yes | `qualification`, `qualification_level` | T | Check page |
| 4.1.6 | Primary / Secondary | Yes, confirm with Ontriq | Primary and Secondary levels, and a second record at case creation | T W | New case, Add a record |
| 4.1.7 | Educational documents and verification evidence uploaded and attached to the Final Report | Yes | Certificates, transcript, Reply from the institution, in the report by default | T | Check page, Documents |

### 4.2 Employment Verification

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.2.1 | Candidate Name | Yes | `candidate_name` | T | Check page |
| 4.2.2 | Company Name | Yes | `employers.company` | T | Check page |
| 4.2.3 | Designation | Yes | `employers.designation` | T | Check page |
| 4.2.4 | Employment Period, From to To (DD/MM/YY) | Yes | `employers.period`, `fieldDate`, Still here | T | Check page |
| 4.2.5 | Employee Code / NIC | Yes | `employers.employee_code` | T | Check page |
| 4.2.6 | Employment Type: Permanent / Temporary / Internship / Contract | Yes | `employers.employment_type` | T | Check page |
| 4.2.7 | Multiple employment records | Yes | Repeating group, 1 to 10 | T | Check page |
| 4.2.8 | Documents and evidence attached to each record | Yes | `record_key`, `per_record`, a file per employer before Verified, one file can cover named rows | T W | Check page, Documents |

### 4.3 Address Check

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.3.1 | Address | Yes | `address` | T | Check page |
| 4.3.2 | Period of Residency | Yes | `residence_period` | T W | Check page |
| 4.3.3 | Verified By | Yes | `verified_by` | T | Check page |
| 4.3.4 | Grama Niladhari details, where applicable | Yes | `gn_name`, `gn_division`, `gn_contact` | T | Check page |
| 4.3.5 | Address documents, field verification records and other evidence | Yes | GN certificate, field verification, confirmation slot | T | Check page, Documents |

### 4.4 Criminal Check

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.4.1 | Candidate NIC Number | Yes | `nic` | T | Check page |
| 4.4.2 | Permanent Address | Yes | `permanent_address` | T | Check page |
| 4.4.3 | Period of Residency | Yes | `residence_period` | T | Check page |
| 4.4.4 | Area of Police Station | Yes | `police_station_area` | T | Check page |
| 4.4.5 | Verified By | Yes | `verified_by` | T | Check page |
| 4.4.6 | Officer in Charge and station contact number, where applicable | Yes | `oic_name`, `station_contact` | T | Check page |
| 4.4.7 | Evidence uploaded and linked to the check | Yes | `police_report` slot, confirmation slot | T | Check page, Documents |

### 4.5 NIC Verification

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.5.1 | Candidate NIC Number | Yes | `nic_number`, `parseNic`, mismatch warning | T | Check page |
| 4.5.2 | Identification document and verification evidence uploaded | Yes | NIC copy, Official validation result | T W | Check page, Documents |

### 4.6 Reference Verification, two referees

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.6.1 | Separate records for two referees | Yes | `referees`, exactly 2 | T | Check page |
| 4.6.2 | Full Name | Yes | `full_name` | T | Check page |
| 4.6.3 | Current Employer | Yes | `current_employer` | T | Check page |
| 4.6.4 | Current Job Title | Yes | `current_job_title` | T | Check page |
| 4.6.5 | Company where the referee worked with the candidate | Yes | `worked_together_at` | T | Check page |
| 4.6.6 | Relationship to the Candidate | Yes | `relationship` | T | Check page |
| 4.6.7 | Duration of Acquaintance | Yes | `acquaintance_duration` | T | Check page |
| 4.6.8 | Contact Number | Yes | `contact_number` | T | Check page |
| 4.6.9 | Email Address | Yes | `email` | T | Check page |
| 4.6.10 | Contact records, feedback, correspondence and evidence recorded and attached | Yes | Contact log per referee, feedback, details confirmed, reference form slot | T | Check page |

### 4.7 Global Sanction Screening

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.7.1 | Sanctions Found Against the Candidate's Name | Yes | `sanctions_found`, a hit can't be clear | T | Check page |
| 4.7.2 | Screening result and supporting report uploaded | Yes | `sanction_report` slot | T S | Check page, Documents |
| 4.7.3 | Attached as a separate annexure | Yes | `fixed_annexure`, own cover, always in the report | T S | Report PDF |
| 4.7.4 | Original approved format preserved | Yes, needs deployment | Pages copied unchanged and the original file attached inside the PDF. Not yet tried on a real Cfirst report | T W | Report PDF |

### 4.8 Additional checks

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 4.8.1 | New verification types without restriction | Yes | `save_check_type_draft`, `publish_check_type` | T | Settings, Check types |
| 4.8.2 | Added when required by a client or by operations | Yes | `client_check_type_access`, Add a check | T | Client page, Case page |

### 5.1 Pre-QC

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 5.1.1 | Review candidate details and submitted documents | Yes | Case page, AI Pre-QC review | T W | Case page |
| 5.1.2 | Check whether required documents are available | Yes | `case_outstanding_requirements`, re-checked at approval | T W | Case page, Documents |
| 5.1.3 | Identify missing information or document discrepancies | Yes | Checklist, consistency check, NIC mismatch warning | T W | Case page |
| 5.1.4 | Record remarks and request corrections | Yes | `qc_reviews.remarks`, amendment message | T W | Pre-QC dialog |
| 5.1.5 | Approve to proceed or return for amendments | Yes | `record_qc_review` | T W | Pre-QC dialog |

### 5.2 Post-QC

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 5.2.1 | Check the completed verification information | Yes | Check details and findings on the case page | T W | Case page |
| 5.2.2 | Review findings, discrepancies and remarks | Yes | Findings required, Post-QC cross-check, remarks can be reworded | T W | Check page |
| 5.2.3 | Confirm supporting evidence has been uploaded | Yes | `submit_post_qc` gates, checklist item | T W | Post-QC dialog |
| 5.2.4 | Identify incomplete or pending checks | Yes | Check states listed in the dialog | T W | Post-QC dialog |
| 5.2.5 | Approve for the report or return for correction | Yes | `record_qc_review`, return to verification or data entry | T W | Post-QC dialog |
| 5.2.6 | Both stages recorded with status, reviewer and remarks | Yes | `qc_reviews`, audit log, Quality reviews panel | T | Case page |

### 6. Client progress tracking

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 6.0 | Authorized clients log in and see their organisation's cases | Yes | `portal_cases`, `portal_client` | T S W | Portal Cases |
| 6.1.1 | Case Reference Number | Yes | `portal_case_row` | T S W | Portal case page |
| 6.1.2 | Candidate Name or approved identifier | Yes | `portal_case_row` | T W | Portal case page |
| 6.1.3 | Verification package or checks requested | Yes | `portal_case_detail` | T W | Portal case page |
| 6.1.4 | Current overall case status | Yes | `PortalStatusChip`, beside Action needed | T W | Portal case page |
| 6.1.5 | Current processing stage | Yes | `PortalProgressRail` | T W | Portal case page |
| 6.1.6 | Individual verification check statuses | Yes | Checks list | T W | Portal case page |
| 6.1.7 | Pending documents or information required from the client | Yes | Document slots, questions. Needs info sends a real question | T W | Portal case page |
| 6.1.8 | Cases awaiting further information or action | Yes | `portal_pending_slots`, Needs action | T W | Portal Dashboard |
| 6.1.9 | Final Report status | Yes | Report card | T W | Portal case page |
| 6.1.10 | Final Report download once approved and released | Yes | `report_download` | T S | Portal Reports |
| 6.2.1 | Status: Case Received | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.2 | Status: Documents Pending | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.3 | Status: Document Review in Progress | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.4 | Status: Pre-QC in Progress | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.5 | Status: Data Entry in Progress | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.6 | Status: Verification in Progress | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.7 | Status: Partially Completed | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.8 | Status: Pending Information | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.9 | Status: Pending Post-QC | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.10 | Status: Returned for Correction | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.11 | Status: Final Report in Progress | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.12 | Status: Pending Final Approval | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.13 | Status: Report Completed | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.14 | Status: Report Released | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.15 | Status: On Hold | Yes | `recompute_case`, `client_status_catalog` | T | Portal, Cases |
| 6.2.16 | Exact statuses may be configured | Yes, confirm with Ontriq | Wording for staff, clients and candidates, and Ontriq's own statuses. Built-in statuses can't be switched off, and when one applies follows from the stage | T W | Settings, Workflow |
| 6.2.17 | Each check's status visible separately | Yes | Checks list | T W | Portal case page |
| 6.3.1 | Status changes reflect automatically | Yes | `recompute_case`, read fresh on each load | T S | Portal case page |
| 6.3.2 | Clients can identify the stage reached | Yes | Progress rail | T W | Portal case page |
| 6.3.3 | Clients can identify completed checks | Yes | Checks list | T W | Portal case page |
| 6.3.4 | Clients can identify checks in progress or pending | Yes | Checks list | T W | Portal case page |
| 6.3.5 | Clients can identify whether information or documents are required | Yes | Documents and questions cards | T W | Portal case page |
| 6.3.6 | Clients can identify whether the Final Report is ready | Yes | Report card | T W | Portal case page |
| 6.3.7 | Notification when a case status changes | Yes, needs deployment | Portal alert tested. Email needs a sending domain | T | Bell, email |
| 6.3.8 | Notification when additional documents are required | Yes, needs deployment | Portal alert when a case opens, when a request is accepted and on each request, tested. Email needs a sending domain | T | Bell, email |
| 6.3.9 | Notification when the Final Report is released | Yes, needs deployment | Portal alert tested. Email needs a sending domain | T | Bell, email |
| 6.4.1 | Clients see only their own organisation's cases and authorized information | Yes | RLS, `portal_client()` | T S | Portal |
| 6.4.2 | Internal remarks and staff-only QC notes not visible | Yes | `internal_notes` separate, `clients` staff-only, `qc_reviews` staff-only | T W | Portal |
| 6.4.3 | Sensitive evidence and restricted personal information not automatically visible | Yes | `documents_select_client`, `show_candidate_details` off by default | T | Portal |
| 6.4.4 | Ontriq controls which information, statuses, documents and reports are visible | Yes | Client portal settings, per-file visibility, per-case hide, recipients | T | Client page, Case page |

### 7. Supporting documents and evidence

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 7.1 | Multiple documents against each check | Yes | `begin_document_upload` | T S | Check page, Documents |
| 7.2 | Each document associated with the correct candidate and check | Yes | `documents.case_check_id`, `record_key` | T | Check page, Documents |
| 7.3 | View and retrieve when authorized | Yes | `api/files`, `documents_select`, `documents_select_client` | T S | Documents |
| 7.4 | Identify missing supporting documents | Yes | Slots, missing count | T W | Documents |
| 7.5 | Attach relevant documents to the Final Report | Yes | Visibility, `in_report`, moved files and new versions keep their place | T | Documents |
| 7.6 | Record of document uploads and later changes | Yes | Versions, audit log | T | Audit log |
| 7.7 | All required evidence included in the Final Report package or annexures | Yes | Further parts, `submit_report` gate, attachment for protected files | T | Report panel |
| 7.8 | Global Sanction report attached separately with its fixed template | Yes, needs deployment | As 4.7.3 and 4.7.4 | T | Report PDF |

### 8. Final Report

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 8.0 | PDF generated once checks are complete and QC passed | Yes | `request_report_draft` only at the report stage | T S | Report panel |
| 8.1 | Candidate and Case Details: name, Case ID, client details, report date | Yes | `build-body.tsx` cover | T | Report PDF |
| 8.2 | Verification Summary | Yes | `compile-core.ts` | T | Report PDF |
| 8.3 | Detailed Verification Information | Yes | `compile-core.ts` | T | Report PDF |
| 8.4 | Findings and Remarks | Yes | `client_note`, required for a discrepancy, no old finding prints beside a new outcome | T W | Report PDF |
| 8.5 | Supporting Documents and Annexures | Yes | `assemble.ts` | T | Report PDF |
| 8.6 | Global Sanction Annexure in its fixed template | Yes, needs deployment | As 4.7.4 | T | Report PDF |
| 8.7 | Report Completion Details: QC and approval | Yes | `build-body.tsx` | T | Report PDF |
| 8.8 | Clearly distinguish completed, pending and discrepancy checks | Yes | `checkStatus` | T | Report PDF |
| 8.9 | Incomplete checks not shown as verified | Yes | `compile-core.ts`, `set_check_state` | T | Report PDF |
| 8.10 | Preview | Yes | Draft with watermark | T S | Report panel |
| 8.11 | Approve | Yes | `approve_report` | T S | Report panel |
| 8.12 | Generate | Yes | `report-render.ts` | T S | Report panel |
| 8.13 | Download | Yes | `report_download` | T S | Report panel |
| 8.14 | Securely release | Yes | `release_report`, a second person | T S | Report panel |
| 8.15 | Client view shows preparing, awaiting approval or released | Yes | Status chip, report card | T W | Portal case page |
| 8.16 | Clients get the PDF only after approval and release | Yes | `report_download` | T S | Portal Reports |

### 9. Final results

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 9.1 | Green: Clear | Yes | `FINAL_RESULTS`, `approve_report` | T | Report, portal |
| 9.2 | Amber: Pending / Review | Yes | As 9.1 | T | Report, portal |
| 9.3 | Red: Discrepancy Identified | Yes | As 9.1 | T | Report, portal |
| 9.4 | Overall result reflects the findings and the review process | Yes | `recompute_case`, `approve_report` | T | Approve dialog |
| 9.5 | A potential finding isn't automatically an adverse result | Yes | Red needs a person's discrepancy. The AI only suggests | T | Check page |
| 9.6 | Progress status and final outcome kept separate | Yes | `status_key`, `final_result` | T W | Portal case page |
| 9.7 | A case can be in progress with no result, and a finished check can still need review | Yes | `final_result` set at approval only | T | Case page |

### 10. Core functionality

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| 10.1 | Case Management, unique references | Yes | `next_case_number` | T S W | Cases |
| 10.2 | Two Processing Workflows | Yes | Sections 2.1 and 2.2 | T S W | New case |
| 10.3 | Data Entry, required fields per component | Yes | Section 4 | T | Check page |
| 10.4 | Verification Management: assigned, updated, tracked separately | Yes | `assign_check`, `set_check_state` | T S | Check page |
| 10.5 | Document Management | Yes | Section 7 | T S | Documents |
| 10.6 | Pre-QC and Post-QC: stages, approvals, remarks, corrections | Yes | Section 5 | T W | QC dialogs |
| 10.7 | Internal Progress Tracking | Yes | Full status beside the stage on every list | T W | Cases, My work |
| 10.8 | Client Progress Tracking | Yes | Section 6 | T S W | Portal |
| 10.9 | Client Notifications | Yes, needs deployment | As 6.3.7 to 6.3.9 | T | Bell, email |
| 10.10 | Access Control | Yes | RLS, permissions, section 6.4 | T S | All |
| 10.11 | Final Report Generation | Yes | Section 8 | T S | Report panel |
| 10.12 | Annexure Management | Yes, needs deployment | As 4.7.4 | T | Documents, report PDF |
| 10.13 | Report Approval and Release | Yes | Section 8 | T S | Report panel, Queues |
| 10.14 | Audit Trail: status changes, document updates, QC decisions, report approvals | Yes | 45 audited tables plus `qc_reviews`, search by case | T W | Audit log |
| 10.15 | Report Retrieval | Yes | Portal Reports, staff Reports | T S | Reports |
| 10.16 | Future Expansion: check types, fields, workflow configuration | Yes, confirm with Ontriq | Builder and Settings, Workflow cover check types, fields, document types, QC lists, check order and own statuses. A new stage needs a developer | T W | Settings |

### Flowchart: documents to collect

Both flowchart pages list these. The first page reads "By form", the second "BGV form".

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| F2.1 | BGV form | Yes, confirm with Ontriq | Form slot on Type 1. On Type 2, a BGV form on the candidate's page plus consent, required before Pre-QC | T W | Portal, Candidate page |
| F2.2 | NIC / identity document | Yes | `nic_copy` | T | Documents |
| F2.3 | Education certificates (O/L, A/L, G.C.E., degree or diploma) | Yes | `education_certificate` | T | Documents |
| F2.4 | Employment documents (service letters, resignation and acceptance letters) | Yes | `service_letter`, `resignation_letter` | T | Documents |
| F2.5 | Reference details | Yes | `referees`, candidate rows form | T W | Candidate page |
| F2.6 | Global sanctions screening details | Yes, confirm with Ontriq | Name, date of birth, NIC or passport and nationality fields, from staff or the candidate | T W | Check page |
| F2.7 | Grama Niladhari certificate | Yes | `gn_certificate` | T | Documents |
| F2.8 | Police clearance report | Yes | `police_report`, collected before Pre-QC as drawn. It can be waived with a reason when it comes later | T | Documents |

### Flowchart: Pre-QC loop

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| F3.1 | Check completeness, readability, consistency and copy/original requirements | Yes | Checklist, `original_kind` per file | T W | Pre-QC dialog, Documents |
| F3.2 | Identify missing documents, mismatches or amendments | Yes | Slots, consistency check, mismatch warning | T W | Case page |
| F3.3 | Send clear requests to the candidate or client | Yes | `sendAmendmentRequest` at Pre-QC, `case_transition` from data entry or verification, reaching whoever provides the documents | T | Pre-QC dialog |
| F3.4 | Documents complete and acceptable? No: request amendments | Yes | `record_qc_review` returned | T W | Pre-QC dialog |
| F3.5 | Receive revised documents, back to Pre-QC | Yes | `case_transition` `submit_pre_qc` | T S | Case page |
| F3.6 | Yes: proceed to verification | Yes | Through Data Entry | T S | Case page |

### Flowchart: verification steps

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| F4.0 | Steps 2 to 8 in sequence | Yes, confirm with Ontriq | Any order by default, with a switch for the flowchart's order | T W | Settings, Workflow |
| F4.2 | Education: contact institutions or use official portals, record the response | Yes | Confirmation fields, reply slot, contact log | T | Check page |
| F4.3 | Employment: contact employers or HR, record responses | Yes | HR contacts, contact log per employer, reply slot | T | Check page |
| F4.4 | Online / ID: official online sources, validate NIC where available | Yes | `validation_source`, result slot | T | Check page |
| F4.5 | Global Sanctions: search the approved platform, check details, save results | Yes | `screening_platform`, `screened_on`, report slot | T | Check page |
| F4.6 | Reference: contact references, confirm the form, record feedback | Yes, confirm with Ontriq | Details confirmed, spoken to on, feedback, form slot, per referee | T | Check page |
| F4.7 | Address: contact the Grama Niladhari, confirm address and period | Yes | GN fields, visit, confirmation slot | T | Check page |
| F4.8 | Police Clearance: confirm with the station or authorized officer | Yes | OIC, station contact, confirmation slot | T | Check page |
| F4.9 | Final QC and Report: review, follow up, complete, assign the outcome | Yes | Post-QC, report stage, `approve_report` | T S W | Case page |

### Flowchart: final result

| # | Requirement | Met | Built in | Verified | Where |
|---|---|---|---|---|---|
| F5.1 | Green, Clear: completed with no significant discrepancies | Yes | As 9.1 | T | Report |
| F5.2 | Amber, Pending / Review: pending checks or more evidence or review needed | Yes | Send with pending checks, result can't be Clear | T | Report |
| F5.3 | Discrepancy: information differs, or an adverse finding needs review | Yes | As 9.3 | T | Report |

