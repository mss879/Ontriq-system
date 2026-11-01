import { renderEmail, type EmailBrand, DEFAULT_BRAND } from "./layout";

export function inviteEmail(
  input: { fullName: string; inviterName: string; orgName: string; roleName: string; actionUrl: string; kind: "staff" | "client"; clientName?: string | null },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const greeting = input.fullName ? `Hello ${input.fullName.split(" ")[0]},` : "Hello,";
  const where =
    input.kind === "client"
      ? `the ${input.orgName} client portal${input.clientName ? ` for ${input.clientName}` : ""}`
      : input.orgName;
  const subject = input.kind === "client" ? `Your ${input.orgName} client portal access` : `You're invited to ${input.orgName}`;
  const rendered = renderEmail(
    {
      preheader: `${input.inviterName} invited you to ${where}.`,
      heading: input.kind === "client" ? "Your client portal is ready" : `Join ${input.orgName}`,
      paragraphs: [
        greeting,
        `${input.inviterName} has invited you to ${where} as ${input.roleName}.`,
        input.kind === "client"
          ? "From the portal you can request background verifications, follow every check as it progresses, and download reports once they are released."
          : "Set your password to get started. You'll be asked to set up two-step verification with an authenticator app.",
      ],
      cta: { label: "Set up my account", url: input.actionUrl },
      note: "This link works once and expires in 24 hours. If it has expired, ask for a new invitation.",
    },
    brand,
  );
  return { subject, ...rendered };
}

export function recoveryEmail(input: { fullName: string; orgName: string; actionUrl: string }, brand: EmailBrand = DEFAULT_BRAND) {
  const rendered = renderEmail(
    {
      preheader: `Reset your ${input.orgName} password.`,
      heading: "Reset your password",
      paragraphs: [
        input.fullName ? `Hello ${input.fullName.split(" ")[0]},` : "Hello,",
        "We received a request to reset your password. Use the button below to choose a new one.",
      ],
      cta: { label: "Choose a new password", url: input.actionUrl },
      note: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
    },
    brand,
  );
  return { subject: `Reset your ${input.orgName} password`, ...rendered };
}

/** To a client's report contact: the report is out. It stays in the portal, so nothing personal travels by email. */
export function reportReleasedEmail(input: { contactName: string; reference: string; orgName: string; portalUrl: string; hasPortal?: boolean }, brand: EmailBrand = DEFAULT_BRAND) {
  const portal = input.hasPortal !== false;
  const rendered = renderEmail(
    {
      preheader: `A verification report is ready: ${input.reference}.`,
      heading: "A verification report is ready",
      paragraphs: [
        input.contactName ? `Hello ${input.contactName.split(" ")[0]},` : "Hello,",
        `${input.orgName} has released the final background verification report for ${input.reference}.`,
        portal
          ? "Sign in to your client portal to read and download it. If you don't have portal access, ask your company's portal administrator."
          : `Your company has no portal users yet. Reply to this email or call ${input.orgName}, and they will arrange a copy or set up portal access for you.`,
      ],
      cta: portal ? { label: "Open the portal", url: input.portalUrl } : undefined,
    },
    brand,
  );
  return { subject: `${input.orgName}: report ready for ${input.reference}`, ...rendered };
}
