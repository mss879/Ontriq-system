"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireViewer } from "@/lib/server/viewer";
import { AuthError, authErrorMessage, rpcErrorMessage } from "@/lib/server/errors";
import { fail, zodFieldErrors, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { parseNic } from "@/domain/nic-core";
import { DISTRICT_CHOICES } from "@/domain/districts";
import { parseCheckTypeSchema } from "@/domain/check-types/schema";
import { validateCheckValues } from "@/domain/check-types/validate";
import { recordMoves } from "@/domain/check-types/records";
import { CHECK_STATES } from "@/domain/workflow/stages";
import { isValidPhoneNumber } from "libphonenumber-js";
import type { Json } from "@/lib/supabase/database.types";
import { autoCandidateLink, emailCandidateUpdate, type Channel } from "@/lib/server/candidate/links";

/**
 * Case actions. Each one confirms the caller, validates input, then calls the
 * database function that enforces permission and the workflow rules
 * (0006_cases, 0007_documents, 0011_qc, 0016_assignment). Refusals come back
 * as readable messages.
 */

async function staff() {
  return requireViewer({ kind: "staff" });
}

async function guarded<T extends object>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return fail(authErrorMessage(error));
    throw error;
  }
}

const uuid = z.uuid();

/** The generated types mark these function arguments as strings, but the functions accept null ("no check", "unassign"). */
const orNull = (v: string | null | undefined) => (v ?? null) as unknown as string;

// ---------------------------------------------------------------- create

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const createSchema = z
  .object({
    clientId: z.uuid("Choose a client."),
    packageId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    checkTypeIds: z.array(z.uuid()).optional(),
    templateId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    processType: z.enum(["client_supplied", "candidate_collected"]),
    priority: z.enum(["normal", "high", "urgent"]).default("normal"),
    positionTitle: optionalText(120),
    department: optionalText(120),
    clientReference: optionalText(80),
    instructions: optionalText(2000),
    internalNotes: optionalText(2000),
    extraChecks: z.array(z.object({ checkTypeId: z.uuid(), label: z.string().trim().min(2, "Name each extra check.").max(120) })).max(10).default([]),
    candidate: z.object({
      id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
      fullName: z.string().trim().max(160).default(""),
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
        .refine((v) => !v || DISTRICT_CHOICES.includes(v), "Choose a district."),
      preferredLanguage: z.enum(["en", "si", "ta"]).default("en"),
    }),
  })
  .superRefine((v, ctx) => {
    if (!v.packageId && !v.checkTypeIds?.length) ctx.addIssue({ code: "custom", path: ["packageId"], message: "Choose a package or at least one check." });
    // Spec 2.2: Type 2 starts by contacting the candidate. A saved candidate is checked in createCase.
    if (v.processType === "candidate_collected" && !v.candidate.id && !v.candidate.email && !v.candidate.phone) {
      ctx.addIssue({ code: "custom", path: ["candidate", "email"], message: "Ontriq collects from this candidate, so add an email or phone number to reach them." });
    }
    if (!v.candidate.id && v.candidate.fullName.length < 2) ctx.addIssue({ code: "custom", path: ["candidate", "fullName"], message: "Enter the candidate's full name." });
    if (v.candidate.nic && !parseNic(v.candidate.nic).valid) {
      const parsed = parseNic(v.candidate.nic);
      ctx.addIssue({ code: "custom", path: ["candidate", "nic"], message: parsed.valid ? "" : parsed.error });
    }
  });

export type CreateCaseInput = z.input<typeof createSchema>;

export async function createCase(input: CreateCaseInput): Promise<ActionResult<{ caseId: string; reference: string; candidateReused: boolean; candidateLinkSent: Channel[] }>> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "cases.create" });
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const nic = v.candidate.nic ? parseNic(v.candidate.nic) : null;
    const supabase = await createClient();
    if (v.processType === "candidate_collected" && v.candidate.id) {
      const { data: saved } = await supabase.from("candidates").select("email, phone").eq("id", v.candidate.id).maybeSingle();
      const email = saved?.email ? undefined : v.candidate.email;
      const phone = saved?.phone ? undefined : v.candidate.phone;
      if (!saved?.email && !saved?.phone && !email && !phone) {
        return fail("Check the highlighted fields.", { "candidate.email": ["This candidate has no email or phone on file. Add one to reach them."] });
      }
      // A contact typed here fills a gap on the saved record, so the link can go out.
      if (email || phone) await supabase.rpc("update_candidate", { p_candidate: v.candidate.id, p: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } });
    }
    const { data, error } = await supabase.rpc("create_case", {
      p: {
        client_id: v.clientId,
        package_id: v.packageId ?? null,
        check_type_ids: v.packageId ? [] : (v.checkTypeIds ?? []),
        template_id: v.templateId ?? null,
        process_type: v.processType,
        priority: v.priority,
        position_title: v.positionTitle ?? null,
        department: v.department ?? null,
        client_reference: v.clientReference ?? null,
        instructions: v.instructions ?? null,
        internal_notes: v.internalNotes ?? null,
        extra_checks: v.extraChecks.map((x) => ({ check_type_id: x.checkTypeId, label: x.label })),
        created_via: "staff",
        candidate: {
          id: v.candidate.id ?? null,
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
      },
    });
    if (error || !data) return fail(rpcErrorMessage(error));
    kickWorker(); // run auto-assignment now
    const r = data as { case_id: string; reference: string; candidate_reused: boolean };
    // Process Type 2: Ontriq collects the documents, so the candidate gets their link straight away.
    const candidateLinkSent = v.processType === "candidate_collected" ? await autoCandidateLink(r.case_id, viewer.userId) : [];
    refresh();
    return { ok: true, caseId: r.case_id, reference: r.reference, candidateReused: r.candidate_reused, candidateLinkSent };
  });
}

/** Look up an existing candidate by NIC while typing in the new case form. */
export async function findCandidateByNic(nicInput: string): Promise<ActionResult<{ candidate: { id: string; fullName: string; email: string | null; phone: string | null; caseCount: number } | null; birthDate?: string; gender?: string }>> {
  return guarded(async () => {
    await staff();
    const nic = parseNic(nicInput);
    if (!nic.valid) return fail(nic.error);
    const supabase = await createClient();
    const { data } = await supabase.from("candidates").select("id, full_name, email, phone, cases(count)").eq("nic_canonical", nic.canonical).maybeSingle();
    const count = (data?.cases as unknown as { count: number }[] | undefined)?.[0]?.count ?? 0;
    return {
      ok: true,
      candidate: data ? { id: data.id, fullName: data.full_name, email: data.email, phone: data.phone, caseCount: count } : null,
      birthDate: nic.birthDate,
      gender: nic.gender,
    };
  });
}

// ---------------------------------------------------------------- workflow

const EVENTS = ["accept_request", "submit_pre_qc", "start_verification", "submit_post_qc", "return_to_documents"] as const;

export async function transitionCase(caseId: string, event: (typeof EVENTS)[number], reason?: string): Promise<ActionResult<{ warning?: string; left?: boolean }>> {
  return guarded(async () => {
    const viewer = await staff();
    if (!uuid.safeParse(caseId).success || !EVENTS.includes(event)) return fail("Unknown action.");
    const supabase = await createClient();
    // Asked before the move: Data Entry can't read the case once it has gone back.
    const goingBack = event === "return_to_documents" ? await whoHearsOfTheReturn(caseId) : null;
    const { error } = await supabase.rpc("case_transition", { p_case: caseId, p_event: event, p_reason: reason?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    if (event === "accept_request") {
      const { data: c } = await supabase.from("cases").select("process_type").eq("id", caseId).maybeSingle();
      if (c?.process_type === "candidate_collected") await autoCandidateLink(caseId, viewer.userId);
    }
    // The database passed the message on with the move. Whoever provides the document needs to know it's there.
    const warning = !goingBack
      ? null
      : goingBack.toCandidate
        ? (await emailCandidateUpdate(caseId, viewer.userId).catch(() => false))
          ? null
          : "The case went back and your message is on their page, but they have no working link to read it. Someone needs to send a new link from the Candidate section."
        : goingBack.nobody
          ? NOBODY_READS
          : null;
    if (goingBack) kickWorker();
    // Data entry sees a case while it is theirs. After that this page is someone else's.
    if ((event === "start_verification" || goingBack) && !(await supabase.from("cases").select("id").eq("id", caseId).maybeSingle()).data) {
      return { ok: true, left: true, ...(warning ? { warning } : {}) };
    }
    refresh();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

/** The NIC on a portal request matched someone with another name: same person, or a slip. */
export async function resolveCandidateMatch(caseId: string, same: boolean): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("resolve_candidate_match", { p_case: caseId, p_same: same });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function setCaseHold(caseId: string, hold: boolean, reason?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_case_hold", { p_case: caseId, p_hold: hold, p_reason: reason?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function cancelCase(caseId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_case", { p_case: caseId, p_reason: reason.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const detailsSchema = z.object({
  priority: z.enum(["normal", "high", "urgent"]).optional(),
  positionTitle: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  clientReference: z.string().trim().max(80).optional(),
  instructions: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});

export async function updateCaseDetails(caseId: string, input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const parsed = detailsSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const p: Record<string, string> = {};
    if (v.priority) p.priority = v.priority;
    if (v.positionTitle !== undefined) p.position_title = v.positionTitle;
    if (v.department !== undefined) p.department = v.department;
    if (v.clientReference !== undefined) p.client_reference = v.clientReference;
    if (v.instructions !== undefined) p.instructions = v.instructions;
    if (v.internalNotes !== undefined) p.internal_notes = v.internalNotes;
    if (v.dueAt) p.due_at = v.dueAt;
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_case_details", { p_case: caseId, p });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const candidateSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name.").max(160),
  nic: z.string().trim().max(20).optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).optional(),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((v) => !v || isValidPhoneNumber(v, "LK"), "Enter a valid phone number."),
  address: z.string().trim().max(400).optional(),
  district: z
    .string()
    .optional()
    .refine((v) => !v || DISTRICT_CHOICES.includes(v), "Choose a district."),
  preferredLanguage: z.enum(["en", "si", "ta"]).optional(),
});

export async function updateCandidate(candidateId: string, input: z.input<typeof candidateSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const parsed = candidateSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
    const v = parsed.data;
    const nic = v.nic ? parseNic(v.nic) : null;
    if (nic && !nic.valid) return fail("Check the highlighted fields.", { nic: [nic.error] });
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_candidate", {
      p_candidate: candidateId,
      p: {
        full_name: v.fullName,
        nic: nic?.valid ? nic.display : "",
        nic_canonical: nic?.valid ? nic.canonical : "",
        ...(nic?.valid ? { date_of_birth: nic.birthDate, gender: nic.gender } : {}),
        // Left out, the contact stays as it is. On a request it may be what the client typed, not the record.
        ...(v.email !== undefined ? { email: v.email } : {}),
        ...(v.phone !== undefined ? { phone: v.phone } : {}),
        address: v.address ?? "",
        district: v.district ?? "",
        ...(v.preferredLanguage ? { preferred_language: v.preferredLanguage } : {}),
      },
    });
    if (error) return fail(error.code === "23505" ? "Another candidate already has this NIC number." : rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function addCaseNote(caseId: string, checkId: string | null, body: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!body.trim()) return fail("Write a note first.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_case_note", { p_case: caseId, p_check: orNull(checkId), p_body: body.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- assignment

export async function assignCases(caseIds: string[], userId: string | null, reason?: string): Promise<ActionResult<{ assigned: number; failed: number; error?: string }>> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "cases.assign" });
    const ids = caseIds.filter((id) => uuid.safeParse(id).success).slice(0, 200);
    if (!ids.length) return fail("Choose at least one case.");
    const supabase = await createClient();
    let assigned = 0;
    let lastError: string | undefined;
    for (const id of ids) {
      const { error } = await supabase.rpc("assign_case", { p_case: id, p_user: orNull(userId), p_reason: reason?.trim() || undefined, p_include_checks: true });
      if (error) lastError = rpcErrorMessage(error);
      else assigned += 1;
    }
    refresh();
    if (!assigned && lastError) return fail(lastError);
    return { ok: true, assigned, failed: ids.length - assigned, error: lastError };
  });
}

export async function assignCheck(checkId: string, userId: string | null, reason?: string): Promise<ActionResult> {
  return guarded(async () => {
    await requireViewer({ kind: "staff", permission: "cases.assign" });
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_check", { p_check: checkId, p_user: orNull(userId), p_reason: reason?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** Run auto-assignment again for a case still in the manager queue. */
export async function autoAssignAgain(caseId: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await requireViewer({ kind: "staff", permission: "cases.assign" });
    const supabase = await createClient();
    const { data: c } = await supabase.from("cases").select("id").eq("id", caseId).maybeSingle();
    if (!c) return fail("That case no longer exists, or you don't have access to it.");
    const admin = createAdminClient();
    const { error } = await admin.rpc("enqueue_job", {
      p_kind: "assign.auto",
      p_payload: { case_id: caseId },
      p_idempotency_key: `assign.auto:${caseId}:${new Date().toISOString().slice(0, 16)}`,
      p_entity_type: "case",
      p_entity_id: caseId,
      p_org: viewer.orgId,
      p_created_by: viewer.userId,
    });
    if (error) return fail(rpcErrorMessage(error));
    kickWorker();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- checks

export async function saveCheckValues(checkId: string, values: Record<string, unknown>): Promise<ActionResult<{ valid: boolean; errors: Record<string, string> }>> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { data: check } = await supabase.from("case_checks").select("id, values, version:check_type_versions(schema)").eq("id", checkId).maybeSingle();
    if (!check) return fail("That check no longer exists, or you don't have access to it.");
    const schema = parseCheckTypeSchema((check.version as { schema: unknown } | null)?.schema);
    const draft = validateCheckValues(schema.fields, values, "draft");
    if (!draft.ok) return { ok: false, error: "Some details need fixing before they can be saved.", fieldErrors: Object.fromEntries(Object.entries(draft.errors).map(([k, v]) => [k, [v]])) };
    const submit = validateCheckValues(schema.fields, draft.values, "submit");
    const { error } = await supabase.rpc("save_check_values", { p_check: checkId, p_values: draft.values as never, p_valid: submit.ok });
    if (error) return fail(rpcErrorMessage(error));
    const moves = recordMoves(schema.fields, check.values as Record<string, unknown>, draft.values);
    if (Object.keys(moves).length) await supabase.rpc("remap_check_records", { p_check: checkId, p_map: moves });
    // The database has the last word on whether the details are complete.
    const { data: saved } = await supabase.from("case_checks").select("values_valid").eq("id", checkId).maybeSingle();
    refresh();
    return { ok: true, valid: saved?.values_valid ?? submit.ok, errors: submit.errors };
  });
}

export async function setCheckState(
  checkId: string,
  input: { state: (typeof CHECK_STATES)[number]; result?: string; note?: string; clientNote?: string },
): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    if (!CHECK_STATES.includes(input.state)) return fail("Unknown status.");
    const supabase = await createClient();
    const { data: before } = await supabase.from("case_checks").select("state, case_id").eq("id", checkId).maybeSingle();
    const { error } = await supabase.rpc("set_check_state", {
      p_check: checkId,
      p_state: input.state,
      p_result: input.result || undefined,
      p_note: input.note?.trim() || undefined,
      // Left out, the finding stays as it was. Sent empty, it is cleared.
      p_client_note: input.clientNote?.trim(),
    });
    if (error) return fail(rpcErrorMessage(error));
    // A waived check that comes back asks the candidate again.
    if (before?.state === "waived" && input.state !== "waived") {
      const { count } = await supabase.from("candidate_requests").select("id", { count: "exact", head: true }).eq("case_check_id", checkId).eq("status", "open");
      if (count) {
        await emailCandidateUpdate(before.case_id, viewer.userId).catch(() => false);
        kickWorker();
      }
    }
    refresh();
    return { ok: true };
  });
}

/** Reword what the report and the client read for a check. */
export async function setCheckRemarks(checkId: string, remarks: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(checkId).success) return fail("Unknown check.");
    if (remarks.length > 4000) return fail("Keep remarks under 4,000 characters.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_check_remarks", { p_check: checkId, p_remarks: remarks.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** "Needs info" says what is needed: the question goes to whoever provides it, then the check waits. */
export async function requestCheckInformation(caseId: string, checkId: string, question: string): Promise<ActionResult<{ warning?: string }>> {
  return guarded(async () => {
    const viewer = await staff();
    const text = question.trim();
    if (!uuid.safeParse(caseId).success || !uuid.safeParse(checkId).success) return fail("Unknown check.");
    if (!text) return fail("Say what you need.");
    if (text.length > 2000) return fail("Keep questions under 2,000 characters.");
    const supabase = await createClient();
    const { data: c } = await supabase.from("cases").select("process_type").eq("id", caseId).maybeSingle();
    const { data: check } = await supabase.from("case_checks").select("state").eq("id", checkId).maybeSingle();
    if (!c || !check) return fail("That check no longer exists, or you don't have access to it.");
    // The check first: if the person can't change it, no question goes out.
    const { error } = await supabase.rpc("set_check_state", { p_check: checkId, p_state: "pending_info", p_note: text });
    if (error) return fail(rpcErrorMessage(error));
    const toCandidate = c.process_type === "candidate_collected";
    const asked = toCandidate
      ? await supabase.rpc("create_candidate_request", { p_case: caseId, p: { kind: "question", check_id: checkId, title: text.slice(0, 200), help: text.length > 200 ? text : undefined } })
      : await supabase.rpc("create_client_request", { p_case: caseId, p_check: checkId, p_question: text });
    if (asked.error) {
      await supabase.rpc("set_check_state", { p_check: checkId, p_state: check.state });
      return fail(rpcErrorMessage(asked.error));
    }
    const warning = toCandidate
      ? (await emailCandidateUpdate(caseId, viewer.userId).catch(() => false))
        ? null
        : NO_WORKING_LINK
      : await nobodyAtTheClient(caseId);
    kickWorker();
    refresh();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

// ---------------------------------------------------------------- QC

const qcSchema = z.object({
  kind: z.enum(["pre", "post"]),
  decision: z.enum(["approved", "returned"]),
  checklist: z.array(z.object({ item: z.string().max(200), ok: z.boolean() })).max(40).default([]),
  remarks: z.string().trim().max(4000).optional(),
  returnCheckIds: z.array(z.uuid()).default([]),
  /** Post-QC: back to verification, or to data entry when the details themselves are wrong. */
  returnTo: z.enum(["verification", "data_entry"]).default("verification"),
  /** Pre-QC return: what to send the client or candidate (the flowchart's "clear request"). */
  message: z.string().trim().max(2000).optional(),
});

export async function recordQcReview(caseId: string, input: z.input<typeof qcSchema>): Promise<ActionResult<{ warning?: string }>> {
  return guarded(async () => {
    const viewer = await staff();
    const parsed = qcSchema.safeParse(input);
    if (!parsed.success) return fail("Check the review.");
    const v = parsed.data;
    if (v.kind === "pre" && v.decision === "returned" && !v.message) return fail("Say what you need sent or corrected.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_qc_review", {
      p_case: caseId,
      p_kind: v.kind,
      p_decision: v.decision,
      p_checklist: v.checklist,
      p_remarks: v.remarks || undefined,
      p_return_checks: v.returnCheckIds,
      p_return_to: v.returnTo,
    });
    if (error) return fail(rpcErrorMessage(error));
    // The review stands either way. If the message didn't go, say so rather than leave them waiting.
    const warning = v.kind === "pre" && v.decision === "returned" && v.message ? await sendAmendmentRequest(caseId, v.message, viewer.userId) : null;
    refresh();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

/**
 * Pre-QC's request for amendments goes to whoever is providing the documents, and
 * only them: a candidate's message never falls through to the client. Returns what
 * the reviewer needs to know if it didn't reach them.
 */
async function sendAmendmentRequest(caseId: string, message: string, actorId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: c } = await supabase.from("cases").select("process_type").eq("id", caseId).maybeSingle();
  if (c?.process_type === "candidate_collected") {
    const { error } = await supabase.rpc("post_candidate_message", { p_case: caseId, p_body: message });
    if (error) return "The case was returned, but your message couldn't be saved. Send it from the Candidate section.";
    const reached = await emailCandidateUpdate(caseId, actorId).catch(() => false);
    return reached ? null : NO_WORKING_LINK;
  }
  const { error } = await supabase.rpc("create_client_request", { p_case: caseId, p_check: orNull(null), p_question: message });
  if (error) return "The case was returned, but the message didn't go out. Send it from the case page.";
  return nobodyAtTheClient(caseId);
}

const NOBODY_READS = "Nobody at this client can read the portal, so they haven't seen this. Contact them directly and log it under Contacts.";
const NO_WORKING_LINK = "It's on the candidate's page, but they have no working link to read it. Send a new link from the Candidate section.";

/** A question to the client reaches their portal users. Without any, staff need to know it reached nobody. */
async function nobodyAtTheClient(caseId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("case_portal_readers", { p_case: caseId });
  return data === 0 ? NOBODY_READS : null;
}

async function whoHearsOfTheReturn(caseId: string) {
  const supabase = await createClient();
  const { data: c } = await supabase.from("cases").select("process_type").eq("id", caseId).maybeSingle();
  const toCandidate = c?.process_type === "candidate_collected";
  return { toCandidate, nobody: !toCandidate && Boolean(await nobodyAtTheClient(caseId)) };
}

// ---------------------------------------------------------------- questions to the client, contact log

export async function askClient(caseId: string, question: string, checkId?: string | null): Promise<ActionResult<{ warning?: string }>> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    if (!question.trim()) return fail("Write the question.");
    if (question.length > 2000) return fail("Keep questions under 2,000 characters.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_client_request", { p_case: caseId, p_check: orNull(checkId), p_question: question.trim() });
    if (error) return fail(rpcErrorMessage(error));
    const warning = await nobodyAtTheClient(caseId);
    kickWorker();
    refresh();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

export async function closeClientRequest(requestId: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(requestId).success) return fail("Unknown question.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("close_client_request", { p_request: requestId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const contactSchema = z.object({
  checkId: z.uuid().nullable().optional(),
  recordKey: z.string().max(60).nullable().optional(),
  counterparty: z.string().trim().min(1, "Say who you spoke to.").max(200),
  channel: z.enum(["phone", "email", "whatsapp", "sms", "letter", "visit"]),
  direction: z.enum(["outbound", "inbound"]),
  outcome: z.string().trim().max(100).optional(),
  body: z.string().trim().max(4000).optional(),
});

export async function logContact(caseId: string, input: z.input<typeof contactSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const parsed = contactSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details.");
    const v = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("log_contact", {
      p_case: caseId,
      p: { check_id: v.checkId ?? null, record_key: v.recordKey ?? null, counterparty: v.counterparty, channel: v.channel, direction: v.direction, outcome: v.outcome ?? null, body: v.body ?? "" },
    });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- case structure

export async function addCaseCheck(caseId: string, checkTypeId: string, label?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success || !uuid.safeParse(checkTypeId).success) return fail("Choose a check.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_case_check", { p_case: caseId, p_check_type: checkTypeId, p_label: label?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function setCaseClientVisible(caseId: string, visible: boolean): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(caseId).success) return fail("Unknown case.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_case_client_visible", { p_case: caseId, p_visible: visible });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- documents

export async function requestDocument(caseId: string, input: { checkId?: string | null; category: string; label?: string; note?: string }): Promise<ActionResult<{ warning?: string }>> {
  return guarded(async () => {
    const viewer = await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("request_case_document", {
      p_case: caseId,
      p_check: orNull(input.checkId),
      p_category: input.category,
      p_label: input.label?.trim() || input.category,
      p_note: input.note?.trim() || undefined,
    });
    if (error) return fail(rpcErrorMessage(error));
    // Whoever provides the documents hears of it. On a client-supplied case, that isn't the candidate.
    const { data: c } = await supabase.from("cases").select("process_type").eq("id", caseId).maybeSingle();
    const warning =
      c?.process_type === "candidate_collected"
        ? (await emailCandidateUpdate(caseId, viewer.userId).catch(() => false))
          ? null
          : NO_WORKING_LINK
        : await nobodyAtTheClient(caseId);
    kickWorker();
    refresh();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

export async function waiveRequirement(requirementId: string, reason: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("waive_requirement", { p_requirement: requirementId, p_reason: reason.trim() });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const fileLinksSchema = z.object({
  documentId: z.uuid(),
  links: z.array(z.object({ requirement: z.uuid(), pages: z.string().trim().max(40).nullable(), records: z.array(z.string().max(60)).max(20).default([]) })).min(1).max(30),
  /** The AI's list, when this came from one: settled with what the person chose. */
  suggestionId: z.uuid().nullable(),
  all: z.boolean(),
});

/** A person says a file holds these documents. Each slot then counts the file as received. */
export async function confirmRequirementFiles(input: z.input<typeof fileLinksSchema>): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const parsed = fileLinksSchema.safeParse(input);
    if (!parsed.success) return fail("Choose at least one document.");
    const { documentId, links, suggestionId, all } = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("confirm_requirement_files", { p_document: documentId, p_links: links as unknown as Json, p_source: suggestionId ? "ai" : "staff" });
    if (error) return fail(rpcErrorMessage(error));
    if (suggestionId) {
      const decided = await supabase.rpc("decide_ai_suggestion", { p_suggestion: suggestionId, p_decision: all ? "accepted" : "edited", p_value: all ? undefined : ({ links } as unknown as Json) });
      if (decided.error) return fail(rpcErrorMessage(decided.error));
    }
    refresh();
    return { ok: true };
  });
}

export async function removeRequirementFile(requirementId: string, documentId: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_requirement_file", { p_requirement: requirementId, p_document: documentId });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

const uploadSchema = z.object({
  caseId: z.uuid(),
  checkId: z.uuid().nullable().optional(),
  category: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().max(120).optional(),
  parentId: z.uuid().nullable().optional(),
  recordKey: z.string().regex(/^[a-z][a-z0-9_]*\.\d+$/).nullable().optional(),
  filename: z.string().trim().min(1).max(200),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"], { error: "Upload a PDF, JPEG, PNG, WebP or HEIC file." }),
  size: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "Files must be under 25 MB."),
});

/** Step 1: create the document row and a signed upload URL the browser uploads to directly. */
export async function beginUpload(input: z.input<typeof uploadSchema>): Promise<ActionResult<{ documentId: string; path: string; token: string }>> {
  return guarded(async () => {
    await staff();
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "This file can't be uploaded.");
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("begin_document_upload", {
      p_case: v.caseId,
      p_check: orNull(v.checkId),
      p_category: v.category,
      p_filename: v.filename,
      p_mime: v.mime,
      p_size: v.size,
      p_parent: v.parentId ?? undefined,
      p_label: v.label || undefined,
    });
    if (error || !data) return fail(rpcErrorMessage(error));
    const d = data as { id: string; bucket: string; path: string };
    // A new version keeps its parent's row, so this is sent only when someone chose one.
    if (v.recordKey !== undefined) {
      const tied = await supabase.rpc("set_document_record", { p_document: d.id, p_record: v.recordKey ?? "" });
      if (tied.error) return fail(rpcErrorMessage(tied.error));
    }
    const admin = createAdminClient();
    const signed = await admin.storage.from(d.bucket).createSignedUploadUrl(d.path);
    if (signed.error) return fail("We couldn't prepare the upload. Try again in a moment.");
    return { ok: true, documentId: d.id, path: d.path, token: signed.data.token };
  });
}

/** Step 2: confirm the object landed in Storage, then mark the document uploaded. */
export async function finalizeUpload(documentId: string, sha256?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { data: doc } = await supabase.from("documents").select("id, storage_bucket, storage_path, size_bytes").eq("id", documentId).maybeSingle();
    // Sensitive files are invisible to some uploaders; fall back to the service read for the existence check only.
    const admin = createAdminClient();
    const row = doc ?? (await admin.from("documents").select("id, storage_bucket, storage_path, size_bytes").eq("id", documentId).maybeSingle()).data;
    if (!row) return fail("That upload no longer exists.");
    const exists = await admin.storage.from(row.storage_bucket).exists(row.storage_path);
    if (!exists.data) return fail("The file didn't reach storage. Try uploading it again.");
    const { error } = await supabase.rpc("finalize_document_upload", { p_document: documentId, p_sha256: sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function reviewDocument(documentId: string, accept: boolean, reason?: string): Promise<ActionResult> {
  return guarded(async () => {
    const viewer = await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("review_document", { p_document: documentId, p_accept: accept, p_reason: reason?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    if (!accept) {
      const { data: d } = await supabase.from("documents").select("case_id, uploaded_by_kind").eq("id", documentId).maybeSingle();
      if (d?.uploaded_by_kind === "candidate") await emailCandidateUpdate(d.case_id, viewer.userId).catch(() => false);
      kickWorker();
    }
    refresh();
    return { ok: true };
  });
}

export async function setDocumentRecord(documentId: string, recordKey: string | null): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_document_record", { p_document: documentId, p_record: recordKey ?? "" });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function setDocumentOriginal(documentId: string, kind: "unknown" | "original" | "certified_copy" | "copy"): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_document_original", { p_document: documentId, p_kind: kind });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** One of Ontriq's own statuses, or null to go back to the automatic one. */
export async function setCaseStatus(caseId: string, key: string | null): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_case_status", { p_case: caseId, p_key: orNull(key) });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

export async function setDocumentVisibility(documentId: string, visibility: "internal" | "client" | "report", reason?: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_document_visibility", { p_document: documentId, p_visibility: visibility, p_reason: reason?.trim() || undefined });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

/** A file in the wrong place: another check, another kind of document, or the case as a whole. */
export async function refileDocument(documentId: string, checkId: string | null, category: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    if (!uuid.safeParse(documentId).success || (checkId && !uuid.safeParse(checkId).success)) return fail("Unknown file.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("refile_document", { p_document: documentId, p_check: orNull(checkId), p_category: category });
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- saved views

export async function saveView(name: string, query: string, shared: boolean): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const viewer = await staff();
    const clean = name.trim().slice(0, 60);
    if (!clean) return fail("Give the view a name.");
    const params = new URLSearchParams(query);
    params.delete("page");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("saved_views")
      .insert({ org_id: viewer.orgId, owner_id: viewer.userId, entity: "cases", name: clean, query: params.toString(), shared })
      .select("id")
      .single();
    if (error || !data) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true, id: data.id };
  });
}

export async function deleteView(id: string): Promise<ActionResult> {
  return guarded(async () => {
    await staff();
    const supabase = await createClient();
    const { error } = await supabase.from("saved_views").delete().eq("id", id);
    if (error) return fail(rpcErrorMessage(error));
    refresh();
    return { ok: true };
  });
}
