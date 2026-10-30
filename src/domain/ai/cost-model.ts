/**
 * Ontriq cost model: the single source of truth for the Cost and Feasibility
 * document (scripts/build-cost-doc.tsx) and, later, the in-app usage
 * dashboard's "plan" column. Every figure is computed from the assumptions
 * below. Prices are list prices verified on 2026-10-29; re-verify before
 * publishing a new version.
 */

export const COST_MODEL_VERSION = "1.0";
export const PRICES_VERIFIED_ON = "29 October 2026";
export const USD_TO_LKR = 300; // planning rate; restate at the current rate when quoting in rupees

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
    role: "Light, high-volume work: classifying uploads, reading slips, short messages and explanations.",
  },
  sonnet: {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cacheRead: 0.2,
    role: "Everyday extraction and drafting: check fields, outreach, QC checklists, quotations, report narrative, the staff assistant.",
  },
  opus: {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    input: 4,
    output: 20,
    cacheRead: 0.2,
    role: "Only where judgement matters most: the Post-QC cross-check and the Super Admin command assistant.",
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
  | "consistency"
  | "preqc"
  | "outreach_check"
  | "response_check"
  | "postqc"
  | "narrative"
  | "tamper"
  | "candidate_guidance"
  | "status_explainer"
  | "consent_check"
  | "assignment_explanation"
  | "quotation_draft"
  | "cover_email"
  | "slip_read"
  | "nudge"
  | "staff_assistant_turn"
  | "command_turn"
  | "daily_briefing";

export type TaskDef = { key: TaskKey; label: string; unit: string; usage: Usage; note?: string };

/** Typical Sri Lankan documents are 1–2 pages; one page image ≈ 1,600 input tokens. */
export const TASKS: TaskDef[] = [
  { key: "classify_page", label: "Classify, quality-check and read one page", unit: "page", usage: { tier: "haiku", input: 2200, output: 950 } },
  { key: "extract_check", label: "Extract the fields for one check", unit: "check", usage: { tier: "sonnet", input: 5000, cachedInput: 2500, output: 700 }, note: "about 3 pages plus the check's cached field schema" },
  { key: "consistency", label: "Cross-document consistency check", unit: "case", usage: { tier: "sonnet", input: 12000, output: 1200 }, note: "scales with pages; 12-page case shown" },
  { key: "preqc", label: "Pre-QC checklist and drafted requests", unit: "case", usage: { tier: "sonnet", input: 8000, output: 1200 } },
  { key: "outreach_check", label: "Verification outreach draft", unit: "check", usage: { tier: "sonnet", input: 3000, output: 500 } },
  { key: "response_check", label: "Turn a reply into a proposed result", unit: "check", usage: { tier: "sonnet", input: 4000, output: 500 } },
  { key: "postqc", label: "Post-QC cross-check and proposed outcome", unit: "case", usage: { tier: "opus", input: 24900, output: 6200 }, note: "scales with checks; 7-check case shown" },
  { key: "narrative", label: "Report findings and summary", unit: "case", usage: { tier: "sonnet", input: 15500, output: 2900 }, note: "scales with checks; 7-check case shown" },
  { key: "tamper", label: "Tamper and duplicate signals", unit: "case", usage: { tier: "haiku", input: 6000, output: 300 } },
  { key: "candidate_guidance", label: "Instant feedback on a candidate upload", unit: "upload", usage: { tier: "haiku", input: 2000, output: 100 } },
  { key: "status_explainer", label: "Plain-language status for client or candidate", unit: "update", usage: { tier: "haiku", input: 1500, output: 200 } },
  { key: "consent_check", label: "Check a photographed consent form", unit: "form", usage: { tier: "haiku", input: 2000, output: 150 } },
  { key: "assignment_explanation", label: "Explain an auto-assignment", unit: "case", usage: { tier: "haiku", input: 1200, output: 150 } },
  { key: "quotation_draft", label: "Draft a quotation", unit: "draft", usage: { tier: "sonnet", input: 6000, output: 2500 } },
  { key: "cover_email", label: "Cover email for a quote or invoice", unit: "email", usage: { tier: "haiku", input: 1500, output: 300 } },
  { key: "slip_read", label: "Read a payment slip", unit: "slip", usage: { tier: "haiku", input: 2000, output: 150 } },
  { key: "nudge", label: "Draft a nudge to a staff member", unit: "nudge", usage: { tier: "haiku", input: 1500, output: 300 } },
  { key: "staff_assistant_turn", label: "Staff assistant question", unit: "question", usage: { tier: "sonnet", input: 4000, cachedInput: 4000, output: 800 } },
  { key: "command_turn", label: "Super Admin command (text or voice)", unit: "command", usage: { tier: "opus", input: 8000, cachedInput: 4000, output: 1500 } },
  { key: "daily_briefing", label: "Daily manager briefing", unit: "day", usage: { tier: "sonnet", input: 10000, output: 1000 } },
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
  candidateUploads: number;
  statusUpdates: number;
  postQcTier: "opus" | "sonnet";
};

export const COMPREHENSIVE_CASE: CaseProfile = { label: "Comprehensive (7 checks)", checks: 7, pages: 12, candidateUploads: 12, statusUpdates: 6, postQcTier: "opus" };
export const STANDARD_CASE: CaseProfile = { label: "Standard (NIC, education, employment)", checks: 3, pages: 6, candidateUploads: 6, statusUpdates: 5, postQcTier: "opus" };

export type CostLine = { label: string; quantity: number; unit: string; tier: ModelTier | "none"; cost: number };

export function caseCostLines(p: CaseProfile): CostLine[] {
  const postQc: Usage = { tier: p.postQcTier, input: 6000 + 2700 * p.checks, output: 2000 + 600 * p.checks };
  const narrative: Usage = { tier: "sonnet", input: 5000 + 1500 * p.checks, output: 800 + 300 * p.checks };
  const consistency: Usage = { tier: "sonnet", input: 1000 * p.pages, output: 600 + 50 * p.pages };
  const line = (key: TaskKey, quantity: number): CostLine => ({ label: task(key).label, quantity, unit: task(key).unit, tier: task(key).usage.tier, cost: quantity * taskCost(key) });
  return [
    line("classify_page", p.pages),
    line("extract_check", p.checks),
    { label: task("consistency").label, quantity: 1, unit: "case", tier: "sonnet", cost: usageCost(consistency) },
    line("preqc", 1),
    line("outreach_check", p.checks),
    line("response_check", p.checks),
    { label: task("postqc").label, quantity: 1, unit: "case", tier: p.postQcTier, cost: usageCost(postQc) },
    { label: task("narrative").label, quantity: 1, unit: "case", tier: "sonnet", cost: usageCost(narrative) },
    line("tamper", 1),
    line("candidate_guidance", p.candidateUploads),
    line("status_explainer", p.statusUpdates),
    line("consent_check", 1),
    line("assignment_explanation", 1),
  ];
}

export const sum = (lines: { cost: number }[]) => lines.reduce((a, l) => a + l.cost, 0);
export const caseCost = (p: CaseProfile) => sum(caseCostLines(p));

/** Onboarding a client: the AI quotation (first draft and two regenerations) and its cover email. */
export function onboardingCostLines(): CostLine[] {
  return [
    { label: "Draft the quotation (first draft and two regenerations)", quantity: 3, unit: "draft", tier: "sonnet", cost: 3 * taskCost("quotation_draft") },
    { label: task("cover_email").label, quantity: 1, unit: "email", tier: "haiku", cost: taskCost("cover_email") },
  ];
}

export const invoiceCost = () => taskCost("cover_email") + taskCost("slip_read");

// ---------------------------------------------------------------------------
// Hosting and services (USD per month)
// ---------------------------------------------------------------------------
export const SERVICES = {
  netlifyPro: { label: "Netlify Pro", monthly: 20, note: "3,000 credits a month; background jobs and scheduled tasks; automatic top-ups so the site is never paused" },
  netlifyPersonal: { label: "Netlify Personal", monthly: 9, note: "1,000 credits a month; the minimum paid plan" },
  supabaseFree: { label: "Supabase Free", monthly: 0, note: "500 MB database, 1 GB file storage, pauses after a week without activity, no backups" },
  supabasePro: { label: "Supabase Pro", monthly: 25, note: "8 GB database, 100 GB file storage, daily backups, never pauses; includes a $10 compute credit" },
  resendFree: { label: "Resend Free", monthly: 0, note: "3,000 emails a month, 100 a day" },
  resendPro: { label: "Resend Pro", monthly: 20, note: "50,000 emails a month" },
  smsPerMessage: { label: "SMS (Notify.lk or similar)", unitCost: 0.003, note: "about LKR 0.65–1.00 per message at local gateway rates" },
};

export const STORAGE_PER_CASE_MB = 8; // document images, PDFs and the final report

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
};

export const SCENARIOS: Scenario[] = [
  { key: "starter", label: "Starter", casesPerMonth: 50, comprehensiveShare: 0.4, newClientsPerMonth: 3, staffAssistantQuestions: 200, commandTurns: 100, voiceMinutes: 15, nudges: 10, smsPerCase: 3, emailsPerCase: 8 },
  { key: "growth", label: "Growth", casesPerMonth: 200, comprehensiveShare: 0.4, newClientsPerMonth: 8, staffAssistantQuestions: 500, commandTurns: 200, voiceMinutes: 30, nudges: 25, smsPerCase: 3, emailsPerCase: 8 },
  { key: "scale", label: "Scale", casesPerMonth: 600, comprehensiveShare: 0.4, newClientsPerMonth: 15, staffAssistantQuestions: 1200, commandTurns: 300, voiceMinutes: 50, nudges: 50, smsPerCase: 3, emailsPerCase: 8 },
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

export function monthly(s: Scenario): MonthlyBreakdown {
  const perCase = s.comprehensiveShare * caseCost(COMPREHENSIVE_CASE) + (1 - s.comprehensiveShare) * caseCost(STANDARD_CASE);
  const aiCases = s.casesPerMonth * perCase;
  const aiCommercial = s.newClientsPerMonth * sum(onboardingCostLines()) + s.casesPerMonth * invoiceCost();
  const speech = s.voiceMinutes * SPEECH_TO_TEXT_PER_MINUTE;
  const aiAssistants =
    s.staffAssistantQuestions * taskCost("staff_assistant_turn") +
    s.commandTurns * taskCost("command_turn") +
    30 * taskCost("daily_briefing") +
    s.nudges * taskCost("nudge");
  const aiTotal = aiCases + aiCommercial + aiAssistants;

  const emailsPerMonth = s.casesPerMonth * s.emailsPerCase + 200;
  const email = emailsPerMonth > 3000 ? SERVICES.resendPro.monthly : SERVICES.resendFree.monthly;
  const sms = s.casesPerMonth * s.smsPerCase * SERVICES.smsPerMessage.unitCost;
  const netlify = SERVICES.netlifyPro.monthly;
  const supabase = SERVICES.supabasePro.monthly; // recommended for production from day one
  const storageGbPerMonth = (s.casesPerMonth * STORAGE_PER_CASE_MB) / 1024;
  const servicesTotal = netlify + supabase + email + sms + speech;
  return { scenario: s, aiCases, aiCommercial, aiAssistants, aiTotal, netlify, supabase, email, sms, speech, servicesTotal, total: aiTotal + servicesTotal, storageGbPerMonth, emailsPerMonth };
}

/** Months until the free 1 GB of file storage is full. */
export const monthsOnFreeStorage = (casesPerMonth: number) => 1024 / (casesPerMonth * STORAGE_PER_CASE_MB);

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
