/**
 * The shape of public.candidate_link_view() (0008): everything the
 * candidate's page may show. Types only.
 */
import type { Stage } from "../workflow/stages";

export type CandidateRequirement = {
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
  files: { id: string; filename: string; status: "uploaded" | "accepted" | "rejected" | "superseded"; rejection_reason: string | null; created_at: string }[];
};

export type CandidateRequest = {
  id: string;
  kind: "document" | "field" | "question";
  title: string;
  help: string | null;
  field_type: string | null;
  options: { value: string; label: string }[] | string[];
  requirement_id: string | null;
  due_at: string | null;
  status: "open" | "answered" | "accepted";
  answer: { value?: string; document_id?: string } | null;
  answered_at: string | null;
  review_note: string | null;
  created_at: string;
};

export type CandidateView = {
  link: { id: string; expires_at: string; language: "en" | "si" | "ta"; sent_at: string | null };
  org: { name: string; legal_name: string; email: string | null; phone: string | null; website: string | null; address: string | null };
  case: {
    reference: string;
    position_title: string | null;
    stage: Stage;
    status_key: string;
    status_label: string | null;
    process_type: "client_supplied" | "candidate_collected";
    on_hold: boolean;
    received_at: string;
    client_name: string;
  };
  candidate: { full_name: string; preferred_language: "en" | "si" | "ta" };
  checks: { label: string; key: string }[];
  requirements: CandidateRequirement[];
  requests: CandidateRequest[];
  messages: { id: string; from: "staff" | "candidate"; body: string; at: string }[];
  consent: { status: "pending" | "submitted" | "accepted" | "rejected"; method: "esign" | "upload" | "staff" | null; signed_name: string | null; signed_at: string | null; review_note: string | null } | null;
  timeline: { id: number; kind: string; at: string; title: string; body: string | null; data: { to: string | null; category: string | null } }[];
};
