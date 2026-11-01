/**
 * Ontriq cost model: the single source of truth for the Cost and Feasibility
 * document (scripts/build-cost-doc.tsx). Every figure is computed from the
 * assumptions below. Prices are list prices verified on 2026-10-31; re-verify
 * before publishing a new version. Token counts come from the AI evaluation of
 * 2026-10-31 (scripts/ai-eval) and the ledger of its real test cases. Only AI
 * calls the system really makes belong here.
 */

export const COST_MODEL_VERSION = "1.3";
export const PRICES_VERIFIED_ON = "31 October 2026";
export const USD_TO_LKR = 335; // market about 331 in mid-October 2026, plus a small cushion; restate when quoting in rupees

// ---------------------------------------------------------------------------
// Model prices (USD per million tokens)
// ---------------------------------------------------------------------------
export type ModelTier = "haiku" | "sonnet" | "opus";

export const MODELS: Record<ModelTier, { id: string; name: string; input: number; output: number; cacheRead: number; role: string }> = {
  haiku: {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    role: "Light, high-volume work: reading uploads, payment slips, consistency checks, Pre-QC drafts, outreach and briefings.",
  },
  sonnet: {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cacheRead: 0.1,
    role: "Where accuracy matters most: check fields, the candidate report, the Post-QC cross-check, reading replies, report remarks, quotations, the staff assistant.",
  },
  opus: {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    input: 4,
    output: 20,
    cacheRead: 0.2,
    role: "The Super Admin command assistant.",
  },
};

export const SPEECH_TO_TEXT_PER_MINUTE = 0.003; // hosted transcription for voice notes

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export type Usage = { tier: ModelTier; input: number; cachedInput?: number; output: number };

export function usageCost(u: Usage): number {
  const m = MODELS[u.tier];
  return (u.input * m.input + (u.cachedInput ?? 0) * m.cacheRead + u.output * m.output) / 1_000_000;
}

export type TaskKey =
  | "classify_page"
  | "extract_check"
  | "candidate_report"
  | "consistency"
  | "preqc"
  | "outreach_check"
  | "response_check"
  | "postqc"
  | "narrative"
  | "quotation_draft"
  | "slip_read"
  | "nudge"
  | "staff_assistant_turn"
  | "command_turn"
  | "daily_briefing";

export type TaskDef = { key: TaskKey; label: string; unit: string; usage: Usage; note?: string };

/** Typical Sri Lankan documents are 1 to 2 pages; a photographed page is up to about 4,800 input tokens. */
export const TASKS: TaskDef[] = [
  { key: "classify_page", label: "Read one page: type, quality, text, translation, signs of editing", unit: "page", usage: { tier: "haiku", input: 4000, output: 900 } },
  { key: "extract_check", label: "Fill the fields for one check", unit: "check", usage: { tier: "sonnet", input: 5700, output: 520 }, note: "one new page, earlier pages as text" },
  { key: "candidate_report", label: "Write the candidate report once they confirm", unit: "case", usage: { tier: "sonnet", input: 6000, cachedInput: 1800, output: 2560 }, note: "scales with pages; 12-page case shown" },
  { key: "consistency", label: "Compare everything across documents", unit: "case", usage: { tier: "haiku", input: 9600, output: 1980 }, note: "scales with pages; 12-page case shown" },
  { key: "preqc", label: "Pre-QC checklist and drafted requests", unit: "case", usage: { tier: "haiku", input: 3000, output: 1900 } },
  { key: "outreach_check", label: "Draft the verification email and call script", unit: "check", usage: { tier: "haiku", input: 1000, output: 600 } },
  { key: "response_check", label: "Turn a verifier's reply into a proposed result", unit: "check", usage: { tier: "sonnet", input: 1200, output: 700 } },
  { key: "postqc", label: "Post-QC cross-check and proposed outcome", unit: "case", usage: { tier: "sonnet", input: 5200, output: 710 }, note: "scales with checks; 7-check case shown" },
  { key: "narrative", label: "Report remarks and summary", unit: "case", usage: { tier: "sonnet", input: 2400, output: 870 }, note: "scales with checks; 7-check case shown" },
  { key: "quotation_draft", label: "Draft a quotation", unit: "draft", usage: { tier: "sonnet", input: 1000, output: 400 } },
  { key: "slip_read", label: "Read a payment slip", unit: "slip", usage: { tier: "haiku", input: 2200, output: 240 } },
  { key: "nudge", label: "Draft a nudge to a staff member", unit: "nudge", usage: { tier: "haiku", input: 600, output: 130 } },
  // The two assistants are planned at about twice the test runs: real conversations run longer than single questions.
  { key: "staff_assistant_turn", label: "Staff assistant question", unit: "question", usage: { tier: "sonnet", input: 800, cachedInput: 8000, output: 300 } },
  { key: "command_turn", label: "Super Admin command", unit: "command", usage: { tier: "opus", input: 900, cachedInput: 10000, output: 320 } },
  { key: "daily_briefing", label: "Daily manager briefing", unit: "day", usage: { tier: "haiku", input: 750, output: 150 } },
];

export const task = (key: TaskKey): TaskDef => {
  const t = TASKS.find((x) => x.key === key);
  if (!t) throw new Error(`unknown task ${key}`);
  return t;
};
export const taskCost = (key: TaskKey) => usageCost(task(key).usage);

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
export type CaseProfile = {
  label: string;
  checks: number;
  pages: number;
};

export const COMPREHENSIVE_CASE: CaseProfile = { label: "Comprehensive (7 checks)", checks: 7, pages: 12 };
export const STANDARD_CASE: CaseProfile = { label: "Standard (NIC, education, employment)", checks: 3, pages: 6 };

export type CostLine = { label: string; quantity: number; unit: string; tier: ModelTier | "none"; cost: number };

export function caseCostLines(p: CaseProfile): CostLine[] {
  const postQc: Usage = { tier: "sonnet", input: 1000 + 600 * p.checks, output: 150 + 80 * p.checks };
  const narrative: Usage = { tier: "sonnet", input: 1000 + 200 * p.checks, output: 100 + 110 * p.checks };
  const consistency: Usage = { tier: "haiku", input: 800 * p.pages, output: 1500 + 40 * p.pages };
  // Fits the ledger: $0.021 for a real report on five files, six pages.
  const candidateReport: Usage = { tier: "sonnet", input: 600 + 450 * p.pages, cachedInput: 1800, output: 400 + 180 * p.pages };
  const line = (key: TaskKey, quantity: number): CostLine => ({ label: task(key).label, quantity, unit: task(key).unit, tier: task(key).usage.tier, cost: quantity * taskCost(key) });
  return [
    line("classify_page", p.pages),
    line("extract_check", p.checks),
    { label: task("candidate_report").label, quantity: 1, unit: "case", tier: "sonnet", cost: usageCost(candidateReport) },
    { label: task("consistency").label, quantity: 1, unit: "case", tier: "haiku", cost: usageCost(consistency) },
    line("preqc", 1),
    line("outreach_check", p.checks),
    line("response_check", p.checks),
    { label: task("postqc").label, quantity: 1, unit: "case", tier: "sonnet", cost: usageCost(postQc) },
    { label: task("narrative").label, quantity: 1, unit: "case", tier: "sonnet", cost: usageCost(narrative) },
  ];
}

export const sum = (lines: { cost: number }[]) => lines.reduce((a, l) => a + l.cost, 0);
export const caseCost = (p: CaseProfile) => sum(caseCostLines(p));

/**
 * One check reading a whole combined PDF. Separate files are read once each and
 * reused as text, but every check reads a pack in full. Fits the ledger: four
 * pages over seven checks cost $0.145 to $0.152 on the real pipeline.
 */
export const packExtractCost = (pages: number) => usageCost({ tier: "sonnet", input: 800 + 1850 * pages, cachedInput: 2000, output: 400 });

/** The same case when it all arrives as one PDF. */
export function combinedCaseCost(p: CaseProfile): number {
  return caseCost(p) - p.checks * taskCost("extract_check") + p.checks * packExtractCost(p.pages);
}

/** Onboarding a client: the AI quotation, a first draft and two regenerations. */
export function onboardingCostLines(): CostLine[] {
  return [{ label: "Draft the quotation (first draft and two regenerations)", quantity: 3, unit: "draft", tier: "sonnet", cost: 3 * taskCost("quotation_draft") }];
}

/** The AI's part in one invoice: reading the payment slip. */
export const invoiceCost = () => taskCost("slip_read");

// ---------------------------------------------------------------------------
// Hosting and services (USD per month)
// ---------------------------------------------------------------------------
export const SERVICES = {
  netlifyPro: { label: "Netlify Pro", monthly: 20, note: "3,000 credits a month for the team, with unlimited members; extra credits can top up automatically so the site is never paused", topUpUsd: 10, topUpCredits: 1500 },
  netlifyPersonal: { label: "Netlify Personal", monthly: 9, note: "1,000 credits a month; the minimum paid plan" },
  supabaseFree: { label: "Supabase Free", monthly: 0, note: "500 MB database, 1 GB file storage, pauses after a week without activity, no backups" },
  supabasePro: { label: "Supabase Pro", monthly: 25, note: "8 GB database, 100 GB file storage, daily backups kept for 7 days, never pauses; includes a $10 compute credit", extraStoragePerGb: 0.0213 },
  resendFree: { label: "Resend Free", monthly: 0, note: "3,000 emails a month, 100 a day" },
  resendPro: { label: "Resend Pro", monthly: 20, note: "50,000 emails a month" },
  smsPerMessage: { label: "SMS (Notify.lk or similar)", unitCost: 0.003, note: "LKR 0.64 to 0.84 a message on Text.lk's published rates; the totals allow about LKR 1.00, because Sinhala and Tamil messages can use more than one unit" },
};

export const STORAGE_PER_CASE_MB = 8; // document images, PDFs and the final report
export const WORKING_DAYS_PER_MONTH = 22;
/** Resend's free plan stops at 100 emails a day, and busy days run at about twice the average. */
const EMAILS_A_DAY_ON_FREE_PLAN = 50;
const BACKGROUND_EMAILS = 200; // invites, reminders and notices that don't belong to one case

export type Scenario = {
  key: "starter" | "growth" | "scale";
  label: string;
  casesPerMonth: number;
  comprehensiveShare: number;
  newClientsPerMonth: number;
  staffAssistantQuestions: number;
  commandTurns: number;
  voiceMinutes: number;
  nudges: number;
  smsPerCase: number;
  emailsPerCase: number;
  /** Cases that arrive as one combined PDF instead of separate files. */
  combinedShare: number;
};

export const SCENARIOS: Scenario[] = [
  { key: "starter", label: "Starter", casesPerMonth: 50, comprehensiveShare: 0.4, newClientsPerMonth: 3, staffAssistantQuestions: 200, commandTurns: 100, voiceMinutes: 15, nudges: 10, smsPerCase: 3, emailsPerCase: 8, combinedShare: 0.3 },
  { key: "growth", label: "Growth", casesPerMonth: 200, comprehensiveShare: 0.4, newClientsPerMonth: 8, staffAssistantQuestions: 500, commandTurns: 200, voiceMinutes: 30, nudges: 25, smsPerCase: 3, emailsPerCase: 8, combinedShare: 0.3 },
  { key: "scale", label: "Scale", casesPerMonth: 600, comprehensiveShare: 0.4, newClientsPerMonth: 15, staffAssistantQuestions: 1200, commandTurns: 300, voiceMinutes: 50, nudges: 50, smsPerCase: 3, emailsPerCase: 8, combinedShare: 0.3 },
];

export type MonthlyBreakdown = {
  scenario: Scenario;
  aiCases: number;
  aiCommercial: number;
  aiAssistants: number;
  aiTotal: number;
  netlify: number;
  supabase: number;
  email: number;
  sms: number;
  speech: number;
  servicesTotal: number;
  total: number;
  storageGbPerMonth: number;
  emailsPerMonth: number;
};

/** AI per case across the month's mix of case sizes and of separate files and combined PDFs. */
export function averageCaseCost(s: Pick<Scenario, "comprehensiveShare" | "combinedShare">): number {
  const arriving = (p: CaseProfile) => (1 - s.combinedShare) * caseCost(p) + s.combinedShare * combinedCaseCost(p);
  return s.comprehensiveShare * arriving(COMPREHENSIVE_CASE) + (1 - s.comprehensiveShare) * arriving(STANDARD_CASE);
}

export const needsPaidEmail = (emailsPerMonth: number) => emailsPerMonth / WORKING_DAYS_PER_MONTH > EMAILS_A_DAY_ON_FREE_PLAN;

/** The monthly case count at which email moves to the paid plan. */
export const paidEmailFromCases = (emailsPerCase: number) => Math.ceil((EMAILS_A_DAY_ON_FREE_PLAN * WORKING_DAYS_PER_MONTH - BACKGROUND_EMAILS) / emailsPerCase);

export function monthly(s: Scenario): MonthlyBreakdown {
  const aiCases = s.casesPerMonth * averageCaseCost(s);
  const aiCommercial = s.newClientsPerMonth * sum(onboardingCostLines()) + s.casesPerMonth * invoiceCost();
  const speech = s.voiceMinutes * SPEECH_TO_TEXT_PER_MINUTE;
  const aiAssistants =
    s.staffAssistantQuestions * taskCost("staff_assistant_turn") +
    s.commandTurns * taskCost("command_turn") +
    30 * taskCost("daily_briefing") +
    s.nudges * taskCost("nudge");
  const aiTotal = aiCases + aiCommercial + aiAssistants;

  const emailsPerMonth = s.casesPerMonth * s.emailsPerCase + BACKGROUND_EMAILS;
  const email = needsPaidEmail(emailsPerMonth) ? SERVICES.resendPro.monthly : SERVICES.resendFree.monthly;
  const sms = s.casesPerMonth * s.smsPerCase * SERVICES.smsPerMessage.unitCost;
  const netlify = SERVICES.netlifyPro.monthly;
  const supabase = SERVICES.supabasePro.monthly; // recommended for production from day one
  const storageGbPerMonth = (s.casesPerMonth * STORAGE_PER_CASE_MB) / 1024;
  const servicesTotal = netlify + supabase + email + sms + speech;
  return { scenario: s, aiCases, aiCommercial, aiAssistants, aiTotal, netlify, supabase, email, sms, speech, servicesTotal, total: aiTotal + servicesTotal, storageGbPerMonth, emailsPerMonth };
}

/** Months until the free 1 GB of file storage is full. */
export const monthsOnFreeStorage = (casesPerMonth: number) => 1024 / (casesPerMonth * STORAGE_PER_CASE_MB);
/** Years until Supabase Pro's 100 GB of file storage is full. */
export const yearsOnProStorage = (casesPerMonth: number) => (100 * 1024) / (casesPerMonth * STORAGE_PER_CASE_MB) / 12;

// ---------------------------------------------------------------------------
// Feasibility: staff time the AI replaces on a comprehensive case (minutes)
// ---------------------------------------------------------------------------
export const TIME_SAVED = [
  { activity: "Data entry from documents", before: 15, after: 4 },
  { activity: "Pre-QC document review", before: 20, after: 8 },
  { activity: "Drafting verification outreach (7 checks)", before: 70, after: 14 },
  { activity: "Recording responses and results (7 checks)", before: 56, after: 21 },
  { activity: "Writing the report findings", before: 45, after: 10 },
  { activity: "Chasing candidates for documents", before: 20, after: 2 },
  { activity: "Status calls and emails from clients", before: 15, after: 3 },
];
export const minutesSaved = () => TIME_SAVED.reduce((a, r) => a + (r.before - r.after), 0);
export const STAFF_COST_PER_HOUR_LKR = 900; // loaded cost of a verification officer, planning assumption

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
/** Money in USD: sub-cent values keep enough digits to be meaningful. */
export function usd(value: number, opts: { precise?: boolean; whole?: boolean } = {}): string {
  if (value === 0) return "$0";
  if (opts.whole) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (opts.precise || value < 0.1) {
    if (value < 0.001) return `$${value.toFixed(4)}`;
    if (value < 0.1) return `$${value.toFixed(3)}`;
    return `$${value.toFixed(2)}`;
  }
  return value >= 100 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}
export const lkr = (usdValue: number) => `LKR ${Math.round(usdValue * USD_TO_LKR).toLocaleString("en-US")}`;
