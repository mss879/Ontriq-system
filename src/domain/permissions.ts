/**
 * Permission catalog, mirrored from supabase/migrations/0001_foundation.sql.
 * A test keeps the two in sync. Pure module: safe on server, client and worker.
 */

export const PERMISSION_GROUPS = {
  system: "System",
  cases: "Cases and checks",
  documents: "Documents and reports",
  clients: "Clients and catalog",
  commercial: "Quotations, invoices and payments",
  team: "Team",
  platform: "Platform",
  portal: "Client portal",
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

export type PermissionDef = {
  key: string;
  group: PermissionGroup;
  label: string;
  kind: "staff" | "client";
  grantable: boolean;
};

export const PERMISSIONS = [
  { key: "*", group: "system", label: "Everything", kind: "staff", grantable: false },
  { key: "cases.read", group: "cases", label: "View all cases", kind: "staff", grantable: true },
  { key: "cases.read_assigned", group: "cases", label: "View assigned cases", kind: "staff", grantable: true },
  { key: "cases.create", group: "cases", label: "Create cases", kind: "staff", grantable: true },
  { key: "cases.update", group: "cases", label: "Edit cases", kind: "staff", grantable: true },
  { key: "cases.assign", group: "cases", label: "Assign work", kind: "staff", grantable: true },
  { key: "cases.stage.change", group: "cases", label: "Move case stages", kind: "staff", grantable: true },
  { key: "cases.hold", group: "cases", label: "Hold cases", kind: "staff", grantable: true },
  { key: "cases.cancel", group: "cases", label: "Cancel cases", kind: "staff", grantable: true },
  { key: "checks.verify", group: "cases", label: "Verify checks", kind: "staff", grantable: true },
  { key: "checks.data_entry", group: "cases", label: "Data entry", kind: "staff", grantable: true },
  { key: "qc.pre", group: "cases", label: "Pre-QC review", kind: "staff", grantable: true },
  { key: "qc.post", group: "cases", label: "Post-QC review", kind: "staff", grantable: true },
  { key: "candidates.manage", group: "cases", label: "Manage candidates", kind: "staff", grantable: true },
  { key: "candidates.requests", group: "cases", label: "Ask candidates", kind: "staff", grantable: true },
  { key: "documents.read", group: "documents", label: "View documents", kind: "staff", grantable: true },
  { key: "documents.read_sensitive", group: "documents", label: "View sensitive evidence", kind: "staff", grantable: true },
  { key: "documents.manage_visibility", group: "documents", label: "Control visibility", kind: "staff", grantable: true },
  { key: "reports.preview", group: "documents", label: "Preview reports", kind: "staff", grantable: true },
  { key: "reports.approve", group: "documents", label: "Approve reports", kind: "staff", grantable: true },
  { key: "reports.release", group: "documents", label: "Release reports", kind: "staff", grantable: true },
  { key: "clients.read", group: "clients", label: "View clients", kind: "staff", grantable: true },
  { key: "clients.manage", group: "clients", label: "Manage clients", kind: "staff", grantable: true },
  { key: "packages.manage", group: "clients", label: "Manage packages", kind: "staff", grantable: true },
  { key: "check_types.manage", group: "clients", label: "Manage check types", kind: "staff", grantable: true },
  { key: "templates.manage", group: "clients", label: "Manage templates", kind: "staff", grantable: true },
  { key: "quotes.manage", group: "commercial", label: "Build quotations", kind: "staff", grantable: true },
  { key: "quotes.send", group: "commercial", label: "Send quotations", kind: "staff", grantable: true },
  { key: "invoices.manage", group: "commercial", label: "Manage invoices", kind: "staff", grantable: true },
  { key: "invoices.send", group: "commercial", label: "Send invoices", kind: "staff", grantable: true },
  { key: "payments.record", group: "commercial", label: "Record payments", kind: "staff", grantable: true },
  { key: "billing.export", group: "commercial", label: "Export billing", kind: "staff", grantable: true },
  { key: "users.manage", group: "team", label: "Manage users", kind: "staff", grantable: true },
  { key: "roles.manage", group: "team", label: "Manage roles", kind: "staff", grantable: true },
  { key: "assignment.configure", group: "team", label: "Configure assignment", kind: "staff", grantable: true },
  { key: "staff.performance.read", group: "team", label: "View performance", kind: "staff", grantable: true },
  { key: "staff.nudge", group: "team", label: "Push staff", kind: "staff", grantable: true },
  { key: "settings.manage", group: "platform", label: "Manage settings", kind: "staff", grantable: true },
  { key: "jobs.read", group: "platform", label: "View background jobs", kind: "staff", grantable: true },
  { key: "ai.assistant", group: "platform", label: "Use the AI assistant", kind: "staff", grantable: true },
  { key: "ai.configure", group: "platform", label: "Configure AI", kind: "staff", grantable: true },
  { key: "ai.usage.read", group: "platform", label: "View AI usage and cost", kind: "staff", grantable: true },
  { key: "ai.super_assistant", group: "platform", label: "Command assistant", kind: "staff", grantable: false },
  { key: "audit.read", group: "platform", label: "View audit log", kind: "staff", grantable: true },
  { key: "analytics.read", group: "platform", label: "View analytics", kind: "staff", grantable: true },
  { key: "portal.cases.read", group: "portal", label: "View cases", kind: "client", grantable: true },
  { key: "portal.cases.create", group: "portal", label: "Request verifications", kind: "client", grantable: true },
  { key: "portal.packages.manage", group: "portal", label: "Build packages", kind: "client", grantable: true },
  { key: "portal.templates.manage", group: "portal", label: "Manage request templates", kind: "client", grantable: true },
  { key: "portal.quotes.accept", group: "portal", label: "Accept quotations", kind: "client", grantable: true },
  { key: "portal.invoices.view", group: "portal", label: "View invoices", kind: "client", grantable: true },
  { key: "portal.payments.upload", group: "portal", label: "Upload payments", kind: "client", grantable: true },
  { key: "portal.users.manage", group: "portal", label: "Manage your team", kind: "client", grantable: true },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export type SystemRoleKey =
  | "super_admin"
  | "admin"
  | "operations_manager"
  | "verification_officer"
  | "qc_officer"
  | "data_entry_officer"
  | "client_relations"
  | "viewer"
  | "client_admin"
  | "client_user"
  | "client_viewer";

/** Anything holding a permissions list (the viewer, a role). */
export type HasPermissions = { permissions: readonly string[] };

export function can(subject: HasPermissions | null | undefined, permission: Permission): boolean {
  if (!subject) return false;
  return subject.permissions.includes("*") || subject.permissions.includes(permission);
}

export function canAny(subject: HasPermissions | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(subject, p));
}
