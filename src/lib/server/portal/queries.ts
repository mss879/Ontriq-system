import "server-only";
import { cache } from "react";
import { createRequestClient } from "@/lib/supabase/server";
import type { PortalCaseDetail, PortalCaseRow, PortalDashboard, PortalPriceItem, PortalStatusFilter, PortalTeamMember } from "@/domain/portal/types";

/**
 * Portal reads. Client users read cases only through the portal_* functions
 * (0021), which keep to their company and to what Ontriq lets them see.
 * Packages, templates and check types are read under their own row level
 * security. Server Components only (uncached business reads).
 */

export async function portalDashboard(): Promise<PortalDashboard> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_dashboard");
  if (error) throw new Error(`portal_dashboard: ${error.message}`);
  return data as unknown as PortalDashboard;
}

export type PortalCaseFilters = { q?: string; status?: PortalStatusFilter; sort?: "recent" | "due"; page?: number };
export const PORTAL_PAGE_SIZE = 25;

export function parsePortalFilters(sp: Record<string, string | string[] | undefined>): PortalCaseFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? undefined;
  const status = one("status");
  return {
    q: one("q")?.slice(0, 80) || undefined,
    status: (["all", "action", "active", "released", "cancelled"] as const).find((s) => s === status) ?? "all",
    sort: one("sort") === "due" ? "due" : "recent",
    page: Math.max(1, Number.parseInt(one("page") ?? "1", 10) || 1),
  };
}

export async function portalCases(f: PortalCaseFilters): Promise<{ total: number; rows: PortalCaseRow[] }> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_cases", {
    p: { q: f.q ?? "", status: f.status ?? "all", sort: f.sort ?? "recent", limit: PORTAL_PAGE_SIZE, offset: ((f.page ?? 1) - 1) * PORTAL_PAGE_SIZE },
  });
  if (error) throw new Error(`portal_cases: ${error.message}`);
  return data as unknown as { total: number; rows: PortalCaseRow[] };
}

/** One case, or null when it isn't theirs. Deduped per request for metadata and regions. */
export const portalCaseDetail = cache(async (caseId: string): Promise<PortalCaseDetail | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_case_detail", { p_case: caseId });
  if (error) {
    if (error.code === "P0002" || error.code === "22P02") return null;
    throw new Error(`portal_case_detail: ${error.message}`);
  }
  return data as unknown as PortalCaseDetail;
});

export async function portalPriceList(): Promise<PortalPriceItem[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_price_list");
  if (error) throw new Error(`portal_price_list: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, unit_price: Number(r.unit_price) })) as PortalPriceItem[];
}

export async function portalTeam(): Promise<PortalTeamMember[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_team");
  if (error) throw new Error(`portal_team: ${error.message}`);
  return (data ?? []) as unknown as PortalTeamMember[];
}

export type PortalPackage = {
  id: string;
  name: string;
  code: string | null;
  description: string;
  owner_scope: "org" | "client";
  is_active: boolean;
  /** A client-built package waiting for Ontriq's approval. */
  needs_approval: boolean;
  pricing_mode: "sum" | "fixed";
  fixed_price: number | null;
  currency: string;
  tat_days: number;
  default_process_type: "client_supplied" | "candidate_collected";
  items: { check_type_id: string; name: string; key: string; unit_price: number }[];
  total: number;
};

/** Packages the client may use (Ontriq's offered packages and their own), with prices. */
export async function portalPackages(): Promise<PortalPackage[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase
    .from("packages")
    .select("id, name, code, description, owner_scope, is_active, needs_approval, pricing_mode, fixed_price, currency, tat_days, default_process_type, items:package_items(check_type_id, unit_price, sort, check_type:check_types(name, key, sort))")
    .order("owner_scope", { ascending: true })
    .order("name");
  if (error) throw new Error(`packages: ${error.message}`);
  return (data ?? []).map((p) => {
    const items = ((p.items ?? []) as { check_type_id: string; unit_price: number; sort: number; check_type: { name: string; key: string; sort: number } | null }[])
      .sort((a, b) => a.sort - b.sort || (a.check_type?.sort ?? 0) - (b.check_type?.sort ?? 0))
      .map((i) => ({ check_type_id: i.check_type_id, name: i.check_type?.name ?? "", key: i.check_type?.key ?? "", unit_price: Number(i.unit_price) }));
    const sum = items.reduce((a, i) => a + i.unit_price, 0);
    return {
      ...(p as unknown as Omit<PortalPackage, "items" | "total">),
      fixed_price: p.fixed_price === null ? null : Number(p.fixed_price),
      items,
      total: p.pricing_mode === "fixed" && p.fixed_price !== null ? Number(p.fixed_price) : sum,
    };
  });
}

export type PortalTemplate = {
  id: string;
  name: string;
  description: string;
  package_id: string;
  process_type: "client_supplied" | "candidate_collected";
  priority: "normal" | "high" | "urgent";
  defaults: { position_title?: string; department?: string; instructions?: string };
  is_favourite: boolean;
  usage_count: number;
  last_used_at: string | null;
  is_active: boolean;
};

/** The client company's own request templates, favourites and most used first. */
export async function portalTemplates(): Promise<PortalTemplate[]> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase
    .from("request_templates")
    .select("id, name, description, package_id, process_type, priority, defaults, is_favourite, usage_count, last_used_at, is_active")
    .eq("owner_scope", "client")
    .order("is_favourite", { ascending: false })
    .order("usage_count", { ascending: false })
    .order("name");
  if (error) throw new Error(`request_templates: ${error.message}`);
  return (data ?? []) as unknown as PortalTemplate[];
}

export type PortalClientProfile = {
  id: string;
  name: string;
  code: string;
  address: Record<string, string> | null;
  email: string | null;
  phone: string | null;
  default_template: string | null;
  portal: { bulk_upload: boolean; client_packages: boolean; client_packages_need_approval: boolean };
};

/** The company as its own users may read it. The clients table holds Ontriq's notes, so they never touch it (0048). */
export const portalClientProfile = cache(async (): Promise<PortalClientProfile | null> => {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.rpc("portal_client_profile");
  if (error) throw new Error(`portal_client_profile: ${error.message}`);
  return (data ?? null) as unknown as PortalClientProfile | null;
});

/** Portal settings Ontriq set for this client (bulk upload, client packages, approval). */
export async function portalSettings(): Promise<PortalClientProfile["portal"]> {
  const profile = await portalClientProfile();
  return profile?.portal ?? { bulk_upload: true, client_packages: true, client_packages_need_approval: false };
}
