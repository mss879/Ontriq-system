/**
 * Shapes returned by the portal_* functions (0021). Types only.
 */
import type { Stage } from "../workflow/stages";

export type PortalCaseRow = {
  id: string;
  reference: string;
  candidate_name: string;
  position_title: string | null;
  department: string | null;
  client_reference: string | null;
  package_name: string | null;
  stage: Stage;
  stage_label: string;
  status_label: string;
  priority: "normal" | "high" | "urgent";
  on_hold: boolean;
  checks_total: number;
  checks_done: number;
  received_at: string;
  due_at: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  process_type: "client_supplied" | "candidate_collected";
  created_via: "staff" | "portal" | "import" | "assistant";
  needs_documents: number;
  final_result: "green" | "amber" | "red" | null;
};

export type PortalStatusFilter = "all" | "action" | "active" | "released" | "cancelled";

export type PortalDashboard = {
  client: { id: string; name: string; code: string; sla_days: number };
  counts: { total: number; active: number; action: number; released_30d: number; overdue: number };
  by_stage: { received: number; documents: number; in_progress: number; report: number; released: number };
  avg_tat_days: number | null;
  needs_action: PortalCaseRow[];
  recent: PortalCaseRow[];
};

export type PortalVisibility = {
  show_check_progress: boolean;
  show_timeline: boolean;
  show_documents: boolean;
  show_results_before_release: boolean;
  show_candidate_progress: boolean;
  hidden_check_types: string[];
};

export const DEFAULT_PORTAL_VISIBILITY: PortalVisibility = {
  show_check_progress: true,
  show_timeline: true,
  show_documents: true,
  show_results_before_release: false,
  show_candidate_progress: true,
  hidden_check_types: [],
};

export type PortalCheck = {
  id: string;
  label: string;
  key: string;
  icon: string;
  state: "not_started" | "in_progress" | "needs_information" | "done" | "not_required";
  completed_at: string | null;
  result_tone: "green" | "amber" | "red" | null;
  result_label: string | null;
  client_note: string | null;
  fields: { label: string; value: unknown }[];
};

export type PortalRequirement = {
  id: string;
  category: string;
  label: string;
  description: string | null;
  category_name: string | null;
  guide: string | null;
  check_label: string | null;
  min_count: number;
  received_count: number;
  status: "pending" | "received" | "optional";
  requested_note: string | null;
  requested_at: string | null;
};

export type PortalDocument = {
  id: string;
  filename: string;
  category: string;
  category_name: string | null;
  label: string | null;
  from: "staff" | "client" | "candidate" | "system";
  status: "uploaded" | "accepted" | "rejected";
  created_at: string;
  mime: string;
  size: number;
  rejection_reason: string | null;
};

export type PortalCaseDetail = {
  case: PortalCaseRow & {
    candidate: { full_name: string; nic: string | null; email: string | null; phone: string | null };
    instructions: string | null;
    package: { name: string | null; code: string | null; tat_days: number | null };
    hold_label: string | null;
    results_visible: boolean;
  };
  visibility: PortalVisibility;
  can_upload: boolean;
  checks: PortalCheck[];
  requirements: PortalRequirement[];
  documents: PortalDocument[];
  candidate_progress: { invited_at: string | null; active: boolean; opened: boolean; consent: boolean } | null;
  timeline: { id: number; kind: string; at: string; title: string; body: string | null }[];
  report: { status: "not_ready" | "in_preparation" | "released" | "cancelled"; released_at: string | null };
};

export type PortalTeamMember = {
  membership_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role_id: string;
  role_key: string;
  role_name: string;
  status: "active" | "invited" | "suspended";
  invited_at: string | null;
  activated_at: string | null;
  is_me: boolean;
};

export type PortalPriceItem = { check_type_id: string; key: string; name: string; description: string; icon: string; unit_price: number; currency: string };
