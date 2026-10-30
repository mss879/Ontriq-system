/** Portal notification types (raised by case_events_notify_client in 0021) and how they are described to clients. */
export const PORTAL_EVENTS = [
  { type: "portal.documents_needed", label: "Ontriq needs documents", text: "When Ontriq asks you for a document on one of your requests." },
  { type: "portal.document_rejected", label: "A document needs replacing", text: "When a file you uploaded can't be used." },
  { type: "portal.case_accepted", label: "Request accepted", text: "When Ontriq confirms a request and starts work." },
  { type: "portal.report_released", label: "Report available", text: "When Ontriq releases a report." },
] as const;
