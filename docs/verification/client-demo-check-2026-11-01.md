# Check before the first client demo

Run on 1 November 2026 on the final build, on the local stack. The client's two documents were read again from the start.

## Result

Every client requirement is built. Four are built more narrowly than the widest reading of the client's words, and one needs a real file from Ontriq to prove. Role-based access held under every attack tried. The serious problems found were in the demo data, not the product, and are fixed.

The system is not deployed. It runs only on this Mac, the hosted database stops at migration 0043, and no Netlify site exists.

## How it was checked

| Check | Result |
|---|---|
| Unit tests | 303 of 303 |
| All 49 migrations and 24 database suites on a clean database | Pass |
| Type check, lint, production build | Clean |
| Simulation of the whole system | 153 of 155. The two others need hosted services: live updates and the 10-character password rule |
| Browser page views across all 11 roles | 139 of 139 clean, 6 of 6 interactions |
| Draft to release through the real screens, each step as its role | 33 of 33 |
| Sign-in through the real form with all 12 demo accounts | 12 of 12, no errors |
| Real AI: a document read and the assistant | Both work. About two cents |

A fresh line-by-line read of the client's document finished for sections 4.1 to 4.4, 4.7, 4.8 and 6 to 6.2: 131 lines, 125 met. A usage limit stopped it for the other sections. Those rest on the runs above, on a released report read page by page, and on the earlier audits in [the requirements audit](requirements-audit-2026-10-31.md).

## Requirements

| Client section | Built | How it was shown |
|---|---|---|
| 2.1 Process Type 1 | Yes | Simulation and walkthrough |
| 2.2 Process Type 2 | Yes | Simulation, and a live run to a 37-page report |
| 3 Overall workflow and returns | Yes | Simulation, walkthrough |
| 4.1 Education | Yes, see note 1 | Fresh read, report |
| 4.2 Employment | Yes, see note 2 | Fresh read, report |
| 4.3 Address Check | Yes | Fresh read, report |
| 4.4 Criminal Check | Yes | Fresh read, report |
| 4.5 NIC Verification | Yes | Report, simulation |
| 4.6 Reference Verification | Yes | Two referees and all eight fields in the report |
| 4.7 Global Sanction Screening | Yes, see note 3 | Fresh read, annexure attached unchanged |
| 4.8 Additional checks | Yes | Fresh read |
| 5 Pre-QC and Post-QC | Yes | Simulation, reviewer and remarks recorded on all 91 reviews |
| 6.1 What clients see | Yes | Fresh read, signed in as the client |
| 6.2 Statuses | Yes, see note 4 | All 15 on one demo client |
| 6.3 Updates and notifications | Yes, see note 6 | Status, documents, information and release notices all in the data |
| 6.4 Access and confidentiality | Yes | Attacks below |
| 7 Documents and evidence | Yes | Report, simulation |
| 8 Final Report | Yes | All seven contents in a released report |
| 9 Green, Amber, Red | Yes | All three on released reports |
| 10 Core functions | Yes, see note 5 | Audit trail holds status, document, QC and report rows |

1. "Primary / Secondary" is read two ways and both exist: a Level choice with Primary school and Secondary school, and a second education record. The first record is always named Education. Ontriq should say which they mean.
2. The report prints DD/MM/YY. Entry boxes show DD/MM/YYYY and accept a two-digit year.
3. No real Cfirst report has been through the system. Sample files were used. One real file should be tried before anyone promises the template.
4. Ontriq can reword statuses and add their own. A built-in status can't be turned off, reordered or given different rules.
5. Check types, fields, document types, packages and statuses need no developer. A new stage or a third process path does.
6. Email and SMS can only be proved once a provider is connected. Locally they stop in the outbox.

## Role-based access

Each attack ran against the real app or database, as the real role.

| Attack | Result |
|---|---|
| 63 pages and APIs, for all 11 roles and a signed-out visitor | Each role reaches its own work only. A visitor reaches nothing |
| A client opening another client's case, invoice, quote, report, file or statement | 404 every time |
| A client downloading a report that isn't released | 404 on all 14 tried |
| Reading every table directly as each role | Clients get no cases, checks, QC notes or evidence. A visitor gets nothing |
| Running database functions as a signed-out visitor | None of the 281 can run |
| Every function a signed-in user can run, as a client viewer and a viewer | Nothing acted without permission |
| Internal notes, QC remarks and staff names in the client's hidden page data, on 31 cases | None. One Pre-QC return message appeared, which is meant for the client |
| An officer's export and search | Only their assigned cases |
| Staff with a password but no second step | No data |
| A suspended person with a live session | Locked out at once |
| Granting yourself a role or a blocked permission | Refused for every role tried |
| Each role's menu | No dead links |

One audit finding was wrong. It said a Data Entry Officer couldn't open the police report. Assigned to the case or to the police check, they can. Assigned to a different check, they can't, which is the rule working.

## Left as they are

- A new document type made in Settings is still asked of the candidate on Type 2 cases.
- One unanswered employer holds back the result on that check.
- A password-protected sanction PDF is attached, not shown as pages.
- Staff screens number report versions differently from the PDF: the first final can read v2 on screen and version 1 on the report.
- Two-step sign-in is off in the demo data so nobody needs an authenticator. It stays on by default everywhere else.

## Showing it

See [local development](../local-development.md#showing-the-system). The check-type names in the demo data use the client's words, set the way Ontriq would in Settings. The built-in names stay as they are until Ontriq confirms them.
