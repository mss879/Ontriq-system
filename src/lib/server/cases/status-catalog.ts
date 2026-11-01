import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import { STATUS_LABELS } from "@/domain/workflow/stages";
import { parseWorkflowSettings, type WorkflowSettings } from "@/domain/workflow/settings";

export type StatusRow = { key: string; label: string; isCustom: boolean; isActive: boolean };

/** Ontriq's wording for each status (Settings, Workflow), including statuses of their own. */
export const getStatusCatalog = cache(async (): Promise<StatusRow[]> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("client_status_catalog").select("key, internal_label, is_custom, is_active").order("sort");
  return (data ?? []).map((s) => ({ key: s.key, label: s.internal_label, isCustom: s.is_custom, isActive: s.is_active }));
});

/** A status key to what the team reads. */
export async function statusLabeller(): Promise<(key: string) => string> {
  const catalog = await getStatusCatalog();
  const labels = new Map(catalog.map((s) => [s.key, s.label]));
  return (key) => labels.get(key) ?? STATUS_LABELS[key] ?? key.replace(/_/g, " ");
}

export const getWorkflowSettings = cache(async (orgId: string): Promise<WorkflowSettings> => {
  const supabase = await createRequestClient();
  const { data } = await supabase.from("orgs").select("settings").eq("id", orgId).maybeSingle();
  return parseWorkflowSettings(data?.settings);
});
