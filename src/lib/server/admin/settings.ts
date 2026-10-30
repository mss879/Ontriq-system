import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { checkTypeSchema, type CheckTypeSchema } from "@/domain/check-types/schema";
import { DEFAULT_WEIGHTS, type Strategy, type Weights } from "@/domain/assignment/assignment-core";

// ---------------------------------------------------------------- check types

export type CheckTypeListItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  sort: number;
  isBuiltin: boolean;
  archived: boolean;
  currentVersion: number | null;
  publishedAt: string | null;
  hasDraft: boolean;
  fieldCount: number;
  documentCount: number;
  slaDays: number | null;
};

export async function listCheckTypes(): Promise<CheckTypeListItem[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase
    .from("check_types")
    .select(
      "id, key, name, description, icon, sort, is_builtin, archived_at, draft_version_id, current:check_type_versions!check_types_current_version_fk(version, published_at, schema)",
    )
    .order("sort")
    .order("name");
  return (data ?? []).map((t) => {
    const current = t.current as { version: number | null; published_at: string | null; schema: { fields?: unknown[]; documents?: unknown[]; sla_days?: number } } | null;
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      icon: t.icon,
      sort: t.sort,
      isBuiltin: t.is_builtin,
      archived: Boolean(t.archived_at),
      currentVersion: current?.version ?? null,
      publishedAt: current?.published_at ?? null,
      hasDraft: Boolean(t.draft_version_id),
      fieldCount: current?.schema?.fields?.length ?? 0,
      documentCount: current?.schema?.documents?.length ?? 0,
      slaDays: current?.schema?.sla_days ?? null,
    };
  });
}

export type CheckTypeVersionInfo = { id: string; version: number | null; publishedAt: string | null; notes: string | null; publishedBy: string | null };

export type CheckTypeEditorData = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  sort: number;
  isBuiltin: boolean;
  archived: boolean;
  /** The schema the editor opens with: the draft if there is one, else the current version. */
  schema: CheckTypeSchema;
  editingDraft: boolean;
  currentVersion: number | null;
  versions: CheckTypeVersionInfo[];
  usage: number;
};

const STARTER: CheckTypeSchema = checkTypeSchema.parse({ fields: [{ key: "notes", label: "Notes", type: "textarea", width: "full" }] });

export const getCheckTypeEditor = cache(async (id: string): Promise<CheckTypeEditorData | null> => {
  const supabase = await createRequestClient();
  const { data: t } = await supabase
    .from("check_types")
    .select("id, key, name, description, icon, sort, is_builtin, archived_at, current_version_id, draft_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!t) return null;
  const [{ data: versions }, { count }] = await Promise.all([
    supabase.from("check_type_versions").select("id, version, schema, published_at, notes, published_by").eq("check_type_id", id).order("created_at", { ascending: false }),
    supabase.from("case_checks").select("id", { count: "exact", head: true }).eq("check_type_id", id),
  ]);
  const draft = (versions ?? []).find((v) => v.id === t.draft_version_id);
  const current = (versions ?? []).find((v) => v.id === t.current_version_id);
  const raw = draft?.schema ?? current?.schema;
  const parsed = checkTypeSchema.safeParse(raw);
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    icon: t.icon,
    sort: t.sort,
    isBuiltin: t.is_builtin,
    archived: Boolean(t.archived_at),
    schema: parsed.success ? parsed.data : STARTER,
    editingDraft: Boolean(draft),
    currentVersion: current?.version ?? null,
    versions: (versions ?? [])
      .filter((v) => v.published_at)
      .map((v) => ({ id: v.id, version: v.version, publishedAt: v.published_at, notes: v.notes, publishedBy: v.published_by })),
    usage: count ?? 0,
  };
});

export async function documentCategories(): Promise<{ key: string; name: string; sensitive: boolean }[]> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("document_categories").select("key, name, sensitive").eq("is_active", true).order("sort");
  return data ?? [];
}

// ---------------------------------------------------------------- packages

export async function packageVisibility(): Promise<Map<string, string[]>> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("package_client_visibility").select("package_id, client_id");
  const out = new Map<string, string[]>();
  for (const r of data ?? []) out.set(r.package_id, [...(out.get(r.package_id) ?? []), r.client_id]);
  return out;
}

// ---------------------------------------------------------------- assignment

export type AssignmentRules = { strategy: Strategy; weights: Weights; considerSkills: boolean; considerRegions: boolean; assignChecks: boolean };

export async function getAssignmentRules(orgId: string): Promise<AssignmentRules> {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("assignment_rules").select("*").eq("org_id", orgId).maybeSingle();
  return {
    strategy: (data?.strategy ?? "least_loaded") as Strategy,
    weights: { ...DEFAULT_WEIGHTS, ...((data?.weights ?? {}) as Partial<Weights>) },
    considerSkills: data?.consider_skills ?? true,
    considerRegions: data?.consider_regions ?? true,
    assignChecks: data?.assign_checks ?? true,
  };
}

export type StaffLoadRow = {
  userId: string;
  name: string;
  roleKey: string;
  permissions: string[];
  autoAssign: boolean;
  hasSettings: boolean;
  onLeave: boolean;
  skills: string[];
  regions: string[];
  maxOpenCases: number;
  maxOpenChecks: number;
  openCases: number;
  openChecks: number;
  weightedLoad: number;
  overdue: number;
  completed7d: number;
  lastAssignedAt: string | null;
  isNew: boolean;
};

export async function staffLoad(): Promise<StaffLoadRow[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("staff_load_snapshot");
  if (error) return [];
  type Raw = {
    user_id: string;
    name: string;
    role_key: string;
    permissions: string[];
    auto_assign: boolean;
    has_settings: boolean;
    on_leave: boolean;
    skills: string[];
    regions: string[];
    max_open_cases: number;
    max_open_checks: number;
    open_cases: number;
    open_checks: number;
    weighted_load: number;
    overdue: number;
    completed_7d: number;
    last_assigned_at: string | null;
    is_new: boolean;
  };
  return ((data ?? []) as unknown as Raw[]).map((s) => ({
    userId: s.user_id,
    name: s.name,
    roleKey: s.role_key,
    permissions: s.permissions ?? [],
    autoAssign: s.auto_assign,
    hasSettings: s.has_settings,
    onLeave: s.on_leave,
    skills: s.skills ?? [],
    regions: s.regions ?? [],
    maxOpenCases: s.max_open_cases,
    maxOpenChecks: s.max_open_checks,
    openCases: s.open_cases,
    openChecks: s.open_checks,
    weightedLoad: Number(s.weighted_load),
    overdue: s.overdue,
    completed7d: s.completed_7d,
    lastAssignedAt: s.last_assigned_at,
    isNew: s.is_new,
  }));
}

export type LeaveRow = { id: string; userId: string; startsOn: string; endsOn: string; kind: string; note: string | null };

/** Leave that has not ended yet (Colombo date). */
export async function upcomingLeave(): Promise<LeaveRow[]> {
  const supabase = await createRequestClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
  const { data } = await supabase.from("staff_availability").select("id, user_id, starts_on, ends_on, kind, note").gte("ends_on", today).order("starts_on");
  return (data ?? []).map((l) => ({ id: l.id, userId: l.user_id, startsOn: l.starts_on, endsOn: l.ends_on, kind: l.kind, note: l.note }));
}
