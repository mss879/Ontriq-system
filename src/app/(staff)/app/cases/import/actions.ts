"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { autoCandidateLink, type Channel } from "@/lib/server/candidate/links";
import { candidatePayload, caseFields, IMPORT_COLUMNS, IMPORT_MAX_ROWS, validateRecords, type ImportKey } from "@/domain/cases/import-core";

/**
 * Staff bulk import (cases.create): the rows the person checked in the
 * preview are validated again here, then each becomes a case through
 * create_case (0006), which enforces the same rules as the New case form.
 * One row failing never stops the others. Candidates whose documents Ontriq
 * collects get their link straight away, as with a single new case.
 */

const KEYS = new Set<string>(IMPORT_COLUMNS.map((c) => c.key));

const inputSchema = z.object({
  clientId: z.uuid("Choose a client."),
  packageId: z.uuid("Choose a package or a template."),
  templateId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  processType: z.enum(["client_supplied", "candidate_collected"]),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  records: z
    .array(z.object({ line: z.number().int().min(2).max(100_000), values: z.record(z.string(), z.string().max(500)) }))
    .min(1, "There are no rows to import.")
    .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time.`),
});

export type ImportInput = z.input<typeof inputSchema>;
export type ImportLineResult =
  | { line: number; name: string; ok: true; caseId: string; reference: string; candidateReused: boolean; linkSent: Channel[] }
  | { line: number; name: string; ok: false; error: string };

/** Run `work` over `items` with at most `limit` at a time, keeping the order of results. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

export async function importCases(input: ImportInput): Promise<ActionResult<{ results: ImportLineResult[]; created: number; failed: number }>> {
  try {
    const viewer = await requireViewer({ kind: "staff", permission: "cases.create" });
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the import settings.");
    const v = parsed.data;
    const supabase = await createClient();

    // Template defaults fill what a row leaves empty.
    let defaults: { position_title?: string; department?: string; instructions?: string } = {};
    if (v.templateId) {
      const { data: t } = await supabase.from("request_templates").select("package_id, defaults").eq("id", v.templateId).maybeSingle();
      if (!t || t.package_id !== v.packageId) return fail("That template no longer exists.");
      defaults = (t.defaults ?? {}) as typeof defaults;
    }

    const records = v.records.map((r) => ({
      line: r.line,
      values: Object.fromEntries(Object.entries(r.values).filter(([k, val]) => KEYS.has(k) && val.trim())) as Partial<Record<ImportKey, string>>,
    }));
    const rows = validateRecords(records, { processType: v.processType });

    const results = await mapLimited(rows, 4, async (row): Promise<ImportLineResult> => {
      const name = row.values.full_name ?? "";
      if (row.errors.length) return { line: row.line, name, ok: false, error: row.errors.join(" ") };
      // A row that leaves out the contact only works for someone already on file who can be reached.
      if (v.processType === "candidate_collected" && !row.values.email && !row.values.phone) {
        const { data: known } = await supabase.from("candidates").select("email, phone").eq("nic_canonical", row.nic?.canonical ?? "").maybeSingle();
        if (!known?.email && !known?.phone) return { line: row.line, name, ok: false, error: "Ontriq collects from this candidate, so the row needs an email or phone number." };
      }
      const fields = caseFields(row);
      const candidate = candidatePayload(row);
      const { data, error } = await supabase.rpc("create_case", {
        p: {
          client_id: v.clientId,
          package_id: v.packageId,
          check_type_ids: [],
          template_id: v.templateId ?? null,
          process_type: v.processType,
          priority: v.priority,
          position_title: fields.position_title ?? defaults.position_title ?? null,
          department: fields.department ?? defaults.department ?? null,
          client_reference: fields.client_reference,
          instructions: fields.instructions ?? null,
          // A template's instructions were written by staff, so they stay with the team.
          internal_notes: fields.internal_notes ?? defaults.instructions ?? null,
          created_via: "import",
          candidate,
        },
      });
      if (error || !data) return { line: row.line, name, ok: false, error: rpcErrorMessage(error) };
      const r = data as { case_id: string; reference: string; candidate_reused: boolean };
      let linkSent: Channel[] = [];
      if (v.processType === "candidate_collected") {
        // A reused candidate keeps the contact details on file; read them back rather than trusting the row.
        const { data: c } = await supabase.from("cases").select("candidate:candidates(email, phone)").eq("id", r.case_id).maybeSingle();
        const contact = (c?.candidate as { email: string | null; phone: string | null } | null) ?? { email: null, phone: null };
        linkSent = await autoCandidateLink(r.case_id, viewer.userId, contact);
      }
      return { line: row.line, name, ok: true, caseId: r.case_id, reference: r.reference, candidateReused: r.candidate_reused, linkSent };
    });

    const created = results.filter((r) => r.ok).length;
    if (created) {
      kickWorker(); // auto-assignment for the new cases
      refresh();
    }
    return { ok: true, results, created, failed: results.length - created };
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}
