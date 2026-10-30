import type { LucideIcon } from "lucide-react";
import { BarChart3, Briefcase, ClipboardList, FileSignature, FileText, FolderKanban, History, Inbox, LayoutDashboard, Palette, Receipt, Settings, Sparkles, SquareTerminal, TrendingUp, UserRound, Users, Wallet } from "lucide-react";
import type { Permission } from "@/domain/permissions";

/**
 * The one navigation config. The sidebar, the command palette and page titles
 * read it. Items appear as their phase ships; `permission` hides items the
 * viewer cannot use (pages re-check on the server).
 */
export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Visible with any one of these. */
  anyOf?: Permission[];
  keywords?: string[];
  superAdminOnly?: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

export const STAFF_NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/app", icon: LayoutDashboard, keywords: ["home", "overview"] },
      { title: "Command", href: "/app/command", icon: SquareTerminal, superAdminOnly: true, keywords: ["assistant", "ai", "voice", "ask"] },
      { title: "My work", href: "/app/queues", icon: Inbox, anyOf: ["cases.read", "cases.read_assigned", "qc.pre", "qc.post", "checks.data_entry"], keywords: ["queue", "tasks", "assigned", "qc", "pre-qc", "post-qc", "data entry"] },
      { title: "Cases", href: "/app/cases", icon: FolderKanban, anyOf: ["cases.read", "cases.read_assigned"], keywords: ["verifications", "requests", "board", "kanban"] },
      { title: "Performance", href: "/app/team/performance", icon: TrendingUp, keywords: ["leaderboard", "scorecard", "push", "nudge", "workload", "rebalance"] },
    ],
  },
  {
    label: "Directory",
    items: [
      { title: "Clients", href: "/app/clients", icon: Briefcase, anyOf: ["clients.read", "clients.manage"], keywords: ["companies", "customers", "employers"] },
      { title: "Candidates", href: "/app/candidates", icon: UserRound, anyOf: ["cases.read", "candidates.manage"], keywords: ["people", "nic", "applicants"] },
      { title: "Reports", href: "/app/reports", icon: FileText, permission: "reports.preview", keywords: ["final report", "released", "archive", "approval"] },
      { title: "Analytics", href: "/app/analytics", icon: BarChart3, anyOf: ["analytics.read", "billing.export", "invoices.manage", "ai.usage.read"], keywords: ["reports", "charts", "turnaround", "revenue", "receivables", "aging", "ai cost", "export"] },
    ],
  },
  {
    label: "Billing",
    items: [
      { title: "Quotes", href: "/app/quotes", icon: FileSignature, anyOf: ["quotes.manage", "quotes.send"], keywords: ["quotation", "proposal", "pricing", "price list"] },
      { title: "Invoices", href: "/app/invoices", icon: Receipt, anyOf: ["invoices.manage", "invoices.send", "billing.export"], keywords: ["billing", "credit note", "statement", "overdue"] },
      { title: "Payments", href: "/app/payments", icon: Wallet, anyOf: ["payments.record", "invoices.manage"], keywords: ["slips", "receipts", "bank transfer", "match"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Team", href: "/app/team", icon: Users, permission: "users.manage", keywords: ["staff", "users", "invite", "roles"] },
      { title: "Settings", href: "/app/settings", icon: Settings, anyOf: ["settings.manage", "check_types.manage", "packages.manage", "templates.manage", "assignment.configure", "ai.configure", "ai.usage.read"], keywords: ["branding", "organisation", "security", "check types", "packages", "templates", "assignment", "taxes", "ai"] },
      { title: "Audit log", href: "/app/audit", icon: History, permission: "audit.read", keywords: ["history", "changes", "who"] },
    ],
  },
];

/** Settings sub-pages, each gated by its own permission. */
export const SETTINGS_NAV: NavItem[] = [
  { title: "Organisation", href: "/app/settings", icon: Settings, permission: "settings.manage" },
  { title: "Check types", href: "/app/settings/check-types", icon: ClipboardList, permission: "check_types.manage" },
  { title: "Packages & templates", href: "/app/settings/packages", icon: Briefcase, anyOf: ["packages.manage", "templates.manage"] },
  { title: "Assignment", href: "/app/settings/assignment", icon: Users, permission: "assignment.configure" },
  { title: "Branding & documents", href: "/app/settings/branding", icon: Palette, anyOf: ["settings.manage", "templates.manage"] },
  { title: "Billing & taxes", href: "/app/settings/billing", icon: Receipt, permission: "settings.manage" },
  { title: "AI", href: "/app/settings/ai", icon: Sparkles, anyOf: ["ai.configure", "ai.usage.read"] },
];

export function visibleNav(sections: NavSection[], viewer: { permissions: string[]; roleKey: string }): NavSection[] {
  const canSee = (item: NavItem) => canSeeNavItem(item, viewer);
  return sections.map((s) => ({ ...s, items: s.items.filter(canSee) })).filter((s) => s.items.length > 0);
}

export function canSeeNavItem(item: NavItem, viewer: { permissions: string[]; roleKey: string }): boolean {
  const has = (p: string) => viewer.permissions.includes("*") || viewer.permissions.includes(p);
  return (
    (!item.superAdminOnly || viewer.roleKey === "super_admin") &&
    (!item.permission || has(item.permission)) &&
    (!item.anyOf || item.anyOf.some(has))
  );
}
