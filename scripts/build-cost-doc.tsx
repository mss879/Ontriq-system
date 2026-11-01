/**
 * Builds the client-facing Cost and Feasibility document from the cost model.
 *   npm run docs:cost
 * Writes docs/Ontriq-CRM-Cost-and-Feasibility.pdf and docs/cost-and-feasibility.md
 */
import { writeFileSync } from "node:fs";
import { Defs, Document, Page, RadialGradient, Rect, Stop, Svg, Text, View, renderToFile } from "@react-pdf/renderer";
import * as m from "../src/domain/ai/cost-model";
import { Bullets, C, Callout, ContentPage, H2, LogoLockup, P, SectionTitle, StatTiles, Table, registerFonts, s } from "../src/jobs/documents/pdf-kit";

const TITLE = "Ontriq CRM · Cost and Feasibility";
const comprehensive = m.caseCost(m.COMPREHENSIVE_CASE);
const comprehensiveCombined = m.combinedCaseCost(m.COMPREHENSIVE_CASE);
const standard = m.caseCost(m.STANDARD_CASE);
const standardCombined = m.combinedCaseCost(m.STANDARD_CASE);
const onboarding = m.sum(m.onboardingCostLines());
const months = m.SCENARIOS.map(m.monthly);
const [starter, growth, scale] = months;
const hoursSaved = m.minutesSaved() / 60;
const valueSavedLkr = hoursSaved * m.STAFF_COST_PER_HOUR_LKR;
const aiCaseLkr = comprehensive * m.USD_TO_LKR;
const fixedMonthly = m.SERVICES.netlifyPro.monthly + m.SERVICES.supabasePro.monthly;
const perCaseAll = m.averageCaseCost(growth.scenario) + m.invoiceCost() + growth.scenario.smsPerCase * m.SERVICES.smsPerMessage.unitCost;
const emailFrom = m.paidEmailFromCases(growth.scenario.emailsPerCase);
const MAINTENANCE_PLAN_USD: number | null = null; // set when the maintenance plan is priced
/** Version 1.0 of this document, 29 October 2026, before the AI was tested on the real models. */
const V1 = { comprehensive: 0.65, standard: 0.35, monthly: [80, 164, 395], rate: 300 };

const tierName = (t: m.ModelTier | "none") => (t === "none" ? "—" : m.MODELS[t].name.replace("Claude ", ""));
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const percent = (share: number) => `${Math.round(share * 100)}%`;

const SOURCES = [
  ["Claude pricing", "https://claude.com/pricing"],
  ["Netlify pricing", "https://www.netlify.com/pricing/"],
  ["Supabase pricing", "https://supabase.com/pricing"],
  ["Supabase compute sizes", "https://supabase.com/docs/guides/platform/compute-and-disk"],
  ["Resend pricing", "https://resend.com/pricing"],
  ["OpenAI transcription pricing", "https://openai.com/api/pricing/"],
  ["Sri Lanka SMS rates (local gateway benchmark)", "https://text.lk"],
  ["USD to LKR, Federal Reserve series", "https://alfred.stlouisfed.org/series?seid=DEXSLUS"],
];

function Cover() {
  return (
    <Page size="A4" style={{ fontFamily: "Inter", backgroundColor: C.white }}>
      <View style={{ backgroundColor: C.navyDeep, height: 560, paddingHorizontal: 56, paddingTop: 52, paddingBottom: 40, justifyContent: "space-between", position: "relative" }}>
        {/* The website's signature glow: orange bottom-left, blue bottom-right. */}
        <Svg width={595.28} height={560} viewBox="0 0 595 560" style={{ position: "absolute", top: 0, left: 0 }}>
          <Defs>
            <RadialGradient id="glowOrange" cx="0" cy="1" r="0.75">
              <Stop offset="0" stopColor="#F75834" stopOpacity={0.45} />
              <Stop offset="1" stopColor="#F75834" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="glowBlue" cx="1" cy="1" r="0.75">
              <Stop offset="0" stopColor="#0098F3" stopOpacity={0.4} />
              <Stop offset="1" stopColor="#0098F3" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="595" height="560" fill="url(#glowOrange)" />
          <Rect x="0" y="0" width="595" height="560" fill="url(#glowBlue)" />
        </Svg>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <LogoLockup height={44} ink={C.white} />
          <Text style={{ color: "#B9C6DA", fontSize: 8, letterSpacing: 1.2 }}>ESTABLISH · EMPOWER · EXCEL</Text>
        </View>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: C.orange }} />
            <Text style={{ color: "#FFB08F", fontSize: 9, fontWeight: 600, letterSpacing: 2 }}>BACKGROUND VERIFICATION CRM</Text>
          </View>
          <Text style={{ color: C.white, fontFamily: "StackSans", fontWeight: 700, fontSize: 40, lineHeight: 1.08, letterSpacing: -0.6, marginBottom: 14 }}>Cost and Feasibility</Text>
          <Text style={{ color: "#D3DCE8", fontSize: 12, lineHeight: 1.5, maxWidth: 400 }}>
            What Ontriq pays each month to run the system, line by line, and why it pays for itself.
          </Text>
        </View>
        <StatTiles
          dark
          items={[
            { label: `Monthly at ${growth.scenario.casesPerMonth} cases`, value: m.usd(growth.total, { whole: true }), sub: `${m.lkr(growth.total)} · everything but maintenance` },
            { label: "AI per comprehensive case", value: m.usd(comprehensive), sub: `${m.lkr(comprehensive)} · 7 checks` },
            { label: "Hosting and database", value: m.usd(fixedMonthly, { whole: true }), sub: "a month, at any volume" },
          ]}
        />
      </View>
      <View style={{ paddingHorizontal: 56, paddingTop: 34, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 40 }}>
          <View>
            <Text style={s.small}>Prepared for</Text>
            <Text style={[s.strong, { fontSize: 11 }]}>Ontriq (Pvt) Ltd</Text>
          </View>
          <View>
            <Text style={s.small}>Version</Text>
            <Text style={[s.strong, { fontSize: 11 }]}>
              {m.COST_MODEL_VERSION} · {m.PRICES_VERIFIED_ON}
            </Text>
          </View>
          <View>
            <Text style={s.small}>Currency</Text>
            <Text style={[s.strong, { fontSize: 11 }]}>USD (LKR at {m.USD_TO_LKR})</Text>
          </View>
        </View>
        <Text style={[s.small, { lineHeight: 1.5 }]}>
          Every figure is calculated from the stated assumptions and public list prices checked on {m.PRICES_VERIFIED_ON}. AI usage comes from test runs on the real models. The system records actual spend from the first case, so these estimates can be checked at any time.
        </Text>
      </View>
    </Page>
  );
}

function Summary() {
  return (
    <ContentPage title={TITLE} section="Summary">
      <SectionTitle
        eyebrow="1 · Summary"
        title="The short answer"
        intro={`Running the system costs about ${m.usd(starter.total, { whole: true })} a month at ${starter.scenario.casesPerMonth} cases and ${m.usd(scale.total, { whole: true })} at ${scale.scenario.casesPerMonth}. That covers AI, hosting, database, email and SMS. The maintenance plan is quoted separately.`}
      />
      <StatTiles items={months.map((b) => ({ label: `${b.scenario.casesPerMonth} cases a month`, value: m.usd(b.total, { whole: true }), sub: m.lkr(b.total) }))} />
      <H2>Key findings</H2>
      <Bullets
        items={[
          `AI costs about ${m.usd(comprehensive)} (${m.lkr(comprehensive)}) for a seven-check case and ${m.usd(standard)} for a standard one when files arrive separately. A case sent as one combined PDF costs about ${m.usd(comprehensiveCombined)}, because each check reads the whole file.`,
          `Real test cases came in below these plans. Six separate files cost $0.10 from upload to report, with one check taken through outreach. One four-page PDF cost $0.15 to read into all seven checks. Five files from a candidate cost $0.08 to read and write up.`,
          `Hosting and the database are a fixed ${m.usd(fixedMonthly, { whole: true })} a month. There are no per-user fees, so staff and client logins can grow freely.`,
          `Each comprehensive case saves roughly ${hoursSaved.toFixed(1)} hours of staff work, worth about LKR ${Math.round(valueSavedLkr).toLocaleString("en-US")}, against ${m.lkr(comprehensive)} of AI: about ${Math.round(valueSavedLkr / aiCaseLkr)} times the cost.`,
        ]}
      />
      <H2>What changed since version 1.0</H2>
      <Table
        columns={[
          { label: "", width: 46 },
          { label: "Version 1.0", width: 27, align: "right" },
          { label: `Version ${m.COST_MODEL_VERSION}`, width: 27, align: "right" },
        ]}
        rows={[
          ["AI per comprehensive case", m.usd(V1.comprehensive), m.usd(comprehensive)],
          ["AI per standard case", m.usd(V1.standard), m.usd(standard)],
          ...months.map((b, i) => [`Monthly at ${b.scenario.casesPerMonth} cases`, m.usd(V1.monthly[i], { whole: true }), m.usd(b.total, { whole: true })]),
          ["Exchange rate, LKR to the dollar", String(V1.rate), String(m.USD_TO_LKR)],
        ]}
      />
      <P>Version 1.0 was an estimate made before the AI was built. Every feature has since been run on the real models, and routine work moved to a cheaper model wherever its results held up.</P>
      <Callout title="Verdict: feasible" tone="green">
        The running cost is a small fraction of the value of each verification. Every AI step is recorded and capped by budget, and a person confirms every result.
      </Callout>
    </ContentPage>
  );
}

function Models() {
  return (
    <ContentPage title={TITLE} section="How the AI is used">
      <SectionTitle
        eyebrow="3 · How the AI is used"
        title="The cheapest model that does each job well"
        intro="AI usage is billed by the amount of text and images it reads (input) and writes (output), measured in tokens. A photographed page is up to about 4,800 tokens. Each task runs on the most economical model that does it reliably."
      />
      <Table
        columns={[
          { label: "Model", width: 18 },
          { label: "Price per million tokens (in / out)", width: 24 },
          { label: "Used for", width: 58 },
        ]}
        rows={(Object.keys(m.MODELS) as m.ModelTier[]).map((t) => [m.MODELS[t].name, `$${m.MODELS[t].input.toFixed(2)} / $${m.MODELS[t].output.toFixed(2)}`, m.MODELS[t].role])}
      />
      <H2>How the models were chosen</H2>
      <Bullets
        items={[
          "The case features were scored on the real models against known right answers, and each moved to the cheapest model that held its score.",
          "Haiku, the lowest-cost model, reads every upload and handles the consistency check, Pre-QC, outreach drafts and briefings.",
          "Sonnet stays where a wrong word could reach a client or a result: check fields, the candidate report, the Post-QC cross-check, verifiers' replies, report remarks and quotations.",
          "Opus runs only the Super Admin's command assistant, which is low in volume and has the widest reach.",
          "Fixed instructions are cached, so repeat reads cost a tenth of the normal price or less.",
          `Voice notes for the command assistant are transcribed at about ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} a minute before the assistant reads them.`,
        ]}
      />
      <Callout title="People stay in control">
        The AI proposes and staff confirm. It never sets a price, a verification result or an assignee on its own, and it never marks a document as received.
      </Callout>
    </ContentPage>
  );
}

function Tasks() {
  return (
    <ContentPage title={TITLE} section="Cost per task">
      <SectionTitle
        eyebrow="4 · Cost per task"
        title="What each AI step costs"
        intro="Token counts come from the test runs of 31 October 2026, rounded up where real cases ran higher. Quality feedback to candidates and signs of editing come from the first read, so they have no cost of their own."
      />
      <Table
        columns={[
          { label: "Task", width: 52 },
          { label: "Model", width: 16 },
          { label: "Unit", width: 14 },
          { label: "Cost", width: 18, align: "right" },
        ]}
        rows={m.TASKS.map((t) => [t.label, tierName(t.usage.tier), t.unit, m.usd(m.taskCost(t.key), { precise: true })]).concat([
          ["Transcribe a voice note", "Speech-to-text", "minute", m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })],
          ["SLA monitoring, auto-assignment rules, performance tracking", "No AI", "—", "$0"],
        ])}
      />
      <P style={s.small}>The two assistants are planned at about twice their test cost, because real conversations run longer than single questions.</P>
    </ContentPage>
  );
}

function CaseTable({ profile }: { profile: m.CaseProfile }) {
  const lines = m.caseCostLines(profile);
  const total = m.sum(lines);
  return (
    <Table
      columns={[
        { label: "Step", width: 50 },
        { label: "Qty", width: 8, align: "right" },
        { label: "Model", width: 14 },
        { label: "Cost", width: 28, align: "right" },
      ]}
      rows={lines.map((l) => [l.label, `${qty(l.quantity)}`, tierName(l.tier), m.usd(l.cost, { precise: true })])}
      total={["Total per case", "", "", `${m.usd(total, { precise: true })} · ${m.lkr(total)}`]}
      keepTogether
    />
  );
}

function Cases() {
  return (
    <ContentPage title={TITLE} section="Cost per case">
      <SectionTitle eyebrow="5 · Cost per case" title="One case, start to finish" intro="From the first upload to the drafted report, with every check taken through outreach and a reply." />
      <H2>{m.COMPREHENSIVE_CASE.label}</H2>
      <P style={s.small}>Education, employment, address, police clearance, NIC, references and global sanctions; about 12 pages of documents, sent as separate files.</P>
      <CaseTable profile={m.COMPREHENSIVE_CASE} />
      <View wrap={false}>
        <H2>What real test cases cost</H2>
        <P>Test cases ran through real uploads, the job worker and the cost ledger, using invented documents. They came in below the plan above.</P>
        <Table
          columns={[
            { label: "Test case", width: 66 },
            { label: "AI calls", width: 14, align: "right" },
            { label: "Cost", width: 20, align: "right" },
          ]}
          rows={[
            ["Six separate files, to the report stage, one check through outreach", "17", "$0.10 to $0.11"],
            ["One four-page PDF, read into all seven checks", "8", "$0.15 to $0.16"],
            ["Five files from a candidate, read in and written up as a candidate report", "11", "$0.08"],
          ]}
        />
      </View>
      <View wrap={false}>
        <H2>{m.STANDARD_CASE.label}</H2>
        <P style={s.small}>About 6 pages of documents, sent as separate files.</P>
        <CaseTable profile={m.STANDARD_CASE} />
      </View>
      <View wrap={false}>
        <H2>When a case arrives as one combined PDF</H2>
        <P>Separate files are read once and reused as text. A combined PDF is read in full by every check, so it costs more. The monthly totals allow for this.</P>
        <Table
          columns={[
            { label: "How the case arrives", width: 46 },
            { label: m.COMPREHENSIVE_CASE.label, width: 27, align: "right" },
            { label: "Standard", width: 27, align: "right" },
          ]}
          rows={[
            ["Separate files", m.usd(comprehensive), m.usd(standard)],
            ["One combined PDF", m.usd(comprehensiveCombined), m.usd(standardCombined)],
          ]}
        />
      </View>
    </ContentPage>
  );
}

function Commercial() {
  const lines = m.onboardingCostLines();
  return (
    <ContentPage title={TITLE} section="Clients, quotations and invoices">
      <SectionTitle eyebrow="6 · Clients, quotations and invoices" title="Onboarding a client and billing" intro="Creating the client, its portal login and its packages uses no AI. The AI drafts the quotation's wording; prices always come from the price list." />
      <Table
        columns={[
          { label: "Step", width: 60 },
          { label: "Qty", width: 10, align: "right" },
          { label: "Model", width: 14 },
          { label: "Cost", width: 16, align: "right" },
        ]}
        rows={lines.map((l) => [l.label, qty(l.quantity), tierName(l.tier), m.usd(l.cost, { precise: true })])}
        total={["Onboarding a client", "", "", m.usd(onboarding, { precise: true })]}
      />
      <Table
        columns={[
          { label: "Per invoice", width: 60 },
          { label: "", width: 10 },
          { label: "Model", width: 14 },
          { label: "Cost", width: 16, align: "right" },
        ]}
        rows={[["Read the payment slip", "", "Haiku", m.usd(m.taskCost("slip_read"), { precise: true })]]}
        total={["Per invoice", "", "", m.usd(m.invoiceCost(), { precise: true })]}
      />
      <H2>Assistants</H2>
      <Bullets
        items={[
          `Staff assistant, which answers questions about the work each person can see: about ${m.usd(m.taskCost("staff_assistant_turn"))} per question.`,
          `Super Admin command assistant, with reach across the whole system by voice or text: about ${m.usd(m.taskCost("command_turn"))} per command, plus ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} per minute of voice.`,
          `Daily manager briefing: about ${m.usd(m.taskCost("daily_briefing"), { precise: true })} a day.`,
        ]}
      />
    </ContentPage>
  );
}

function Monthly() {
  const col = (label: string) => ({ label, width: 15, align: "right" as const });
  const money = (v: number) => m.usd(v, { precise: v < 10 });
  const row = (label: string, paidTo: string, pick: (b: m.MonthlyBreakdown) => number) => [label, paidTo, ...months.map((b) => money(pick(b)))];
  return (
    <ContentPage title={TITLE} section="Monthly cost">
      <SectionTitle
        eyebrow="2 · Monthly cost"
        title="What Ontriq pays each month"
        intro={`Ontriq's monthly volume isn't confirmed yet, so three volumes are shown. Each assumes ${percent(growth.scenario.comprehensiveShare)} comprehensive cases, the rest standard, and ${percent(growth.scenario.combinedShare)} of cases arriving as one combined PDF.`}
      />
      <Table
        columns={[{ label: "Per month", width: 37 }, { label: "Paid to", width: 18 }, col(starter.scenario.label), col(growth.scenario.label), col(scale.scenario.label)]}
        rows={[
          ["Cases a month", "", ...months.map((b) => String(b.scenario.casesPerMonth))],
          row("AI: reading and reviewing cases", "Anthropic", (b) => b.aiCases),
          row("AI: quotations and payment slips", "Anthropic", (b) => b.aiCommercial),
          row("AI: assistants and briefings", "Anthropic", (b) => b.aiAssistants),
          row("Hosting (Netlify Pro)", "Netlify", (b) => b.netlify),
          row("Database, files, backups (Supabase Pro)", "Supabase", (b) => b.supabase),
          ["Email (Resend)", "Resend", ...months.map((b) => (b.email ? m.usd(b.email) : "Free plan"))],
          row("SMS to candidates", "SMS gateway", (b) => b.sms),
          row("Voice transcription", "OpenAI", (b) => b.speech),
        ]}
        total={["Total (USD)", "", ...months.map((b) => m.usd(b.total, { whole: true }))]}
      />
      <Table
        columns={[{ label: "In rupees", width: 55 }, col(""), col(""), col("")]}
        rows={[
          ["Total per month", ...months.map((b) => m.lkr(b.total))],
          ["AI per case on average", ...months.map((b) => m.lkr(b.aiCases / b.scenario.casesPerMonth))],
        ]}
      />
      <Callout title="Work out any month">
        {`${m.usd(fixedMonthly, { whole: true })} for hosting and the database, plus about ${m.usd(perCaseAll)} a case for AI and SMS, plus a few dollars for the assistants. Add ${m.usd(m.SERVICES.resendPro.monthly, { whole: true })} for email above about ${emailFrom} cases a month.`}
      </Callout>
      <H2>Not in these totals</H2>
      <Bullets
        items={[
          `The maintenance plan, quoted separately. If it includes the Netlify hosting, take ${m.usd(m.SERVICES.netlifyPro.monthly, { whole: true })} off each total.`,
          "Tax and bank charges on foreign-currency payments.",
          `Extra Netlify credits, if a busy month uses up the 3,000 included: ${m.usd(m.SERVICES.netlifyPro.topUpUsd, { whole: true })} for ${m.SERVICES.netlifyPro.topUpCredits.toLocaleString("en-US")} more. We expect the allowance to cover these volumes, but it can only be measured once the site is live.`,
          `A larger database server, if ${scale.scenario.casesPerMonth} cases a month slows the included one. The next size up adds about $5 a month.`,
        ]}
      />
    </ContentPage>
  );
}

function Hosting() {
  const pro = m.SERVICES.supabasePro;
  return (
    <ContentPage title={TITLE} section="Hosting and services">
      <SectionTitle eyebrow="7 · Hosting and services" title="Where the system runs" intro="Managed services run the system, so Ontriq needs no servers of its own." />
      <H2>Netlify: the application, on a maintenance plan</H2>
      <P>
        The application and its background workers run on Netlify. Netlify’s free plan is too small for a business system, so the system runs on {m.SERVICES.netlifyPro.label} at ${m.SERVICES.netlifyPro.monthly} a month: {m.SERVICES.netlifyPro.note}.
      </P>
      <Callout title="Maintenance plan">
        {MAINTENANCE_PLAN_USD
          ? `Hosting is provided under a monthly maintenance plan of ${m.usd(MAINTENANCE_PLAN_USD)}, which also covers monitoring, security updates, backup checks and support.`
          : "Hosting is provided under a monthly maintenance plan, quoted separately. The plan covers the Netlify hosting, monitoring, security and dependency updates, backup checks and support."}
      </Callout>
      <H2>Supabase: database, sign-in and document storage</H2>
      <Table
        columns={[
          { label: "Plan", width: 22 },
          { label: "Monthly", width: 14, align: "right" },
          { label: "What you get", width: 64 },
        ]}
        rows={[
          [m.SERVICES.supabaseFree.label, "$0", m.SERVICES.supabaseFree.note],
          [pro.label, `$${pro.monthly}`, pro.note],
        ]}
      />
      <P>
        Every total in this document uses Pro from go-live, because the system holds candidates’ personal documents and needs daily backups. Each case stores about {m.STORAGE_PER_CASE_MB} MB of documents and reports. At {growth.scenario.casesPerMonth} cases a month, Pro’s 100 GB lasts about {Math.floor(m.yearsOnProStorage(growth.scenario.casesPerMonth))} years, and more costs ${pro.extraStoragePerGb} a GB. Records past their retention period are erased, which frees space.
      </P>
      <H2>Email, SMS and transcription</H2>
      <Bullets
        items={[
          `Email through Resend: free for up to 3,000 emails a month, but limited to 100 a day. Busy days would pass that from about ${emailFrom} cases a month, so the totals move to the $20 plan there.`,
          `SMS reminders through Notify.lk or a similar gateway, paid per message: ${m.SERVICES.smsPerMessage.note}.`,
          `Voice transcription for the command assistant: about ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} a minute, on an OpenAI account.`,
          "Domain: the system runs on a sub-domain of Ontriq's existing domain (for example crm.ontriq.lk) at no extra cost.",
        ]}
      />
    </ContentPage>
  );
}

function Feasibility() {
  return (
    <ContentPage title={TITLE} section="Feasibility">
      <SectionTitle eyebrow="8 · Feasibility" title="What the AI saves on every case" intro="Minutes of staff time on a comprehensive case, before and after the AI takes on the reading, drafting and chasing. Staff still review and confirm every step." />
      <Table
        columns={[
          { label: "Activity", width: 52 },
          { label: "Before (min)", width: 16, align: "right" },
          { label: "With AI (min)", width: 16, align: "right" },
          { label: "Saved", width: 16, align: "right" },
        ]}
        rows={m.TIME_SAVED.map((r) => [r.activity, String(r.before), String(r.after), String(r.before - r.after)])}
        total={["Per comprehensive case", String(m.TIME_SAVED.reduce((a, r) => a + r.before, 0)), String(m.TIME_SAVED.reduce((a, r) => a + r.after, 0)), `${m.minutesSaved()} min`]}
      />
      <StatTiles
        items={[
          { label: "Staff time saved", value: `${hoursSaved.toFixed(1)} h`, sub: "per comprehensive case" },
          { label: "Value of that time", value: `LKR ${Math.round(valueSavedLkr).toLocaleString("en-US")}`, sub: `at LKR ${m.STAFF_COST_PER_HOUR_LKR} an hour` },
          { label: "AI cost", value: m.lkr(comprehensive), sub: `${Math.round(valueSavedLkr / aiCaseLkr)}× return` },
        ]}
      />
      <H2>Beyond the hours</H2>
      <Bullets
        items={[
          "Faster turnaround: candidates upload through a guided link with instant feedback, and outreach is drafted in seconds for a person to send.",
          "Fewer QC returns: documents are checked for readability on upload, and for consistency before Pre-QC.",
          "Fewer missed discrepancies: the Post-QC cross-check reads every check against its evidence.",
          "A head start on every case: when a candidate confirms, staff get a report of what was provided, with each fact tied to its file.",
          "Fewer status calls: clients see each check's progress in their portal.",
        ]}
      />
      <P style={s.small}>The staff cost per hour and the minutes saved are planning assumptions; replace them with Ontriq’s own figures to restate the return.</P>
    </ContentPage>
  );
}

function Controls() {
  const assumptions = growth.scenario;
  return (
    <ContentPage title={TITLE} section="Cost controls and assumptions">
      <SectionTitle eyebrow="9 · Cost controls" title="Spend that can't run away" />
      <Bullets
        items={[
          "Every AI call is recorded with its model, tokens and cost, and tied to the case and feature that caused it.",
          "Settings and Analytics show spend by day, feature and model, and the cost per released case.",
          "Budgets alert or pause when reached. The starting limits are an alert at $25 a day or $400 a month in total, with lower caps that pause document reading, field filling and the command assistant.",
          "Each AI feature can be switched off, or moved to a cheaper model, without a code change.",
          "If the AI is off or unavailable, the system keeps working and staff enter details by hand.",
          "A background job that fails repeatedly is stopped rather than retried forever, so a fault can never loop on paid calls.",
        ]}
      />
      <SectionTitle eyebrow="10 · Assumptions and sources" title="How these numbers were made" />
      <Bullets
        items={[
          `List prices checked on ${m.PRICES_VERIFIED_ON}. OpenAI's page could not be opened that day, so its transcription price is from 29 October and independent listings.`,
          `USD 1 = LKR ${m.USD_TO_LKR}: the market rate was about 331 in mid-October 2026, plus a small cushion. Tax and bank charges are not included.`,
          "AI figures come from test runs on invented documents and cases in English, Sinhala and Tamil. Real documents may use more tokens, and the system records the real cost from the first case.",
          `A comprehensive case has about 12 pages and a standard case about 6. ${percent(assumptions.comprehensiveShare)} of cases are comprehensive and ${percent(assumptions.combinedShare)} arrive as one combined PDF. ${m.STORAGE_PER_CASE_MB} MB of files per case.`,
          `Per month: ${months.map((b) => `${b.scenario.casesPerMonth} cases with ${b.scenario.newClientsPerMonth} new clients, ${b.scenario.staffAssistantQuestions.toLocaleString("en-US")} assistant questions, ${b.scenario.commandTurns} commands and ${b.scenario.voiceMinutes} voice minutes`).join("; ")}. ${assumptions.emailsPerCase} emails and ${assumptions.smsPerCase} SMS per case.`,
          "Usage figures for assistants and briefings are estimates. They are the easiest line to control with budgets.",
          "Prices change. This document is regenerated from the same model when they do.",
        ]}
      />
      <H2>Sources</H2>
      {SOURCES.map(([label, url]) => (
        <Text key={url} style={{ fontSize: 8.5, marginBottom: 2 }}>
          {label}: <Text style={{ color: C.navy }}>{url}</Text>
        </Text>
      ))}
    </ContentPage>
  );
}

function CostDocument() {
  return (
    <Document title="Ontriq CRM — Cost and Feasibility" author="Ontriq CRM" subject="AI, hosting and running costs" creator="Ontriq CRM cost model">
      <Cover />
      <Summary />
      <Monthly />
      <Models />
      <Tasks />
      <Cases />
      <Commercial />
      <Hosting />
      <Feasibility />
      <Controls />
    </Document>
  );
}

function markdown(): string {
  const md: string[] = [];
  md.push(`# Ontriq CRM — Cost and Feasibility`, "", `Version ${m.COST_MODEL_VERSION} · prices checked ${m.PRICES_VERIFIED_ON} · USD (LKR at ${m.USD_TO_LKR})`, "");
  md.push("Generated from `src/domain/ai/cost-model.ts` by `npm run docs:cost`. The PDF is the client-facing version.", "");
  md.push("## Summary", "", "| | |", "|---|---|");
  md.push(`| AI per comprehensive case (7 checks) | ${m.usd(comprehensive)} (${m.lkr(comprehensive)}) |`);
  md.push(`| AI per comprehensive case as one combined PDF | ${m.usd(comprehensiveCombined)} |`);
  md.push(`| AI per standard case (3 checks) | ${m.usd(standard)} |`);
  md.push(`| AI per standard case as one combined PDF | ${m.usd(standardCombined)} |`);
  md.push(`| AI per client onboarding with quotation | ${m.usd(onboarding)} |`);
  md.push(`| AI per invoice | ${m.usd(m.invoiceCost(), { precise: true })} |`);
  md.push(`| Staff time saved per comprehensive case | ${hoursSaved.toFixed(1)} hours |`, "");
  md.push("## Cost per task", "", "| Task | Model | Unit | Cost |", "|---|---|---|---|");
  for (const t of m.TASKS) md.push(`| ${t.label} | ${tierName(t.usage.tier)} | ${t.unit} | ${m.usd(m.taskCost(t.key), { precise: true })} |`);
  md.push("", "## Monthly running cost", "", `| Per month | ${months.map((b) => b.scenario.label).join(" | ")} |`, `|---|${months.map(() => "---:").join("|")}|`);
  const r = (label: string, f: (b: m.MonthlyBreakdown) => string) => md.push(`| ${label} | ${months.map(f).join(" | ")} |`);
  r("Cases", (b) => String(b.scenario.casesPerMonth));
  r("AI", (b) => m.usd(b.aiTotal));
  r("Netlify Pro", (b) => m.usd(b.netlify));
  r("Supabase Pro", (b) => m.usd(b.supabase));
  r("Email", (b) => (b.email ? m.usd(b.email) : "free plan"));
  r("SMS", (b) => m.usd(b.sms));
  r("Voice transcription", (b) => m.usd(b.speech));
  r("**Total (USD)**", (b) => `**${m.usd(b.total, { whole: true })}**`);
  r("Total (LKR)", (b) => m.lkr(b.total));
  md.push("", `Any month: ${m.usd(fixedMonthly, { whole: true })} for hosting and the database, plus about ${m.usd(perCaseAll)} a case, plus a few dollars for the assistants. Add ${m.usd(m.SERVICES.resendPro.monthly, { whole: true })} for email above about ${emailFrom} cases a month.`, "", "Hosting is provided under a monthly maintenance plan, quoted separately.", "");
  md.push("## Sources", "", ...SOURCES.map(([l, u]) => `- ${l}: ${u}`), "");
  return md.join("\n");
}

async function main() {
  registerFonts();
  await renderToFile(<CostDocument />, "docs/Ontriq-CRM-Cost-and-Feasibility.pdf");
  writeFileSync("docs/cost-and-feasibility.md", markdown());
  console.info("Wrote docs/Ontriq-CRM-Cost-and-Feasibility.pdf and docs/cost-and-feasibility.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
