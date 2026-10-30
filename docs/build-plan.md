# Ontriq BGV CRM — Build Plan

## Context

Ontriq (Pvt) Ltd is a Sri Lankan background verification (BGV) company. They supplied two documents: an 11-page written requirements spec and a 2-page process flowchart (two variants of the same 9-step flow, one for client-supplied documents and one for candidate-collected documents). They want a CRM that runs the whole verification operation end to end: case intake, document collection, Pre-QC, data entry, per-check verification, Post-QC, a consolidated PDF report with annexures, approval and release, plus a client-facing portal so employer clients can track progress without phoning.

You want to deliver this as a high-end product: AI-automated wherever it is safe, very easy to use, with a super admin → admin → custom designations role model, a client portal with its own logins, global search, and the depth of your Arc AI CRM, without drifting outside the client's scope.

Decisions locked in this session:
- Stack: the existing Next.js 16.4.3 scaffold in this repo (Cache Components on), Supabase as the backend, Netlify hosting.
- AI: Claude via the official Anthropic SDK with budget-first routing: `claude-haiku-5-5` for light tasks, `claude-sonnet-5-5` for everyday drafting and extraction, `claude-opus-5-5` only for the few quality-critical reasoning tasks and the Super Admin command assistant.
- Tenant-ready schema (`org_id` on every business table, Ontriq is the only tenant, no tenant admin UI yet).
- Commercial flow is in scope: packages that both Ontriq and clients can build and name, quick-pick request templates, AI-drafted quotations with a live preview and three Ontriq-branded document templates, invoicing with payments, reminders and statements. (This replaces the earlier "pricing fields only" decision after your follow-up.)
- Candidates get a public, secure link generated when they are added: required-documents guide, live timeline, staff information requests, uploads, and a consent form they can download, sign, photograph and upload on the page.
- New incoming cases (what you called new leads) are auto-assigned to the freest qualified staff member, staff performance is tracked, and admins can push a nudge to anyone who is behind.
- The Super Admin gets a voice-enabled command assistant with reach across the whole system, responding as messages with confirm cards for actions.
- A client-facing Cost and Feasibility PDF is part of the deliverables, covering AI usage per task, hosting (Netlify paid plan under your maintenance plan, Supabase free then $25), and monthly totals by volume.
- Every feature gets its own migration file so features can be added or skipped independently.

---

## 1. What the client asked for (digest of both documents)

### 1.1 Checks and their fields
| Check | Required fields (spec §4) | Evidence (flowchart) |
|---|---|---|
| Education | Candidate name, student/roll/index number, institution, year of completion, degree or qualification | O/L, A/L, G.C.E., degree or diploma certificates; institution confirmation |
| Employment (multiple records) | Candidate name, company, designation, period from–to, employee code or NIC, employment type (Permanent / Temporary / Internship / Contract) | Service letters, resignation and acceptance letters; HR confirmation |
| Address | Address, period of residency, verified by, Grama Niladhari details | GN certificate, field verification record |
| Criminal / Police clearance | NIC, permanent address, period of residency, police station area, verified by, OIC name and station contact number | Police clearance report, station confirmation |
| NIC verification | NIC number | NIC copy, official source validation |
| Reference (two referees) | Per referee: full name, current employer, current job title, company where they worked with the candidate, relationship, duration of acquaintance, contact number, email | Reference form, feedback, correspondence |
| Global Sanction Screening | Sanctions found (yes or no, details) | Screening platform report (e.g. Cfirst). Fixed template, attached untouched as a separate annexure |
| Additional checks | Must be addable by Ontriq or per client without code | — |

The flowchart's "Online / ID Verification" step is NIC and qualification validation through official online sources. It is modelled as evidence sources inside the NIC and Education checks, and can become its own check type later through the builder.

### 1.2 Two process types
- Type 1, client-initiated: the client supplies the CV and documents.
- Type 2, candidate-contact: the client initiates, Ontriq contacts the candidate and collects documents directly.
Only the collection step differs. Everything from Pre-QC onward is identical.

### 1.3 Workflow
Case Creation → Document Collection → Pre-QC → Data Entry → Verification → Post-QC → Final Report Generation → Final Approval → Report Release. Any stage can return the case for correction. Each check is tracked individually while the case keeps an overall status.

### 1.4 Statuses (configurable)
Case Received, Documents Pending, Document Review in Progress, Pre-QC in Progress, Data Entry in Progress, Verification in Progress, Partially Completed, Pending Information, Pending Post-QC, Returned for Correction, Final Report in Progress, Pending Final Approval, Report Completed, Report Released, On Hold.

### 1.5 Results
Green (Clear), Amber (Pending or Review), Red (Discrepancy). Progress status and final result are separate. A potential finding is never automatically adverse. Incomplete checks must never display as verified.

### 1.6 QC stages
- Pre-QC: completeness, readability, consistency; remarks; request corrections; approve or return.
- Post-QC: review findings, discrepancies and evidence; identify pending checks; approve for report or return.
Both recorded with status, reviewer and remarks.

### 1.7 Documents, report, portal, non-functional
- Documents: multiple per check, linked to candidate and check, retrievable when authorized, missing-document detection, attach to report, full change history.
- Final report PDF: candidate and case details, verification summary, per-check details, findings and remarks, annexures, Global Sanction annexure in its fixed template, QC and approval details. Preview → approve → generate → release. Clients only after release.
- Client portal: reference number, candidate identifier, package, overall status, stage, per-check status, pending documents, cases awaiting action, report status and download, notifications. Strict confidentiality: no internal remarks, QC notes or sensitive evidence. Ontriq controls what is visible.
- Access control, audit trail of every status change, document update, QC decision and approval, report retrieval by permission, future expansion of types, fields and workflow.

---

## 2. Product vision: what takes this beyond the brief

Six pillars, each mapped to the client's own words or your follow-ups so nothing is out of scope:

1. **Ontriq Intelligence (working name): an AI layer that watches every case.** Reads every uploaded document, pre-fills data entry, flags inconsistencies, drafts every outreach, amendment request, quotation and cover email, proposes check results and the final Green/Amber/Red, writes the report narrative, routes and balances work, predicts SLA breaches, and answers questions in plain language. Humans confirm; the AI never finalizes a result, a price or an assignee on its own.
2. **A command assistant for the Super Admin.** Tap the mic, say "show me every unpaid invoice over 30 days" or "create a client called Hemas Holdings on the Comprehensive package", and get the answer as a message with tables, cards and one-tap confirmations.
3. **Three experiences, one system.** Staff workspace at `/app`, client portal at `/portal` with real logins created when a client is created, and a public candidate link at `/c/…` that turns document collection into a guided, mobile self-service flow with a live timeline, consent capture and automated reminders.
4. **Commercial flow built in.** Packages (Ontriq's and the client's own), one-click request templates, AI-drafted quotations with a live preview in three Ontriq-branded designs, acceptance in the portal, invoices per case or per month, payments with slip reading, reminders and statements.
5. **A team that runs itself.** New cases land on the freest qualified officer automatically with an explanation, managers see who is performing and who is behind, and a single Push button sends a constructive nudge.
6. **Zero friction and trust by design.** ⌘K search with actions, table and kanban views with saved filters, side panels, keyboard shortcuts, live updates, dark mode, responsive; strict row-level security, immutable audit log, per-client visibility enforced in the database, report integrity (hash + QR verification page), electronic consent, retention and erasure, MFA for staff, and a transparent cost model.

---

## 3. Users, roles and permissions

### 3.1 Populations
| Population | Auth | Scope |
|---|---|---|
| Staff | Supabase Auth, email + password, TOTP MFA enforced (the `is_staff()` SQL helper requires JWT `aal = aal2` when the org setting is on) | The whole org, limited by role permissions |
| Client users | Supabase Auth, invited with `auth.admin.inviteUserByEmail` when the client is created (or later by a client admin); password or magic link | Only their client company's cases, packages, quotes and invoices, and only client-visible data |
| Candidates | No account. Public, signed, expiring, single-case link sent by email or SMS; exchanged for a short HMAC-signed session cookie | Exactly one case: guide, timeline, requests, uploads, consent |

Authority lives in tables, not the JWT: `memberships (user_id, org_id, kind staff|client, client_id, role_id, status)` joined to `roles` and `role_permissions`. `app_metadata.kind` (set by the service role only) is used solely by the proxy to route `/app` vs `/portal` without a DB call. Revocation is immediate.

### 3.2 Staff roles (seeded, permissions editable except Super Admin)
| Role | What they do |
|---|---|
| Super Admin | Everything (permission `*`). Owns settings, roles, integrations, document templates, AI kill switches and budgets, and the voice command assistant. Cannot be deleted. |
| Admin | Manage users, roles, clients, packages, check types, templates, assignment rules. Approve and release reports. Push nudges. |
| Operations Manager | Assign and rebalance work, monitor SLAs and performance, final approval of reports, override statuses, on-hold, push nudges. |
| Verification Officer | Perform assigned checks, record findings, upload evidence, send outreach. |
| QC Officer | Pre-QC and Post-QC reviews, return for correction. |
| Data Entry Officer | Confirm AI-extracted data, complete check fields. |
| Client Relations | Onboard clients, build quotations, send invoices, record payments, manage client contacts and portal users, manage candidate links and requests. |
| Viewer | Read-only. |

Admins create custom designations: a role is a name plus permissions from a fixed catalog seeded in `permissions` and mirrored in `src/domain/permissions.ts`:
- Cases and checks: `cases.read`, `cases.read_assigned`, `cases.create`, `cases.update`, `cases.assign`, `cases.stage.change`, `cases.hold`, `cases.cancel`, `checks.verify`, `checks.data_entry`, `qc.pre`, `qc.post`, `candidates.manage`, `candidates.requests`
- Documents and reports: `documents.read`, `documents.read_sensitive`, `documents.manage_visibility`, `reports.preview`, `reports.approve`, `reports.release`
- Clients and catalog: `clients.read`, `clients.manage`, `packages.manage`, `check_types.manage`, `templates.manage`
- Commercial: `quotes.manage`, `quotes.send`, `invoices.manage`, `invoices.send`, `payments.record`, `billing.export`
- Team: `users.manage`, `roles.manage`, `assignment.configure`, `staff.performance.read`, `staff.nudge`
- Platform: `settings.manage`, `jobs.read`, `ai.assistant`, `ai.configure`, `ai.usage.read`, `audit.read`, `analytics.read`
- Super Admin only, not grantable to custom roles: `ai.super_assistant`
- Portal (client roles): `portal.cases.create`, `portal.packages.manage`, `portal.templates.manage`, `portal.quotes.accept`, `portal.invoices.view`, `portal.payments.upload`, `portal.users.manage`

### 3.3 Client roles
Client Admin (manage their users, build packages and templates, accept quotes, view and pay invoices, submit requests, download reports, set notification prefs), Client User (submit and view), Client Viewer (view only).

---

## 4. Workflow engine

### 4.1 Case stages (fixed order) and configurable statuses
Stages are the machine's states; statuses are labels Ontriq configures per stage in `client_status_catalog`, each with an internal, a client-facing and a candidate-facing label:

| Stage key | Default internal status | Default client label |
|---|---|---|
| `intake` | Case Received | Received |
| `documents` | Documents Pending / Pending Information | Documents required |
| `pre_qc` | Pre-QC in Progress / Document Review in Progress | Under review |
| `data_entry` | Data Entry in Progress | In progress |
| `verification` | Verification in Progress / Partially Completed | Verification in progress |
| `post_qc` | Pending Post-QC | Quality review |
| `report` | Final Report in Progress | Report in preparation |
| `approval` | Pending Final Approval | Awaiting approval |
| `released` | Report Released | Report available |
| `cancelled` | Cancelled | Cancelled |

`on_hold` is an overlay flag with a reason (resume returns to the previous stage). `Returned for Correction` is the status shown when a return transition fires (post_qc → verification, pre_qc → documents, approval → report).

### 4.2 Transitions
Pure function `transition(case, event, actor)` in `src/domain/workflow/transitions-core.ts` (vitest) mirrored by the `case_transition()` RPC that performs the write atomically:
- `documents → pre_qc` requires all `case_check_requirements` satisfied or explicitly waived, and consent captured when the candidate link is in use.
- `pre_qc → data_entry` requires a Pre-QC decision `approved`.
- `data_entry → verification` requires every check's values valid against its snapshot schema.
- `verification → post_qc` requires every check in a terminal state (completed, discrepancy, unable_to_verify, waived).
- `post_qc → report` requires a Post-QC decision `approved`.
- `report → approval` requires a ready draft report version.
- `approval → released` requires `reports.approve` then `reports.release` (two different users unless Super Admin). Release also triggers invoicing when the client's billing policy is per case.
Every transition writes `stage_history` and `case_events`, then notifications, including the candidate's timeline.

### 4.3 Check-level states
`not_started → in_progress → awaiting_response → completed | discrepancy | unable_to_verify | waived`, plus `pending_info` (needs documents) and `returned` (Post-QC sent it back). Check result options come from the check type (`clear | discrepancy | pending | unable_to_verify` by default, each with a colour).

### 4.4 Roll-ups
- Case status is derived from check states (Partially Completed when some checks are terminal and some are not).
- Proposed final result: Red if any check is `discrepancy` confirmed by a human; Amber if any check is pending or unable to verify; Green only when all checks are `clear`. The approver sets `final_result` explicitly with the proposal beside it. The report renders the stored final result, never the derived one.

---

## 5. Packages, request templates and client-built packages

- **Ontriq packages** (Settings → Packages, `packages.manage`): name, code, description, check types with a unit price each, pricing mode (sum of items or fixed package price), TAT days, default process type, visibility (all clients or selected clients), active flag. Examples seeded: Standard (NIC + Education + Employment), Comprehensive (all seven), Executive (Comprehensive + 2 references + sanctions).
- **Client-built packages** (Portal → Packages, `portal.packages.manage`): a Client Admin composes a named package ("Senior Hire", "Driver Onboarding") from the check types Ontriq has enabled for that client, sees Ontriq's unit prices from the client's contracted price list (or list price) and the computed total, and saves it. Clients never set prices. The package appears instantly in their New Request picker. Ontriq sees client-built packages on the client page and can promote one to an org package. Org setting: "client packages need Ontriq approval before first use" (default off).
- **Request templates** (both sides): name, package, process type, priority, position and department defaults, instructions to Ontriq, default notification recipients, favourite flag. The New Request (portal) and New Case (staff) screens open with a template picker: cards showing name, checks as chips, TAT and price; one click prefills everything, the user reviews and submits. Recent and favourite templates pin to the top; usage counts drive ordering.
- **Snapshots**: cases store `package_snapshot jsonb` (name, checks, unit prices) at creation so history, reports and invoices stay accurate when packages change later.
- Data: `packages (owner_scope org|client, client_id nullable, name, code, description, pricing_mode, fixed_price, tat_days, default_process_type, visibility, is_active)`, `package_items (package_id, check_type_id, unit_price, sort)`, `package_client_visibility (package_id, client_id)`, `client_check_type_access (client_id, check_type_id, enabled)`, `request_templates (owner_scope, client_id nullable, name, package_id, process_type, priority, defaults jsonb, is_favourite, usage_count)`.

---

## 6. Quotations and invoicing with AI

### 6.1 Where it appears
- **Client onboarding wizard**: Company → Contacts and portal admin → Packages and pricing (pick org packages, optionally override unit prices, which creates the client's price list) → **Quotation** (AI drafts, live preview, edit, confirm, send) → Done.
- Client page → Quotes tab → New quotation. Portal → Quotes (view, accept, decline, ask a question) and optionally Request a quote.
- Invoices: per client billing policy `per_case_on_release` (default) or `monthly_consolidated`; drafted automatically by a job and queued for confirmation, or auto-sent when the client policy allows.

### 6.2 Quotation builder (two-pane)
- **Left pane**: structured form. Client and contact, validity days, payment terms, currency (LKR default), line items table (package or check type, description, quantity, unit price, discount, total), optional volume tiers, scope notes, assumptions, TAT commitments per package, intro and closing text, template choice, signature block.
- **Right pane**: live preview rendered from the same document model in HTML, matched to the PDF layout (both targets come from `renderDocument(model, template)` in `src/domain/documents/`). Switching template re-renders instantly.
- **Draft with AI** (`claude-sonnet-5-5`): streams intro, scope, assumptions, TAT commitments and closing into the form; proposes tiered pricing from the client's expected monthly volume within configured discount bounds; tone selector (formal or friendly); "Regenerate section". Prices always come from the price list or list prices, never from the model.
- Autosave as draft → **Confirm** locks a version and generates the PDF (job) → **Send** by email with a portal link → portal **Accept** (typed name, checkbox, IP, timestamp, optional drawn signature), **Decline** with reason, or **Ask a question** (creates a communication). Accepted quotes update the client's price list and mark the client contracted; expired quotes can be duplicated as a new version. Status: `draft → confirmed → sent → viewed → accepted | declined | expired`.

### 6.3 Three Ontriq document templates
Shared by quotations, invoices, statements, receipts, consent forms and the cost document, each a react-pdf layout with an HTML twin, fed by `org_settings.branding` (logo, colours, address, company registration number, VAT number, bank details, footer, signature image). Template choice is stored per document with a default per client.
- **Executive**: navy header band with the white logo, serif display headings, generous margins, summary box on the first page.
- **Modern**: white page, thin navy accent rule, sans headings, airy tables, totals card.
- **Classic**: formal bordered tables, compact rows, traditional letterhead feel.

### 6.4 Invoicing and payments
- `invoices` numbered `INV-YYYY-NNNN` through `next_document_number('invoice')` (row-locked, no gaps); line items from released case checks at the client's contracted price or fixed package price, discounts, configurable taxes (VAT and SSCL rates and applicability per org, inclusive or exclusive), due date from the client's payment terms; status `draft → sent → viewed → partially_paid → paid | overdue | void`; credit notes for corrections; cover email AI-drafted (`claude-haiku-5-5`) from a template; same two-pane edit-and-preview screen before confirmation.
- Payments: manual record (bank transfer, cheque, cash) with reference; portal **Upload payment slip** → AI reads amount, date, bank and reference → proposes a match to open invoices → staff confirms (Arc AI pattern); partial payments; receipt PDF.
- Reminder ladder: 3 days before due, on due, 7 and 14 days late, office hours only, paused while a slip awaits confirmation or on manual hold, escalates to Client Relations after the last step (Arc AI `invoice-chase-core.ts` pattern).
- Client statement with running balance (PDF and CSV) and a monthly billing export per client.
- Portal: Invoices list with status and balance, PDF download, slip upload, payment history, "Explain this invoice" (AI).
- No online payment gateway in v1 (bank transfer plus slips); a gateway is a Phase 6 option.

---

## 7. Auto-assignment, staff performance and nudges

**Interpretation**: "new leads" means new incoming work: cases arriving from any source (portal request, staff creation, bulk import, the command assistant) and the checks they spawn. The engine is generic (`entity_type`), so it can route new client enquiries later if a lead form is added.

### 7.1 Eligibility and scoring
- Eligible: active staff whose role carries the needed permission (`cases.update` for case ownership, `checks.verify` for checks), whose `staff_skills` cover the check type, whose regions match when the check type is location-bound (address, police) and the candidate's district is known, who are not on leave (`staff_availability`), who are under capacity (`max_open_cases`, `max_open_checks`), and who have auto-assign enabled.
- Weighted load counts checks by stage effort (verification 1.0, data entry 0.5, awaiting response 0.3) so "busy" means real work.
- Pure `assignment-core.ts` (vitest): `score = w_load × openLoadNorm + w_overdue × overdueNorm + w_recent × (1 − recentThroughputNorm) + w_new × newStaffBoost`; lowest score wins; ties go to the longest-waiting person (round-robin). Strategies in `assignment_rules`: `least_loaded` (default), `round_robin`, `performance_weighted` (strong performers get slightly more, capped by capacity), `manual` (manager queue). Weights are editable in Settings → Assignment.

### 7.2 Flow
Case created → `assign.auto` job picks a case owner and per-check assignees → `assignment_events` row with a human-readable explanation ("Nimal: 3 open checks vs team average 6, qualified for Employment, completed 14 checks in the last 7 days") → urgent notification (in-app, optional SMS) "New case ONT-2026-000123 assigned to you" → Realtime toast in the workspace and a highlighted row in My work → manager dashboard shows the distribution. Manual reassign with a reason is always allowed. **Rebalance** asks the AI to propose moves when someone is overloaded or goes on leave (confirm cards). No eligible staff → manager queue plus alert.

### 7.3 Performance tracking
Nightly `performance.rollup` job fills `staff_performance_daily` (checks completed, cases closed, average TAT, SLA met %, QC return rate, first-action time, outreach sent, overdue at end of day, nudges received). `/app/team/performance` (`staff.performance.read`): leaderboard for week, month or quarter with a composite score (throughput 40 %, timeliness 30 %, quality 20 %, responsiveness 10 %, weights configurable), trend sparklines, workload heatmap, per-staff drill-down with open items and nudge history. Staff see their own scorecard on their dashboard.

### 7.4 Nudges (the Push button)
On any staff row or scorecard, a user with `staff.nudge` clicks **Push** → dialog lists the overdue and at-risk items with an AI-drafted, constructive message (editable, tone selector) → sends an urgent in-app banner (bypasses quiet hours), email and optional SMS → `nudges` row (from, to, items, channel, message, acknowledged_at, reply). The staff member sees "You're behind on 3 items" with one-click open, Acknowledge and Reply. Optional auto-nudge rule: if overdue items exceed N for more than H hours the system nudges automatically and informs the manager; a second breach escalates to the manager.

Data: `staff_skills (user_id, check_type_id, level)`, `staff_capacity (user_id, max_open_cases, max_open_checks, regions text[], auto_assign_enabled)`, `staff_availability (user_id, from, to, kind, note)`, `assignment_rules (strategy, weights jsonb, consider_skills, consider_regions, fallback_user_id, auto_nudge jsonb)`, `assignment_events (entity_type, entity_id, assigned_to, assigned_by, strategy, score_breakdown jsonb, explanation, reason)`, `staff_performance_daily`, `nudges`.

---

## 8. The AI layer: Ontriq Intelligence (working name)

### 8.1 Budget-first model routing
You asked for the most budget-friendly option wherever the task is not heavy. The routing policy, stored in `src/lib/ai/models.ts` and editable per capability in Settings → AI:
- `claude-haiku-5-5` ($0.10 in / $0.50 out per million tokens): classification, OCR, quality checks, slip reading, candidate guidance, portal explainers, nudge and cover-email drafts, assignment explanations.
- `claude-sonnet-5-5` ($2 / $10): field extraction, consistency checks, Pre-QC copilot, outreach drafts, response capture, report narrative, quotation drafting, staff assistant chat, rebalancing proposals, the daily briefing.
- `claude-opus-5-5` ($4 / $20): Post-QC cross-check (the one place a missed inconsistency costs the most) and the Super Admin command assistant (low volume, highest reach). Either can be switched to Sonnet in Settings if Ontriq prefers.
- Prompt caching for every system prompt and schema (cache reads cost about a tenth of input), Message Batches at half price for nightly re-checks and backfills, and `max_tokens` sized per capability.

### 8.2 Capabilities
Every capability is a job handler in `src/jobs/handlers/` (or, for chat and the drafters, a streaming route), records an `ai_runs` row (model, prompt version, input refs, output, confidence, tokens, cost) and writes `ai_suggestions` rows that the UI shows with an "AI suggested" badge and accept / edit / reject controls. Each capability has a kill switch in Settings and a per-client opt-out. Costs are planning estimates at the prices above (details and assumptions in §18).

| # | Capability | Trigger | Model | Output | Human gate | Est. cost |
|---|---|---|---|---|---|---|
| 1 | Document classification, quality and OCR | Every upload | Haiku | Document type, readability, blur/orientation/missing pages, copy vs original, language, OCR text | None; low quality → re-upload request | $0.001 per page |
| 2 | Extraction and pre-fill | Document accepted | Sonnet, structured output from the check-type schema | Field values with confidence and page reference, per check | Data entry officer confirms side-by-side | $0.02 per check |
| 3 | Cross-document consistency | Document set changes | Sonnet | Name, NIC, DOB, dates, institutions compared across documents; discrepancy list | Pre-QC officer reviews | $0.03 per case |
| 4 | Pre-QC copilot | Case enters Pre-QC | Rules + Sonnet | Completeness checklist, missing or unreadable items, drafted amendment or candidate request in their language | Officer edits and sends | $0.03 per case |
| 5 | Outreach drafts | Check starts | Sonnet | Verification emails to institutions, employers, referees; reference call script; follow-up cadence | Officer sends (optional auto-send per template) | $0.01 per check |
| 6 | Response capture | Reply pasted, uploaded or call notes typed | Sonnet | Confirmed vs claimed facts, proposed check result with confidence and reasoning | Officer confirms | $0.013 per check |
| 7 | Post-QC cross-check | Case enters Post-QC | Opus, effort `high` (Sonnet option) | Audit of every check against evidence, inconsistencies, proposed Green/Amber/Red with reasoning | QC officer decides | $0.22 per case (Sonnet $0.09) |
| 8 | Report narrative | Draft report | Sonnet | Findings and remarks per check in house style, executive summary | Editable before generation | $0.06 per case |
| 9 | Ask Ontriq (staff assistant) | Staff chat panel | Sonnet, effort `low`, tool runner, ≤ 4 turns, 22 s budget | Answers over the data the user may see; actions as confirm cards | Confirm card before any write | $0.02 per turn |
| 10 | Auto-assignment explanation and rebalancing | Case created; Rebalance clicked | Rules + Haiku (explanations), Sonnet (rebalance) | Assignee with explanation; proposed moves | Policy for routine; confirm cards for moves | $0.0005 / $0.03 |
| 11 | SLA and risk radar, daily briefing | 15-minute scan; 07:30 Asia/Colombo | Rules + Sonnet for the briefing | At-risk cases, bottlenecks, manager briefing | Informational | $0.04 per day |
| 12 | Candidate link guide | During upload | Haiku | "This looks like an A/L certificate, we need the O/L one", blur warnings, EN/SI/TA | None | $0.0003 per upload |
| 13 | Portal and candidate explainer | Status change | Haiku (cached per status) | Plain-language "where this is and what we need from you", "what this invoice covers" | None | $0.001 per change |
| 14 | Tamper and duplicate signals | Document accepted; case created | Haiku + rules | Edited-document heuristics, same NIC across cases, sanction name-match notes | QC reviews | $0.005 per case |
| 15 | Quotation and invoice drafting | Draft with AI in the builder | Sonnet, streaming structured output | Intro, scope, assumptions, TAT commitments, closing, tier proposals within discount bounds; cover emails (Haiku) | User edits in the live preview and confirms | $0.04 per draft |
| 16 | Payment slip reading | Slip uploaded | Haiku vision | Amount, date, bank, reference, proposed match | Staff confirms | $0.0005 per slip |
| 17 | Nudge drafting | Push clicked or auto-nudge | Haiku | Constructive message listing the items | Manager edits and sends | $0.001 per nudge |
| 18 | Super Admin command assistant (§9) | Mic or text in Command | Opus, tool runner with the full tool set, ≤ 6 turns, 22 s budget, job hand-off beyond | Answers over the whole system, artifacts, confirm cards for actions | Confirm card before any write | $0.08 per turn + transcription |

Governance rules in code: prompts are versioned TypeScript builders in `src/lib/ai/prompts/` with the check-type schema or document model appended and cached with `cache_control`; no PII in cache keys or tags; every call passes through `src/lib/ai/claude.ts`, which records usage and prices it in `ai_runs` from the editable `ai_cost_rates` table with the Arc AI `markAiSource` AsyncLocalStorage pattern so spend is reportable per client, case and capability; structured outputs via `output_config.format` / `messages.parse`; `fallbacks: "default"` with the server-side-fallback beta on Opus and Sonnet calls, and `stop_reason === "refusal"` always checked; thinking left on (never `disabled` or `budget_tokens`); no forced `tool_choice`; the model never sets a price, a result or an assignee without a rule or a human; daily and monthly budget caps per capability pause non-essential jobs and alert the Super Admin.

---

## 9. Super Admin command assistant (voice-enabled)

- **Who**: the Super Admin only (`ai.super_assistant`, bound to the system role and not grantable to custom roles; an org setting can later extend it to Admins). Everyone else keeps the scoped Ask Ontriq assistant.
- **Where**: a dedicated Command page at `/app/command` plus the floating panel on every screen. A **mic button** records a voice note (tap to start and stop, up to two minutes, waveform shown), uploads it to the private `documents` bucket, transcribes it, and shows the transcript as the user's message (editable before sending if the "review transcript" preference is on). Live dictation uses the browser's Web Speech API when available (free, instant); recorded notes go through a server transcription adapter (`src/lib/stt/provider.ts`, default a Whisper-class hosted model at roughly $0.003–0.006 per minute, Claude has no speech input). Sinhala and Tamil dictation depend on the browser or provider's language support and are enabled per language in Settings.
- **How it answers**: always as a message. Text plus artifacts: sortable tables with "open this view in the app" (the filter is applied in the URL), record cards, metric tiles, charts, signed document links minted on request, and confirm cards for actions. Long answers stream; work beyond the 22-second budget continues as a job and the result arrives in the thread via Realtime.
- **Reach**: the whole system through about 45 tools grouped by module: cases and checks, documents (metadata; file links minted on request), candidates and candidate links, clients, packages and templates, quotes, invoices and payments, staff, assignment and performance, jobs, audit log, AI usage and cost, settings. Reads run under the Super Admin's own RLS client (they hold `*`), so nothing bypasses policies, and every tool call is logged in `assistant_actions` and `ai_runs`.
- **Actions** (every one a confirm card, with an Undo for reversible ones within ten minutes): create client (opens the onboarding wizard pre-filled, or creates directly on confirm and sends the portal invite), create case, generate and send a candidate link, assign or reassign, change stage or status, hold or resume, draft and send a quotation, invoice or reminder, record a payment, push a nudge, invite a user, change an allow-listed setting, retry a job. Bulk actions ("send reminders to every invoice over 30 days") show one card with the full list before anything is sent. No deletes; voids and cancellations are status changes.
- **Examples**: "Show me all unpaid invoices over 30 days" → table, total outstanding, Send reminders card. "Create a new client called Hemas Holdings, contact Nadeesha Perera, Comprehensive package, 30-day terms" → parsed details card → confirm → client created, invite sent, quotation drafted and opened. "Who is behind this week?" → leaderboard with Push cards. "What did AI cost us for Client X last month?" → from `ai_runs`. "Open ONT-2026-000123" → navigates.
- **Memory**: approved memories (preferences, standing instructions such as "always use the Executive template for banks"), a morning summary when the page opens, quiet hours for proactive messages.
- **Guardrails**: daily token and dollar caps in Settings → AI, at most 6 tool turns per message, tools answer in under 1.5 seconds, destructive operations excluded by design, full audit trail, rate limits on the transcription route.
- **Tech**: the same tool-runner route as Ask Ontriq with the `command` tool set, `claude-opus-5-5` (`low` effort for conversation, `medium` for analysis questions), `assistant_voice_notes` (storage path, duration, transcript, language), the `src/lib/stt/` adapter, and `src/lib/ai/tools-command/*` modules merged into the registry with the duplicate-name check.

---

## 10. The three experiences

### 10.1 Staff workspace (`/app`)
| Area | Content |
|---|---|
| Dashboard | My work (new assignments highlighted, due today, overdue, behind banner), my scorecard, team load, cases by stage, SLA at risk, today's briefing; each tile its own Suspense region |
| Command (Super Admin) | Full-height assistant with mic, thread history, artifacts, pending confirm cards, memory list, usage today |
| Cases | TanStack table with server-side pagination, URL-driven filters (`nuqs`), column chooser, saved views (shared or private), bulk actions; kanban by stage (dnd-kit); New Case opens the template picker |
| Case detail | Header: reference, candidate, client, package, process type, stage/status pill, result badge, SLA countdown, assignees with the assignment explanation, hold. Regions: Overview, Checks, Documents, Candidate link (status, requests, consent, messages), Communications, QC, Report, Billing, Activity, Jobs. Right rail: AI copilot with suggestions for this case |
| Check detail | Schema-driven form with ghost AI suggestions, evidence list, verification log, outreach thread, result selector |
| Documents | Viewer (PDF and image) beside extracted fields, visibility toggle (internal / client / report), versions, request missing |
| Queues | My checks, Pre-QC, Post-QC, Approvals (reports pending final approval), Returned items, Manager queue (unassignable work), Candidate requests awaiting review |
| Clients | Onboarding wizard, company profile, contacts, portal users, packages and price list, quotes, invoices and statement, SLA days, visibility defaults, AI opt-out, billing policy, AI cost this month |
| Quotes | List, two-pane builder with AI draft and live preview, versions, send, acceptance status |
| Invoices and payments | Drafts awaiting confirmation, sent, overdue, payments and slips to match, credit notes, reminders status, statements, billing export |
| Candidates | Deduplicated by NIC; case history; consent records; link history |
| Team | Members and invites, roles with permission matrix, MFA status, skills, capacity and availability, **Performance** (leaderboard, trends, heatmap, drill-down, Push button), nudge history |
| Settings | Org profile and branding, document templates (preview of the three designs), check types and packages, request templates, candidate link content (guide texts, consent form template, languages), statuses and labels, assignment rules and weights, SLA policies, billing and taxes, numbering series, email and SMS templates, integrations, AI (routing per capability, budgets, kill switches, **Usage and cost** dashboard with actuals vs the plan's estimates), retention, Jobs monitor |
| Inbox | Per-case email threads (outbound logged; inbound via Resend webhook in Phase 6), templates with `{{tokens}}` |
| Tasks | Auto-generated follow-ups and manual tasks with due dates and assignees |
| Reports archive | Every version, hash, who released to whom, downloads |
| Analytics | TAT per stage and package, throughput, officer workload, client volumes, result mix, SLA breaches, revenue and receivables, AI cost per case |
| Audit log | Filterable immutable log |
| Everywhere | ⌘K palette (records, pages, permission-gated actions), notifications bell, Ask Ontriq panel, keyboard shortcuts (`c` new case, `/` search, `g c` cases…), light and dark theme |

### 10.2 Client portal (`/portal`)
Dashboard (cases by status, pending actions, average TAT, open invoices), cases list and detail (per-check client labels only, timeline of client-visible events, pending documents with upload, report download once released), **New request** opening with the template picker (single form with CV upload that pre-fills candidate details, or bulk CSV/Excel), **Packages and templates** (build and name custom packages from enabled checks with live pricing; create request templates), **Quotes** (view, accept with e-signature, decline, ask), **Invoices** (status, balance, PDF, upload slip, payment history, AI explainer), reports library, notification preferences, team management for client admins. Branded Ontriq with the client's logo. Data comes only from `portal_*` security-definer views and RPCs, so hidden columns never leave the database.

### 10.3 Candidate public link (`/c/[token]` → `/c/session`)
Generated the moment a candidate is added to a case (automatically for Process Type 2, on demand for Type 1), sent by email and SMS with a configurable message, copyable from the case, re-sendable, revocable. The page needs no login and works on a phone:
- **Welcome and purpose**: Ontriq branding, the client's name and the position, what background verification is, how long it takes, who to contact. English, Sinhala and Tamil switcher.
- **Live timeline**: Received → Documents → Review → Verification → Report, with the candidate's current step highlighted and candidate-safe events ("Your NIC copy was received", "We need a clearer copy of your O/L certificate") streaming in from `case_events`. The candidate never sees results, internal notes or client-only data.
- **Required documents guide**: every document the package needs, grouped by check, each with a description, an example image, accepted formats, and its own upload slot showing pending / received / accepted / needs re-upload with the reason. Camera capture on mobile, multi-page capture, instant AI feedback (wrong document type, blur, missing page).
- **Information requests**: staff ask the candidate for specific things from the case ("Please provide your employee code at ABC Ltd", "Confirm your period of residence at this address", "Add your second referee") through an "Ask candidate" composer that picks check fields, document categories or free-text questions, with due dates and reminders. The requests appear as a form on the page; answers flow into check values with `source: candidate` for staff confirmation. The Pre-QC copilot suggests requests from its findings.
- **Consent form**: at the bottom, a consent and authorisation form generated from the document system with the candidate's and client's names and the checks listed. The candidate can **download** it, sign on paper, **photograph** it and **upload** it right there (AI confirms it is signed and legible), or sign electronically (typed name plus drawn signature with IP and timestamp). Consent is required before Pre-QC starts.
- **Messages**: a simple thread where staff post notes to the candidate and the candidate replies; everything logged on the case.
- **Progress and reminders**: a progress bar, "what's left" summary, reminders on a configurable cadence (default day 1, 3, 5) with staff escalation after the last one, and an automatic "all received, thank you" message.
- **Security**: the token is hashed at rest, expires (default 14 days), is scoped to one case, is exchanged for a 20-minute HMAC-signed cookie so it leaves the URL, is rate-limited by IP and link, is revoked on submission or cancellation, and every access and write is audited. All writes happen server-side with the service-role client filtered by the link's `case_id`.
- **Staff side** (case → Candidate link panel): link status and last opened, uploads and their AI checks, open requests, consent status, messages, re-send, revoke, "Ask candidate" composer.

---

## 11. Document generation: reports, quotes, invoices, consent forms, cost document

### 11.1 Shared document system
`src/domain/documents/` holds the document model types, the three templates (Executive, Modern, Classic) and `renderDocument(model, template)` with two targets: HTML (live previews, portal, candidate page) and react-pdf (the worker). Brand tokens come from `org_settings.branding`. Numbering through `next_document_number(kind)` with per-kind series (`QT-`, `INV-`, `CN-`, `RCT-`, `CNS-`). Every generated PDF is a `generated_documents` row (kind, entity, version, template, storage path, sha256) rendered by the `document.render` job and stored in the private `documents` bucket. The final report has its own layout but uses the same brand tokens and job. The Cost and Feasibility document (§18) is rendered by the same system from a script.

### 11.2 Final report pipeline
1. **Compile**: `src/domain/reports/compile-core.ts` builds a JSON snapshot from the case: cover, candidate and case details, summary table (every check with status and result, incomplete clearly marked), per-check sections rendered from the check type's report blocks, findings and remarks (AI-drafted, human-edited), evidence appendix list, Global Sanction annexure reference, QC and approval details, result legend. The snapshot is stored on `report_versions` so regeneration years later is faithful.
2. **Draft** (`report.render` job, kind `draft`): `@react-pdf/renderer` renders the body with a DRAFT watermark; `pdf-lib` appends evidence (JPEG/PNG as scaled A4 pages, PDFs via `copyPages`) and the Global Sanction PDF's original pages untouched behind an annexure cover sheet. The UI shows "Generating…" from the job row via Realtime.
3. **Approve**: Operations Manager or Admin with `reports.approve`. The action re-hashes the current case data against the snapshot; if anything changed it demands a regenerate. Final result confirmed here.
4. **Final** (`report.render`, kind `final`): same pipeline without watermark → SHA-256 → QR code on the cover pointing to `/verify/[reportVersionId]` → stored as a new version in the private `reports` bucket.
5. **Release**: choose recipients (client portal, specific client users). Portal shows "Report available"; emails carry a portal link, never a signed URL. Downloads go through `/api/reports/[versionId]/download`, which checks RLS, logs to `report_downloads`, and redirects to a 60-second signed URL. Per-case billing policy drafts the invoice here.
6. **Revise**: a new version with a reason; previous versions marked superseded, never overwritten.
Fonts: Noto Sans, Noto Sans Sinhala and Noto Sans Tamil embedded, selected per string by Unicode range. Complex-script shaping in react-pdf is a known weak spot, so week 1 includes a spike; the fallback is English prose with Sinhala/Tamil only where needed.

---

## 12. Notifications and communications

- Channels: in-app (Realtime), email (Resend through `email_outbox` + `email.send` job with the outbox id as the Resend idempotency key, Svix-verified delivery webhook), SMS (Notify.lk adapter behind `src/lib/sms/provider.ts`, `sms_outbox`), WhatsApp later.
- Events: case created, assigned, documents requested or received, candidate request answered, consent received, stage changed, pending information, QC returned, check completed, report released, SLA warning, nudge, quote sent/viewed/accepted, invoice sent/due/overdue/paid, slip uploaded, AI budget threshold, mention, candidate submitted.
- Per-user preferences (event type × channel, daily digest, quiet hours; `urgent` bypasses quiet hours). `notifyUsers()` does one batched insert then fans out, same shape as Arc AI.
- Every outbound message is a `communications` row (channel, direction, template, rendered body, external id, delivery status).

---

## 13. Data model (Supabase Postgres)

All business tables: `id uuid`, `org_id` (filled by a `BEFORE INSERT` trigger from `auth_org_id()`), `created_at`, `updated_at`, `created_by`. Enums for stages, check states, job status, visibility, document kinds, quote and invoice status, request kinds.

| Group | Tables and key columns |
|---|---|
| Identity | `orgs` (name, settings, branding, mfa_required_for_staff), `profiles` (1:1 auth.users: full_name, phone, avatar, locale), `memberships` (user_id, org_id, kind, client_id, role_id, status), `roles`, `permissions` (seeded catalog), `role_permissions`, `invitations` (email, role_id, client_id, token_hash, expires_at, accepted_at) |
| Clients | `clients` (name, code, industry, address, sla_days, default_package_id, default_template, payment_terms_days, billing_policy, ai_opt_out, status), `client_contacts`, `client_settings` (visibility defaults, portal options), `client_check_type_access`, `client_price_lists` (client_id, check_type_id or package_id, unit_price, source quote_id, valid_from) |
| Catalog | `document_categories`, `check_types` (key, name, current_version_id, draft_version_id, archived_at), `check_type_versions` (version, schema jsonb, published_at; immutable once published), `packages`, `package_items`, `package_client_visibility`, `request_templates` |
| Cases | `candidates` (full_name, full_name_latin, nic_number unique per org, dob, email, phone, address, district, preferred_language), `cases` (reference, client_id, candidate_id, package_id, package_snapshot jsonb, process_type, stage, status_key, on_hold, hold_reason, final_result, proposed_result, priority, assigned_to, due_at, received_at, released_at, billable_amount, client_visible, created_via, candidate_name_snapshot, search_text generated), `case_counters` + `next_case_number(org_id)`, `case_checks` (case_id, check_type_id, check_type_version_id, state, result, values jsonb, values_meta jsonb, client_status, assigned_to, started_at, completed_at), `case_check_internal` (1:1: verifier notes, outreach log, AI drafts; staff-only policies), `case_check_requirements`, `stage_history`, `case_events` (with `visible_to` flags: staff, client, candidate), `client_status_catalog` |
| Documents | `documents` (case_id, check_id, candidate_id, uploaded_by_kind, category, storage_path, filename, mime, size, sha256, version, parent_id, visibility, status, rejection_reason), `document_texts` (OCR text, tsvector), `document_ai` |
| Candidate link | `candidate_links` (case_id, token_hash unique, scope, language, expires_at, revoked_at, last_used_at, use_count, sent_via), `candidate_requests` (case_id, kind document|field|question, payload jsonb, due_at, status, answered_at, answer jsonb, reviewed_by), `candidate_messages` (case_id, from_kind staff|candidate, body, read_at), `consent_forms` (case_id, generated_document_id, signed_document_id, method esign|upload, signed_name, signed_at, ip, ai_check jsonb) |
| QC and reports | `qc_reviews` (case_id, type pre/post, reviewer_id, decision, checklist jsonb, remarks, returned_to_stage), `report_versions` (case_id, version, kind, status, storage_path, sha256, page_count, snapshot jsonb, approved_by, released_by, released_at), `report_recipients`, `report_downloads` |
| Documents and branding | `document_templates` (key executive/modern/classic, name, preview_path, settings jsonb), `document_counters` + `next_document_number(kind)`, `generated_documents` (kind, entity_type, entity_id, version, template_key, storage_path, sha256) |
| Quotations | `quotes` (client_id, number, version, status, template_key, currency, valid_until, payment_terms_days, model jsonb, subtotal, discount_total, tax_total, total, sent_at, viewed_at, accepted_at, accepted_by_name, accepted_ip, declined_reason, pdf_document_id), `quote_items`, `quote_tiers`, `quote_events` |
| Invoices and payments | `invoices` (client_id, number, status, template_key, issue_date, due_date, period_from, period_to, model jsonb, subtotal, discount_total, tax_lines jsonb, total, balance, sent_at, viewed_at, paid_at, pdf_document_id), `invoice_items` (invoice_id, case_id, case_check_id, description, qty, unit_price, total), `payments` (client_id, invoice_id, amount, method, reference, paid_on, recorded_by, slip_document_id), `payment_slips` (client_id, storage_path, ai_extraction jsonb, proposed_invoice_id, status), `credit_notes`, `invoice_reminders` (invoice_id, step, sent_at, paused_reason), `tax_rates` (code VAT/SSCL, rate, applies_to, inclusive) |
| Assignment and performance | `staff_skills`, `staff_capacity`, `staff_availability`, `assignment_rules`, `assignment_events`, `staff_performance_daily` (user_id, day, checks_completed, cases_closed, avg_tat_hours, sla_met_pct, qc_return_rate, first_action_minutes, outreach_sent, overdue_eod, nudges_received), `nudges` (from_user, to_user, items jsonb, channel, message, auto, acknowledged_at, reply) |
| Work and comms | `tasks`, `communications`, `templates` (email/sms/amendment/cover letters/candidate link texts), `notifications`, `notification_prefs`, `email_outbox`, `sms_outbox`, `saved_views`, `sla_policies`, `org_settings` |
| Jobs | `jobs` (kind, payload, idempotency_key, status, priority, run_after, attempts, max_attempts, claims, locked_by, locked_until, progress, result, last_error, entity_type, entity_id), `job_kind_limits`, `job_failures`, `job_workers` |
| AI | `ai_runs` (capability, model, prompt_version, case_id, client_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, status, reviewed_by), `ai_suggestions` (entity, field key, value, confidence, source refs, accepted_by, decision), `ai_cost_rates` (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, effective_from), `ai_budgets` (capability or org, daily_usd, monthly_usd, action pause|alert), `assistant_threads`, `assistant_messages`, `assistant_actions` (confirm cards and outcomes, before/after, undo_until), `assistant_memories` (status pending/approved), `assistant_voice_notes` (storage_path, duration_s, transcript, language, provider, cost_usd), `ai_batches` |
| Audit | `audit_log` (table, row_id, op, before, after, actor_id, actor_kind, ip; insert-only, generic AFTER trigger), `system_events`, `rate_limit_hits` |

RPCs (`security definer` unless noted): `auth_org_id()`, `is_staff()`, `is_client()`, `client_id_of_user()`, `has_permission(text)`, `my_membership()`, `next_case_number(uuid)`, `next_document_number(text)`, `case_transition(...)`, `portal_case_detail(uuid)`, `candidate_link_view(uuid)` (candidate-safe projection), `search_everything(text, int)` (`security invoker`, so RLS filters every branch), `enqueue_job`, `claim_jobs` (`FOR UPDATE SKIP LOCKED`, lease, per-kind concurrency), `heartbeat_job`, `progress_job`, `complete_job`, `fail_job` (exponential backoff with jitter, dead-letter after `max_attempts` or 3 claims without progress), `staff_load_snapshot()`, `client_balance(uuid)`, `ai_cost_summary(period, group_by)`, `rate_limit_check`.

Storage buckets: `case-files` (private, `org/{org}/client/{client}/case/{case}/doc/{doc}/{file}`), `reports` (private), `documents` (private: quotes, invoices, statements, receipts, consents, slips, voice notes), `org-assets` (public logos). No Storage policies for `authenticated` in v1: every read is a server-minted 60-second signed URL issued after an RLS-scoped row read, every write is a signed upload URL minted after an authorization check.

---

## 14. Security and compliance

- RLS on every table, no `using (true)`. Staff policies: `org_id = auth_org_id() and is_staff() and has_permission('…')`. Client policies: `is_client() and client_id = client_id_of_user()`, documents additionally `visibility in ('client','report')`, quotes and invoices only in `sent` or later statuses. Clients have no policy on `case_checks` or `case_check_internal`; they read `portal_*` views. No delete policies anywhere (cancel, void and archive are status changes).
- Candidates never touch RLS: the server verifies the HMAC session cookie, re-loads the `candidate_links` row (revocation wins), and performs reads through `candidate_link_view()` and writes with the service-role client filtered by the `case_id` from the row, never from the form. Only `src/lib/server/candidate/*` may import the admin client for this purpose.
- Supabase Auth TOTP MFA enforced for staff via the `aal` claim; access tokens 10 minutes; idle timeout; login sessions with IP and user agent.
- Insert-only audit tables (no update or delete grants); trigger-written; the worker sets `app.actor_id` so job writes are attributed; command-assistant actions carry `actor_kind = 'assistant'` plus the Super Admin's id.
- PII minimisation in AI prompts; per-client AI opt-out; no PII in cache keys, tags, page titles or URLs (case reference only); voice notes retained 30 days then purged, transcripts kept with the thread.
- Retention policy per client (default 24 months after release) with a scheduled purge job and an erasure flow (anonymise candidate, delete objects) that writes an audit entry; financial records are retained per statutory period and excluded from erasure.
- Rate limiting on public endpoints (candidate link, verify page, login, quote acceptance, transcription) via `rate_limit_check`.
- Secrets only in Netlify environment variables; the service-role key lives in `server-only` modules and the worker, never in a client bundle.

---

## 15. Technical architecture

### 15.1 Next.js 16.4.3 with Cache Components (kept on)
The framework will enable `cacheComponents` and `partialPrefetching` everywhere in the next major and remove the flags (`01-getting-started/08-caching.md`), so build with them now. The model: a static app shell plus everything else streaming behind Suspense; `use cache` only for org catalogs; session via `use cache: private`. On Netlify's serverless runtime `use cache` entries do not persist across requests, so database performance comes from indexes and RPCs, not from caching.

Patterns (docs under `node_modules/next/dist/docs/01-app/`):
- **Layouts are synchronous.** `(staff)/app/layout.tsx` renders the frame and puts `<StaffNav/>` and `<AuthGate kind="staff"/>` each in its own `<Suspense>`; the gate is UX only (`02-guides/optimizing-the-static-shell.md`, `02-guides/authentication-with-cache-components.md`).
- **Data Access Layer** in `src/lib/server/viewer.ts`: `loadViewer()` (uncached, reads cookies, `auth.getClaims()` + `my_membership()` RPC) for Server Actions and Route Handlers; `getViewer()` wraps it in `'use cache: private'` with `cacheLife({ stale: Infinity })` for request-scoped dedupe in Server Components and redirects to `/login` when absent; `requireViewer({ kind, permission })` throws typed errors for actions. Supabase clients are created where used and never cross a cache boundary. The viewer promise is shared with Client Components through context; only `{ displayName, kind, permissions }` reaches the browser.
- **Pages are synchronous** and render chrome plus one `<Suspense>` per data region; the async child awaits `params`/`searchParams`. `loading.tsx` only on list pages where nothing renders without data. `useSearchParams()` always sits inside Suspense. `getCase(id)` is wrapped in `React.cache` so a detail page's regions share one read. No `generateStaticParams` on `[caseId]` routes.
- **Catalogs** (check types, packages, status catalog, roles, document templates, AI rates) via `'use cache'` + `cacheTag('org:{orgId}:…')` + `cacheLife('hours')`; admin edits call `updateTag`.
- **Mutations**: Server Actions validate with zod, call `requireViewer`, write through RLS or an RPC, return `ActionResult<T>`, then `refresh()` (business reads are uncached). `updateTag` only for catalogs. Route handlers and the worker use `revalidateTag(tag, 'max')`. Never `revalidatePath('/', 'layout')`. The browser dispatches Server Actions sequentially, so batch inside one action.
- **Cross-user freshness**: `useRealtimeSync(table)` → debounced `router.refresh()` with a 5-second floor (ported from Arc AI); hidden `<Activity>` routes drop their channels. The candidate page uses the same hook through a candidate-scoped Realtime channel keyed by case.
- **Metadata**: case pages title by reference, never candidate name; `generateMetadata` shares the `React.cache`d read. List and portal pages export static `metadata`.
- **Uploads**: never through Server Actions (1 MB limit). `beginUpload` action inserts a `documents` row with `status = pending_upload` and mints `createSignedUploadUrl`; the browser uploads with `uploadToSignedUrl` (25 MB cap, PDF/JPEG/PNG only, images downsized to 2000 px client-side); `finalizeUpload` confirms the object, sets `uploaded`, enqueues `ai.classify_document`. Voice notes follow the same path into `documents` bucket. Downloads via `/api/files/[documentId]` → RLS read → log → 302 to a 60-second signed URL.
- **`src/proxy.ts`**: `@supabase/ssr` `createServerClient` with `getAll`/`setAll`, `auth.getClaims()` to refresh; redirects signed-out users on private paths to `/login?next=…`, staff without `aal2` to `/mfa`, and routes `/app` vs `/portal` by `app_metadata.kind`; `/c/*`, `/verify/*` and machine paths bypass it and guard themselves; matcher excludes static assets; fails closed on private paths. Every Server Action still re-checks auth because excluded matcher paths skip action POSTs.
- Time-dependent rendering (SLA countdowns, "today") lives in Client Components or after `await connection()`. No `runtime`, `dynamic`, `revalidate`, `fetchCache` or `dynamicParams` exports. `error.tsx` uses `retry`; parallel slots get `default.tsx`. Temporary escape hatch per segment: `export const instant = false`.

### 15.2 Supabase
- Hosted project; `supabase/config.toml`; migrations in `supabase/migrations/` applied with `supabase db push`; `npm run db:types` runs `supabase gen types typescript --linked > src/lib/supabase/database.types.ts` and CI fails when it is stale. Never hand-edit the types (the hand-written 11k-line type is what blew Arc AI's build heap).
- Extensions: `pgcrypto`, `pg_trgm`, `pg_net`, `pg_cron` (upgrade path only), `pgvector` (Phase 6).
- Three clients: `src/lib/supabase/server.ts` (cookies, RLS), `client.ts` (browser, anon, auth and signed uploads only), `admin.ts` (service role, `server-only`; used only by candidate flows, invitations, webhooks). The worker has its own `src/jobs/admin-client.ts`.
- Realtime publication: `jobs`, `documents`, `case_checks`, `cases`, `case_events`, `candidate_requests`, `candidate_messages`, `ai_suggestions`, `assistant_messages`, `notifications`, `quotes`, `invoices`, `assignment_events`. Realtime honours RLS; the candidate channel is served through a server-side relay keyed by the verified session.
- `supabase/seed.sql`: Ontriq org, a super admin, 2 clients with portal users, staff with skills and capacity, 12 cases across stages, a quote and two invoices, a candidate link with requests.

### 15.3 Background jobs on Netlify
Decision: a `jobs` table owned by Postgres, a Netlify Background Function worker, and a 1-minute Scheduled Function sweeper. No new vendor; job state reaches the UI through Realtime. pgmq/pg_cron is the upgrade path if the sweeper proves costly; `runJob(job)` stays transport-agnostic so Inngest or Trigger.dev could replace the worker later.
- `enqueue_job` + immediate kick: the Server Action `fetch`es `${process.env.URL}/.netlify/functions/jobs-worker-background` with `JOBS_WORKER_SECRET` and a 2-second abort (the 202 returns instantly; failures are caught by the sweeper). At most 3 live workers, counted from `job_workers` heartbeats.
- Worker `netlify/functions/jobs-worker-background.mts`: 13-minute budget, claims one job at a time while ≥ 90 seconds remain, heartbeats every 60 seconds during long model streams (lease 10 minutes), self-chains when queued work remains. **Nothing under `src/jobs/**` imports `next/*` or `server-only`**; shared pure code lives in `src/domain/**`.
- Sweeper `netlify/functions/jobs-sweeper.mts` (`* * * * *`) → `POST /api/jobs/tick` with `CRON_SECRET` (fails closed): enqueues scheduled kinds by idempotency key (`sla.scan` every 15 min, `reminders.scan` hourly, `invoice.reminders` hourly in office hours, `invoice.monthly_draft` on the 1st, `briefing.daily` 07:30 Asia/Colombo, `performance.rollup` 00:30, `ai.budget_check` hourly, `retention.purge` nightly), requeues expired leases, kicks a worker if queued rows exist and no heartbeat is fresh; hands off within 3 seconds so the scheduler never double-fires.
- Per-step jobs, not mega-jobs: upload → `ai.classify_document` (Haiku, ~10 s) → `ai.extract_fields` per check (Sonnet, 20–60 s) → `ai.consistency` per case. Other kinds: `ai.preqc_copilot`, `ai.outreach_draft`, `ai.response_capture`, `ai.postqc`, `ai.narrative`, `ai.slip_read`, `ai.consent_check`, `stt.transcribe`, `assistant.task`, `assign.auto`, `assign.rebalance`, `document.render`, `report.render`, `invoice.draft`, `email.send`, `sms.send`, `reminder.candidate`, `sla.scan`, `briefing.daily`, `performance.rollup`, `nudge.auto`, `retention.purge`, `ai.batch_submit`, `ai.batch_collect`.
- Idempotency keys: `ai.classify_document:{documentId}:{sha256}`, `ai.extract_fields:{caseCheckId}:{docSetHash}`, `report.render:{caseId}:v{n}:{kind}`, `document.render:{kind}:{entityId}:v{n}`, `invoice.draft:{clientId}:{period|caseId}`, `email.send:{outboxId}`, `sla.scan:{15-minute bucket}`. `max_attempts`: AI 3, email 8, render 3, scans 1. The `claims >= 3` dead-letter guard (Arc AI's lesson) stops a platform-killed worker from re-running a paid model call forever.
- Settings → Jobs shows queue depth, running, dead letters with retry, per-kind limits.

### 15.4 Dynamic check types
- A custom field DSL validated by a zod meta-schema in `src/domain/check-types/schema.ts`: field `key`, `label`, `type` (`text, textarea, number, date, date_range, select, multi_select, boolean, phone, email, nic, address, repeatable_group`), `required`, `help`, `options`, `validation`, `visibility {client, report, candidate}`, `fill_by [staff|candidate|client]`, `ai {extract, hint, from_categories}`, nested `fields` + `group {min, max, item_label}` for repeatable groups. The check type also declares `documents[]` (category, label, description, example_image, min, max, accepted_from, accepted_mime, required_by_stage, client_visible_default), `result.options`, `report.blocks`, `sla_days`, `outreach`, `location_bound` (for regional assignment) and optional `fixed_annexure { category, untouched: true }` (Global Sanction).
- Employment = repeatable group (min 1), Reference = repeatable group (min 2, max 2), `nic` validates both the old 9-digit + V/X and new 12-digit formats and derives DOB and gender for the consistency check.
- `buildZod(fields, audience)` produces the validator at runtime (memoised per version id) for both `react-hook-form` (`zodResolver`) and the `saveCheckValues` action; `values_meta` records source (`manual | ai | candidate | client`), confidence and who confirmed. The candidate page renders only `fill_by` candidate fields that staff have requested.
- `<DynamicForm>` maps types to shadcn fields (`PhoneInput` +94 default, `NicInput`, `AddressFields` with district and GN division, `RepeatableGroup` via `useFieldArray` + dnd-kit) and renders AI suggestions as ghost values with Accept.
- Report blocks: `heading | kv | table | paragraph (with {{key}} interpolation and a tiny when-expression) | result_badge | remarks | evidence`. `renderReportBlocks()` is pure with two targets: react-pdf primitives in the worker and HTML for the web preview and portal. Only `visibility.report` fields render.
- Versioning: edit a draft, Publish validates and bumps `check_type_versions`; `case_checks.check_type_version_id` is stamped at case creation and never changes implicitly; an explicit `migrateCaseCheck` action diffs keys and archives removed values. The 7 built-in types ship as data in the seed, editable like any custom type.

### 15.5 AI service layer
`src/lib/ai/claude.ts` (Anthropic SDK singleton, usage recording, pricing from `ai_cost_rates`, budget checks), `models.ts` (capability → model, effort, max tokens; overridable in Settings), `prompts/` (versioned builders), `tool-registry.ts` + `tools-*.ts` (merged modules with a duplicate-name check; tools receive the caller's RLS client and must answer in under 1.5 seconds; outbound tools return confirm cards, and a separate `confirmAssistantAction` Server Action performs the write after re-checking permission), `tools-command/*` (the Super Admin set), `usage-sink.ts`. The assistant route `POST /api/assistant/chat` streams SSE using `client.beta.messages.toolRunner` with `max_iterations` 4 (staff) or 6 (command), a cached system prompt, `eager_input_streaming` on tools, and a 22-second wall budget; when the budget is hit it says so, enqueues `assistant.task`, and the worker finishes with read-only tools under a service-role client filtered by the stored viewer scope, inserting the reply into `assistant_messages` for Realtime delivery. The quotation drafter streams structured output over `POST /api/ai/draft-document` into the builder form field by field. `src/lib/stt/provider.ts` wraps transcription (browser Web Speech API first; server provider for recorded notes).

### 15.6 UI stack
Tailwind v4 (keep the existing Turbopack loader; `shadcn init` writes its CSS variables into `globals.css` with no PostCSS config; fall back to `@tailwindcss/postcss` only if a build path breaks), shadcn/ui on Radix with class-based dark mode via `next-themes`, lucide-react, cmdk, sonner, TanStack Table, react-hook-form + `@hookform/resolvers` + zod 4 (direct dependency), `nuqs` for typed URL filters, dnd-kit, recharts, date-fns + date-fns-tz (Asia/Colombo SLA maths), react-day-picker, libphonenumber-js, `react-signature-canvas` for consent and quote acceptance, MediaRecorder for voice notes. Design tokens: Ontriq navy primary (from the flowchart header), semantic status colours (slate / blue / amber / green / red), Geist fonts already present. Density like Linear: 13–14 px tables, generous whitespace in detail views, side panels for quick looks, empty states and skeletons everywhere. `<Activity>` keeps 3 routes mounted, so dialogs derive from the URL, dropdowns close in effect cleanup, forms reset on submit, and logout uses `window.location.href`.

### 15.7 PDF, email, SMS, speech
- `@react-pdf/renderer` + `pdf-lib` run only in `document.render` and `report.render` jobs under `src/jobs/documents/` and `src/jobs/report/` (`build-body.tsx`, `assemble.ts`, shared `fonts/`). `netlify.toml`: `included_files = ["src/jobs/fonts/*.ttf"]`, `external_node_modules = ["@react-pdf/renderer"]`, `node_bundler = "esbuild"`; `job_kind_limits('report.render') = 1`, `('document.render') = 2`; cap evidence at 60 pages / 150 MB; no `sharp`, no headless browser. `next.config.ts` adds `serverExternalPackages: ['@react-pdf/renderer', 'pdf-lib']`.
- Resend with React Email templates and the Svix-verified webhook; Notify.lk SMS behind the provider interface; `qrcode` for the verification QR; speech-to-text behind `src/lib/stt/provider.ts` (Web Speech API in the browser, a hosted Whisper-class provider for uploaded notes, chosen at build time for price).

### 15.8 Hosting, environment, CI
- `netlify.toml`: Node 22, the two functions above, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set so action ids stay stable across instances. Preview deploy per branch. Background Functions require a paid Netlify plan, which is why hosting sits under your maintenance plan (§18).
- Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (tests), `ANTHROPIC_API_KEY`, `STT_PROVIDER`, `STT_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `NOTIFYLK_USER_ID`, `NOTIFYLK_API_KEY`, `JOBS_WORKER_SECRET`, `CRON_SECRET`, `CANDIDATE_SESSION_SECRET`, `APP_ORIGIN`.
- GitHub Actions: `tsc`, `vitest`, `eslint`, `next build`, `db:types` staleness check, `docs:cost` build, Playwright smoke against the preview URL. `/api/health` checks DB and tick freshness.

---

## 16. Repository layout, migrations per feature, dependencies

```
src/
  proxy.ts
  app/
    layout.tsx  globals.css  error.tsx  global-error.tsx  not-found.tsx
    (auth)/login  (auth)/mfa  (auth)/auth/callback/route.ts  (auth)/auth/accept-invite  (auth)/forgot-password
    (public)/verify/[id]/page.tsx
    (staff)/app/layout.tsx            # frame + <Suspense><StaffNav/></Suspense> + AuthGate
    (staff)/app/page.tsx              # dashboard regions
    (staff)/app/command/              # Super Admin assistant (page + actions)
    (staff)/app/cases/{page,loading}.tsx  cases-view.tsx  actions.ts  new/
    (staff)/app/cases/[caseId]/page.tsx  case-header.tsx  case-checks.tsx  case-documents.tsx  case-candidate-link.tsx  case-billing.tsx  case-timeline.tsx  actions.ts
    (staff)/app/cases/[caseId]/checks/[checkId]/   report/
    (staff)/app/queues/{checks,pre-qc,post-qc,approvals,returned,manager,candidate-requests}/
    (staff)/app/clients/  clients/new/ (wizard)  clients/[clientId]/{page,packages,quotes,invoices,users}/
    (staff)/app/quotes/  quotes/[quoteId]/ (two-pane builder)  invoices/  invoices/[invoiceId]/  payments/
    (staff)/app/candidates/  candidates/[candidateId]/  inbox/  tasks/  reports/  analytics/  audit/  jobs/
    (staff)/app/team/{page,performance,roles,skills}/
    (staff)/app/settings/{org,branding,document-templates,check-types,packages,request-templates,candidate-link,statuses,assignment,sla,billing,numbering,templates,ai,ai/usage,retention}/
    (client)/portal/layout.tsx  page.tsx  cases/  cases/[caseId]/  cases/new/  packages/  templates/  quotes/  quotes/[quoteId]/  invoices/  invoices/[invoiceId]/  reports/  users/  settings/
    (candidate)/c/[token]/page.tsx  c/session/{page,actions}.ts(x)  c/session/{guide,timeline,requests,consent,messages}.tsx  c/done/
    api/assistant/chat/route.ts  api/assistant/confirm/route.ts  api/assistant/voice/route.ts  api/ai/draft-document/route.ts
    api/files/[documentId]/route.ts  api/reports/[versionId]/download/route.ts  api/documents/[generatedId]/download/route.ts
    api/candidate/realtime/route.ts  api/jobs/tick/route.ts  api/webhooks/resend/route.ts  api/health/route.ts
  components/ui/*  components/{layout,command,forms,dynamic-form,tables,cases,documents,reports,quotes,invoices,portal,candidate,assistant,voice,performance,charts}/
  domain/                             # pure, isomorphic, vitest; NO next/*, NO server-only
    permissions.ts  check-types/{schema,build-zod,report-blocks,seed}.ts  workflow/{stages,transitions}-core.ts
    reports/compile-core.ts  documents/{model,templates/{executive,modern,classic},render,consent-form}.ts  pricing/{quote,invoice,tax}-core.ts
    assignment/assignment-core.ts  performance/score-core.ts  ai/{pricing-core,cost-model}.ts  sla-core.ts  nic-core.ts  search/parse-query-core.ts  reminders-core.ts  candidate/requests-core.ts
  lib/
    supabase/{client,server,admin}.ts  supabase/database.types.ts (generated)
    server/{viewer,errors,action-result,cron-auth,notify}.ts  server/{cases,checks,documents,candidate,reports,clients,packages,quotes,invoices,payments,assignment,performance,jobs,assistant}/
    ai/{claude,models,tool-registry,tools-cases,tools-documents,tools-money,tools-team,tools-nav,usage-sink}.ts  ai/tools-command/*.ts  ai/prompts/
    stt/{provider,web-speech,hosted}.ts  email/{resend,templates}/  sms/{provider,notifylk}.ts  utils/
  hooks/{use-realtime-sync,use-viewer,use-hotkeys,use-voice-recorder}.ts
  jobs/                               # bundled by Netlify; plain Node; relative imports only
    run-job.ts  admin-client.ts  fonts/
    handlers/{ai-classify,ai-extract,ai-consistency,ai-preqc,ai-outreach,ai-response,ai-postqc,ai-narrative,ai-slip-read,ai-consent-check,stt-transcribe,assistant-task,
              assign-auto,assign-rebalance,document-render,report-render,invoice-draft,invoice-reminders,email-send,sms-send,reminders,
              sla-scan,briefing,performance-rollup,nudge-auto,ai-budget-check,retention}.ts
    documents/{build,templates}.tsx  report/{build-body.tsx,assemble.ts}
netlify/functions/jobs-worker-background.mts  netlify/functions/jobs-sweeper.mts  netlify.toml
supabase/config.toml  supabase/migrations/  supabase/seed.sql  supabase/tests/
tests/e2e/*.spec.ts  vitest.config.mts  scripts/{ai-eval,build-cost-doc}.ts
docs/architecture.md  docs/runbook.md  docs/cost-and-feasibility.md  docs/Ontriq-CRM-Cost-and-Feasibility.pdf  docs/features/*.md
```

Route anatomy follows Arc AI: `page.tsx` (sync shell + Suspense regions) → async region components → `*-view.tsx` client component → `actions.ts` → optional `loading.tsx`.

### 16.1 One migration per feature
Each file is self-contained: its tables, enums, indexes, triggers, RLS policies, RPCs and `alter publication` lines. A feature can be skipped by omitting its file; dependencies are listed so you know what must precede it.

| File | Feature | Contains | Depends on |
|---|---|---|---|
| `0001_foundation.sql` | Tenancy, users, roles | extensions, `orgs`, `profiles`, `memberships`, `roles`, `permissions`, `role_permissions`, `invitations`, helper functions, `set_org_id()`, `set_updated_at()`, `my_membership()` | — |
| `0002_audit.sql` | Audit trail | `audit_log`, `log_row_change()` trigger, `system_events`, `rate_limit_hits`, `rate_limit_check` | 0001 |
| `0003_clients.sql` | Clients | `clients`, `client_contacts`, `client_settings`, `client_check_type_access` | 0001 |
| `0004_check_types.sql` | Check type builder | `document_categories`, `check_types`, `check_type_versions` (immutability trigger) | 0001 |
| `0005_packages_templates.sql` | Packages and request templates | `packages`, `package_items`, `package_client_visibility`, `request_templates` | 0003, 0004 |
| `0006_cases.sql` | Case engine | `candidates`, `cases`, `case_counters`, `next_case_number`, `case_checks`, `case_check_internal`, `case_check_requirements`, `stage_history`, `case_events`, `client_status_catalog`, `case_transition()` | 0003, 0004, 0005 |
| `0007_documents.sql` | Documents and evidence | `documents`, `document_texts`, `document_ai`, buckets `case-files`/`reports`/`documents`/`org-assets`, requirement-count trigger | 0006 |
| `0008_candidate_link.sql` | Candidate public link | `candidate_links`, `candidate_requests`, `candidate_messages`, `consent_forms`, `candidate_link_view()` | 0006, 0007 |
| `0009_jobs.sql` | Background jobs | `jobs`, `job_kind_limits`, `job_failures`, `job_workers`, six job RPCs | 0001 |
| `0010_notifications_comms.sql` | Notifications, email, SMS, tasks | `notifications`, `notification_prefs`, `email_outbox`, `sms_outbox`, `communications`, `templates`, `tasks` | 0001 |
| `0011_qc.sql` | Pre-QC and Post-QC | `qc_reviews` | 0006 |
| `0012_reports.sql` | Final report | `report_versions`, `report_recipients`, `report_downloads` | 0006, 0007 |
| `0013_document_system.sql` | Branding, templates, numbering | `document_templates`, `document_counters`, `next_document_number()`, `generated_documents`, `org_settings.branding` | 0001 |
| `0014_quotations.sql` | Quotations | `quotes`, `quote_items`, `quote_tiers`, `quote_events`, `client_price_lists` | 0003, 0005, 0013 |
| `0015_invoices_payments.sql` | Invoicing and payments | `invoices`, `invoice_items`, `payments`, `payment_slips`, `credit_notes`, `invoice_reminders`, `tax_rates`, `client_balance()` | 0003, 0006, 0013 |
| `0016_assignment.sql` | Auto-assignment | `staff_skills`, `staff_capacity`, `staff_availability`, `assignment_rules`, `assignment_events`, `staff_load_snapshot()` | 0001, 0006 |
| `0017_performance_nudges.sql` | Staff performance and nudges | `staff_performance_daily`, `nudges` | 0016 |
| `0018_ai.sql` | AI layer and cost ledger | `ai_runs`, `ai_suggestions`, `ai_cost_rates`, `ai_budgets`, `ai_batches`, `ai_cost_summary()` | 0001 |
| `0019_assistant.sql` | Ask Ontriq assistant | `assistant_threads`, `assistant_messages`, `assistant_actions`, `assistant_memories` | 0018 |
| `0020_super_assistant.sql` | Super Admin command assistant and voice | `assistant_voice_notes`, command allow-listed settings, extra policies | 0019 |
| `0021_portal_views.sql` | Client portal | `portal_cases`, `portal_case_checks`, `portal_documents`, `portal_quotes`, `portal_invoices`, `portal_case_detail()` | 0006, 0007, 0014, 0015 |
| `0022_search.sql` | Global search | generated columns, GIN indexes, `search_everything()` | 0003, 0006, 0007, 0014, 0015 |
| `0023_realtime_views_settings.sql` | Live updates, saved views, SLA | publication, `saved_views`, `sla_policies`, `org_settings` defaults | all above |
| `0024_seed_catalog.sql` | Catalog data | permission catalog, system roles, 7 check types v1, 3 packages, status catalog, document categories with guide texts, 3 document templates, consent form template, tax rates, AI cost rates and routing defaults, job kind limits, default assignment rules | all above |

### 16.2 Dependencies
Runtime: `@supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod resend @react-email/components @react-pdf/renderer pdf-lib qrcode date-fns date-fns-tz libphonenumber-js server-only sonner cmdk lucide-react @tanstack/react-table react-hook-form @hookform/resolvers @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities next-themes class-variance-authority clsx tailwind-merge radix-ui tw-animate-css nuqs recharts react-day-picker react-signature-canvas p-limit` plus the chosen speech-to-text SDK.
Dev: `supabase @netlify/functions vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @playwright/test @types/qrcode`.
Not used: `@tanstack/react-query` (RSC + Realtime refresh covers it), `sharp`, any headless browser.

---

## 17. Delivery phases

Estimates assume one senior engineer working with Claude Code full time. Staff can use it internally at the end of Phase 1; clients can be onboarded with quotes and invoices at the end of Phase 3; the full product lands at the end of Phase 5.

### Phase 0: Foundation and the cost document (week 1)
- Install dependencies, `shadcn init`, design tokens, dark mode, AppFrame, nav config, ⌘K shell, empty states, skeleton primitives.
- Supabase project, migrations 0001, 0002, 0003, 0009, 0010, 0013, 0018; seed super admin.
- `@supabase/ssr` clients, `src/proxy.ts`, `viewer.ts` DAL, login, MFA enrolment and challenge, invite acceptance, password reset.
- `netlify.toml`, first deploy, CI pipeline, `/api/health`, `db:types` script, worker and sweeper skeleton with `email.send`.
- **Cost and Feasibility document v1**: `src/domain/ai/cost-model.ts` (the assumptions and formulas), `docs/cost-and-feasibility.md`, `scripts/build-cost-doc.ts` rendering the PDF with the Executive template, `npm run docs:cost`. Delivered to Ontriq at the end of the week.
- Three spikes: (1) measure the real Netlify cut-off for a streamed route on this site; (2) render a react-pdf page with Sinhala and Tamil names inside a background function and inspect shaping; (3) confirm `uploadToSignedUrl` + `finalizeUpload` round trip.
Done when: a preview deploy lets the super admin log in with MFA, invite an admin and a manager, send a test email through the outbox; a pgTAP script proves a client user cannot read another client's rows; the cost PDF builds from the model.

### Phase 1: Case engine, packages, auto-assignment (weeks 2–4)
- Migrations 0004–0007, 0011, 0016, 0022, 0023, 0024. Check type builder with the 7 seeded types, draft → publish versioning.
- Org packages and request templates with the picker; clients and candidates (NIC dedupe); case creation wizard (template → client → candidate → process type → package snapshot → checks spawned, reference from `next_case_number`).
- Auto-assignment v1: skills, capacity, availability, `least_loaded` strategy, explanations, notifications, My work highlighting, manual reassign, manager queue.
- Cases table and kanban, saved views, bulk assign, case detail regions, `<DynamicForm>` from the schema, tasks.
- Documents: signed upload, viewer, versions, visibility, request missing, document requests to clients, `case_check_requirements`.
- Workflow engine with guards, stage history, return loops, on hold; Pre-QC and Post-QC review screens with checklists and decisions.
- Notifications (in-app + email outbox), activity timeline, audit log viewer, `search_everything` + palette with permission-gated actions.
Done when: both process types run end to end on seeded data by hand with cases auto-landing on the right officer; vitest covers transitions, roll-ups, `buildZod`, NIC parsing and `assignment-core`; pgTAP covers staff roles.

### Phase 2: Portals and the candidate link (weeks 5–6)
- Migrations 0008, 0021. Client portal: creating a client provisions its first client admin and sends the invite; dashboard, cases, per-check client labels, pending actions with uploads, New request with the template picker (CV upload pre-fill, bulk CSV), client-built packages and request templates with live pricing, reports library, team, notification preferences; everything through `portal_*` views.
- Visibility engine: defaults per check type, per-client overrides, server-side filtering in `portal_case_detail()`.
- Candidate public link: generation and sending, HMAC session, welcome and guide, live timeline, document slots with instant classification feedback, information requests and the "Ask candidate" composer, consent form (download-sign-upload with AI check, or e-sign), messages, reminders via the tick, Sinhala and Tamil strings, staff-side panel.
Done when: a client admin invited from the app logs in, builds a named package, submits a request from a template and sees only their cases; a candidate on a phone-width viewport opens the link, follows the timeline, answers a staff request, uploads every document and a photographed signed consent; reminders fire in a test schedule.

### Phase 3: Documents and money (weeks 7–9)
- Migrations 0012, 0014, 0015. AI foundation live: `claude.ts`, ledger priced from `ai_cost_rates`, budgets, kill switches, Settings → AI → Usage dashboard (needed by the quotation drafter and to validate the cost document).
- Document system: the three templates with HTML and PDF targets, branding settings page with live previews, numbering series, `document.render` job, consent form template.
- Reports: compile snapshot, react-pdf body with embedded Noto fonts, DRAFT watermark draft job, approval with snapshot hash check and explicit final result, final job with `pdf-lib` annexures and the untouched Global Sanction PDF, SHA-256 + QR, `/verify/[id]`, release, download route with audit, revisions, archive page.
- Quotations: onboarding wizard step, two-pane builder with Draft with AI (streaming), versions, confirm, PDF, send, portal acceptance with e-signature, price list update.
- Invoicing: billing policies, per-case and monthly drafts, two-pane confirm, PDF, send, payments, slip upload with AI reading and match confirmation, reminder ladder, credit notes, statements, billing export, portal invoice pages.
Done when: a seeded case with all 7 checks and a sample sanction PDF produces a report that opens cleanly in Preview, Acrobat and Chrome and verifies by hash; a new client is onboarded with an AI-drafted quote accepted in the portal; releasing a case produces an invoice the client can download, pay by slip, and see matched; the usage dashboard shows the real cost of each of those steps.

### Phase 4: AI layer, command assistant, performance and nudges (weeks 10–13)
- Migrations 0017, 0019, 0020. Capabilities 1–4 (classification, extraction with the side-by-side review UI, consistency, Pre-QC copilot), then 5–8 (outreach, response capture, Post-QC cross-check, narrative), then 9 (Ask Ontriq with the tool registry, confirm cards, streaming panel, job hand-off), then 11–14 (SLA radar and briefing, candidate guide, portal explainer, tamper and duplicate signals).
- Super Admin command assistant: Command page, full tool set across every module, confirm cards with undo, bulk action cards, voice notes (recorder, upload, transcription adapter, transcript review), memories, morning summary, budget caps.
- Performance rollups, leaderboard and scorecards, workload heatmap, Push nudges with AI drafting, auto-nudge rule, Rebalance proposals, `performance_weighted` strategy.
- Evaluation set: 30 sample documents (NICs, O/L and A/L certificates, service letters, GN certificates, police reports, payment slips, signed consent photos) with expected extractions, run by `scripts/ai-eval.ts` reporting field-level accuracy and cost per document; the cost document is refreshed with measured numbers (v2).
Done when: a Type 1 case goes from upload to a drafted report with every AI suggestion visible and confirmable, no AI write happens without a human action or an explicit policy, the ledger shows cost per case within the document's estimates, a manager can see the leaderboard and push a nudge that the officer acknowledges, and the Super Admin can say "show me all unpaid invoices" and "create a client" by voice and confirm the result.

### Phase 5: Polish and scale (weeks 14–16)
- Analytics dashboards (operations, revenue, AI cost per case), bulk case import, exports, keyboard shortcuts, mobile and dark-mode QA, performance pass (indexes, pagination, `next start` prefetch validation), security hardening (MFA enforcement, retention purge, erasure flow, rate limits, dependency audit), docs (`docs/features/*.md`, runbook), UAT with Ontriq, training material, go-live checklist, cost document v3 with the go-live plan choices.
Done when: the Playwright smoke suite passes on the preview deploy and Ontriq signs off UAT.

### Phase 6 (optional, after launch)
Any of the suggestions in §19 that Ontriq picks, client REST API and webhooks, WhatsApp channel, Resend inbound email into case threads, online payments (PayHere), semantic search over OCR text and notes (pgvector), tenant admin UI, pgmq/pg_cron if the sweeper cost matters.

---

## 18. Cost model and the Cost and Feasibility document

### 18.1 The deliverable
A client-facing PDF, `docs/Ontriq-CRM-Cost-and-Feasibility.pdf`, rendered with the Executive template from one source of truth, `src/domain/ai/cost-model.ts`, so every number is computed from stated assumptions rather than typed by hand. Sections: executive summary; how AI is used and the budget-first routing; cost per task; cost per case by package; cost per client onboarding; monthly scenarios; hosting and services; your maintenance plan; feasibility and savings; assumptions and how to re-run the numbers. Built by `npm run docs:cost`, versioned (v1 in week 1 from estimates, v2 in Phase 4 from measured `ai_runs`, v3 at go-live), and mirrored by the in-app Settings → AI → Usage dashboard so Ontriq can compare the plan with actuals at any time.

### 18.2 Model prices used (Anthropic list prices, per million tokens, as cached in this session on 2026-10-06; re-verify on the pricing page before each document version)
| Model | Input | Output | Cache read | Use |
|---|---|---|---|---|
| `claude-haiku-5-5` | $0.10 | $0.50 | ≈ $0.01 | Light tasks (prompts ≤ 100K tokens; $0.50 / $2.50 beyond) |
| `claude-sonnet-5-5` | $2.00 | $10.00 | $0.20 | Everyday extraction and drafting |
| `claude-opus-5-5` | $4.00 | $20.00 | $0.20 | Post-QC cross-check, Super Admin command assistant |
Message Batches halve input and output prices for non-urgent work. Cache writes cost 1.25 × input.

### 18.3 Cost per task (planning estimates; token counts assume typical Sri Lankan documents of 1–2 pages at about 1,600 image tokens per page)
| Task | Model | Tokens in / out (approx.) | Estimated cost |
|---|---|---|---|
| Classify, quality-check and OCR one page | Haiku | 2,200 / 950 | $0.001 |
| Extract fields for one check (3 pages + cached schema) | Sonnet | 5,000 + 2,500 cached / 700 | $0.02 |
| Consistency check for a case | Sonnet | 12,000 / 1,000 | $0.03 |
| Pre-QC copilot for a case | Sonnet | 8,000 / 1,200 | $0.03 |
| Outreach draft for one check | Sonnet | 3,000 / 500 | $0.01 |
| Response capture for one check | Sonnet | 4,000 / 500 | $0.013 |
| Post-QC cross-check for a case | Opus, high | 25,000 / 6,000 incl. thinking | $0.22 (Sonnet option $0.09) |
| Report narrative for a case | Sonnet | 15,000 / 3,000 | $0.06 |
| Tamper and duplicate signals | Haiku + rules | 6,000 / 300 | $0.005 |
| Candidate upload guidance (per upload) | Haiku | 2,000 / 100 | $0.0003 |
| Quotation draft (one pass) | Sonnet | 6,000 / 2,500 | $0.04 |
| Cover email | Haiku | 1,500 / 300 | $0.001 |
| Payment slip reading | Haiku | 2,000 / 150 | $0.0005 |
| Nudge draft | Haiku | 1,500 / 300 | $0.001 |
| Staff assistant turn | Sonnet, low | 8,000 (half cached) / 800 | $0.02 |
| Super Admin command turn | Opus, low | 12,000 (a third cached) / 1,500 | $0.08 |
| Voice note transcription (per minute) | Hosted STT | — | $0.003–0.006 |
| Daily briefing | Sonnet | 10,000 / 1,000 | $0.04 per day |
| SLA scans, assignment, performance rollups | Rules | — | $0 |

### 18.4 Cost per case and per client onboarding
| Scenario | What runs | Estimated AI cost |
|---|---|---|
| Comprehensive case (7 checks, ~12 pages, all AI steps, Opus Post-QC) | 12 × classify + 7 × extract + consistency + Pre-QC + 7 × outreach + 7 × response + Post-QC + narrative + signals + guidance | **≈ $0.65** |
| Same with Sonnet for Post-QC | | ≈ $0.52 |
| Standard case (3 checks, ~6 pages) | | **≈ $0.30** |
| Client onboarding with AI quotation (two regenerations, cover email) | | **≈ $0.10** |
| Invoice (rules, cover email, one slip read) | | ≈ $0.002 |
| Super Admin assistant, 200 turns a month with 30 voice minutes | | ≈ $16 + $0.15 |
| Staff assistant, 500 turns a month | | ≈ $10 |
| Briefings and automation, per month | | ≈ $2 |

### 18.5 Monthly scenarios (AI plus services, USD)
| Line | Starter: 50 cases | Growth: 200 cases | Scale: 600 cases |
|---|---|---|---|
| AI for cases (mix of standard and comprehensive, ≈ $0.50 average) | $25 | $100 | $300 |
| Assistants, briefings, drafting | $15 | $28 | $45 |
| Netlify Pro (Background Functions for the AI jobs and PDF rendering need a paid plan; one team member, ≈ $19–20 a month at today's pricing) | $19 | $19 | $19 |
| Supabase (Free until the 500 MB database or 1 GB file storage limit; Pro $25 a month with 8 GB database, 100 GB storage, daily backups and no project pausing) | $0 → $25 | $25 | $25 + compute add-on if needed ($10–60) |
| Resend email (3,000 free a month, then $20) | $0 | $0–20 | $20 |
| SMS via Notify.lk (per message, local rates, volume-dependent) | per use | per use | per use |
| Speech-to-text for voice notes | $0.15 | $0.30 | $0.50 |
| Domain and SSL | ≈ $1.50 | ≈ $1.50 | ≈ $1.50 |
| **Platform total (before your maintenance plan)** | **≈ $60–85** | **≈ $175–195** | **≈ $410–470** |
| Hosting, monitoring, updates and support under your maintenance plan | to be set by you | to be set by you | to be set by you |

Notes the document will state plainly: file storage, not the database, is what pushes Supabase to Pro first (each case stores roughly 5–10 MB of images and PDFs, so 100 cases a month fill the free 1 GB in about two months); a production system holding candidates' personal data should run on Supabase Pro from go-live for daily backups and no pausing; Netlify's free tier cannot run the background jobs this system depends on, which is why hosting is bundled into your maintenance plan; prompt caching and Batches can cut the AI line by 20–40 % once volumes justify tuning; every vendor price is re-verified when each version of the document is produced.

### 18.6 Feasibility argument
AI cost per case stays under one US dollar at list prices. Against a typical per-candidate verification fee it is a small single-digit percentage (the document shows the exact percentage from Ontriq's own fee, entered as an assumption). Time saved per comprehensive case, estimated from the capabilities (data entry 15 → 4 minutes, Pre-QC 20 → 8, outreach drafting 10 → 2 per check, response capture 8 → 3 per check, report writing 45 → 10, candidate chasing 20 → 2): about 2–3 staff hours per case, which at Ontriq's loaded hourly cost is worth many times the AI spend. The document presents this as a table Ontriq can adjust, plus the non-monetary gains: faster TAT, fewer QC returns, fewer missed discrepancies, and client self-service that removes status calls.

---

## 19. Suggested additional features (optional, for you to pick)

Not in scope until you choose them; each fits the data model above and lands as its own migration.

| Suggestion | Why it fits | Effort |
|---|---|---|
| Verification source directory | A knowledge base of institutions, employers, police stations and GN offices with verified contacts, preferred channels, response times and success rates; the outreach drafter picks the right contact and learns from outcomes. Biggest lever on verification TAT | 1 week |
| Digital reference questionnaire | Referees get a secure link with a structured, multilingual questionnaire instead of phone tag; AI summarises answers into the check; reminders built in | 4 days |
| WhatsApp channel | Candidates and clients send documents and receive updates on WhatsApp (Meta Cloud API, as in Arc AI); the system files media to the right case and slot | 1 week |
| Inbound email intelligence | Replies from universities and employers land in the case thread through Resend inbound; AI extracts the confirmation and triggers response capture automatically | 4 days |
| Field verification mobile mode | A phone-first screen for address and police checks: GPS-stamped photos, GN officer signature capture, offline-tolerant PWA | 1 week |
| Monthly client performance report | Automated PDF per client (volumes, TAT, result mix, pending actions) emailed on the 1st; strong retention tool | 3 days |
| Bulk Excel round-trip | Clients upload a spreadsheet of candidates; the system creates cases, sends candidate links and returns a live tracker export | 3 days |
| HRIS/ATS API and webhooks | Clients push candidates from their ATS and receive status and report events; needed by larger clients | 1 week |
| Fraud intelligence registry | Institutions and employers with past discrepancies, candidate cross-client conflict detection, pattern alerts, with privacy controls | 1 week |
| Digital signature on reports | PAdES signature with Ontriq's certificate on top of the hash so reports are tamper-evident in any PDF reader | 3 days |
| Internal comments with @mentions | Case-level discussion threads with mentions and notifications (Arc AI pattern) | 2 days |
| Staff mobile PWA with push | Web-push for assignments, nudges and candidate submissions; installable on phones | 3 days |
| Automatic time tracking and profitability | Minutes per check from activity, cost per check vs price, package profitability, AI pricing suggestions per client | 1 week |
| Public "request a quote" page | New prospective clients request a quote; the AI drafts it, Client Relations approves, the portal account is created on acceptance | 3 days |
| SOP assistant | Ontriq's standard operating procedures as a searchable knowledge base the assistants cite ("how do we verify an O/L certificate") | 3 days |
| Operations anomaly alerts | TAT spikes, officer inactivity, unusual document rejection or discrepancy rates flagged by rules and summarised by AI | 2 days |

---

## 20. Verification

- Local: `npm run dev` (launch config `next-dev`) against the hosted Supabase project with `npm run db:seed`; browser checks through the in-app preview at each phase; `next start` for instant-navigation checks (prefetching is production-only).
- Automated: `vitest` for everything in `src/domain/**` (transitions, roll-ups, `buildZod`, report compile, report blocks, document rendering model, quote and invoice pricing with taxes, assignment scoring, performance scoring, candidate request rules, the cost model's arithmetic, prompt builders, reminder cadence, NIC parsing, AI pricing); pgTAP RLS tests under `supabase/tests/` run with `psql "$SUPABASE_DB_URL" -f` against the hosted project (Docker is not installed here, so `supabase test db` is not used), each test impersonating staff, client and anonymous JWTs via `set role` + `request.jwt.claims`; Playwright smoke suite (login with MFA, onboard client with AI quote, accept quote in portal, create case from template, auto-assignment lands, candidate link with request answer and consent photo, upload, Pre-QC approve, verify check, Post-QC approve, draft and release report, invoice generated, client download and slip upload, push nudge, Super Admin command "show unpaid invoices" and "create client" with confirmation) against preview deploys in CI. Async Server Components are not unit-tested; routes are covered end to end.
- AI: `scripts/ai-eval.ts` against the sample document set, with field-level accuracy and cost per document; quotation drafts checked for "no invented prices" by asserting every line price equals a price-list or list value; measured `ai_runs` costs compared with the cost document's estimates per capability, and the document regenerated when they drift.
- Operational: `/api/health`, Settings → Jobs (queue depth, dead letters), Settings → AI → Usage (actuals vs plan, budget state).
- Tooling present on this machine: Supabase CLI 2.121, Netlify CLI 27.14, gh, psql 16, Node 24.15, npm 11.12. No Docker, so the Supabase project is hosted and migrations are applied with `supabase db push`.

---

## 21. Risks and gotchas

| Risk | Mitigation |
|---|---|
| Cache Components build errors: `cookies()` outside Suspense, `Date.now()`/`Math.random()` during prerender (even with `instant = false`), runtime promises passed into `use cache`, `useSearchParams()` without Suspense | DAL pattern, sync layouts and pages with explicit Suspense regions, `connection()`/`io()` for time, `instant = false` per segment while a route is built |
| Netlify synchronous and streaming limits (docs and forum reports disagree: 10 s for streamed responses in older docs, a 30 s hard cut reported in 2026, 60 s claimed elsewhere) | Everything heavier than a form submit runs in the background worker; assistant and drafter turns capped at 22 seconds; the Phase 0 spike measures the real cut-off on this site and, if it is 10 s, streaming falls back to job-plus-Realtime delivery |
| `use cache` does not persist across serverless requests on Netlify | Treat it as shell and prefetch optimisation only; indexes and RPCs carry database load |
| Server Action 1 MB body limit; sequential action dispatch; action ids rotate on deploy | Direct-to-Storage signed uploads; batch inside one action; surface "Failed to find Server Action" as a retry; stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` |
| react-pdf complex-script shaping for Sinhala and Tamil; function bundle size and memory | Week 1 spike; English prose fallback; fonts via `included_files`, react-pdf external to esbuild, limited render concurrency, evidence caps, images downsized at upload, no `sharp` |
| AI invents prices, results or assignees | Prices come only from price lists; results and assignees come from rules or humans; `ai-eval` asserts it; prompts state it; UI never auto-applies those fields |
| The command assistant's reach | Super Admin only, RLS client not service role, confirm cards for every write, bulk cards list every item, no deletes, undo window, full action log, daily caps, tools limited to 1.5 s each |
| Voice recognition quality, especially Sinhala and Tamil | Transcript shown for review before sending (preference), language chosen per note, hosted provider swappable behind the adapter, text input always available |
| Cost estimates drift from reality | One computed model, measured `ai_runs` compared per capability, document regenerated per version, budgets and alerts in production |
| Tax and numbering rules (VAT, SSCL, gapless invoice numbers) | Configurable `tax_rates`; `next_document_number` under a row lock; void instead of delete |
| Perceived unfairness of auto-assignment; nudges felt as punitive | Every assignment carries an explanation and can be overridden; weights are visible; nudges are drafted constructively, manager-edited, logged and visible on the performance page |
| Candidate page exposes too much | `candidate_link_view()` projects only candidate-safe fields and events; no results, notes or client data ever reach it; pgTAP tests assert the projection |
| Worker code accidentally importing `next/*` or `server-only` | `src/jobs` and `src/domain` only; an ESLint `no-restricted-imports` rule for those folders |
| PII sent to the model | Field-level minimisation, per-client opt-out, Anthropic data handling documented in the runbook, no PII in cache keys, titles or URLs |
| Candidate token leakage | Hashed at rest, 14-day expiry, single case, swapped for a 20-minute HMAC cookie so it leaves the URL, revoked on submit, rate-limited, every write re-verifies the link row |
| Clients and staff share the Postgres `authenticated` role | Audience-split tables (`case_check_internal`), `portal_*` security-definer views, no Storage policies, signed URLs minted only after RLS reads |
| `<Activity>` keeps 3 routes mounted | URL-derived dialog state, effect-cleanup for menus, form reset on submit, `window.location.href` on logout |
| Tailwind via the Turbopack loader is lightly documented | Switch to `@tailwindcss/postcss` if any build path breaks |
| Hand-written DB types drift | Types always generated; CI fails if `db:types` output differs |

---

## 22. Items to confirm with Ontriq (not blocking the build)

Exact status labels and client- and candidate-facing wording; SLA days per package; letterhead, logo, signature blocks, company registration and VAT numbers, bank details for the documents; the Global Sanction platform's export format; default client-visible fields per check; retention period; Notify.lk account and sending domain for Resend; which languages the candidate link must support at launch; whether report prose may stay in English with Sinhala/Tamil only for names and addresses; VAT and SSCL applicability and default payment terms; default quotation validity; whether client-built packages need Ontriq approval before first use; which staff roles are eligible for auto-assignment and their capacities; expected monthly case volume, average documents per case and the fee per case (for the feasibility percentage); whether to start on Supabase Free or Pro at go-live; the wording of the consent and authorisation form.
