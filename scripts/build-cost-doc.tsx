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
const comprehensiveSonnet = m.caseCost({ ...m.COMPREHENSIVE_CASE, postQcTier: "sonnet" });
const standard = m.caseCost(m.STANDARD_CASE);
const onboarding = m.sum(m.onboardingCostLines());
const months = m.SCENARIOS.map(m.monthly);
const growth = months[1];
const hoursSaved = m.minutesSaved() / 60;
const valueSavedLkr = hoursSaved * m.STAFF_COST_PER_HOUR_LKR;
const aiCaseLkr = comprehensive * m.USD_TO_LKR;
const MAINTENANCE_PLAN_USD: number | null = null; // set when the maintenance plan is priced

const tierName = (t: m.ModelTier | "none") => (t === "none" ? "—" : m.MODELS[t].name.replace("Claude ", ""));
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const SOURCES = [
  ["Anthropic Claude pricing", "https://www.anthropic.com/pricing"],
  ["Netlify pricing", "https://www.netlify.com/pricing/"],
  ["Supabase pricing", "https://supabase.com/pricing"],
  ["Resend pricing", "https://resend.com/pricing"],
  ["OpenAI transcription pricing", "https://openai.com/api/pricing/"],
  ["Sri Lanka SMS rates (local gateway benchmark)", "https://text.lk"],
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
            What the AI costs per task and per case, what hosting and services cost each month, and why the system pays for itself.
          </Text>
        </View>
        <StatTiles
          dark
          items={[
            { label: "AI per comprehensive case", value: m.usd(comprehensive), sub: `${m.lkr(comprehensive)} · 7 checks` },
            { label: "AI per client onboarding", value: m.usd(onboarding), sub: "AI-drafted quotation" },
            { label: `Monthly at ${growth.scenario.casesPerMonth} cases`, value: m.usd(growth.total, { whole: true }), sub: "AI plus hosting and services" },
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
          Every figure in this document is calculated from the stated assumptions and public list prices checked on {m.PRICES_VERIFIED_ON}. Real usage is measured inside the system from day one, so these estimates can be compared with actual spend at any time.
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
        intro="The AI that reads documents, drafts outreach and reports, and runs the assistants costs cents per case. Hosting and services are a small, predictable monthly amount. Both are far below the staff time the system saves."
      />
      <StatTiles
        items={[
          { label: "Comprehensive case", value: m.usd(comprehensive), sub: "7 checks, AI end to end" },
          { label: "Standard case", value: m.usd(standard), sub: "NIC, education, employment" },
          { label: "New client + quotation", value: m.usd(onboarding), sub: "first draft and two revisions" },
          { label: "Staff time saved", value: `${hoursSaved.toFixed(1)} h`, sub: "per comprehensive case" },
        ]}
      />
      <H2>Key findings</H2>
      <Bullets
        items={[
          `AI costs about ${m.usd(comprehensive)} (${m.lkr(comprehensive)}) for a comprehensive seven-check case and ${m.usd(standard)} for a standard one, using the most economical model for each step.`,
          `Onboarding a client with an AI-drafted quotation costs about ${m.usd(onboarding)}. Drafting an invoice email and reading a payment slip costs under a tenth of a cent.`,
          `At ${growth.scenario.casesPerMonth} cases a month, the whole system (AI, hosting, database, email, SMS) runs at about ${m.usd(growth.total, { whole: true })} (${m.lkr(growth.total)}) a month. At ${months[0].scenario.casesPerMonth} cases it is about ${m.usd(months[0].total, { whole: true })}; at ${months[2].scenario.casesPerMonth} cases about ${m.usd(months[2].total, { whole: true })}.`,
          `Hosting runs on Netlify's paid plan, provided under a monthly maintenance plan, because the free plan stops the site when its monthly allowance runs out and cannot run background jobs reliably.`,
          `The database starts on Supabase's free tier (500 MB). Moving to Supabase Pro at $25 a month adds 8 GB, 100 GB of file storage and daily backups; we recommend Pro from go-live because the system stores candidates' documents.`,
          `Each comprehensive case saves roughly ${hoursSaved.toFixed(1)} hours of staff work, worth about ${`LKR ${Math.round(valueSavedLkr).toLocaleString("en-US")}`}, against ${m.lkr(comprehensive)} of AI: about ${Math.round(valueSavedLkr / aiCaseLkr)} times the cost.`,
        ]}
      />
      <Callout title="Verdict: feasible" tone="green">
        The running cost is a small fraction of the value of each verification, every AI step is measured and capped by budget, and the most expensive model is used only where a missed discrepancy would cost the most.
      </Callout>
    </ContentPage>
  );
}

function Models() {
  return (
    <ContentPage title={TITLE} section="How the AI is used">
      <SectionTitle
        eyebrow="2 · How the AI is used"
        title="The cheapest model that does each job well"
        intro="AI usage is billed by the amount of text and images it reads (input) and writes (output), measured in tokens; a page of a scanned certificate is roughly 1,600 tokens. The system routes every task to the most economical model that does it reliably."
      />
      <Table
        columns={[
          { label: "Model", width: 18 },
          { label: "Price per million tokens (in / out)", width: 24 },
          { label: "Used for", width: 58 },
        ]}
        rows={(Object.keys(m.MODELS) as m.ModelTier[]).map((t) => [m.MODELS[t].name, `$${m.MODELS[t].input.toFixed(2)} / $${m.MODELS[t].output.toFixed(2)}`, m.MODELS[t].role])}
      />
      <H2>Budget-first routing</H2>
      <Bullets
        items={[
          "Light, high-volume work (classifying every upload, reading payment slips, short messages) runs on Haiku, the lowest-cost model.",
          "Extraction and drafting run on Sonnet, which balances quality and price.",
          "Opus is reserved for the final Post-QC cross-check, where a missed discrepancy is costly, and for the Super Admin's command assistant. Either can be switched to Sonnet in Settings to save about 15% per case.",
          "Fixed instructions are cached, so repeat reads cost about a tenth of the normal price. Non-urgent backlogs can run through Anthropic's batch service at half price.",
          `Voice notes for the command assistant are transcribed at about ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} a minute before the assistant reads them.`,
        ]}
      />
      <Callout title="People stay in control">
        The AI proposes; staff confirm. It never sets a price, a verification result or an assignee on its own, and every suggestion is shown with an accept, edit or reject choice.
      </Callout>
    </ContentPage>
  );
}

function Tasks() {
  return (
    <ContentPage title={TITLE} section="Cost per task">
      <SectionTitle eyebrow="3 · Cost per task" title="What each AI step costs" intro="Typical document sizes for Sri Lankan certificates, letters and forms. Prices are per unit." />
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
      <SectionTitle
        eyebrow="4 · Cost per case"
        title="One case, start to finish"
        intro="From the first upload to the drafted report, including the candidate's upload page and status updates to the client."
      />
      <H2>{m.COMPREHENSIVE_CASE.label}</H2>
      <P style={s.small}>Education, employment, address, police clearance, NIC, two references and global sanctions; about 12 pages of documents.</P>
      <CaseTable profile={m.COMPREHENSIVE_CASE} />
      <P>
        With Sonnet for the Post-QC cross-check instead of Opus, this case costs {m.usd(comprehensiveSonnet)} ({m.lkr(comprehensiveSonnet)}).
      </P>
      <View wrap={false}>
        <H2>{m.STANDARD_CASE.label}</H2>
        <CaseTable profile={m.STANDARD_CASE} />
      </View>
    </ContentPage>
  );
}

function Commercial() {
  const lines = m.onboardingCostLines();
  return (
    <ContentPage title={TITLE} section="Clients, quotations and invoices">
      <SectionTitle eyebrow="5 · Clients, quotations and invoices" title="Onboarding a client and billing" intro="Creating the client, its portal login and its packages uses no AI. The AI drafts the quotation and its cover email; prices always come from the price list." />
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
        rows={[
          ["Cover email", "", "Haiku", m.usd(m.taskCost("cover_email"), { precise: true })],
          ["Read the payment slip and match it to the invoice", "", "Haiku", m.usd(m.taskCost("slip_read"), { precise: true })],
        ]}
        total={["Per invoice", "", "", m.usd(m.invoiceCost(), { precise: true })]}
      />
      <H2>Assistants</H2>
      <Bullets
        items={[
          `Staff assistant (answers questions about the work each person can see): about ${m.usd(m.taskCost("staff_assistant_turn"))} per question.`,
          `Super Admin command assistant (reach across the whole system, voice or text): about ${m.usd(m.taskCost("command_turn"))} per command, plus ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} per minute of voice.`,
          `Daily manager briefing: about ${m.usd(m.taskCost("daily_briefing"))} a day.`,
        ]}
      />
    </ContentPage>
  );
}

function Monthly() {
  const col = (label: string) => ({ label, width: 18, align: "right" as const });
  const row = (label: string, pick: (b: m.MonthlyBreakdown) => number) => [label, ...months.map((b) => m.usd(pick(b), { precise: pick(b) < 10 }))];
  return (
    <ContentPage title={TITLE} section="Monthly running cost">
      <SectionTitle
        eyebrow="6 · Monthly running cost"
        title="Three volumes, all costs included"
        intro="Forty percent comprehensive cases, the rest standard. Includes AI, hosting, database, email, SMS reminders to candidates and voice transcription."
      />
      <Table
        columns={[{ label: "Per month", width: 46 }, col(months[0].scenario.label), col(months[1].scenario.label), col(months[2].scenario.label)]}
        rows={[
          ["Cases a month", ...months.map((b) => String(b.scenario.casesPerMonth))],
          row("AI: cases", (b) => b.aiCases),
          row("AI: quotations and invoices", (b) => b.aiCommercial),
          row("AI: assistants and briefings", (b) => b.aiAssistants),
          row("Netlify Pro (hosting)", (b) => b.netlify),
          row("Supabase Pro (database, files, backups)", (b) => b.supabase),
          ["Email (Resend)", ...months.map((b) => (b.email ? m.usd(b.email) : "Free tier"))],
          row("SMS to candidates", (b) => b.sms),
          row("Voice transcription", (b) => b.speech),
        ]}
        total={["Total (USD)", ...months.map((b) => m.usd(b.total, { whole: true }))]}
      />
      <Table
        columns={[{ label: "In rupees", width: 46 }, col(""), col(""), col("")]}
        rows={[
          ["Total per month", ...months.map((b) => m.lkr(b.total))],
          ["AI per case on average", ...months.map((b) => m.lkr(b.aiCases / b.scenario.casesPerMonth))],
        ]}
      />
      <P style={s.small}>
        Assumptions per month: {months.map((b) => `${b.scenario.label} — ${b.scenario.newClientsPerMonth} new clients, ${b.scenario.staffAssistantQuestions} assistant questions, ${b.scenario.commandTurns} commands, ${b.scenario.voiceMinutes} voice minutes`).join("; ")}. Three SMS reminders per case. The hosting maintenance plan is quoted separately.
      </P>
    </ContentPage>
  );
}

function Hosting() {
  const starterMonths = m.monthsOnFreeStorage(m.SCENARIOS[0].casesPerMonth);
  return (
    <ContentPage title={TITLE} section="Hosting and services">
      <SectionTitle eyebrow="7 · Hosting and services" title="Where the system runs" intro="Three managed services run the system. None needs servers of your own." />
      <H2>Netlify: the application, on a maintenance plan</H2>
      <P>
        The application and its background workers run on Netlify. Netlify’s free plan stops a site when its monthly allowance is used up, which a business system cannot risk, so the system runs on a paid plan ({m.SERVICES.netlifyPro.label}, about ${m.SERVICES.netlifyPro.monthly} a month; {m.SERVICES.netlifyPro.note}).
      </P>
      <Callout title="Maintenance plan">
        {MAINTENANCE_PLAN_USD
          ? `Hosting is provided under a monthly maintenance plan of ${m.usd(MAINTENANCE_PLAN_USD)}, which also covers monitoring, security updates, backups checks and support.`
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
          [m.SERVICES.supabasePro.label, `$${m.SERVICES.supabasePro.monthly}`, m.SERVICES.supabasePro.note],
        ]}
      />
      <P>
        We include 500 MB of free Supabase data storage to start. Each case stores about {m.STORAGE_PER_CASE_MB} MB of documents and reports, so at {m.SCENARIOS[0].casesPerMonth} cases a month the free 1 GB of file storage lasts about {starterMonths.toFixed(1)} months. Upgrading to Pro ($25 a month) removes that limit for years and adds daily backups. Because the system holds candidates’ personal documents, we recommend Pro from go-live.
      </P>
      <H2>Email, SMS and transcription</H2>
      <Bullets
        items={[
          `Email through Resend: free for up to 3,000 emails a month (100 a day); $20 a month for 50,000. The Starter and Growth volumes fit the free tier.`,
          `SMS reminders through Notify.lk or a similar gateway: ${m.SERVICES.smsPerMessage.note}, paid per message.`,
          `Voice transcription for the command assistant: about ${m.usd(m.SPEECH_TO_TEXT_PER_MINUTE, { precise: true })} a minute.`,
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
          "Faster turnaround: candidates upload through a guided link with instant feedback, and outreach goes out the day a case opens.",
          "Fewer QC returns: documents are checked for readability and consistency on upload, before a person looks at them.",
          "Fewer missed discrepancies: the Post-QC cross-check reads every check against its evidence.",
          "Fewer status calls: clients see each check's progress in their portal.",
        ]}
      />
      <P style={s.small}>The staff cost per hour and the minutes saved are planning assumptions; replace them with Ontriq’s own figures to restate the return.</P>
    </ContentPage>
  );
}

function Controls() {
  return (
    <ContentPage title={TITLE} section="Cost controls and assumptions">
      <SectionTitle eyebrow="9 · Cost controls" title="Spend that can't run away" />
      <Bullets
        items={[
          "Every AI call is recorded with its model, tokens and cost, and attributed to the client, case and feature that caused it.",
          "The AI page in Settings shows spend by day, feature, model and client, next to the estimates in this document.",
          "Daily and monthly budgets per feature send an alert or pause the feature when reached. The command assistant has its own daily cap.",
          "Each AI feature can be switched off, or moved to a cheaper model, without a code change.",
          "Clients can opt out of AI processing entirely; their cases are then handled manually.",
          "A background job that fails repeatedly is stopped rather than retried forever, so a fault can never loop on paid calls.",
        ]}
      />
      <SectionTitle eyebrow="10 · Assumptions and sources" title="How these numbers were made" />
      <Bullets
        items={[
          `List prices checked on ${m.PRICES_VERIFIED_ON}. Exchange rate USD 1 = LKR ${m.USD_TO_LKR}. Taxes on foreign services are not included.`,
          "A scanned page is about 1,600 tokens; a comprehensive case has about 12 pages, a standard case about 6.",
          `Forty percent of cases are comprehensive. ${m.STORAGE_PER_CASE_MB} MB of files per case.`,
          "Usage figures for assistants and briefings are estimates; they are the easiest line to control with budgets.",
          "Prices change. The system's usage dashboard measures the real cost from the first case, and this document is regenerated from the same model.",
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
      <Models />
      <Tasks />
      <Cases />
      <Commercial />
      <Monthly />
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
  md.push(`| AI with Sonnet for Post-QC | ${m.usd(comprehensiveSonnet)} |`);
  md.push(`| AI per standard case (3 checks) | ${m.usd(standard)} |`);
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
  r("Email", (b) => (b.email ? m.usd(b.email) : "free tier"));
  r("SMS", (b) => m.usd(b.sms));
  r("Voice transcription", (b) => m.usd(b.speech));
  r("**Total (USD)**", (b) => `**${m.usd(b.total, { whole: true })}**`);
  r("Total (LKR)", (b) => m.lkr(b.total));
  md.push("", "Hosting is provided under a monthly maintenance plan, quoted separately.", "");
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
