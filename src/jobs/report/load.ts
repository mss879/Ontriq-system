/**
 * Read everything the report says from the database (service role) and
 * compile it (src/domain/reports/compile-core.ts). The report.render job
 * uses it for drafts; the approve action uses it to check the case did not
 * change after the draft. Plain Node: relative imports only.
 */
import { createHash } from "node:crypto";
import type { ServiceClient } from "../admin-client";
import { canonicalJson, compileReport, type ReportInputs, type ReportSnapshot } from "../../domain/reports/compile-core";
import { checkTypeSchema } from "../../domain/check-types/schema";
import type { ResultTone } from "../../domain/check-types/schema";

export type AnnexureSource = { document_id: string; bucket: string; path: string; mime: string };

export async function loadReportInputs(admin: ServiceClient, caseId: string): Promise<{ inputs: ReportInputs; sources: AnnexureSource[]; orgId: string }> {
  const { data: c, error } = await admin
    .from("cases")
    .select(
      "id, org_id, reference, client_reference, position_title, department, package_snapshot, process_type, received_at, completed_at, proposed_result, client:clients(name), candidate:candidates(full_name, nic, date_of_birth), org:orgs(name, branding)",
    )
    .eq("id", caseId)
    .single();
  if (error || !c) throw new Error(`case ${caseId} not found`);
  const org = c.org as unknown as { name: string; branding: Record<string, string> | null };
  const b = org.branding ?? {};

  const { data: checks } = await admin
    .from("case_checks")
    .select("id, label, sort, state, result, result_tone, client_note, values, completed_at, check_type:check_types(key), version:check_type_versions(schema)")
    .eq("case_id", caseId);

  const { data: docs } = await admin
    .from("documents")
    .select("id, case_check_id, category, filename, mime, sha256, created_at, storage_bucket, storage_path")
    .eq("case_id", caseId)
    .eq("visibility", "report")
    .in("status", ["uploaded", "accepted"]);
  const { data: cats } = await admin.from("document_categories").select("key, name").eq("org_id", c.org_id);
  const catName = new Map((cats ?? []).map((x) => [x.key, x.name]));

  const { data: qc } = await admin.from("qc_reviews").select("kind, reviewer_id, created_at").eq("case_id", caseId).eq("decision", "approved");
  const reviewerIds = [...new Set((qc ?? []).map((q) => q.reviewer_id).filter(Boolean) as string[])];
  const { data: people } = reviewerIds.length ? await admin.from("profiles").select("id, full_name").in("id", reviewerIds) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name || "Ontriq QC"]));

  const inputs: ReportInputs = {
    org: {
      name: b.display_name || org.name,
      legal_name: b.legal_name || org.name,
      address: b.address ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
      website: b.website ?? "",
    },
    case: {
      reference: c.reference,
      client_name: (c.client as unknown as { name: string }).name,
      client_reference: c.client_reference,
      position_title: c.position_title,
      department: c.department,
      package_name: ((c.package_snapshot ?? {}) as { name?: string }).name ?? null,
      process_type: c.process_type,
      received_at: c.received_at,
      completed_at: c.completed_at,
      proposed_result: c.proposed_result as ResultTone | null,
    },
    candidate: c.candidate as unknown as ReportInputs["candidate"],
    checks: (checks ?? []).map((k) => {
      const schema = checkTypeSchema.parse((k.version as unknown as { schema: unknown }).schema);
      return {
        id: k.id,
        key: (k.check_type as unknown as { key: string }).key,
        label: k.label,
        sort: k.sort,
        state: k.state,
        result: k.result,
        result_tone: k.result_tone as ResultTone | null,
        client_note: k.client_note,
        values: (k.values ?? {}) as Record<string, unknown>,
        completed_at: k.completed_at,
        schema: { fields: schema.fields, result: schema.result, fixed_annexure: schema.fixed_annexure },
      };
    }),
    documents: (docs ?? []).map((d) => ({
      id: d.id,
      case_check_id: d.case_check_id,
      category: d.category,
      category_name: catName.get(d.category) ?? d.category,
      filename: d.filename,
      mime: d.mime,
      sha256: d.sha256,
      created_at: d.created_at,
    })),
    qc: (qc ?? []).map((q) => ({ kind: q.kind as "pre" | "post", reviewer: q.reviewer_id ? (nameOf.get(q.reviewer_id) ?? "Ontriq QC") : "Ontriq QC", created_at: q.created_at })),
  };
  const sources = (docs ?? []).map((d) => ({ document_id: d.id, bucket: d.storage_bucket, path: d.storage_path, mime: d.mime }));
  return { inputs, sources, orgId: c.org_id };
}

export function snapshotHash(snapshot: ReportSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

/** Compile the case as it is now and return the snapshot with its hash. */
export async function currentSnapshot(admin: ServiceClient, caseId: string) {
  const { inputs, sources, orgId } = await loadReportInputs(admin, caseId);
  const snapshot = compileReport(inputs);
  return { snapshot, hash: snapshotHash(snapshot), sources, orgId };
}
