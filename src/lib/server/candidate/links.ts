import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin } from "@/lib/env";
import { emailBrand } from "@/lib/server/email-brand";
import { queueEmail } from "@/lib/server/jobs/enqueue";
import { kickWorker } from "@/lib/server/jobs/kick";
import { rpcErrorMessage } from "@/lib/server/errors";
import { fail, type ActionResult } from "@/lib/server/action-result";
import { candidateLinkEmail, candidateLinkSms, candidateUpdateEmail } from "@/domain/email/candidate-templates";
import {
  candidateLinkUrl,
  hashLinkSecret,
  isCandidateSecretConfigured,
  newLinkSecret,
  openLinkSecret,
  sealLinkSecret,
} from "@/lib/crypto/candidate-token";

/**
 * Staff side of the candidate link: issue, send, re-send and copy. The
 * database decides who may (issue_candidate_link and friends check the
 * caller's permission on the case); this module makes the secret, builds
 * the URL and queues the email or SMS. Call after requireViewer().
 */

export type Channel = "email" | "sms";

type CaseContact = {
  caseId: string;
  orgId: string;
  reference: string;
  position: string | null;
  candidateName: string;
  email: string | null;
  phone: string | null;
  language: "en" | "si" | "ta";
  clientName: string;
  orgName: string;
  contact: string;
};

async function caseContact(caseId: string): Promise<CaseContact | null> {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("cases")
    .select("id, org_id, reference, position_title, client:clients(name), candidate:candidates(full_name, email, phone, preferred_language), org:orgs(name, branding)")
    .eq("id", caseId)
    .maybeSingle();
  if (!c) return null;
  const cand = c.candidate as { full_name: string; email: string | null; phone: string | null; preferred_language: string } | null;
  const org = c.org as { name: string; branding: Record<string, string> | null } | null;
  const lang = cand?.preferred_language;
  return {
    caseId: c.id,
    orgId: c.org_id,
    reference: c.reference,
    position: c.position_title,
    candidateName: cand?.full_name ?? "",
    email: cand?.email ?? null,
    phone: cand?.phone ?? null,
    language: lang === "si" || lang === "ta" ? lang : "en",
    clientName: (c.client as { name: string } | null)?.name ?? "",
    orgName: org?.branding?.display_name || org?.name || "Ontriq",
    contact: org?.branding?.email || org?.branding?.phone || "",
  };
}

async function deliver(link: { id: string; url: string; expiresAt: string; language: string }, contact: CaseContact, channels: Channel[], actorId: string) {
  const sent: Channel[] = [];
  const admin = createAdminClient();
  if (channels.includes("email") && contact.email) {
    const mail = candidateLinkEmail(
      { language: link.language, candidateName: contact.candidateName, clientName: contact.clientName, position: contact.position, orgName: contact.orgName, contact: contact.contact, url: link.url, expiresAt: link.expiresAt },
      emailBrand(),
    );
    await queueEmail({ to: [contact.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "candidate.link", entityType: "case", entityId: contact.caseId, createdBy: actorId, orgId: contact.orgId });
    sent.push("email");
  }
  if (channels.includes("sms") && contact.phone) {
    const { error } = await admin.rpc("queue_sms", {
      p_to: contact.phone,
      p_body: candidateLinkSms({ orgName: contact.orgName, url: link.url }),
      p_template_key: "candidate.link",
      p_entity_type: "case",
      p_entity_id: contact.caseId,
      p_created_by: actorId,
      p_org: contact.orgId,
    });
    if (!error) {
      sent.push("sms");
      kickWorker();
    }
  }
  if (sent.length) {
    const supabase = await createClient();
    await supabase.rpc("record_candidate_link_sent", { p_link: link.id, p_channels: sent });
  }
  return sent;
}

/** Create a new link for the case (replacing any active one) and send it. */
export async function issueCandidateLink(input: { caseId: string; actorId: string; channels: Channel[]; language?: "en" | "si" | "ta"; days?: number }): Promise<
  ActionResult<{ linkId: string; url: string; sent: Channel[]; missing: Channel[] }>
> {
  if (!isCandidateSecretConfigured()) return fail("Candidate links need CANDIDATE_SESSION_SECRET in the environment.");
  const contact = await caseContact(input.caseId);
  if (!contact) return fail("That case no longer exists.");
  const secret = newLinkSecret();
  const language = input.language ?? contact.language;
  const supabase = await createClient();
  const { data: linkId, error } = await supabase.rpc("issue_candidate_link", {
    p_case: input.caseId,
    p_token_hash: hashLinkSecret(secret),
    p_token_enc: sealLinkSecret(secret),
    p_language: language,
    p_days: input.days ?? 14,
  });
  if (error || !linkId) return fail(rpcErrorMessage(error));
  const { data: row } = await createAdminClient().from("candidate_links").select("expires_at").eq("id", linkId).single();
  const url = candidateLinkUrl(appOrigin(), secret);
  const sent = await deliver({ id: linkId, url, expiresAt: row?.expires_at ?? new Date().toISOString(), language }, contact, input.channels, input.actorId);
  const missing = input.channels.filter((ch) => !sent.includes(ch));
  return { ok: true, linkId, url, sent, missing };
}

/** The working URL of the case's active link (staff "copy link"). */
export async function activeLinkUrl(linkId: string): Promise<ActionResult<{ url: string; expiresAt: string; language: string }>> {
  const supabase = await createClient();
  const { data: sealed, error } = await supabase.rpc("candidate_link_secret", { p_link: linkId });
  if (error) return fail(rpcErrorMessage(error));
  const secret = openLinkSecret(sealed as string | null);
  if (!secret) return fail("This link can't be recovered. Create a new one.");
  const { data: row } = await createAdminClient().from("candidate_links").select("expires_at, language").eq("id", linkId).single();
  return { ok: true, url: candidateLinkUrl(appOrigin(), secret), expiresAt: row?.expires_at ?? "", language: row?.language ?? "en" };
}

/** Send the existing link again. */
export async function resendCandidateLink(input: { linkId: string; actorId: string; channels: Channel[] }): Promise<ActionResult<{ sent: Channel[]; missing: Channel[] }>> {
  const link = await activeLinkUrl(input.linkId);
  if (!link.ok) return link;
  const { data: row } = await createAdminClient().from("candidate_links").select("case_id").eq("id", input.linkId).single();
  const contact = row ? await caseContact(row.case_id) : null;
  if (!contact) return fail("That case no longer exists.");
  const sent = await deliver({ id: input.linkId, url: link.url, expiresAt: link.expiresAt, language: link.language }, contact, input.channels, input.actorId);
  return { ok: true, sent, missing: input.channels.filter((ch) => !sent.includes(ch)) };
}

/** Tell the candidate there is something new on their page (a message or a request). Best effort. */
export async function emailCandidateUpdate(caseId: string, actorId: string): Promise<boolean> {
  if (!isCandidateSecretConfigured()) return false;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("candidate_links")
    .select("id, token_enc, language, expires_at")
    .eq("case_id", caseId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const secret = openLinkSecret(link?.token_enc);
  const contact = await caseContact(caseId);
  if (!link || !secret || !contact?.email) return false;
  const mail = candidateUpdateEmail({ language: link.language, candidateName: contact.candidateName, orgName: contact.orgName, url: candidateLinkUrl(appOrigin(), secret) }, emailBrand());
  await queueEmail({ to: [contact.email], subject: mail.subject, html: mail.html, text: mail.text, templateKey: "candidate.update", entityType: "case", entityId: caseId, createdBy: actorId, orgId: contact.orgId });
  return true;
}
