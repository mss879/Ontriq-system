import { CANDIDATE_LANGS, type CandidateLang } from "@/domain/candidate/i18n";

/**
 * Dates on the candidate's page, in Sri Lanka time and the candidate's
 * language. Formatted on the server and passed down as text, so the browser's
 * own date data can never disagree with the server's.
 */

// British English reads "4 November 2026"; Sinhala and Tamil use their Sri Lankan forms.
const locale = (lang: CandidateLang) => (lang === "en" ? "en-GB" : `${CANDIDATE_LANGS.find((l) => l.key === lang)?.htmlLang ?? "en"}-LK`);

export function candidateDate(iso: string | null | undefined, lang: CandidateLang): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" });
}

export function candidateDateTime(iso: string | null | undefined, lang: CandidateLang): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale(lang), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Colombo" });
}
