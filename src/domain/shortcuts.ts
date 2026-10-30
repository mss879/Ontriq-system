/**
 * Keyboard shortcuts for the staff workspace (plan §10.1). Single keys act
 * at once; "g" starts a two-key jump ("g c" opens Cases). Pure, so the key
 * handling is unit tested; the listener lives in
 * src/components/command/keyboard-shortcuts.tsx.
 */

export type Shortcut = {
  keys: string[];
  label: string;
  group: "Go to" | "Actions" | "Help";
  href?: string;
  action?: "palette" | "help" | "assistant";
  /** Shown and active only with one of these (Super Admin has all). */
  anyOf?: string[];
};

export const SHORTCUTS: Shortcut[] = [
  { keys: ["c"], label: "New case", group: "Actions", href: "/app/cases/new", anyOf: ["cases.create"] },
  { keys: ["/"], label: "Search", group: "Actions", action: "palette" },
  { keys: ["g", "d"], label: "Dashboard", group: "Go to", href: "/app" },
  { keys: ["g", "w"], label: "My work", group: "Go to", href: "/app/queues", anyOf: ["cases.read", "cases.read_assigned", "qc.pre", "qc.post", "checks.data_entry"] },
  { keys: ["g", "c"], label: "Cases", group: "Go to", href: "/app/cases", anyOf: ["cases.read", "cases.read_assigned"] },
  { keys: ["g", "l"], label: "Clients", group: "Go to", href: "/app/clients", anyOf: ["clients.read", "clients.manage"] },
  { keys: ["g", "r"], label: "Reports", group: "Go to", href: "/app/reports", anyOf: ["reports.preview"] },
  { keys: ["g", "q"], label: "Quotes", group: "Go to", href: "/app/quotes", anyOf: ["quotes.manage", "quotes.send"] },
  { keys: ["g", "i"], label: "Invoices", group: "Go to", href: "/app/invoices", anyOf: ["invoices.manage", "invoices.send", "billing.export"] },
  { keys: ["g", "p"], label: "Payments", group: "Go to", href: "/app/payments", anyOf: ["payments.record", "invoices.manage"] },
  { keys: ["g", "a"], label: "Analytics", group: "Go to", href: "/app/analytics", anyOf: ["analytics.read"] },
  { keys: ["g", "t"], label: "Team performance", group: "Go to", href: "/app/team/performance", anyOf: ["staff.performance.read"] },
  { keys: ["g", "s"], label: "Settings", group: "Go to", href: "/app/settings", anyOf: ["settings.manage", "check_types.manage", "packages.manage", "templates.manage", "assignment.configure", "ai.configure", "ai.usage.read"] },
  { keys: ["?"], label: "Show shortcuts", group: "Help", action: "help" },
];

export function allowedShortcuts(permissions: string[]): Shortcut[] {
  const has = (p: string) => permissions.includes("*") || permissions.includes(p);
  return SHORTCUTS.filter((s) => !s.anyOf || s.anyOf.some(has));
}

/**
 * Feed one key. Returns the matched shortcut (if any) and the pending prefix
 * to keep for the next key. Unknown keys reset the sequence.
 */
export function matchKey(shortcuts: Shortcut[], pending: string[], key: string): { match: Shortcut | null; pending: string[] } {
  const seq = [...pending, key];
  const exact = shortcuts.find((s) => s.keys.length === seq.length && s.keys.every((k, i) => k === seq[i]));
  if (exact) return { match: exact, pending: [] };
  const prefix = shortcuts.some((s) => s.keys.length > seq.length && seq.every((k, i) => s.keys[i] === k));
  if (prefix) return { match: null, pending: seq };
  if (pending.length) return matchKey(shortcuts, [], key);
  return { match: null, pending: [] };
}
