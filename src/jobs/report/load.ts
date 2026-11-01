/**
 * Read everything the report says from the database (service role) and
 * compile it (src/domain/reports/compile-core.ts). The report.render job
 * uses it for drafts; the approve action uses it to check the case did not
 * change after the draft. Plain Node: relative imports only.
 */
import { createHash } from "node:crypto";
import type { ServiceClient } from "../admin-client";
import { canonicalJson, compileReport, fixedAnnexureCategories, type ReportInputs, type ReportSnapshot } from "../../domain/reports/compile-core";
import { checkTypeSchema } from "../../domain/check-types/schema";
import type { ResultTone } from "../../domain/check-types/schema";

export type AnnexureSource = { document_id: string; bucket: string; path: string; mime: string };

/** A client's address on one line, however it was stored. */
function addressLine(address: unknown): string | null {
  if (typeof address === "string") return address.trim() || null;
  const a = (address ?? {}) as Record<string, unknown>;
  if (typeof a.text === "string") return a.text.replace(/\s*\n\s*/g, ", ").trim() || null;
  return [a.line1, a.line2, a.city, a.district].filter((x) => typeof x === "string" && x.trim()).join(", ") || null;
}

export async function loadReportInputs(admin: ServiceClient, caseId: string): Promise<{ inputs: ReportInputs; sources: AnnexureSource[]; orgId: string }> {
  const { data: c, error } = await admin
    .from("cases")
    .select(
      "id, org_id, reference, client_reference, position_title, department, package_snapshot, process_type, received_at, completed_at, proposed_result, client:clients(name, address), candidate:candidates(full_name, nic, date_of_birth), org:orgs(name, branding)",
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

  const parsed = (checks ?? []).map((k) => ({ k, schema: checkTypeSchema.parse((k.version as unknown as { schema: unknown }).schema) }));

  // Files marked for the report, plus the fixed annexure: it goes in without anyone having to mark it.
  const fixed = fixedAnnexureCategories(parsed.map(({ k, schema }) => ({ state: k.state, schema })));
  const annexed = admin
    .from("documents")
    .select("id, case_check_id, category, filename, mime, sha256, created_at, storage_bucket, storage_path, record_key, visibility, original_kind, sensitive, withheld_reason")
    .eq("case_id", caseId)
    .in("status", ["uploaded", "accepted"]);
  // Withheld evidence is read too: its check says it exists, and only the file stays behind.
  const scope = ["visibility.in.(report,client)", "withheld_reason.not.is.null", ...(fixed.length ? [`category.in.(${fixed.join(",")})`] : [])].join(",");
  const { data: found } = await annexed.or(scope);
  const [{ data: cats }, { data: links }, { data: slots }] = await Promise.all([
    admin.from("document_categories").select("key, name, in_report").eq("org_id", c.org_id),
    admin.from("requirement_files").select("document_id, pages, requirement:case_check_requirements(label, case_check_id)").eq("case_id", caseId).order("created_at"),
    admin.from("case_check_requirements").select("category, label, case_check_id").eq("case_id", caseId),
  ]);
  const catName = new Map((cats ?? []).map((x) => [x.key, x.name]));
  // A file shared with the client stays in the report if it is evidence. A CV the client sent is not.
  const evidence = new Set((cats ?? []).filter((x) => x.in_report).map((x) => x.key));
  // So is a file a person confirmed holds evidence, whatever it was uploaded as.
  const holds = (id: string) => (links ?? []).filter((l) => l.document_id === id).map((l) => {
    const r = l.requirement as unknown as { label: string; case_check_id: string | null };
    return { check_id: r.case_check_id, label: r.label, pages: l.pages };
  });
  // A file on the case as a whole counts for a check when that is the only slot of its kind (public.sync_requirement_counts).
  const soleSlot = (d: { case_check_id: string | null; category: string }) => {
    const same = (slots ?? []).filter((s) => s.category === d.category);
    return d.case_check_id === null && same.length === 1 ? same[0].case_check_id : null;
  };
  const docs = (found ?? []).filter((d) => d.visibility === "report" || d.withheld_reason || evidence.has(d.category) || fixed.includes(d.category) || holds(d.id).length);

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
      client_address: addressLine((c.client as unknown as { address: unknown }).address),
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
    checks: parsed.map(({ k, schema }) => ({
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
    })),
    documents: docs.map((d) => ({
      id: d.id,
      case_check_id: d.case_check_id,
      category: d.category,
      category_name: catName.get(d.category) ?? d.category,
      filename: d.filename,
      mime: d.mime,
      sha256: d.sha256,
      created_at: d.created_at,
      record_key: d.record_key,
      original_kind: d.original_kind,
      ...(d.sensitive && d.withheld_reason && !fixed.includes(d.category) ? { withheld: true } : {}),
      ...(holds(d.id).length ? { holds: holds(d.id) } : {}),
      ...(soleSlot(d) ? { for_check: soleSlot(d) } : {}),
    })),
    qc: (qc ?? []).map((q) => ({ kind: q.kind as "pre" | "post", reviewer: q.reviewer_id ? (nameOf.get(q.reviewer_id) ?? "Ontriq QC") : "Ontriq QC", created_at: q.created_at })),
  };
  const sources = docs.map((d) => ({ document_id: d.id, bucket: d.storage_bucket, path: d.storage_path, mime: d.mime }));
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
