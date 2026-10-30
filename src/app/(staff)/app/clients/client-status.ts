import type { ClientStatus } from "@/lib/server/admin/clients";
import type { Tone } from "@/domain/workflow/stages";

export const CLIENT_STATUS_TONE: Record<ClientStatus, Tone> = { prospect: "info", active: "success", suspended: "warning", archived: "neutral" };
export const clientStatusLabel = (s: ClientStatus) => s.charAt(0).toUpperCase() + s.slice(1);

export const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect", hint: "Talking to us; cases allowed" },
  { value: "active", label: "Active", hint: "Ordering verifications" },
  { value: "suspended", label: "Suspended", hint: "No new cases" },
  { value: "archived", label: "Archived", hint: "Hidden from lists" },
] as const;
