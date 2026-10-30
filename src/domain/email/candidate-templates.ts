/**
 * Emails and SMS to candidates, in their language (English, Sinhala, Tamil),
 * and the email copy of an in-app notification. Sinhala and Tamil wording is
 * for Ontriq to review before launch (plan §22). Pure: shared by server
 * actions and the worker.
 */
import { renderEmail, type EmailBrand, DEFAULT_BRAND } from "./layout";

export type CandidateLanguage = "en" | "si" | "ta";

type LinkCopy = {
  subject: (org: string) => string;
  heading: string;
  hello: (first: string) => string;
  asked: (client: string, org: string, position: string | null) => string;
  what: string;
  cta: string;
  note: (date: string, org: string, contact: string) => string;
};

const LINK: Record<CandidateLanguage, LinkCopy> = {
  en: {
    subject: (org) => `${org}: please provide documents for your background verification`,
    heading: "Your background verification",
    hello: (first) => `Hello ${first},`,
    asked: (client, org, position) =>
      position ? `${client} has asked ${org} to verify your background for the ${position} role.` : `${client} has asked ${org} to complete a background verification for you.`,
    what: "Open your secure page to see the documents we need, upload them from your phone or computer, and sign the consent form. It takes about 10 minutes.",
    cta: "Open my secure page",
    note: (date, org, contact) => `This link is personal to you and expires on ${date}. Please don't forward it. If you weren't expecting this, contact ${org}${contact ? ` at ${contact}` : ""}.`,
  },
  si: {
    subject: (org) => `${org}: ඔබගේ පසුබිම් සත්‍යාපනය සඳහා ලේඛන ලබා දෙන්න`,
    heading: "ඔබගේ පසුබිම් සත්‍යාපනය",
    hello: (first) => `ආයුබෝවන් ${first},`,
    asked: (client, org, position) =>
      position
        ? `${position} තනතුර සඳහා ඔබගේ පසුබිම සත්‍යාපනය කරන ලෙස ${client} ආයතනය ${org} වෙතින් ඉල්ලා ඇත.`
        : `ඔබගේ පසුබිම් සත්‍යාපනයක් සිදු කරන ලෙස ${client} ආයතනය ${org} වෙතින් ඉල්ලා ඇත.`,
    what: "අපට අවශ්‍ය ලේඛන බැලීමට, ඒවා ඔබගේ දුරකථනයෙන් හෝ පරිගණකයෙන් උඩුගත කිරීමට සහ කැමැත්ත පත්‍රය අත්සන් කිරීමට ඔබගේ ආරක්ෂිත පිටුව විවෘත කරන්න. මේ සඳහා මිනිත්තු 10ක් පමණ ගත වේ.",
    cta: "මගේ ආරක්ෂිත පිටුව විවෘත කරන්න",
    note: (date, org, contact) => `මෙම සබැඳිය ඔබට පමණක් අයත් වන අතර ${date} දින කල් ඉකුත් වේ. කරුණාකර එය වෙනත් අයෙකුට යොමු නොකරන්න. ඔබ මෙය අපේක්ෂා නොකළේ නම්, ${org}${contact ? ` (${contact})` : ""} අමතන්න.`,
  },
  ta: {
    subject: (org) => `${org}: உங்கள் பின்னணி சரிபார்ப்புக்கான ஆவணங்களை வழங்கவும்`,
    heading: "உங்கள் பின்னணி சரிபார்ப்பு",
    hello: (first) => `வணக்கம் ${first},`,
    asked: (client, org, position) =>
      position
        ? `${position} பதவிக்காக உங்கள் பின்னணியைச் சரிபார்க்குமாறு ${client} நிறுவனம் ${org} இடம் கேட்டுள்ளது.`
        : `உங்களுக்கான பின்னணி சரிபார்ப்பை மேற்கொள்ளுமாறு ${client} நிறுவனம் ${org} இடம் கேட்டுள்ளது.`,
    what: "எங்களுக்குத் தேவையான ஆவணங்களைப் பார்க்கவும், அவற்றை உங்கள் தொலைபேசி அல்லது கணினியிலிருந்து பதிவேற்றவும், ஒப்புதல் படிவத்தில் கையொப்பமிடவும் உங்கள் பாதுகாப்பான பக்கத்தைத் திறக்கவும். இதற்கு சுமார் 10 நிமிடங்கள் ஆகும்.",
    cta: "எனது பாதுகாப்பான பக்கத்தைத் திற",
    note: (date, org, contact) => `இந்த இணைப்பு உங்களுக்கு மட்டுமே உரியது, ${date} அன்று காலாவதியாகும். தயவுசெய்து இதை வேறு யாருக்கும் அனுப்ப வேண்டாம். நீங்கள் இதை எதிர்பார்க்கவில்லை என்றால், ${org}${contact ? ` (${contact})` : ""} ஐத் தொடர்பு கொள்ளவும்.`,
  },
};

const REMINDER: Record<CandidateLanguage, { subject: (org: string) => string; heading: string; body: string; items: (n: { documents: number; requests: number; consent: boolean }) => string; cta: string }> = {
  en: {
    subject: (org) => `Reminder from ${org}: a few things are still needed for your verification`,
    heading: "A few things are still needed",
    body: "We still need a few things from you to continue your background verification.",
    items: ({ documents, requests, consent }) =>
      [documents ? `${documents} document${documents === 1 ? "" : "s"}` : "", requests ? `${requests} question${requests === 1 ? "" : "s"}` : "", consent ? "your signed consent" : ""]
        .filter(Boolean)
        .join(", ")
        .replace(/, ([^,]*)$/, " and $1") + ".",
    cta: "Open my secure page",
  },
  si: {
    subject: (org) => `${org} වෙතින් මතක් කිරීමක්: ඔබගේ සත්‍යාපනය සඳහා තවමත් කරුණු කිහිපයක් අවශ්‍යයි`,
    heading: "තවමත් කරුණු කිහිපයක් අවශ්‍යයි",
    body: "ඔබගේ පසුබිම් සත්‍යාපනය දිගටම කරගෙන යාමට අපට තවමත් ඔබෙන් කරුණු කිහිපයක් අවශ්‍යයි.",
    items: ({ documents, requests, consent }) =>
      [documents ? `ලේඛන ${documents}` : "", requests ? `ප්‍රශ්න ${requests}` : "", consent ? "අත්සන් කළ කැමැත්ත පත්‍රය" : ""].filter(Boolean).join(", ") + ".",
    cta: "මගේ ආරක්ෂිත පිටුව විවෘත කරන්න",
  },
  ta: {
    subject: (org) => `${org} இடமிருந்து நினைவூட்டல்: உங்கள் சரிபார்ப்புக்கு இன்னும் சில விவரங்கள் தேவை`,
    heading: "இன்னும் சில விவரங்கள் தேவை",
    body: "உங்கள் பின்னணி சரிபார்ப்பைத் தொடர எங்களுக்கு இன்னும் சில விவரங்கள் உங்களிடமிருந்து தேவை.",
    items: ({ documents, requests, consent }) =>
      [documents ? `${documents} ஆவணம்` : "", requests ? `${requests} கேள்வி` : "", consent ? "கையொப்பமிட்ட ஒப்புதல் படிவம்" : ""].filter(Boolean).join(", ") + ".",
    cta: "எனது பாதுகாப்பான பக்கத்தைத் திற",
  },
};

const UPDATE: Record<CandidateLanguage, { subject: (org: string) => string; heading: string; body: string; cta: string }> = {
  en: {
    subject: (org) => `${org} sent you a message about your verification`,
    heading: "You have a new message",
    body: "There is a new message or request for you on your secure page.",
    cta: "Open my secure page",
  },
  si: {
    subject: (org) => `ඔබගේ සත්‍යාපනය පිළිබඳව ${org} ඔබට පණිවිඩයක් එවා ඇත`,
    heading: "ඔබට නව පණිවිඩයක් ඇත",
    body: "ඔබගේ ආරක්ෂිත පිටුවේ ඔබ සඳහා නව පණිවිඩයක් හෝ ඉල්ලීමක් ඇත.",
    cta: "මගේ ආරක්ෂිත පිටුව විවෘත කරන්න",
  },
  ta: {
    subject: (org) => `உங்கள் சரிபார்ப்பு தொடர்பாக ${org} உங்களுக்கு ஒரு செய்தி அனுப்பியுள்ளது`,
    heading: "உங்களுக்கு ஒரு புதிய செய்தி உள்ளது",
    body: "உங்கள் பாதுகாப்பான பக்கத்தில் உங்களுக்கான ஒரு புதிய செய்தி அல்லது கோரிக்கை உள்ளது.",
    cta: "எனது பாதுகாப்பான பக்கத்தைத் திற",
  },
};

const lang = (l: string | null | undefined): CandidateLanguage => (l === "si" || l === "ta" ? l : "en");
const firstName = (full: string) => full.trim().split(/\s+/)[0] || full;

/** "14 November 2026" in Sri Lanka time. */
export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" });
}

export function candidateLinkEmail(
  input: { language?: string | null; candidateName: string; clientName: string; position: string | null; orgName: string; contact: string; url: string; expiresAt: string },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const c = LINK[lang(input.language)];
  const rendered = renderEmail(
    {
      preheader: c.what,
      heading: c.heading,
      paragraphs: [c.hello(firstName(input.candidateName)), c.asked(input.clientName, input.orgName, input.position), c.what],
      cta: { label: c.cta, url: input.url },
      note: c.note(formatExpiry(input.expiresAt), input.orgName, input.contact),
    },
    brand,
  );
  return { subject: c.subject(input.orgName), ...rendered };
}

export function candidateReminderEmail(
  input: { language?: string | null; candidateName: string; orgName: string; url: string; expiresAt: string; contact: string; outstanding: { documents: number; requests: number; consent: boolean } },
  brand: EmailBrand = DEFAULT_BRAND,
) {
  const l = lang(input.language);
  const c = REMINDER[l];
  const rendered = renderEmail(
    {
      preheader: c.body,
      heading: c.heading,
      paragraphs: [LINK[l].hello(firstName(input.candidateName)), c.body, c.items(input.outstanding)],
      cta: { label: c.cta, url: input.url },
      note: LINK[l].note(formatExpiry(input.expiresAt), input.orgName, input.contact),
    },
    brand,
  );
  return { subject: c.subject(input.orgName), ...rendered };
}

export function candidateUpdateEmail(input: { language?: string | null; candidateName: string; orgName: string; url: string }, brand: EmailBrand = DEFAULT_BRAND) {
  const l = lang(input.language);
  const c = UPDATE[l];
  const rendered = renderEmail({ preheader: c.body, heading: c.heading, paragraphs: [LINK[l].hello(firstName(input.candidateName)), c.body], cta: { label: c.cta, url: input.url } }, brand);
  return { subject: c.subject(input.orgName), ...rendered };
}

/** SMS stays in English and short (one segment where possible). */
export function candidateLinkSms(input: { orgName: string; url: string; reminder?: boolean }): string {
  return input.reminder
    ? `${input.orgName}: reminder, we still need a few things for your background verification: ${input.url}`
    : `${input.orgName}: please upload your documents for your background verification: ${input.url}`;
}

/** The email copy of an in-app notification (notify.email job). */
export function notificationEmail(input: { orgName: string; recipientName: string; title: string; body: string; url: string | null }, brand: EmailBrand = DEFAULT_BRAND) {
  const rendered = renderEmail(
    {
      preheader: input.title,
      heading: input.title,
      paragraphs: [input.recipientName ? `Hello ${firstName(input.recipientName)},` : "Hello,", ...(input.body ? [input.body] : [])],
      cta: input.url ? { label: "Open in the portal", url: input.url } : undefined,
      note: `You're receiving this because email notifications are on for this kind of update. Change it under Settings in ${input.orgName}.`,
    },
    brand,
  );
  return { subject: input.title, ...rendered };
}
