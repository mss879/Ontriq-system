/**
 * Development check: walk an invoice from a released case to paid as the real
 * roles, the way the invoice, payments and portal screens do, and print what happened.
 *
 *   npx tsx --env-file=.env.local scripts/dev/billing-flow.ts [client-id]
 *
 * Local stack only (and the dev server on :3000 for the download routes). Uses
 * the throwaway users of scripts/dev/as-user.ts (passwords never printed).
 * Re-runnable: once the released case's invoice has been issued, later runs
 * carry on with a manual invoice for the same client.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { totp } from "../local-stack/totp";
import { createServiceClient } from "../../src/jobs/admin-client";
import { drainJobs } from "../../src/jobs/run-job";
import { invoiceEmail } from "../../src/domain/email/commercial-templates";

const ORG = "00000000-0000-4000-8000-000000000001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const base = "http://localhost:3000";
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("local stack only");
const store = path.join(homedir(), ".ontiq/local-stack/dev-users.json");
type Saved = Record<string, { email: string; password: string; id: string; totp?: string }>;
const saved: Saved = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {};
const admin = createServiceClient();

type Actor = { db: SupabaseClient; id: string; cookie: () => Promise<string> };

async function as(role: string, clientId?: string): Promise<Actor> {
  const key = `${role}:${clientId ?? ""}`;
  const staff = !role.startsWith("client_") || role === "client_relations";
  if (!saved[key]) {
    const email = `dev-${role}-${randomBytes(3).toString("hex")}@dev.ontriq.test`;
    const password = `${randomBytes(12).toString("base64url")}Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Dev ${role.replace(/_/g, " ")}` }, app_metadata: { kind: staff ? "staff" : "client", org_id: ORG } });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    const { data: r } = await admin.from("roles").select("id").eq("org_id", ORG).eq("key", role).single();
    await admin.from("memberships").insert({ org_id: ORG, user_id: data.user.id, kind: staff ? "staff" : "client", client_id: staff ? null : clientId, role_id: r!.id, status: "active" });
    saved[key] = { email, password, id: data.user.id };
    mkdirSync(path.dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  const u = saved[key];
  const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await db.auth.signInWithPassword({ email: u.email, password: u.password });
  if (s.error) throw new Error(`sign-in ${role}: ${s.error.message}`);
  if (staff) {
    if (!u.totp) {
      const f = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "dev" });
      if (f.error || !f.data) throw new Error(`enroll: ${f.error?.message}`);
      await db.auth.mfa.challengeAndVerify({ factorId: f.data.id, code: totp(f.data.totp.secret) });
      saved[key] = { ...u, totp: f.data.totp.secret };
      writeFileSync(store, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } else {
      const factor = (await db.auth.mfa.listFactors()).data?.totp?.[0];
      if (factor) await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(u.totp) });
    }
  }
  // The app's session cookie, for the download routes.
  const cookie = async () => {
    const session = (await db.auth.getSession()).data.session!;
    const jar = new Map<string, string>();
    const ssr = createServerClient(url, anonKey, {
      cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
    });
    await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  };
  return { db, id: u.id, cookie };
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "ok " : "BAD"} ${name}${detail ? ` · ${detail}` : ""}`);
};
type Res = { error: { code?: string; message?: string } | null; data?: unknown };
const refused = (r: Res) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0);
const why = (r: Res, bad: string) => r.error?.code ?? r.error?.message ?? (Array.isArray(r.data) && r.data.length === 0 ? "no rows" : bad);
const drain = () => drainJobs({ budgetMs: 120_000, reserveMs: 0, maxJobs: 30, workerId: "dev-billing-flow", admin });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const get = async (who: Actor | null, p: string) => {
  const res = await fetch(`${base}${p}`, { headers: who ? { cookie: await who.cookie() } : {}, redirect: "manual" });
  const type = res.headers.get("content-type") ?? "";
  const body = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  return { status: res.status, type, body, location: res.headers.get("location") ?? "" };
};
// A small valid PDF, enough for storage and the slip reader.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 120 Td (Bank transfer LKR 1,000.00 ref DEV123) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    " ".repeat(1200) +
    "\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function uploadSlip(who: Actor, invoiceId: string, note: string) {
  const begun = await who.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "Transfer slip.pdf", p_mime: "application/pdf", p_size: PDF.length, p_note: note });
  if (begun.error) return { error: begun.error, id: null as string | null };
  const d = begun.data as { id: string; bucket: string; path: string };
  const signed = await admin.storage.from(d.bucket).createSignedUploadUrl(d.path);
  if (signed.error) return { error: { message: signed.error.message }, id: d.id };
  const sent = await who.db.storage.from(d.bucket).uploadToSignedUrl(d.path, signed.data.token, PDF, { contentType: "application/pdf" });
  if (sent.error) return { error: { message: sent.error.message }, id: d.id };
  const fin = await who.db.rpc("portal_finalize_slip", { p_slip: d.id, p_sha256: "" });
  return { error: fin.error, id: d.id };
}

async function main() {
  const clientId = process.argv[2] ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherClient = clientId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).single();
  if (!client) throw new Error(`no client ${clientId}`);

  const adminUser = await as("admin");
  const finance = await as("client_relations");
  const entry = await as("data_entry_officer");
  const clientAdmin = await as("client_admin", clientId);
  const clientUser = await as("client_user", clientId);
  const clientViewer = await as("client_viewer", clientId);
  const stranger = await as("client_admin", otherClient);

  // ---------------------------------------------------------------- draft from a released case
  const { data: released } = await admin.from("cases").select("id, reference").eq("client_id", clientId).eq("stage", "released").order("released_at", { ascending: false }).limit(1).maybeSingle();
  if (!released) throw new Error("release a case for this client first (scripts/dev/report-flow.ts)");
  const entryDraft = await entry.db.rpc("draft_case_invoice", { p_case: released.id });
  check("A data entry officer can't draft an invoice", Boolean(entryDraft.error), entryDraft.error?.code ?? "drafted!");
  const drafted = await adminUser.db.rpc("draft_case_invoice", { p_case: released.id });
  check(`Admin drafts the invoice for ${released.reference}`, !drafted.error && Boolean(drafted.data), drafted.error?.message ?? "");
  const again = await adminUser.db.rpc("draft_case_invoice", { p_case: released.id });
  check("Drafting again returns the same invoice", again.data === drafted.data, String(again.data));
  let invoiceId = drafted.data as string;
  const { data: caseInv } = await admin.from("invoices").select("status, kind").eq("id", invoiceId).single();
  if (caseInv?.status !== "draft") {
    console.log(`·   ${released.reference} is already invoiced (${caseInv?.status}); continuing with a manual invoice`);
    const { data: manual, error } = await adminUser.db.from("invoices").insert({ org_id: ORG, client_id: clientId, kind: "manual", status: "draft" }).select("id").single();
    check("Admin creates a manual draft", Boolean(manual), error?.message ?? "");
    invoiceId = manual!.id;
    await adminUser.db.from("invoice_items").insert({ org_id: ORG, invoice_id: invoiceId, sort: 10, description: "Background verification, per candidate", quantity: 1, unit_price: 0 });
  }
  const manualByEntry = await entry.db.from("invoices").insert({ org_id: ORG, client_id: clientId, kind: "manual", status: "draft" }).select("id");
  check("A data entry officer can't create an invoice", refused(manualByEntry), why(manualByEntry, "created!"));

  // ---------------------------------------------------------------- the editor
  const zero = await adminUser.db.rpc("confirm_invoice", { p_invoice: invoiceId });
  const { data: stillDraft } = await admin.from("invoices").select("status, number").eq("id", invoiceId).single();
  check("Confirming a zero total is refused and keeps it a draft", Boolean(zero.error) && stillDraft?.status === "draft" && !stillDraft?.number, zero.error?.message ?? "confirmed!");
  const { data: lines } = await adminUser.db.from("invoice_items").select("id").eq("invoice_id", invoiceId).order("sort");
  for (const l of lines ?? []) await adminUser.db.from("invoice_items").update({ unit_price: 4500 }).eq("id", l.id);
  const added = await adminUser.db.from("invoice_items").insert({ org_id: ORG, invoice_id: invoiceId, sort: 900, description: "Courier of originals", quantity: 2, unit_price: 750, discount_pct: 10 });
  check("Admin prices the lines and adds one", !added.error, added.error?.message ?? "");
  const entryEdit = await entry.db.from("invoice_items").update({ unit_price: 1 }).eq("invoice_id", invoiceId).select("id");
  check("A data entry officer can't edit the lines", refused(entryEdit), why(entryEdit, "edited!"));
  const msg = await adminUser.db.from("invoices").update({ message: "Thank you for your business.", internal_notes: "Dev billing flow" }).eq("id", invoiceId).select("id");
  check("Admin edits the message and internal notes", !msg.error && (msg.data?.length ?? 0) === 1, msg.error?.message ?? "");
  const expected = (lines?.length ?? 0) * 4500 + 1350;
  const { data: totals } = await admin.from("invoices").select("subtotal, discount_total, total").eq("id", invoiceId).single();
  check("Totals are recomputed", Number(totals?.total) === expected && Number(totals?.discount_total) === 150, JSON.stringify(totals));
  const early = await clientAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("The client can't see a draft", Boolean(early.error), early.error?.code ?? "visible!");

  // ---------------------------------------------------------------- confirm and PDF
  const noConfirm = await entry.db.rpc("confirm_invoice", { p_invoice: invoiceId });
  check("A data entry officer can't confirm", Boolean(noConfirm.error), noConfirm.error?.code ?? "confirmed!");
  const confirmed = await finance.db.rpc("confirm_invoice", { p_invoice: invoiceId });
  const c = confirmed.data as { number?: string; document_id?: string; due_date?: string; total?: number } | null;
  check("Client relations confirms it with a number and due date", /^INV-\d{4}-\d{4,}$/.test(c?.number ?? "") && Boolean(c?.due_date), confirmed.error?.message ?? `${c?.number} due ${c?.due_date}`);
  if (!c?.number) throw new Error("not confirmed");
  const frozen = await adminUser.db.from("invoices").update({ message: "changed" }).eq("id", invoiceId).select("id");
  check("A confirmed invoice can't be edited", refused(frozen), why(frozen, "edited!"));
  const frozenItem = await adminUser.db.from("invoice_items").update({ unit_price: 1 }).eq("invoice_id", invoiceId).select("id");
  check("Its lines can't be edited", refused(frozenItem), why(frozenItem, "edited!"));
  await drain();
  const { data: doc } = await admin.from("generated_documents").select("status, storage_path, page_count").eq("id", c.document_id!).single();
  check("The invoice PDF renders", doc?.status === "ready" && Boolean(doc?.storage_path), `${doc?.status} ${doc?.page_count ?? 0} page(s)`);
  const pdf = await get(adminUser, `/api/documents/${c.document_id}?download=1`);
  check("Staff download the PDF", pdf.status === 307 || pdf.status === 302 || pdf.type.includes("pdf"), `${pdf.status}`);
  const unsent = await clientAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("The client can't see it before it is sent", Boolean(unsent.error), unsent.error?.code ?? "visible!");

  // ---------------------------------------------------------------- send
  const noSend = await entry.db.rpc("mark_invoice_sent", { p_invoice: invoiceId, p_to: [] });
  check("A data entry officer can't send", Boolean(noSend.error), noSend.error?.code ?? "sent!");
  const { data: contact } = await admin.from("client_contacts").select("name, email").eq("client_id", clientId).eq("receives_invoices", true).limit(1).maybeSingle();
  const to = [contact?.email ?? "billing@example.test", saved[`client_admin:${clientId}`]!.email];
  const mail = invoiceEmail({ contactName: contact?.name ?? null, clientName: client.name, orgName: "Ontriq", number: c.number, total: expected, currency: "LKR", dueDate: c.due_date!, url: `${base}/portal/invoices/${invoiceId}` });
  const queued = await admin.rpc("queue_email", { p_to: to, p_subject: mail.subject, p_html: mail.html, p_text: mail.text, p_template_key: "invoice.send", p_payload: {}, p_entity_type: "invoice", p_entity_id: invoiceId, p_created_by: finance.id, p_org: ORG });
  check("The invoice email is queued", !queued.error && Boolean(queued.data), queued.error?.message ?? "");
  const sent = await finance.db.rpc("mark_invoice_sent", { p_invoice: invoiceId, p_to: to });
  check("Client relations marks it sent", !sent.error, sent.error?.message ?? "");
  const { count: notes } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("entity_id", invoiceId).in("user_id", [clientAdmin.id, clientUser.id]);
  check("The client's portal users are notified", (notes ?? 0) >= 2, `${notes}`);
  const pause = await finance.db.from("invoices").update({ reminders_paused: true }).eq("id", invoiceId).select("reminders_paused");
  const resume = await finance.db.from("invoices").update({ reminders_paused: false }).eq("id", invoiceId).select("reminders_paused");
  check("Reminders can be paused and resumed after sending", !pause.error && pause.data?.[0]?.reminders_paused === true && resume.data?.[0]?.reminders_paused === false, pause.error?.message ?? "");

  // ---------------------------------------------------------------- portal
  const list = await clientAdmin.db.rpc("portal_invoices");
  const listed = ((list.data as { invoices?: { id: string }[] } | null)?.invoices ?? []).some((r) => r.id === invoiceId);
  check("It shows in the client's invoice list", listed, list.error?.message ?? "");
  const firstRead = await clientAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("Reading it doesn't mark it viewed", (firstRead.data as { status?: string } | null)?.status === "sent", firstRead.error?.message ?? "");
  const shown = await clientAdmin.db.rpc("portal_mark_invoice_viewed", { p_invoice: invoiceId });
  check("Showing it marks it viewed", !shown.error, shown.error?.message ?? "");
  const pi = await clientAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
  const pid = pi.data as { status?: string; items?: unknown[]; internal_notes?: unknown; can_pay?: boolean } | null;
  check("The client admin opens it (marked viewed)", pid?.status === "viewed" && (pid.items?.length ?? 0) === (lines?.length ?? 0) + 1 && pid.can_pay === true, pi.error?.message ?? pid?.status ?? "");
  check("Internal notes are not exposed", pid?.internal_notes === undefined && !JSON.stringify(pid).includes("Dev billing flow"));
  const userView = await clientUser.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("A client user can read it but not pay", !userView.error && (userView.data as { can_pay?: boolean }).can_pay === false, userView.error?.message ?? "");
  const viewerView = await clientViewer.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("A client viewer can't open invoices", Boolean(viewerView.error), viewerView.error?.code ?? "opened!");
  const clientPdf = await get(clientAdmin, `/api/documents/${c.document_id}?download=1`);
  check("The client admin downloads the PDF", clientPdf.status === 307 || clientPdf.status === 302 || clientPdf.type.includes("pdf"), `${clientPdf.status}`);

  // ---------------------------------------------------------------- slips
  const userSlip = await clientUser.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "x.pdf", p_mime: "application/pdf", p_size: 5000 });
  check("A client user can't upload a slip", Boolean(userSlip.error), userSlip.error?.code ?? "began!");
  const badType = await clientAdmin.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "x.docx", p_mime: "application/msword", p_size: 5000 });
  check("Only PDF, JPEG or PNG slips are accepted", Boolean(badType.error), badType.error?.message ?? "began!");
  const tooBig = await clientAdmin.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "x.pdf", p_mime: "application/pdf", p_size: 11 * 1024 * 1024 });
  check("Slips over 10 MB are refused", Boolean(tooBig.error), tooBig.error?.message ?? "began!");
  const strangerSlip = await stranger.db.rpc("portal_begin_slip", { p_invoice: invoiceId, p_filename: "x.pdf", p_mime: "application/pdf", p_size: 5000 });
  check("Another company can't upload against it", Boolean(strangerSlip.error), strangerSlip.error?.code ?? "began!");

  const wrong = await uploadSlip(clientAdmin, invoiceId, "First try");
  check("The client admin uploads a slip", !wrong.error && Boolean(wrong.id), wrong.error?.message ?? "");
  const { data: s1 } = await admin.from("payment_slips").select("status, storage_path").eq("id", wrong.id!).single();
  check("The slip waits for finance", s1?.status === "pending", s1?.status ?? "");
  const { count: slipNotes } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("entity_id", wrong.id!).eq("user_id", finance.id);
  check("Finance is notified", (slipNotes ?? 0) > 0, `${slipNotes}`);
  const entrySees = await entry.db.from("payment_slips").select("id").eq("id", wrong.id!);
  check("A data entry officer can't see slips", (entrySees.data?.length ?? 0) === 0);
  const slipFile = await get(finance, `/api/slips/${wrong.id}`);
  check("Finance opens the slip file", slipFile.status === 307 || slipFile.status === 302, `${slipFile.status}`);
  const slipEntry = await get(entry, `/api/slips/${wrong.id}`);
  check("A data entry officer can't open it", slipEntry.status === 404 || slipEntry.status === 403, `${slipEntry.status}`);
  await drain(); // ai.slip_read
  const { data: read } = await admin.from("payment_slips").select("ai_extraction").eq("id", wrong.id!).single();
  check("The slip reader ran (read, or skipped without AI)", read?.ai_extraction !== null, JSON.stringify(read?.ai_extraction ?? null).slice(0, 80));

  const noReason = await finance.db.rpc("reject_payment_slip", { p_slip: wrong.id!, p_reason: " " });
  check("Rejecting needs a reason", Boolean(noReason.error), noReason.error?.message ?? "rejected!");
  const rejected = await finance.db.rpc("reject_payment_slip", { p_slip: wrong.id!, p_reason: "The amount doesn't match this invoice." });
  check("Finance rejects the first slip", !rejected.error, rejected.error?.message ?? "");
  const { count: rejNotes } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("entity_id", wrong.id!).eq("user_id", clientAdmin.id);
  check("The client is told why", (rejNotes ?? 0) > 0, `${rejNotes}`);
  const reMatch = await finance.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: 100, p_method: "bank_transfer", p_slip: wrong.id! });
  check("A rejected slip can't be matched", Boolean(reMatch.error), reMatch.error?.message ?? "matched!");

  const good = await uploadSlip(clientAdmin, invoiceId, "Paid in full");
  check("The client admin uploads another slip", !good.error && Boolean(good.id), good.error?.message ?? "");
  const over = await finance.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: expected + 1, p_method: "bank_transfer", p_slip: good.id! });
  check("Paying more than is owed is refused", Boolean(over.error), over.error?.message ?? "recorded!");
  const entryPay = await entry.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: expected, p_method: "bank_transfer", p_slip: good.id! });
  check("A data entry officer can't record payments", Boolean(entryPay.error), entryPay.error?.code ?? "recorded!");
  const matched = await finance.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: expected, p_method: "bank_transfer", p_reference: "DEV123", p_paid_on: today, p_slip: good.id!, p_notes: "Matched from the client's payment slip" });
  check("Finance matches the slip", !matched.error && Boolean(matched.data), matched.error?.message ?? "");
  const { data: paid } = await admin.from("invoices").select("status, balance, amount_paid").eq("id", invoiceId).single();
  const { data: s2 } = await admin.from("payment_slips").select("status").eq("id", good.id!).single();
  check("The invoice is paid and the slip matched", paid?.status === "paid" && Number(paid?.balance) === 0 && s2?.status === "matched", JSON.stringify({ ...paid, slip: s2?.status }));

  // Void and re-match, as the payments page allows.
  const voided = await finance.db.rpc("void_payment", { p_payment: matched.data as string, p_reason: "Recorded against the wrong date" });
  const { data: reopened } = await admin.from("invoices").select("status, balance").eq("id", invoiceId).single();
  const { data: s3 } = await admin.from("payment_slips").select("status").eq("id", good.id!).single();
  check("Voiding the payment reopens the invoice and the slip", !voided.error && reopened?.status !== "paid" && Number(reopened?.balance) === expected && s3?.status === "pending", voided.error?.message ?? JSON.stringify({ ...reopened, slip: s3?.status }));
  const rematched = await finance.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: expected, p_method: "bank_transfer", p_reference: "DEV123", p_paid_on: today, p_slip: good.id! });
  const { data: paid2 } = await admin.from("invoices").select("status").eq("id", invoiceId).single();
  check("Finance matches it again: paid", !rematched.error && paid2?.status === "paid", rematched.error?.message ?? paid2?.status ?? "");
  const twice = await finance.db.rpc("record_payment", { p_invoice: invoiceId, p_amount: 1, p_method: "cash" });
  check("A paid invoice takes no more payments", Boolean(twice.error), twice.error?.message ?? "recorded!");
  await drain(); // receipt
  const after = await clientAdmin.db.rpc("portal_invoice", { p_invoice: invoiceId });
  const ap = after.data as { status?: string; payments?: { receipt_ready: boolean; receipt_number: string | null; receipt_document_id: string | null }[] } | null;
  const receipt = ap?.payments?.[0];
  check("The client sees it paid with a receipt", ap?.status === "paid" && ap.payments?.length === 1 && Boolean(receipt?.receipt_ready && receipt?.receipt_number), JSON.stringify(receipt ?? null));
  const receiptPdf = receipt?.receipt_document_id ? await get(clientAdmin, `/api/documents/${receipt.receipt_document_id}?download=1`) : null;
  check("The client downloads the receipt", Boolean(receiptPdf && (receiptPdf.status === 307 || receiptPdf.status === 302 || receiptPdf.type.includes("pdf"))), `${receiptPdf?.status}`);

  // ---------------------------------------------------------------- statement
  const from = `${today.slice(0, 4)}-01-01`;
  const st = await clientAdmin.db.rpc("client_statement", { p_client: clientId, p_from: from, p_to: today });
  const stl = (st.data as { lines?: { reference: string; kind: string }[] } | null)?.lines ?? [];
  check("The client's statement shows the invoice and payment", stl.some((l) => l.reference === c.number && l.kind === "invoice") && stl.some((l) => l.reference === "DEV123" && l.kind === "payment"), st.error?.message ?? `${stl.length} lines`);
  const stPdf = await get(clientAdmin, `/api/statements/${clientId}?from=${from}&to=${today}`);
  check("The client downloads the statement PDF", stPdf.status === 200 && stPdf.type.includes("pdf") && stPdf.body.subarray(0, 5).toString() === "%PDF-", `${stPdf.status} ${stPdf.type} ${stPdf.body.length} bytes`);
  const stCsv = await get(clientAdmin, `/api/statements/${clientId}?from=${from}&to=${today}&format=csv`);
  check("…and the CSV", stCsv.status === 200 && stCsv.type.includes("csv") && stCsv.body.toString().includes(c.number), `${stCsv.status} ${stCsv.type}`);
  const staffSt = await get(finance, `/api/statements/${clientId}?from=${from}&to=${today}&format=csv`);
  check("Finance downloads the same statement", staffSt.status === 200 && staffSt.body.toString().includes(c.number), `${staffSt.status}`);
  const exp = await get(finance, `/api/exports/invoices?from=${today}&to=${today}`);
  check("Finance exports the invoice CSV", exp.status === 200 && exp.type.includes("csv") && exp.body.toString().includes(c.number), `${exp.status} ${exp.type}`);
  const expEntry = await get(entry, `/api/exports/invoices?from=${today}&to=${today}`);
  check("A data entry officer can't export", expEntry.status !== 200 || !expEntry.body.toString().includes(c.number), `${expEntry.status}`);

  // ---------------------------------------------------------------- another company
  const sList = await stranger.db.rpc("portal_invoices");
  const sIds = ((sList.data as { invoices?: { id: string }[] } | null)?.invoices ?? []).map((r) => r.id);
  check("Another company's list doesn't include it", !sIds.includes(invoiceId), sList.error?.message ?? `${sIds.length} of theirs`);
  const sOpen = await stranger.db.rpc("portal_invoice", { p_invoice: invoiceId });
  check("Another company can't open it", Boolean(sOpen.error), sOpen.error?.code ?? "opened!");
  const sDocs = await stranger.db.from("generated_documents").select("id").in("id", [c.document_id!, receipt?.receipt_document_id ?? c.document_id!]);
  check("Another company can't see its PDF or receipt", (sDocs.data?.length ?? 0) === 0);
  const sPdf = await get(stranger, `/api/documents/${c.document_id}?download=1`);
  check("…or download them", sPdf.status === 404, `${sPdf.status}`);
  const sSlips = await stranger.db.from("payment_slips").select("id").in("id", [wrong.id!, good.id!]);
  check("Another company can't see the slips", (sSlips.data?.length ?? 0) === 0);
  const sSt = await stranger.db.rpc("client_statement", { p_client: clientId, p_from: from, p_to: today });
  check("Another company can't read the statement", Boolean(sSt.error), sSt.error?.code ?? "read!");
  const sStPdf = await get(stranger, `/api/statements/${clientId}?from=${from}&to=${today}`);
  check("…or download it", sStPdf.status === 404, `${sStPdf.status}`);
  const sBal = await stranger.db.rpc("client_balance", { p_client: clientId });
  check("Another company sees no balance for it", Number((sBal.data as { open_invoices?: number } | null)?.open_invoices ?? 0) === 0 && Number((sBal.data as { outstanding?: number } | null)?.outstanding ?? 0) === 0, JSON.stringify(sBal.data));
  const anon = await get(null, `/api/statements/${clientId}?from=${from}&to=${today}`);
  check("Anonymous visitors get nothing", anon.status !== 200, `${anon.status}`);

  // ---------------------------------------------------------------- credit note and void
  const { data: m2 } = await adminUser.db.from("invoices").insert({ org_id: ORG, client_id: clientId, kind: "manual", status: "draft" }).select("id").single();
  await adminUser.db.from("invoice_items").insert({ org_id: ORG, invoice_id: m2!.id, sort: 10, description: "Additional verification", quantity: 1, unit_price: 8000 });
  const c2 = await adminUser.db.rpc("confirm_invoice", { p_invoice: m2!.id });
  await finance.db.rpc("mark_invoice_sent", { p_invoice: m2!.id, p_to: [] });
  const overCredit = await adminUser.db.rpc("issue_credit_note", { p_invoice: m2!.id, p_amount: 9000, p_reason: "Too much" });
  check("A credit note can't exceed what is owed", Boolean(overCredit.error), overCredit.error?.message ?? "issued!");
  const credit = await adminUser.db.rpc("issue_credit_note", { p_invoice: m2!.id, p_amount: 3000, p_reason: "Goodwill discount" });
  const { data: credited } = await admin.from("invoices").select("balance, amount_credited").eq("id", m2!.id).single();
  check("Admin issues a credit note", !credit.error && Number(credited?.balance) === 5000 && Number(credited?.amount_credited) === 3000, credit.error?.message ?? JSON.stringify(credited));
  await drain();
  const { data: cn } = await admin.from("credit_notes").select("number, document_id").eq("id", credit.data as string).single();
  const { data: cnDoc } = await admin.from("generated_documents").select("status").eq("id", cn?.document_id ?? "").maybeSingle();
  check("The credit note PDF renders", cnDoc?.status === "ready", `${cn?.number} ${cnDoc?.status}`);
  const cnClient = await clientAdmin.db.rpc("portal_invoice", { p_invoice: m2!.id });
  check("The client sees the credit note", ((cnClient.data as { credit_notes?: unknown[] } | null)?.credit_notes?.length ?? 0) === 1, cnClient.error?.message ?? "");
  const noReasonVoid = await adminUser.db.rpc("void_invoice", { p_invoice: m2!.id, p_reason: "" });
  check("Voiding needs a reason", Boolean(noReasonVoid.error), noReasonVoid.error?.message ?? "voided!");
  const voidInv = await adminUser.db.rpc("void_invoice", { p_invoice: m2!.id, p_reason: "Raised in error (dev flow)" });
  const { data: v } = await admin.from("invoices").select("status, balance").eq("id", m2!.id).single();
  check("Admin voids an unpaid invoice", !voidInv.error && v?.status === "void" && Number(v?.balance) === 0, voidInv.error?.message ?? JSON.stringify(v));
  const voidPaid = await adminUser.db.rpc("void_invoice", { p_invoice: invoiceId, p_reason: "test" });
  check("A paid invoice can't be voided while it has payments", Boolean(voidPaid.error), voidPaid.error?.message ?? "voided!");

  const { data: events } = await admin.from("invoice_events").select("kind").eq("invoice_id", invoiceId).order("at");
  check("The timeline has every step", ["confirmed", "sent", "viewed", "slip_uploaded", "payment", "payment_voided"].every((k) => events?.some((e) => e.kind === k)), (events ?? []).map((e) => e.kind).join(" → "));

  console.log(JSON.stringify({ invoiceId, number: c.number, documentId: c.document_id, creditInvoice: m2!.id, creditInvoiceNumber: (c2.data as { number?: string } | null)?.number }));
  const bad = results.filter((r) => !r[1]).length;
  console.log(`${results.length - bad} of ${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
