"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer, type Viewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { parseNic } from "@/domain/nic-core";
import { DISTRICTS } from "@/domain/districts";
import { BULK_MAX_ROWS, validateBulk } from "@/domain/portal/bulk-core";

/**
 * Portal case actions: new requests (one or a spreadsheet) and uploads into
 * the document slots Ontriq shared. The database functions (create_case,
 * portal_begin_upload, portal_finalize_upload) keep every write to the
 * client's own company and enforce the rules; these actions validate input
 * and turn refusals into readable messages.
 */

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const requester = () => requireViewer({ kind: "client", permission: "portal.cases.create" });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

// ---------------------------------------------------------------- uploads

const uploadSchema = z.object({
  caseId: z.uuid(),
  requirementId: z.uuid().optional(),
  category: z.enum(["cv", "other"]).optional(),
  filename: z.string().trim().min(1).max(200),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]),
  size: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "Files must be under 25 MB."),
});

/** Step 1: create the document row in a shared slot (or as a CV) and a signed upload URL. */
export async function portalBeginUpload(input: z.input<typeof uploadSchema>): Promise<ActionResult<{ documentId: string; path: string; token: string }>> {
  return guarded(async () => {
    await requester();
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "This file can't be uploaded.");
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("portal_begin_upload", {
      p_case: v.caseId,
      p_requirement: (v.requirementId ?? null) as unknown as string,
      p_category: (v.category ?? null) as unknown as string,
      p_filename: v.filename,
      p_mime: v.mime,
      p_size: v.size,
    });
    if (error || !data) return fail(rpcErrorMessage(error));
    const d = data as { id: string; bucket: string; path: string };
    const signed = await createAdminClient().storage.from(d.bucket).createSignedUploadUrl(d.path);
    if (signed.error) return fail("We couldn't prepare the upload. Try again in a moment.");
    return { ok: true, documentId: d.id, path: d.path, token: signed.data.token };
  });
}

/** Step 2: confirm the file reached storage, then mark it uploaded. */
export async function portalFinalizeUpload(documentId: string, sha256?: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requester();
    if (!z.uuid().safeParse(documentId).success) return fail("That upload no longer exists.");
    // A pending upload is not readable through the client's row policy yet: look it up as the
    // service, limited to this person's own upload for their company.
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("documents")
      .select("id, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("client_id", viewer.clientId ?? "")
      .eq("uploaded_by", viewer.userId)
      .maybeSingle();
    if (!row) return fail("That upload no longer exists.");
    const exists = await admin.storage.from(row.storage_bucket).exists(row.storage_path);
    if (!exists.data) return fail("The file didn't reach storage. Try uploading it again.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("portal_finalize_upload", {
      p_document: documentId,
      p_sha256: (sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null) as unknown as string,
    });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- one request

const candidateSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the candidate's full name.").max(160),
  nic: optionalText(20),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.email("Enter a valid email address.").optional()),
  phone: optionalText(40).refine((v) => !v || isValidPhoneNumber(v, "LK"), "Enter a valid phone number."),
  address: optionalText(400),
  district: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || (DISTRICTS as readonly string[]).includes(v), "Choose a district."),
  preferredLanguage: z.enum(["en", "si", "ta"]).default("en"),
});

const requestSchema = z
  .object({
    packageId: z.uuid("Choose a package."),
    templateId: z
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    processType: z.enum(["client_supplied", "candidate_collected"]),
    priority: z.enum(["normal", "high", "urgent"]).default("normal"),
    positionTitle: optionalText(120),
    department: optionalText(120),
    clientReference: optionalText(80),
    instructions: optionalText(2000),
    candidate: candidateSchema,
  })
  .superRefine((v, ctx) => {
    if (v.candidate.nic) {
      const nic = parseNic(v.candidate.nic);
      if (!nic.valid) ctx.addIssue({ code: "custom", path: ["candidate", "nic"], message: nic.error });
    }
    if (v.processType === "candidate_collected" && !v.candidate.email && !v.candidate.phone) {
      ctx.addIssue({ code: "custom", path: ["candidate", "email"], message: "Ontriq needs the candidate's email or phone to collect their documents." });
    }
  });

export type PortalRequestInput = z.input<typeof requestSchema>;

function casePayload(viewer: Viewer, v: z.output<typeof requestSchema>) {
  const nic = v.candidate.nic ? parseNic(v.candidate.nic) : null;
  return {
    client_id: viewer.clientId,
    package_id: v.packageId,
    template_id: v.templateId ?? null,
    process_type: v.processType,
    priority: v.priority,
    position_title: v.positionTitle ?? null,
    department: v.department ?? null,
    client_reference: v.clientReference ?? null,
    instructions: v.instructions ?? null,
    created_via: "portal",
    candidate: {
      full_name: v.candidate.fullName,
      nic: nic?.valid ? nic.display : null,
      nic_canonical: nic?.valid ? nic.canonical : null,
      date_of_birth: nic?.valid ? nic.birthDate : null,
      gender: nic?.valid ? nic.gender : null,
      email: v.candidate.email ?? null,
      phone: v.candidate.phone ?? null,
      address: v.candidate.address ?? null,
      district: v.candidate.district ?? null,
      preferred_language: v.candidate.preferredLanguage,
    },
  };
}

/** Send one candidate to Ontriq. The case starts at "Request received" until Ontriq accepts it. */
export async function createPortalRequest(input: PortalRequestInput): Promise<ActionResult<{ caseId: string; reference: string }>> {
  return guarded(async () => {
    const viewer = await requester();
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_case", { p: casePayload(viewer, parsed.data) });
    if (error || !data) return fail(rpcErrorMessage(error));
    kickWorker();
    const r = data as { case_id: string; reference: string };
    refresh();
    return { ok: true, caseId: r.case_id, reference: r.reference };
  });
}

// ---------------------------------------------------------------- a spreadsheet of requests

const bulkSchema = z.object({
  csv: z.string().max(512 * 1024, "That file is too large. Split it into smaller files."),
  packageId: z.uuid("Choose a package."),
  templateId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  processType: z.enum(["client_supplied", "candidate_collected"]),
});

export type BulkLineResult = { line: number; name: string; ok: boolean; reference?: string; caseId?: string; error?: string };

/** Create one case per valid row (up to 100). Rows with errors are reported, not sent. */
export async function createBulkRequests(input: z.input<typeof bulkSchema>): Promise<ActionResult<{ results: BulkLineResult[]; created: number }>> {
  return guarded(async () => {
    const viewer = await requester();
    const parsed = bulkSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the file and try again.");
    const { csv, packageId, templateId, processType } = parsed.data;
    const check = validateBulk(csv);
    if (check.missingColumns.length) return fail(`The file needs a ${check.missingColumns.join(", ")} column.`);
    if (!check.rows.length) return fail("The file has no candidates in it.");

    const supabase = await createClient();
    const { data: settings } = await supabase.from("client_settings").select("portal").eq("client_id", viewer.clientId ?? "").maybeSingle();
    if ((settings?.portal as Record<string, boolean> | null)?.bulk_upload === false) return fail("Bulk requests are not switched on for your company. Ask Ontriq to turn them on.");

    let defaults: { position_title?: string; department?: string; instructions?: string } = {};
    let priority: "normal" | "high" | "urgent" = "normal";
    if (templateId) {
      const { data: t } = await supabase.from("request_templates").select("defaults, priority").eq("id", templateId).maybeSingle();
      defaults = (t?.defaults ?? {}) as typeof defaults;
      priority = (t?.priority as typeof priority) ?? "normal";
    }

    const results: BulkLineResult[] = [];
    for (const row of check.rows.slice(0, BULK_MAX_ROWS)) {
      const name = row.values.full_name ?? "";
      if (row.errors.length) {
        results.push({ line: row.line, name, ok: false, error: row.errors.join(" ") });
        continue;
      }
      const item = requestSchema.safeParse({
        packageId,
        templateId,
        processType,
        priority,
        positionTitle: row.values.position_title ?? defaults.position_title,
        department: row.values.department ?? defaults.department,
        clientReference: row.values.client_reference,
        instructions: defaults.instructions,
        candidate: {
          fullName: name,
          nic: row.values.nic,
          email: row.values.email,
          phone: row.values.phone,
          district: row.values.district && (DISTRICTS as readonly string[]).includes(row.values.district) ? row.values.district : undefined,
        },
      });
      if (!item.success) {
        results.push({ line: row.line, name, ok: false, error: item.error.issues.map((i) => i.message).join(" ") });
        continue;
      }
      const { data, error } = await supabase.rpc("create_case", { p: casePayload(viewer, item.data) });
      if (error || !data) {
        results.push({ line: row.line, name, ok: false, error: rpcErrorMessage(error) });
        continue;
      }
      const r = data as { case_id: string; reference: string };
      results.push({ line: row.line, name, ok: true, reference: r.reference, caseId: r.case_id });
    }
    const created = results.filter((r) => r.ok).length;
    if (created) kickWorker();
    refresh();
    return { ok: true, results, created };
  });
}
