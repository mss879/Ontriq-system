/**
 * Ontriq's standard quotation wording, built from the quote's own lines. Used
 * when AI drafting is switched off or fails, so "Draft text" always fills the
 * form. Never mentions prices: those live in the line items. Pure module
 * (tests/unit/quote-draft.test.ts).
 */

export type QuoteDraftInput = {
  orgName: string;
  clientName: string;
  lines: { description: string; kind: "package" | "check" | "custom" }[];
  tatDays?: number | null;
  expectedMonthlyVolume?: number | null;
  tone?: "formal" | "friendly";
};

export type QuoteDraftText = { intro: string; scope: string; assumptions: string; tat_text: string; closing: string };

const join = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function defaultQuoteText(input: QuoteDraftInput): QuoteDraftText {
  const friendly = input.tone === "friendly";
  const names = [...new Set(input.lines.map((l) => l.description.trim()).filter(Boolean))];
  const scopeList = names.length ? join(names.map((n) => n.replace(/\.$/, ""))) : "the background checks agreed with your team";
  const volume = input.expectedMonthlyVolume && input.expectedMonthlyVolume > 0 ? ` for around ${input.expectedMonthlyVolume} candidates a month` : "";
  const days = input.tatDays && input.tatDays > 0 ? input.tatDays : 7;
  return {
    intro: friendly
      ? `Thank you for thinking of ${input.orgName}. Here is our quotation for ${input.clientName}'s background verification${volume}, with the checks and turnaround we can commit to.`
      : `Thank you for the opportunity to support ${input.clientName}. This quotation sets out the background verification services ${input.orgName} will provide${volume}, the turnaround we commit to and the terms that apply.`,
    scope: `For each candidate: ${scopeList}. Every case includes document collection, Pre-QC and Post-QC review, and a consolidated final report with annexures, released to your team through the client portal.`,
    assumptions:
      "Candidates provide their documents and signed consent promptly after our request. Turnaround is counted in working days from the day all required documents are received. Police clearance and some institution confirmations depend on third parties and may take longer.",
    tat_text: `${days} working days per candidate from receipt of all documents, with live progress in the client portal.`,
    closing: friendly
      ? "We'd be glad to start whenever you're ready. Accept the quotation in the portal, or reply with any questions."
      : "To proceed, please accept this quotation in the client portal. We would be pleased to answer any questions.",
  };
}
