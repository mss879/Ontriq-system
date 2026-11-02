"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CandidateSessionError, isLinkExpired, requireCandidateSession } from "@/lib/server/candidate/session";
import { clientIp, rateLimit } from "@/lib/server/request-meta";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { kickWorker } from "@/lib/server/jobs/kick";
import { fromWire, type Wire } from "@/lib/wire";

/**
 * The candidate's actions. Each one renews the signed session, rate-limits
 * per link, and calls a candidate_* function (0008) with the service role and
 * the session's own link id: the database scopes every write to that link's
 * case, so ids from the page can only point inside it.
 *
 * Errors come back as a key of the page's error strings (expired, session,
 * tooMany, generic, …) or, for validation messages from the database, as
 * readable English. Answers and file names arrive packed (lib/wire).
 */

type Fail = { ok: false; error: string };
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
const uuid = z.uuid();

/** The generated types mark these arguments as strings; the functions accept null. */
const orNull = (v: string | null | undefined) => (v ?? null) as unknown as string;

async function withLink<R extends ActionResult>(run: (linkId: string) => Promise<R>): Promise<R | Fail> {
  let linkId: string;
  try {
    linkId = (await requireCandidateSession()).linkId;
  } catch (error) {
    if (error instanceof CandidateSessionError) return fail("session");
    throw error;
  }
  if (!(await rateLimit(`candidate-action:${linkId}`, 600, 120))) return fail("tooMany");
  return run(linkId);
}

function dbFail(error: { code?: string; message?: string } | null | undefined): Fail {
  if (isLinkExpired(error)) return fail("expired");
  const text = (error?.message ?? "").trim();
  if (error?.code === "22023" && text) return fail(`${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`);
  return fail("generic");
}

async function linkCase(linkId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("candidate_links").select("case_id").eq("id", linkId).maybeSingle();
  return data?.case_id ?? null;
}

async function requestMeta() {
  const h = await headers();
  return { ip: await clientIp(), userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

// ---------------------------------------------------------------- uploads

const beginSchema = z.object({
  requirementId: uuid.nullable().optional(),
  consent: z.boolean().optional(),
  filename: z.string().trim().min(1).max(200),
  mime: z.enum(MIMES),
  size: z.number().int().positive().max(25 * 1024 * 1024),
});

/** Step 1: a document row in the link's case and a signed upload URL for it. */
export async function beginUpload(packed: Wire<z.input<typeof beginSchema>>): Promise<ActionResult<{ documentId: string; path: string; token: string }>> {
  return withLink(async (linkId) => {
    const parsed = beginSchema.safeParse(fromWire(packed));
    if (!parsed.success) return fail("fileType");
    const v = parsed.data;
    if (!v.consent && !v.requirementId) return fail("generic");
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("candidate_begin_upload", {
      p_link: linkId,
      p_requirement: orNull(v.consent ? null : v.requirementId),
      p_category: orNull(v.consent ? "consent_form" : null),
      p_filename: v.filename,
      p_mime: v.mime,
      p_size: v.size,
    });
    if (error || !data) return dbFail(error);
    const d = data as { id: string; bucket: string; path: string };
    const signed = await admin.storage.from(d.bucket).createSignedUploadUrl(d.path);
    if (signed.error) return fail("uploadFailed");
    return { ok: true, documentId: d.id, path: d.path, token: signed.data.token };
  });
}

/** Step 2: the file is in Storage; mark it received. */
export async function finalizeUpload(documentId: string, sha256?: string): Promise<ActionResult> {
  return withLink(async (linkId) => {
    if (!uuid.safeParse(documentId).success) return fail("generic");
    const caseId = await linkCase(linkId);
    if (!caseId) return fail("expired");
    const admin = createAdminClient();
    const { data: doc } = await admin
      .from("documents")
      .select("id, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("case_id", caseId)
      .eq("uploaded_by_kind", "candidate")
      .maybeSingle();
    if (!doc) return fail("generic");
    const exists = await admin.storage.from(doc.storage_bucket).exists(doc.storage_path);
    if (!exists.data) return fail("uploadFailed");
    const { error } = await admin.rpc("candidate_finalize_upload", {
      p_link: linkId,
      p_document: documentId,
      p_sha256: sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : undefined,
    });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- confirming

/** The candidate's last step: everything is in, and it's true. The report gets written from here. */
export async function confirmSubmission(agree: boolean): Promise<ActionResult> {
  return withLink(async (linkId) => {
    if (!agree) return fail("notReady");
    const { error } = await createAdminClient().rpc("candidate_confirm_submission", { p_link: linkId });
    if (error) return /still needed/.test(error.message ?? "") ? fail("notReady") : dbFail(error);
    kickWorker();
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- requests and messages

const answerSchema = z.object({
  requestId: uuid,
  value: z.union([
    z.string().trim().min(1).max(4000),
    z.array(z.string().max(200)).min(1).max(50),
    z.object({ from: z.string().min(1).max(10), to: z.string().max(10).optional(), present: z.boolean().optional() }),
  ]),
});

export async function answerRequest(packed: Wire<z.input<typeof answerSchema>>): Promise<ActionResult> {
  return withLink(async (linkId) => {
    const parsed = answerSchema.safeParse(fromWire(packed));
    if (!parsed.success) return fail("answerNeeded");
    const { error } = await createAdminClient().rpc("candidate_answer_request", {
      p_link: linkId,
      p_request: parsed.data.requestId,
      p_answer: { value: parsed.data.value },
    });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

const rowsSchema = z.object({
  requestId: uuid,
  rows: z
    .array(z.record(z.string().max(48), z.union([z.string().trim().max(4000), z.array(z.string().max(200)).max(50), z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional(), present: z.boolean().optional() })])))
    .min(1)
    .max(20),
});

/** Rows such as referees or employers, for staff to check and use. */
export async function answerRows(packed: Wire<z.input<typeof rowsSchema>>): Promise<ActionResult> {
  return withLink(async (linkId) => {
    const parsed = rowsSchema.safeParse(fromWire(packed));
    if (!parsed.success) return fail("answerNeeded");
    const { error } = await createAdminClient().rpc("candidate_answer_request", {
      p_link: linkId,
      p_request: parsed.data.requestId,
      p_answer: { rows: parsed.data.rows },
    });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

export async function postMessage(body: string): Promise<ActionResult> {
  return withLink(async (linkId) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) return fail("messageNeeded");
    const { error } = await createAdminClient().rpc("candidate_post_message", { p_link: linkId, p_body: text.slice(0, 4000) });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- consent

/** A photo of the paper form, already uploaded with beginUpload({ consent: true }) and finalizeUpload. */
export async function submitConsentUpload(documentId: string): Promise<ActionResult> {
  return withLink(async (linkId) => {
    if (!uuid.safeParse(documentId).success) return fail("generic");
    const meta = await requestMeta();
    const { error } = await createAdminClient().rpc("candidate_submit_consent", {
      p_link: linkId,
      p_method: "upload",
      p_signed_name: orNull(null),
      p_document: documentId,
      p_ip: meta.ip,
      p_user_agent: meta.userAgent,
    });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

const PNG_PREFIX = "data:image/png;base64,";
const signSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  agree: z.literal(true),
  signature: z
    .string()
    .max(Math.ceil((300 * 1024 * 4) / 3) + PNG_PREFIX.length)
    .startsWith(PNG_PREFIX)
    .nullable()
    .optional(),
});

/** Sign on the page: typed name, agreement and an optional drawn signature. */
export async function signConsent(input: z.input<typeof signSchema>): Promise<ActionResult> {
  return withLink(async (linkId) => {
    const parsed = signSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return fail(field === "agree" ? "agreeNeeded" : field === "fullName" ? "nameNeeded" : "generic");
    }
    const v = parsed.data;
    const admin = createAdminClient();
    let documentId: string | null = null;

    if (v.signature) {
      const png = Buffer.from(v.signature.slice(PNG_PREFIX.length), "base64");
      const isPng = png.length > 8 && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!isPng || png.length > 300 * 1024) return fail("generic");
      const { data, error } = await admin.rpc("candidate_begin_upload", {
        p_link: linkId,
        p_requirement: orNull(null),
        p_category: "consent_form",
        p_filename: "signature.png",
        p_mime: "image/png",
        p_size: png.length,
      });
      if (error || !data) return dbFail(error);
      const d = data as { id: string; bucket: string; path: string };
      const stored = await admin.storage.from(d.bucket).upload(d.path, png, { contentType: "image/png", upsert: false });
      if (stored.error) return fail("uploadFailed");
      const done = await admin.rpc("candidate_finalize_upload", { p_link: linkId, p_document: d.id });
      if (done.error) return dbFail(done.error);
      documentId = d.id;
    }

    const meta = await requestMeta();
    const { error } = await admin.rpc("candidate_submit_consent", {
      p_link: linkId,
      p_method: "esign",
      p_signed_name: v.fullName,
      p_document: orNull(documentId),
      p_ip: meta.ip,
      p_user_agent: meta.userAgent,
    });
    if (error) return dbFail(error);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- session

/** Called every few minutes while the page is open, so a candidate reading slowly isn't signed out. */
export async function keepAlive(): Promise<ActionResult> {
  try {
    await requireCandidateSession();
    return { ok: true };
  } catch (error) {
    if (error instanceof CandidateSessionError) return fail("session");
    throw error;
  }
}
