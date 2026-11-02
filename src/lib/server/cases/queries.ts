import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { parseCheckTypeSchema, type CheckTypeSchema } from "@/domain/check-types/schema";
import type { CheckState, FinalResult, Priority, ProcessType, Stage } from "@/domain/workflow/stages";
import { ACTIVE_STAGES, STAGES } from "@/domain/workflow/stages";
import { statusLabeller } from "./status-catalog";

/**
 * Read models for the case screens. Every query runs as the signed-in person
 * (row level security decides what comes back) and is request-time
 * (createRequestClient calls connection()). React.cache dedupes reads shared
 * by several Suspense regions of one page.
 */

export type Person = { id: string; name: string; email: string };

export const peopleById = cache(async (): Promise<Map<string, Person>> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email");
  return new Map((data ?? []).map((p) => [p.id, { id: p.id, name: p.full_name || p.email, email: p.email }]));
});

export type StaffOption = Person & { roleKey: string; roleName: string };

/** Active staff, for assignment pickers. */
export const staffOptions = cache(async (): Promise<StaffOption[]> => {
  const supabase = await createRequestClient();
  const [{ data: members }, people] = await Promise.all([
    supabase.from("memberships").select("user_id, status, kind, role:roles(key, name)").eq("kind", "staff").eq("status", "active"),
    peopleById(),
  ]);
  return (members ?? [])
    .map((m) => {
      const role = m.role as { key: string; name: string } | null;
      const p = people.get(m.user_id);
      return { id: m.user_id, name: p?.name ?? "Team member", email: p?.email ?? "", roleKey: role?.key ?? "", roleName: role?.name ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

// ---------------------------------------------------------------- list

export type CaseFilters = {
  q?: string;
  stage?: string;
  status?: string;
  client?: string;
  assignee?: string;
  priority?: string;
  due?: string;
  page?: number;
};

export type CaseListItem = {
  id: string;
  reference: string;
  candidateName: string;
  clientId: string;
  clientName: string;
  stage: Stage;
  statusKey: string;
  statusLabel: string;
  priority: Priority;
  onHold: boolean;
  proposedResult: FinalResult | null;
  checksTotal: number;
  checksDone: number;
  assignee: Person | null;
  dueAt: string | null;
  receivedAt: string;
  processType: ProcessType;
  packageName: string;
};

export const PAGE_SIZE = 50;

export function parseCaseFilters(params: Record<string, string | string[] | undefined>): CaseFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const page = Number(one("page") ?? "1");
  return { q: one("q"), stage: one("stage"), status: one("status"), client: one("client"), assignee: one("assignee"), priority: one("priority"), due: one("due"), page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1 };
}

export async function listCases(filters: CaseFilters, viewerId: string, opts: { limit?: number } = {}): Promise<{ items: CaseListItem[]; total: number }> {
  const supabase = await createRequestClient();
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((filters.page ?? 1) - 1) * limit;
  let query = supabase
    .from("cases")
    .select(
      "id, reference, candidate_name, client_id, stage, status_key, priority, on_hold, proposed_result, checks_total, checks_done, assigned_to, due_at, received_at, process_type, package_snapshot, client:clients(name)",
      { count: "exact" },
    );

  const stage = filters.stage ?? "active";
  if (stage === "active") query = query.in("stage", ACTIVE_STAGES);
  else if (stage === "closed") query = query.in("stage", ["released", "cancelled"]);
  else if (stage === "on_hold") query = query.eq("on_hold", true);
  else if ((STAGES as readonly string[]).includes(stage)) query = query.eq("stage", stage as Stage);

  if (filters.status) query = query.eq("status_key", filters.status);
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.assignee === "me") query = query.eq("assigned_to", viewerId);
  else if (filters.assignee === "unassigned") query = query.is("assigned_to", null);
  else if (filters.assignee) query = query.eq("assigned_to", filters.assignee);
  if (filters.due === "overdue") query = query.lt("due_at", new Date().toISOString()).in("stage", ACTIVE_STAGES);
  if (filters.due === "this_week") query = query.lt("due_at", new Date(Date.now() + 7 * 864e5).toISOString()).in("stage", ACTIVE_STAGES);
  if (filters.q) {
    const term = filters.q.replace(/[%_,()]/g, " ").trim();
    if (term) query = query.or(`reference.ilike.%${term}%,candidate_name.ilike.%${term}%,client_reference.ilike.%${term}%`);
  }

  const { data, count } = await query.order("received_at", { ascending: false }).range(from, from + limit - 1);
  const [people, statusLabel] = await Promise.all([peopleById(), statusLabeller()]);
  const items: CaseListItem[] = (data ?? []).map((c) => ({
    id: c.id,
    reference: c.reference,
    candidateName: c.candidate_name,
    clientId: c.client_id,
    clientName: (c.client as { name: string } | null)?.name ?? "",
    stage: c.stage,
    statusKey: c.status_key,
    statusLabel: statusLabel(c.status_key),
    priority: c.priority as Priority,
    onHold: c.on_hold,
    proposedResult: c.proposed_result as FinalResult | null,
    checksTotal: c.checks_total,
    checksDone: c.checks_done,
    assignee: c.assigned_to ? (people.get(c.assigned_to) ?? { id: c.assigned_to, name: "Team member", email: "" }) : null,
    dueAt: c.due_at,
    receivedAt: c.received_at,
    processType: c.process_type,
    packageName: ((c.package_snapshot as { name?: string } | null)?.name ?? "") || "Custom",
  }));
  return { items: await withClientNames(items), total: count ?? items.length };
}

/** Officers work a case without access to the client's record, but lists show its name. */
export async function clientNamesFor(caseIds: string[]): Promise<Map<string, string>> {
  if (!caseIds.length) return new Map();
  const supabase = await createRequestClient();
  const { data } = await supabase.rpc("case_client_names", { p_cases: [...new Set(caseIds)] });
  return new Map((data ?? []).map((r) => [r.case_id, r.client_name]));
}

export async function withClientNames(items: CaseListItem[]): Promise<CaseListItem[]> {
  const names = await clientNamesFor(items.filter((i) => !i.clientName).map((i) => i.id));
  return items.map((i) => (i.clientName ? i : { ...i, clientName: names.get(i.id) ?? "" }));
}

/** Counts per stage for the board header and dashboard pipeline. */
export const stageCounts = cache(async (): Promise<Record<string, number>> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("case_stage_counts", { p_stages: ACTIVE_STAGES });
  const out: Record<string, number> = {};
  if (error) {
    // Migration 0052 isn't on this database yet, so count the rows. Remove this branch once it is.
    const { data: rows } = await supabase.from("cases").select("stage, on_hold").in("stage", ACTIVE_STAGES);
    for (const row of rows ?? []) {
      out[row.stage] = (out[row.stage] ?? 0) + 1;
      if (row.on_hold) out.on_hold = (out.on_hold ?? 0) + 1;
    }
    return out;
  }
  for (const row of data ?? []) {
    out[row.stage] = row.total;
    if (row.on_hold) out.on_hold = (out.on_hold ?? 0) + row.on_hold;
  }
  return out;
});

// ---------------------------------------------------------------- one case

export type CaseDetail = {
  id: string;
  reference: string;
  stage: Stage;
  statusKey: string;
  statusLabel: string;
  /** One of Ontriq's own statuses, set by hand, until the case moves stage. */
  manualStatusKey: string | null;
  /** The NIC matched a record with a different name, and nobody has looked yet. */
  candidateMatchOpen: boolean;
  /** The candidate as the client typed them on a portal request. */
  intakeCandidate: { full_name?: string; nic?: string; email?: string; phone?: string } | null;
  priority: Priority;
  processType: ProcessType;
  clientVisible: boolean;
  onHold: boolean;
  holdReason: string | null;
  returnedAt: string | null;
  returnNote: string | null;
  proposedResult: FinalResult | null;
  finalResult: FinalResult | null;
  checksTotal: number;
  checksDone: number;
  assignee: Person | null;
  assignedAt: string | null;
  positionTitle: string | null;
  department: string | null;
  clientReference: string | null;
  instructions: string | null;
  internalNotes: string | null;
  createdVia: string;
  receivedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  releasedAt: string | null;
  cancelReason: string | null;
  erasedAt: string | null;
  package: { name: string; code: string | null; tatDays: number | null; items: { checkTypeId: string; name: string; unitPrice: number }[] };
  client: { id: string; name: string; code: string };
  candidate: {
    id: string;
    fullName: string;
    nic: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    district: string | null;
    preferredLanguage: string;
  };
};

export const getCase = cache(async (id: string): Promise<CaseDetail | null> => {
  const supabase = await createRequestClient();
  const { data: c } = await supabase
    .from("cases")
    .select("*, client:clients(id, name, code), candidate:candidates(*)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;
  const people = await peopleById();
  const snap = (c.package_snapshot ?? {}) as { name?: string; code?: string; tat_days?: number; items?: { check_type_id: string; name: string; unit_price: number }[] };
  const cand = c.candidate as unknown as {
    id: string;
    full_name: string;
    nic: string | null;
    date_of_birth: string | null;
    gender: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    district: string | null;
    preferred_language: string;
  } | null;
  const client = c.client as { id: string; name: string; code: string } | null;
  // Officers work a case without access to the client's record, but they need its name.
  const clientName = client ? "" : ((await supabase.rpc("case_client_name", { p_case: id })).data ?? "");
  return {
    id: c.id,
    reference: c.reference,
    stage: c.stage,
    statusKey: c.status_key,
    statusLabel: (await statusLabeller())(c.status_key),
    manualStatusKey: c.manual_status_key,
    candidateMatchOpen: c.candidate_match_open,
    intakeCandidate: c.intake_candidate as CaseDetail["intakeCandidate"],
    priority: c.priority as Priority,
    processType: c.process_type,
    clientVisible: c.client_visible,
    onHold: c.on_hold,
    holdReason: c.hold_reason,
    returnedAt: c.returned_at,
    returnNote: c.return_note,
    proposedResult: c.proposed_result as FinalResult | null,
    finalResult: c.final_result as FinalResult | null,
    checksTotal: c.checks_total,
    checksDone: c.checks_done,
    assignee: c.assigned_to ? (people.get(c.assigned_to) ?? { id: c.assigned_to, name: "Team member", email: "" }) : null,
    assignedAt: c.assigned_at,
    positionTitle: c.position_title,
    department: c.department,
    clientReference: c.client_reference,
    instructions: c.instructions,
    internalNotes: c.internal_notes,
    createdVia: c.created_via,
    receivedAt: c.received_at,
    dueAt: c.due_at,
    erasedAt: c.erased_at,
    completedAt: c.completed_at,
    releasedAt: c.released_at,
    cancelReason: c.cancel_reason,
    package: {
      name: snap.name ?? "Custom selection",
      code: snap.code ?? null,
      tatDays: snap.tat_days ?? null,
      items: (snap.items ?? []).map((i) => ({ checkTypeId: i.check_type_id, name: i.name, unitPrice: Number(i.unit_price ?? 0) })),
    },
    client: client ?? { id: c.client_id, name: clientName, code: "" },
    candidate: cand
      ? {
          id: cand.id,
          fullName: cand.full_name,
          nic: cand.nic,
          dateOfBirth: cand.date_of_birth,
          gender: cand.gender,
          email: cand.email,
          phone: cand.phone,
          address: cand.address,
          district: cand.district,
          preferredLanguage: cand.preferred_language,
        }
      : { id: c.candidate_id, fullName: c.candidate_name, nic: null, dateOfBirth: null, gender: null, email: null, phone: null, address: null, district: null, preferredLanguage: "en" },
  };
});

export type CaseCheck = {
  id: string;
  label: string;
  checkTypeId: string;
  checkTypeKey: string;
  icon: string;
  versionId: string;
  version: number | null;
  schema: CheckTypeSchema;
  state: CheckState;
  result: string | null;
  resultTone: "green" | "amber" | "red" | null;
  values: Record<string, unknown>;
  valuesValid: boolean;
  clientNote: string | null;
  /** The last outcome recorded was a discrepancy, even if the check was reopened since. */
  discrepancyAt: string | null;
  assignee: Person | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export const getCaseChecks = cache(async (caseId: string): Promise<CaseCheck[]> => {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase
      .from("case_checks")
      .select("*, type:check_types(key, icon), version:check_type_versions(version, schema)")
      .eq("case_id", caseId)
      .order("sort"),
    peopleById(),
  ]);
  return (data ?? []).map((k) => {
    const type = k.type as { key: string; icon: string } | null;
    const version = k.version as { version: number | null; schema: unknown } | null;
    return {
      id: k.id,
      label: k.label,
      checkTypeId: k.check_type_id,
      checkTypeKey: type?.key ?? "",
      icon: type?.icon ?? "check",
      versionId: k.check_type_version_id,
      version: version?.version ?? null,
      schema: parseCheckTypeSchema(version?.schema ?? { fields: [{ key: "notes", label: "Notes", type: "textarea" }] }),
      state: k.state,
      result: k.result,
      resultTone: k.result_tone as CaseCheck["resultTone"],
      values: (k.values ?? {}) as Record<string, unknown>,
      valuesValid: k.values_valid,
      clientNote: k.client_note,
      discrepancyAt: k.discrepancy_at,
      assignee: k.assigned_to ? (people.get(k.assigned_to) ?? { id: k.assigned_to, name: "Team member", email: "" }) : null,
      dueAt: k.due_at,
      startedAt: k.started_at,
      completedAt: k.completed_at,
      updatedAt: k.updated_at,
    };
  });
});

export type Requirement = {
  id: string;
  caseCheckId: string | null;
  category: string;
  label: string;
  description: string | null;
  minCount: number;
  receivedCount: number;
  stage: "documents" | "verification";
  status: "pending" | "received" | "waived" | "optional";
  requestedNote: string | null;
  requestedAt: string | null;
  waivedReason: string | null;
  /** Files a person confirmed hold this document, though they were uploaded as something else. */
  files: { documentId: string; filename: string; pages: string | null; recordKeys: string[] }[];
};

export const getRequirements = cache(async (caseId: string): Promise<Requirement[]> => {
  const supabase = await createRequestClient();
  const [{ data }, { data: links }] = await Promise.all([
    supabase.from("case_check_requirements").select("*").eq("case_id", caseId).order("created_at"),
    supabase.from("requirement_files").select("requirement_id, document_id, pages, record_keys, document:documents(filename)").eq("case_id", caseId).order("created_at"),
  ]);
  return (data ?? []).map((r) => ({
    id: r.id,
    caseCheckId: r.case_check_id,
    category: r.category,
    label: r.label,
    description: r.description,
    minCount: r.min_count,
    receivedCount: r.received_count,
    stage: r.stage as Requirement["stage"],
    status: r.status as Requirement["status"],
    requestedNote: r.requested_note,
    requestedAt: r.requested_at,
    waivedReason: r.waived_reason,
    files: (links ?? [])
      .filter((f) => f.requirement_id === r.id)
      .map((f) => ({ documentId: f.document_id, filename: (f.document as unknown as { filename: string } | null)?.filename ?? "a file", pages: f.pages, recordKeys: f.record_keys ?? [] })),
  }));
});

/** The flowchart's "copy/original requirements": what Pre-QC saw, per file. */
export type OriginalKind = "unknown" | "original" | "certified_copy" | "copy";

export type CaseDocument = {
  id: string;
  caseCheckId: string | null;
  category: string;
  label: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  version: number;
  parentId: string | null;
  sensitive: boolean;
  visibility: "internal" | "client" | "report";
  recordKey: string | null;
  originalKind: OriginalKind;
  /** Why sensitive evidence stays out of the report, when someone decided that. */
  withheldReason: string | null;
  status: "pending_upload" | "uploaded" | "accepted" | "rejected" | "superseded";
  rejectionReason: string | null;
  uploadedBy: Person | null;
  uploadedByKind: string;
  createdAt: string;
};

export const getDocuments = cache(async (caseId: string): Promise<CaseDocument[]> => {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("documents").select("*").eq("case_id", caseId).neq("status", "pending_upload").order("created_at", { ascending: false }),
    peopleById(),
  ]);
  return (data ?? []).map((d) => ({
    id: d.id,
    caseCheckId: d.case_check_id,
    category: d.category,
    label: d.label,
    filename: d.filename,
    mime: d.mime,
    sizeBytes: Number(d.size_bytes),
    version: d.version,
    parentId: d.parent_id,
    sensitive: d.sensitive,
    visibility: d.visibility as CaseDocument["visibility"],
    recordKey: d.record_key,
    originalKind: d.original_kind as OriginalKind,
    withheldReason: d.withheld_reason,
    status: d.status as CaseDocument["status"],
    rejectionReason: d.rejection_reason,
    uploadedBy: d.uploaded_by ? (people.get(d.uploaded_by) ?? null) : null,
    uploadedByKind: d.uploaded_by_kind,
    createdAt: d.created_at,
  }));
});

export type TimelineEvent = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  caseCheckId: string | null;
  actor: Person | null;
  visibleToClient: boolean;
  visibleToCandidate: boolean;
  at: string;
};

export const getTimeline = cache(async (caseId: string, limit = 100): Promise<TimelineEvent[]> => {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("case_events").select("*").eq("case_id", caseId).order("at", { ascending: false }).limit(limit),
    peopleById(),
  ]);
  return (data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    body: e.body,
    caseCheckId: e.case_check_id,
    actor: e.actor_id ? (people.get(e.actor_id) ?? null) : null,
    visibleToClient: e.visible_to_client,
    visibleToCandidate: e.visible_to_candidate,
    at: e.at,
  }));
});

/** When the case last reached each stage, for the progress rail. */
export const getStageDates = cache(async (caseId: string): Promise<Partial<Record<Stage, string>>> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("stage_history").select("to_stage, at").eq("case_id", caseId).order("at", { ascending: true });
  return Object.fromEntries((data ?? []).map((h) => [h.to_stage, h.at]));
});

export type QcReview = { id: string; kind: "pre" | "post"; decision: "approved" | "returned"; remarks: string | null; checklist: { item: string; ok: boolean }[]; returnedCheckIds: string[]; reviewer: Person | null; at: string };

export const getQcReviews = cache(async (caseId: string): Promise<QcReview[]> => {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("qc_reviews").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    peopleById(),
  ]);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as QcReview["kind"],
    decision: r.decision as QcReview["decision"],
    remarks: r.remarks,
    checklist: Array.isArray(r.checklist) ? (r.checklist as QcReview["checklist"]) : [],
    returnedCheckIds: r.returned_check_ids ?? [],
    reviewer: r.reviewer_id ? (people.get(r.reviewer_id) ?? null) : null,
    at: r.created_at,
  }));
});

export type AssignmentRecord = { id: number; caseCheckId: string | null; assignee: Person | null; mode: "auto" | "manual" | "queue"; explanation: string | null; reason: string | null; by: Person | null; at: string };

export const getAssignments = cache(async (caseId: string): Promise<AssignmentRecord[]> => {
  const supabase = await createRequestClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("assignment_events").select("*").eq("case_id", caseId).order("at", { ascending: false }).limit(50),
    peopleById(),
  ]);
  return (data ?? []).map((a) => ({
    id: a.id,
    caseCheckId: a.case_check_id,
    assignee: a.assigned_to ? (people.get(a.assigned_to) ?? null) : null,
    mode: a.mode as AssignmentRecord["mode"],
    explanation: a.explanation,
    reason: a.reason,
    by: a.assigned_by ? (people.get(a.assigned_by) ?? null) : null,
    at: a.at,
  }));
});

// ---------------------------------------------------------------- catalogue

export type CatalogCheckType = { id: string; key: string; name: string; description: string; icon: string; sort: number; published: boolean; archived: boolean; slaDays: number; locationBound: boolean };
export type CatalogPackage = {
  id: string;
  code: string;
  name: string;
  description: string;
  ownerScope: "org" | "client";
  clientId: string | null;
  pricingMode: "sum" | "fixed";
  fixedPrice: number | null;
  currency: string;
  tatDays: number;
  defaultProcessType: ProcessType;
  visibility: "all" | "selected";
  isActive: boolean;
  items: { checkTypeId: string; unitPrice: number }[];
  price: number;
};
export type CatalogTemplate = {
  id: string;
  name: string;
  description: string;
  ownerScope: "org" | "client";
  clientId: string | null;
  packageId: string;
  processType: ProcessType;
  priority: Priority;
  defaults: { position_title?: string; department?: string; instructions?: string };
  isFavourite: boolean;
  usageCount: number;
  isActive: boolean;
};
export type CatalogCategory = { key: string; name: string; guide: string; sensitive: boolean; sort: number };

export const getCatalog = cache(async () => {
  const supabase = await createRequestClient();
  const [types, packages, items, templates, categories] = await Promise.all([
    supabase.from("check_types").select("id, key, name, description, icon, sort, current_version_id, archived_at, version:check_type_versions!check_types_current_version_fk(schema)").order("sort"),
    supabase.from("packages").select("*").order("sort"),
    supabase.from("package_items").select("package_id, check_type_id, unit_price, sort").order("sort"),
    supabase.from("request_templates").select("*").order("is_favourite", { ascending: false }).order("usage_count", { ascending: false }),
    supabase.from("document_categories").select("key, name, guide, sensitive, sort").eq("is_active", true).order("sort"),
  ]);
  const checkTypes: CatalogCheckType[] = (types.data ?? []).map((t) => {
    const schema = (t.version as { schema?: { sla_days?: number; location_bound?: boolean } } | null)?.schema;
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      icon: t.icon,
      sort: t.sort,
      published: Boolean(t.current_version_id),
      archived: Boolean(t.archived_at),
      slaDays: schema?.sla_days ?? 5,
      locationBound: Boolean(schema?.location_bound),
    };
  });
  const itemsByPackage = new Map<string, { checkTypeId: string; unitPrice: number }[]>();
  for (const i of items.data ?? []) {
    const list = itemsByPackage.get(i.package_id) ?? [];
    list.push({ checkTypeId: i.check_type_id, unitPrice: Number(i.unit_price) });
    itemsByPackage.set(i.package_id, list);
  }
  const pkgs: CatalogPackage[] = (packages.data ?? []).map((p) => {
    const list = itemsByPackage.get(p.id) ?? [];
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      ownerScope: p.owner_scope as CatalogPackage["ownerScope"],
      clientId: p.client_id,
      pricingMode: p.pricing_mode as CatalogPackage["pricingMode"],
      fixedPrice: p.fixed_price === null ? null : Number(p.fixed_price),
      currency: p.currency,
      tatDays: p.tat_days,
      defaultProcessType: p.default_process_type,
      visibility: p.visibility as CatalogPackage["visibility"],
      isActive: p.is_active,
      items: list,
      price: p.pricing_mode === "fixed" ? Number(p.fixed_price ?? 0) : list.reduce((a, b) => a + b.unitPrice, 0),
    };
  });
  const tpls: CatalogTemplate[] = (templates.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ownerScope: t.owner_scope as CatalogTemplate["ownerScope"],
    clientId: t.client_id,
    packageId: t.package_id,
    processType: t.process_type,
    priority: t.priority as Priority,
    defaults: (t.defaults ?? {}) as CatalogTemplate["defaults"],
    isFavourite: t.is_favourite,
    usageCount: t.usage_count,
    isActive: t.is_active,
  }));
  return { checkTypes, packages: pkgs, templates: tpls, categories: (categories.data ?? []) as CatalogCategory[] };
});

export type ClientOption = { id: string; name: string; code: string; status: string; slaDays: number };

export const clientOptions = cache(async (): Promise<ClientOption[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("clients").select("id, name, code, status, sla_days").in("status", ["active", "prospect"]).order("name");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, code: c.code, status: c.status, slaDays: c.sla_days }));
});
