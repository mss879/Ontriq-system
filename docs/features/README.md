# Features

Each feature is one migration file.

- [Tenancy, people, roles and permissions](0001-foundation.md) — `0001_foundation.sql`
- [Audit trail, system events, rate limiting](0002-audit.md) — `0002_audit.sql`
- [Clients](0003-clients.md) — `0003_clients.sql`
- [Check type builder](0004-check-types.md) — `0004_check_types.sql`
- [Packages and request templates](0005-packages-templates.md) — `0005_packages_templates.sql`
- [Case engine](0006-cases.md) — `0006_cases.sql`
- [Documents and evidence](0007-documents.md) — `0007_documents.sql`
- [Candidate link](0008-candidate-link.md) — `0008_candidate_link.sql`
- [Background jobs](0009-jobs.md) — `0009_jobs.sql`
- [Notifications, email, SMS, tasks](0010-notifications-comms.md) — `0010_notifications_comms.sql`
- [Pre-QC and Post-QC](0011-qc.md) — `0011_qc.sql`
- [Final reports](0012-reports.md) — `0012_reports.sql`
- [Document templates, numbering, generated PDFs](0013-document-system.md) — `0013_document_system.sql`
- [Quotations and contracted prices](0014-quotations.md) — `0014_quotations.sql`
- [Invoices and payments](0015-invoices-payments.md) — `0015_invoices_payments.sql`
- [Auto-assignment](0016-assignment.md) — `0016_assignment.sql`
- [Staff performance and nudges](0017-performance-nudges.md) — `0017_performance_nudges.sql`
- [AI routing and cost ledger](0018-ai.md) — `0018_ai.sql`
- [Ask Ontriq (staff assistant)](0019-assistant.md) — `0019_assistant.sql`
- [Command assistant and voice notes](0020-super-assistant.md) — `0020_super_assistant.sql`
- [Client portal](0021-portal-views.md) — `0021_portal_views.sql`
- [Global search](0022-search.md) — `0022_search.sql`
- [Live updates and saved views](0023-realtime-views.md) — `0023_realtime_views_settings.sql`
- [Starting catalogue](0024-seed-catalog.md) — `0024_seed_catalog.sql`
- [Platform hardening](0025-hardening.md) — `0025_hardening.sql`
- [Ontriq brand defaults](0026-ontriq-brand.md) — `0026_ontriq_brand.sql`
- [Client package visibility fix](0027-packages-client-select.md) — `0027_packages_client_select.sql`
- Portal fixes (needs-action count, package approval guard) — `0028_portal_fixes.sql`
- [AI pipeline triggers and decisions](0029-ai-pipeline.md) — `0029_ai_pipeline.sql`
- [AI review permissions](0030-ai-review.md) — `0030_ai_review.sql`
- [Performance page and Push](0032-performance-ui.md) — `0032_performance_ui.sql`
- [Quotation fixes](0033-quote-fixes.md) — `0033_quote_fixes.sql`
- [Analytics and exports](0034-analytics.md) — `0034_analytics.sql`
- [Retention and erasure](0035-retention-erasure.md) — `0035_retention_erasure.sql`
- [Billing fixes](0036-billing-fixes.md) — `0036_billing_fixes.sql`
- [Report draft permissions](0037-report-permissions.md) — `0037_report_permissions.sql`
- [Security review fixes](0038-security-fixes.md) — `0038_security_fixes.sql`

## Notes from Phase 0

- `client_check_type_access` moved from 0003 to 0005 (it needs check types).
- Buckets are created with the feature that owns them: `documents` and `org-assets` in 0013; `case-files` and `reports` arrive with 0007.
- The permission catalog and system roles are seeded in 0001 (everything depends on them); 0024 seeds the rest of the catalog.
