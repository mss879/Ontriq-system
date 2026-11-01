/**
 * Demo data for showing the system to Ontriq: sign-ins for an admin, a staff
 * member and a client portal user, a team, eight sample client companies and
 * about sixty-five cases at every stage, with documents, QC decisions, real
 * report PDFs, quotations, invoices, payments, pushes and sample AI suggestions.
 * Everything goes through the app's own database functions as the right role,
 * so timelines, numbering and PDFs are real; afterwards the dates are spread
 * over the last three months so analytics and the leaderboard look lived-in.
 *
 *   npx tsx scripts/seed-demo.ts --env .env.hosted --app http://localhost:3200 --logins demo-logins.local.md
 *   npx tsx scripts/seed-demo.ts --env .env.hosted --clean     removes all of it and resets the numbering
 *
 * Local stack: add --db-url postgresql://postgres@127.0.0.1:55433/ontriq.
 * Sign-ins and client companies carry a demo marker, so --clean takes away
 * exactly what this script added. Passwords go to the --logins file only.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Database } from "../src/lib/supabase/database.types";
import { parseNic } from "../src/domain/nic-core";
import { parseCheckTypeSchema } from "../src/domain/check-types/schema";
import { validateCheckValues } from "../src/domain/check-types/validate";
import { totp } from "./local-stack/totp";

type DB = SupabaseClient<Database>;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ORG = "00000000-0000-4000-8000-000000000001";
const NOTE = "[demo-seed] Sample company for demonstrations.";
const CLIENT_DOMAIN = "demo.ontriq.test";

loadEnvFile(arg("env") ?? ".env.hosted");
// Reports print this address and its QR code, so it must be where the demo runs.
if (arg("app")) process.env.APP_ORIGIN = arg("app");
// The sample AI output below is written by this script. The job queue must not call the model for it.
process.env.ANTHROPIC_API_KEY = "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !publishable || !secret) throw new Error("the env file needs the Supabase URL and keys");
const service: DB = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = (): DB => createClient<Database>(url, publishable, { auth: { persistSession: false, autoRefreshToken: true } });

// Repeatable pseudo-random numbers, so a re-run makes the same story.
let state = 20261030;
const rnd = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<T>;
};

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

// ---------------------------------------------------------------- the cast

type Actor = { key: string; name: string; email: string; role: string; client?: string; password: string; id: string; db: DB };
const PEOPLE: { key: string; name: string; email: string; role: string; client?: string }[] = [
  { key: "admin", name: "Amaya Perera", email: `admin@${CLIENT_DOMAIN}`, role: "admin" },
  { key: "staff", name: "Nimal Fernando", email: `staff@${CLIENT_DOMAIN}`, role: "verification_officer" },
  { key: "client", name: "Dilani Jayawardena", email: `client@${CLIENT_DOMAIN}`, role: "client_admin", client: "LHH" },
  { key: "ops", name: "Ruwan Herath", email: `ops@${CLIENT_DOMAIN}`, role: "operations_manager" },
  { key: "relations", name: "Shehani de Silva", email: `relations@${CLIENT_DOMAIN}`, role: "client_relations" },
  { key: "qc", name: "Priyanka Nair", email: `qc@${CLIENT_DOMAIN}`, role: "qc_officer" },
  { key: "entry", name: "Mohamed Rizwan", email: `entry@${CLIENT_DOMAIN}`, role: "data_entry_officer" },
  { key: "officer2", name: "Tharushi Gunasekara", email: `tharushi@${CLIENT_DOMAIN}`, role: "verification_officer" },
  { key: "officer3", name: "Kavindu Senanayake", email: `kavindu@${CLIENT_DOMAIN}`, role: "verification_officer" },
  { key: "super", name: "Nadeesha Wickramasinghe", email: `super@${CLIENT_DOMAIN}`, role: "super_admin" },
  { key: "viewer", name: "Sunil Gamage", email: `viewer@${CLIENT_DOMAIN}`, role: "viewer" },
  { key: "clientuser", name: "Kamal Rodrigo", email: `kamal@${CLIENT_DOMAIN}`, role: "client_user", client: "LHH" },
  { key: "clientviewer", name: "Anoma Peiris", email: `anoma@${CLIENT_DOMAIN}`, role: "client_viewer", client: "LHH" },
  { key: "aurora", name: "Rohan Abeysekera", email: `hr@aurora.${CLIENT_DOMAIN}`, role: "client_admin", client: "ALF" },
  { key: "northgate", name: "Sanduni Karunaratne", email: `people@northgate.${CLIENT_DOMAIN}`, role: "client_admin", client: "NGT" },
];

const CLIENTS = [
  { code: "LHH", name: "Lanka Horizon Holdings", legal: "Lanka Horizon Holdings PLC", industry: "Conglomerate", policy: "per_case_on_release", terms: 30, template: "executive", contact: "Dilani Jayawardena", title: "Head of Talent", city: "Colombo 03", volume: 14 },
  { code: "ALF", name: "Aurora Lanka Finance", legal: "Aurora Lanka Finance PLC", industry: "Banking and finance", policy: "monthly_consolidated", terms: 30, template: "classic", contact: "Rohan Abeysekera", title: "HR Manager", city: "Colombo 02", volume: 11 },
  { code: "NGT", name: "Northgate Technologies", legal: "Northgate Technologies (Pvt) Ltd", industry: "Software", policy: "per_case_on_release", terms: 14, template: "modern", contact: "Sanduni Karunaratne", title: "People Partner", city: "Colombo 07", volume: 10 },
  { code: "HBL", name: "Harbourline Logistics", legal: "Harbourline Logistics (Pvt) Ltd", industry: "Logistics", policy: "per_case_on_release", terms: 30, template: "modern", contact: "Chaminda Ratnayake", title: "HR Executive", city: "Colombo 15", volume: 8 },
  { code: "HCH", name: "Hillcrest Hospitality Group", legal: "Hillcrest Hospitality Group (Pvt) Ltd", industry: "Hospitality", policy: "per_case_on_release", terms: 30, template: "executive", contact: "Nirosha Wijesinghe", title: "Group HR Manager", city: "Kandy", volume: 7 },
  { code: "BWA", name: "Bluewave Apparel Exports", legal: "Bluewave Apparel Exports (Pvt) Ltd", industry: "Apparel", policy: "per_case_on_release", terms: 45, template: "classic", contact: "Fathima Nazeer", title: "Compliance Lead", city: "Katunayake", volume: 6 },
  { code: "SSA", name: "Southern Star Assurance", legal: "Southern Star Assurance PLC", industry: "Insurance", policy: "monthly_consolidated", terms: 30, template: "executive", contact: "Lasith Gamage", title: "Talent Acquisition Manager", city: "Galle", volume: 5 },
  { code: "GPA", name: "Golden Paddy Agro Foods", legal: "Golden Paddy Agro Foods (Pvt) Ltd", industry: "Agriculture", policy: "per_case_on_release", terms: 30, template: "modern", contact: "Suresh Kumar", title: "HR Officer", city: "Kurunegala", volume: 4 },
] as const;
type ClientCode = (typeof CLIENTS)[number]["code"];

const PRICES: Record<string, number> = { nic: 1500, education: 3000, employment: 3500, address: 4000, police: 3500, reference: 2500, sanction: 2000 };

const FIRST = ["Kasun", "Sachini", "Dinuka", "Ishara", "Chathura", "Nadeesha", "Mohamed", "Fathima", "Saman", "Kumari", "Pradeep", "Thilini", "Lahiru", "Hasini", "Arjun", "Meena", "Rajiv", "Anushka", "Gayan", "Sewwandi", "Niroshan", "Malsha", "Dulaj", "Yashodha", "Aravind", "Priya", "Sajith", "Oshadi"] as const;
const LAST = ["Perera", "Silva", "Fernando", "Jayasinghe", "Bandara", "Dissanayake", "Kumara", "Ranasinghe", "Liyanage", "Weerasinghe", "Ismail", "Nazeem", "Sivakumar", "Selvarajah", "Pathirana", "Samarasinghe", "Ekanayake", "Mendis", "Gunawardena", "Hettiarachchi", "Thevarajah", "Amarasinghe"] as const;
const POSITIONS = ["Software Engineer", "Relationship Manager", "Accountant", "Branch Manager", "Business Analyst", "HR Executive", "Sales Executive", "Operations Supervisor", "Credit Officer", "Front Office Manager", "Merchandiser", "Quality Controller", "Logistics Coordinator", "Internal Auditor"] as const;
const DEPARTMENTS = ["Technology", "Retail Banking", "Finance", "Operations", "Human Resources", "Sales", "Risk"] as const;
const DISTRICTS = ["Colombo", "Gampaha", "Kandy", "Galle", "Kurunegala", "Matara", "Kalutara", "Jaffna", "Batticaloa", "Anuradhapura"] as const;
const UNIVERSITIES = ["University of Moratuwa", "University of Colombo", "University of Peradeniya", "University of Kelaniya", "University of Sri Jayewardenepura", "SLIIT", "NSBM Green University"] as const;
const DEGREES = ["BSc Computer Science", "BBA Finance", "BSc Accounting", "BSc Engineering", "BA Economics", "BCom Marketing"] as const;
const REFEREES = [
  ["Anil Wijeratne", "Senior Manager", "line_manager", "3 years"],
  ["Sharmila Kanagaratnam", "Team Lead", "senior_colleague", "2 years"],
  ["Roshan Mendis", "Head of Department", "line_manager", "4 years"],
  ["Fazna Marikkar", "Assistant Manager", "senior_colleague", "2 years"],
  ["Gayan Rathnayake", "Project Lead", "line_manager", "5 years"],
  ["Kokila Herath", "Deputy General Manager", "line_manager", "6 years"],
] as const;
const GRAMA_NILADHARIS = ["W. A. Dharmasena", "K. P. Samarasinghe", "M. R. Nazeer", "S. Thevarajah", "H. L. Gunawardena"] as const;
const OFFICERS_IN_CHARGE = ["IP K. Jayalath", "CI R. Abeyratne", "IP S. Kandiah", "SI N. Fonseka"] as const;
const COLLEGES = ["Royal College, Colombo", "Visakha Vidyalaya, Colombo", "Trinity College, Kandy", "Hindu College, Jaffna", "Zahira College, Colombo"] as const;
const EMPLOYERS = ["Meridian Software Lanka", "Crestline Finance", "Palmgrove Hotels", "Ocean Gate Shipping", "Redwood Apparel", "Silverline Insurance", "Greenfield Foods"] as const;
const STREETS = ["Galle Road", "Kandy Road", "Temple Road", "Station Road", "Lake Drive", "Hospital Road", "Main Street"] as const;

let nicSerial = 100;
function candidate(i: number) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 7 + 3) % LAST.length];
  const female = ["Sachini", "Ishara", "Nadeesha", "Fathima", "Kumari", "Thilini", "Hasini", "Meena", "Anushka", "Sewwandi", "Malsha", "Yashodha", "Priya", "Oshadi"].includes(first);
  const year = int(82, 99);
  const day = int(10, 360) + (female ? 500 : 0);
  // Sample numbers: right shape for the system, not anyone's real card.
  const nic = parseNic(`${year}${String(day).padStart(3, "0")}${String(nicSerial++).padStart(3, "0")}${int(1, 9)}V`);
  if (!nic.valid) throw new Error(`bad sample NIC for ${first}`);
  const district = pick(DISTRICTS);
  return {
    full_name: `${first} ${last}`,
    nic: nic.display,
    nic_canonical: nic.canonical,
    date_of_birth: nic.birthDate,
    gender: nic.gender,
    district,
    email: `${first}.${last}${i}@example.com`.toLowerCase(),
    phone: `+9477${String(1000000 + i * 37).slice(0, 7)}`,
    address: `${int(3, 240)}, ${pick(STREETS)}, ${district}`,
    preferred_language: i % 5 === 0 ? "si" : i % 7 === 0 ? "ta" : "en",
  };
}
type Candidate = ReturnType<typeof candidate>;

// ---------------------------------------------------------------- plan of cases

type Stage = "intake" | "documents" | "pre_qc" | "data_entry" | "verification" | "post_qc" | "report" | "approval" | "released" | "cancelled";
type Plan = {
  i: number;
  client: ClientCode;
  pkg: "ESSENTIAL" | "STANDARD" | "COMPREHENSIVE";
  stage: Stage;
  process: "client_supplied" | "candidate_collected";
  received: Date;
  end: Date;
  result?: "green" | "amber" | "red";
  hold?: string;
  returned?: boolean;
  /** Stays with the client named here instead of being dealt out. */
  pinned?: boolean;
  /** All files in, none missing. */
  allIn?: boolean;
  /** How many checks are finished at verification. */
  finished?: number;
  /** A check at verification waits on a question to the client. */
  asks?: boolean;
  /** Final approval done, not yet released. */
  approved?: boolean;
  /** A second education record, as the client's section 4.1 has it. */
  twoEducation?: boolean;
  person: Candidate;
  caseId?: string;
  reference?: string;
};

function plans(): Plan[] {
  const clients = CLIENTS.flatMap((c) => Array.from({ length: c.volume }, () => c.code as ClientCode));
  const list: Omit<Plan, "i" | "person" | "received" | "end">[] = [];
  const add = (stage: Stage, n: number, extra: Partial<Plan> = {}) => {
    for (let k = 0; k < n; k++) {
      const pkg = pick(["STANDARD", "STANDARD", "COMPREHENSIVE", "COMPREHENSIVE", "ESSENTIAL"] as const);
      list.push({ client: "LHH", pkg, stage, process: "client_supplied", ...extra });
    }
  };
  add("released", 15, { result: "green" });
  add("released", 4, { result: "amber" });
  add("released", 2, { result: "red" });
  add("cancelled", 2);
  add("approval", 2, { result: "green" });
  add("report", 3, { result: "green" });
  add("post_qc", 4);
  add("verification", 10);
  add("data_entry", 5);
  add("pre_qc", 5);
  add("documents", 4);
  add("documents", 4, { process: "candidate_collected" });
  add("documents", 1, { returned: true });
  add("intake", 4);
  // Lanka Horizon is the client signed in for the demo. One case at every status.
  const pin = { pinned: true, pkg: "COMPREHENSIVE" } as const;
  add("intake", 1, pin);
  add("documents", 1, pin);
  add("documents", 1, { ...pin, allIn: true });
  add("documents", 1, { ...pin, returned: true });
  add("documents", 1, { ...pin, process: "candidate_collected" });
  add("pre_qc", 1, pin);
  add("data_entry", 1, pin);
  add("verification", 1, { ...pin, finished: 0 });
  add("verification", 1, { ...pin, finished: 3 });
  add("verification", 1, { ...pin, finished: 1, asks: true });
  add("verification", 1, { ...pin, finished: 2, hold: "Client asked to pause until the offer is confirmed." });
  add("post_qc", 1, pin);
  add("report", 1, { ...pin, result: "green" });
  add("approval", 1, { ...pin, result: "green" });
  add("approval", 1, { ...pin, result: "green", approved: true });
  add("released", 1, { ...pin, result: "green", twoEducation: true });
  add("released", 1, { ...pin, result: "amber" });
  add("released", 1, { ...pin, result: "red" });
  const order = list.map((p, n) => ({ p, sort: rnd(), n }));
  // Closed work is older than open work, and each client gets its share.
  const mixed = clients.sort(() => rnd() - 0.5);
  return order.map(({ p }, i) => {
    const closed = p.stage === "released" || p.stage === "cancelled";
    const open = { intake: [0, 1], documents: [1, 5], pre_qc: [2, 6], data_entry: [2, 6], verification: [3, 11], post_qc: [4, 7], report: [5, 8], approval: [5, 8] } as Record<string, [number, number]>;
    const age = closed ? int(14, 92) : int(...(open[p.stage] ?? [1, 5]));
    const received = new Date(daysAgo(age).getTime() + int(0, 8) * 3_600_000);
    const tat = p.stage === "cancelled" ? int(1, 4) : p.pkg === "ESSENTIAL" ? int(3, 8) : p.pkg === "STANDARD" ? int(4, 9) : int(6, 13);
    const end = closed ? new Date(received.getTime() + Math.min(tat, age - 1) * DAY) : new Date(Date.now() - int(1, 20) * 3_600_000);
    return { ...p, client: p.pinned ? p.client : mixed[i % mixed.length], i, received, end, person: candidate(i) };
  }).sort((a, b) => a.received.getTime() - b.received.getTime());
}

// ---------------------------------------------------------------- sample files and check values

const LABELS: Record<string, string> = {
  nic_copy: "National Identity Card (copy)",
  education_certificate: "Degree certificate",
  transcript: "Academic transcript",
  service_letter: "Service letter",
  gn_certificate: "Grama Niladhari certificate",
  police_report: "Police clearance report",
  sanction_report: "Global sanction screening report",
  reference_form: "Reference form",
};

async function samplePdf(category: string, person: Candidate, reference: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.04, 0.16, 0.32);
  page.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: navy });
  page.drawText("SAMPLE DOCUMENT", { x: 40, y: 800, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Demonstration data, not a real record", { x: 40, y: 782, size: 10, font, color: rgb(0.85, 0.9, 1) });
  page.drawText(LABELS[category] ?? category.replace(/_/g, " "), { x: 40, y: 720, size: 16, font: bold, color: navy });
  const rows = [["Name", person.full_name], ["NIC", person.nic], ["Date of birth", person.date_of_birth ?? ""], ["Address", person.address], ["Case reference", reference]];
  rows.forEach(([k, v], n) => {
    page.drawText(k, { x: 40, y: 680 - n * 24, size: 11, font: bold, color: rgb(0.3, 0.3, 0.35) });
    page.drawText(v, { x: 170, y: 680 - n * 24, size: 11, font, color: rgb(0.1, 0.1, 0.12) });
  });
  page.drawText("SAMPLE", { x: 120, y: 300, size: 110, font: bold, color: rgb(0.92, 0.93, 0.95) });
  return pdf.save();
}

const pickTwo = <T,>(list: readonly T[]) => {
  const first = int(0, list.length - 1);
  return [list[first], list[(first + 1 + int(0, list.length - 2)) % list.length]];
};

function employers(latest: string, from: string, to: string, day: string) {
  const row = (company: string, period: { from: string; to: string }) => ({
    company, designation: pick(POSITIONS), period, employee_code: `E${int(1000, 9999)}`, employment_type: pick(["permanent", "permanent", "contract"]), hr_contact: "HR Department",
    hr_email: `hr@${company.split(" ")[0].toLowerCase()}.example.com`, hr_phone: "+94112345678", confirmed_by: "HR Executive", confirmed_on: day, employer_response: "Dates, role and employment type confirmed.",
  });
  const rows = [row(latest, { from, to })];
  if (rnd() < 0.5) {
    const year = Number(from.slice(0, 4));
    rows.push(row(pick(EMPLOYERS.filter((e) => e !== latest)), { from: `${year - 2}-02-01`, to: `${year - 1}-12-31` }));
  }
  return rows;
}

function checkValues(key: string, p: Candidate, seedDate: Date): Record<string, unknown> {
  const grad = int(2012, 2021);
  const from = `${grad}-0${int(1, 9)}-01`;
  const to = `${grad + int(2, 4)}-1${int(0, 2)}-28`;
  const day = iso(seedDate);
  const employer = pick(EMPLOYERS);
  switch (key) {
    case "nic":
      return { nic_number: p.nic, name_on_nic: p.full_name, date_of_birth: p.date_of_birth, validation_source: pick(["drp", "online"]) };
    case "education":
      return { candidate_name: p.full_name, qualification_level: "degree", qualification: pick(DEGREES), institution: pick(UNIVERSITIES), student_number: `S/${grad - 4}/${int(1000, 9999)}`, year_of_completion: grad, confirmed_by: "Assistant Registrar", confirmation_channel: "email", confirmed_on: day };
    case "employment":
      return { candidate_name: p.full_name, employers: employers(employer, from, to, day) };
    case "address":
      return { address: p.address, district: p.district, residence_period: { from, to: day }, verified_by: "Field officer", gn_name: pick(GRAMA_NILADHARIS), gn_division: `${int(100, 650)}A`, gn_contact: "+94112345679", visit_date: day, confirmed_on: day };
    case "police":
      return { nic: p.nic, permanent_address: p.address, district: p.district, residence_period: { from, to: day }, police_station_area: `${p.district} Police`, verified_by: "Verification Officer", oic_name: pick(OFFICERS_IN_CHARGE), station_contact: "+94112345680", confirmed_on: day };
    case "reference":
      return {
        referees: pickTwo(REFEREES).map(([full_name, title, relationship, years], n) => ({
          full_name, current_employer: employer, current_job_title: title, worked_together_at: employer, relationship, acquaintance_duration: years,
          contact_number: `+9477${int(1000000, 9999999)}`, email: `${full_name.split(" ")[0].toLowerCase()}@example.com`,
          feedback: n ? "Good team member, meets deadlines." : "Reliable, works well under pressure.", details_confirmed: "yes", confirmed_on: day,
        })),
      };
    case "sanction":
      return { sanctions_found: "no", screening_platform: "Cfirst", screened_on: day };
    default:
      return { candidate_name: p.full_name };
  }
}

// ---------------------------------------------------------------- seeding

async function ensurePerson(p: (typeof PEOPLE)[number], clientIds: Map<string, string>, roleIds: Map<string, string>): Promise<Actor> {
  const password = `Ontriq-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const kind = p.client ? "client" : "staff";
  const created = await service.auth.admin.createUser({
    email: p.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: p.name },
    app_metadata: { kind, org_id: ORG, demo: true },
  });
  if (created.error || !created.data.user) throw new Error(`create ${p.email}: ${created.error?.message}`);
  const id = created.data.user.id;
  must(
    await service.from("memberships").insert({ org_id: ORG, user_id: id, kind, client_id: p.client ? clientIds.get(p.client) : null, role_id: roleIds.get(p.role)!, status: "active" }),
    `membership ${p.email}`,
  );
  const db = anon();
  const signed = await db.auth.signInWithPassword({ email: p.email, password });
  if (signed.error) throw new Error(`sign-in ${p.email}: ${signed.error.message}`);
  // Where staff need a second factor (the local stack), row level security shows them nothing without one.
  const { data: org } = await service.from("orgs").select("mfa_required_for_staff").eq("id", ORG).single();
  if (kind === "staff" && org?.mfa_required_for_staff) {
    const factor = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "demo" });
    if (factor.error || !factor.data) throw new Error(`two-step ${p.email}: ${factor.error?.message}`);
    const verified = await db.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: totp(factor.data.totp.secret) });
    if (verified.error) throw new Error(`two-step ${p.email}: ${verified.error.message}`);
  }
  return { ...p, password, id, db };
}

async function seed() {
  const already = await service.from("clients").select("id").like("notes", "[demo-seed]%").limit(1);
  if (already.data?.length) throw new Error("demo data is already here. Run with --clean first.");
  const { drainJobs } = await import("../src/jobs/run-job");
  const { currentSnapshot } = await import("../src/jobs/report/load");
  const { hashLinkSecret, newLinkSecret, sealLinkSecret } = await import("../src/lib/crypto/candidate-token");
  const worker = `demo-${Date.now().toString(36)}`;
  const drain = async (label: string) => {
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const r = await drainJobs({ budgetMs: 90_000, reserveMs: 0, maxJobs: 40, workerId: worker, admin: service });
      total += r.processed;
      if (!r.processed) break;
    }
    console.log(`  jobs: ${label} (${total})`);
  };
  const log = (s: string) => console.log(`• ${s}`);

  log("Prices");
  const { data: types } = await service.from("check_types").select("id, key").eq("org_id", ORG);
  const typeKey = new Map((types ?? []).map((t) => [t.id, t.key]));
  const typeId = (key: string) => [...typeKey].find(([, k]) => k === key)![0];
  for (const t of types ?? []) {
    if (PRICES[t.key]) must(await service.from("package_items").update({ unit_price: PRICES[t.key] }).eq("check_type_id", t.id), "prices");
  }

  log("Client companies and people");
  const { data: roles } = await service.from("roles").select("id, key").eq("org_id", ORG);
  const roleIds = new Map((roles ?? []).map((r) => [r.key, r.id]));
  const clientRows = must(
    await service
      .from("clients")
      .insert(
        CLIENTS.map((c) => ({
          org_id: ORG, name: c.name, code: c.code, legal_name: c.legal, industry: c.industry, status: "active", email: `accounts@${c.code.toLowerCase()}.${CLIENT_DOMAIN}`,
          phone: "+94112223344", address: { text: `${int(10, 400)}, ${pick(STREETS)}, ${c.city}, Sri Lanka` }, sla_days: 7, payment_terms_days: c.terms, billing_policy: c.policy,
          default_template: c.template, notes: NOTE,
        })),
      )
      .select("id, code"),
    "clients",
  );
  const clientIds = new Map(clientRows.map((c) => [c.code, c.id]));
  must(
    await service.from("client_contacts").insert(
      CLIENTS.map((c) => ({ org_id: ORG, client_id: clientIds.get(c.code)!, name: c.contact, title: c.title, email: `${c.contact.split(" ")[0].toLowerCase()}@${c.code.toLowerCase()}.${CLIENT_DOMAIN}`, phone: "+94771112233", is_primary: true, receives_invoices: true })),
    ),
    "contacts",
  );
  const actors = new Map<string, Actor>();
  for (const p of PEOPLE) actors.set(p.key, await ensurePerson(p, clientIds, roleIds));
  const A = (k: string) => actors.get(k)!;
  const byId = new Map([...actors.values()].map((a) => [a.id, a]));
  const portalActor = (code: ClientCode) => (code === "LHH" ? A("client") : code === "ALF" ? A("aurora") : code === "NGT" ? A("northgate") : null);
  const { data: pkgRows } = await service.from("packages").select("id, code").eq("org_id", ORG).eq("owner_scope", "org");
  const pkgId = (code: string) => pkgRows!.find((p) => p.code === code)!.id;

  // ------------------------------------------------------------ quotations first: they set contracted prices
  log("Quotations");
  const nicId = (types ?? []).find((t) => t.key === "nic")!.id;
  const quotes: { id: string; state: string; code: ClientCode }[] = [];
  const quoteLines = (id: string) => [
    { org_id: ORG, quote_id: id, sort: 10, kind: "package", package_id: pkgId("COMPREHENSIVE"), description: "Comprehensive verification package", quantity: 1, unit_price: 20000, discount_pct: 10 },
    { org_id: ORG, quote_id: id, sort: 20, kind: "package", package_id: pkgId("STANDARD"), description: "Standard verification package", quantity: 1, unit_price: 8000, discount_pct: 5 },
    { org_id: ORG, quote_id: id, sort: 30, kind: "check", check_type_id: nicId, description: "NIC verification (single check)", quantity: 1, unit_price: 1500, discount_pct: 0 },
  ];
  for (const [code, stateName] of [["LHH", "accepted"], ["ALF", "accepted"], ["NGT", "accepted"], ["HBL", "sent"], ["HCH", "viewed"], ["BWA", "declined"], ["SSA", "confirmed"], ["GPA", "draft"]] as [ClientCode, string][]) {
    const c = CLIENTS.find((x) => x.code === code)!;
    const q = must(
      await A("relations").db.from("quotes").insert({
        org_id: ORG, client_id: clientIds.get(code)!, title: `Background verification services for ${c.name}`, template_key: c.template, valid_until: iso(new Date(Date.now() + 30 * DAY)),
        intro: `Thank you for considering Ontriq. This proposal covers background verification for ${c.name}'s new hires.`,
        scope: "Education, employment, address, police, NIC, reference and global sanction checks, by package.", tat_text: "7 working days for Standard, 10 for Comprehensive.",
        assumptions: "Consent is collected before verification begins. Prices exclude any taxes that apply.", closing: "We look forward to working with you.",
      }).select("id").single(),
      "quote",
    );
    must(await A("relations").db.from("quote_items").insert(quoteLines(q.id) as never), "quote lines");
    quotes.push({ id: q.id, state: stateName, code });
    if (stateName === "draft") continue;
    must(await A("relations").db.rpc("confirm_quote", { p_quote: q.id }), "confirm quote");
  }
  await drain("quotation PDFs");
  for (const q of quotes) {
    if (["draft", "confirmed"].includes(q.state)) continue;
    must(await A("relations").db.rpc("mark_quote_sent", { p_quote: q.id, p_to: [] }), "send quote");
    if (q.state === "accepted") must(await portalActor(q.code)!.db.rpc("portal_accept_quote", { p_quote: q.id, p_name: portalActor(q.code)!.name, p_ip: "203.0.113.20" }), "accept quote");
    if (q.state === "viewed") must(await service.from("quotes").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", q.id), "view quote");
    if (q.state === "declined") must(await service.from("quotes").update({ status: "declined", declined_reason: "We will revisit this next financial year." }).eq("id", q.id), "decline quote");
  }

  // Ontriq's own words for its checks, set the way they would be in Settings.
  runSql(`update public.check_types t set name = v.name from (values ('education', 'Education Verification'), ('employment', 'Employment Verification'), ('address', 'Address Check'), ('police', 'Criminal Check'), ('nic', 'NIC Verification'), ('reference', 'Reference Verification'), ('sanction', 'Global Sanction Screening')) as v(key, name) where t.key = v.key;
    alter table public.check_type_versions disable trigger user;
    update public.check_type_versions set schema = replace(replace(replace(schema::text, '"OIC name"', '"Name of the Officer in Charge"'), '"Station contact number"', '"Police Station Contact Number"'), '"Police station area"', '"Area of Police Station"')::jsonb;
    alter table public.check_type_versions enable trigger user;`);

  // ------------------------------------------------------------ cases
  const all = plans();
  log(`${all.length} cases`);
  for (const p of all) {
    const fromPortal = p.stage === "intake" ? portalActor(p.client) ?? A("client") : null;
    if (fromPortal) p.client = fromPortal.client as ClientCode;
    const actor = fromPortal ?? (p.i % 3 === 0 ? A("relations") : A("admin"));
    const r = must(
      await actor.db.rpc("create_case", {
        p: {
          client_id: clientIds.get(p.client), package_id: pkgId(p.pkg), process_type: p.process, position_title: pick(POSITIONS), department: pick(DEPARTMENTS),
          client_reference: `HR-${int(1000, 9999)}`, candidate: p.person,
          ...(p.twoEducation ? { extra_checks: [{ check_type_id: typeId("education"), label: "Education: Secondary" }] } : {}),
        },
      }),
      `create case for ${p.person.full_name}`,
    ) as { case_id: string; reference: string };
    p.caseId = r.case_id;
    p.reference = r.reference;
  }
  await drain("auto-assignment");

  const fileBytes = async (p: Plan, category: string) => samplePdf(category, p.person, p.reference!);
  const putFile = async (bucket: string, filePath: string, bytes: Uint8Array) => {
    const signed = await service.storage.from(bucket).createSignedUploadUrl(filePath);
    if (signed.error) throw new Error(`signed url: ${signed.error.message}`);
    const up = await anon().storage.from(bucket).uploadToSignedUrl(filePath, signed.data.token, bytes, { contentType: "application/pdf" });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
  };
  const upload = async (p: Plan, actor: Actor, req: { case_check_id: string | null; category: string }) => {
    const bytes = await fileBytes(p, req.category);
    const d = must(
      await actor.db.rpc("begin_document_upload", { p_case: p.caseId!, p_check: req.case_check_id as string, p_category: req.category, p_filename: `${req.category.replace(/_/g, "-")}.pdf`, p_mime: "application/pdf", p_size: bytes.length }),
      `begin upload ${req.category}`,
    ) as { id: string; bucket: string; path: string };
    await putFile(d.bucket, d.path, bytes);
    must(await actor.db.rpc("finalize_document_upload", { p_document: d.id }), "finalize upload");
    return d.id;
  };

  const ORDER: Stage[] = ["intake", "documents", "pre_qc", "data_entry", "verification", "post_qc", "report", "approval", "released"];
  const reached = (p: Plan, s: Stage) => p.stage !== "cancelled" && ORDER.indexOf(p.stage) >= ORDER.indexOf(s);
  const links = new Map<string, { id: string; secret: string }>();

  log("Moving cases through documents, QC, data entry and verification");
  await mapLimit(all, 4, async (p) => {
    const id = p.caseId!;
    const ops = A("ops");
    const { data: reqs } = await service.from("case_check_requirements").select("id, case_check_id, category, status, min_count").eq("case_id", id);
    const needed = (reqs ?? []).filter((r) => r.status === "pending" && r.min_count > 0);

    if (p.stage === "intake") return;
    if (p.process === "candidate_collected") {
      const secretValue = newLinkSecret();
      const link = must(await A("relations").db.rpc("issue_candidate_link", { p_case: id, p_token_hash: hashLinkSecret(secretValue), p_token_enc: sealLinkSecret(secretValue) as string, p_language: p.person.preferred_language as string, p_days: 14 }), "issue link") as string;
      links.set(id, { id: link, secret: secretValue });
      must(await A("relations").db.rpc("record_candidate_link_sent", { p_link: link, p_channels: ["email"] }), "link sent");
    }
    if (p.stage === "documents") {
      // Part-way through collecting: one or two files in, the rest still missing.
      for (const r of p.allIn ? needed : needed.slice(0, Math.max(1, needed.length - 2))) await upload(p, ops, r);
      if (p.returned) {
        for (const r of (await service.from("case_check_requirements").select("id, status").eq("case_id", id).eq("status", "pending")).data ?? []) must(await ops.db.rpc("waive_requirement", { p_requirement: r.id, p_reason: "Client confirmed by email" }), "waive");
        must(await ops.db.rpc("case_transition", { p_case: id, p_event: "submit_pre_qc" }), "to Pre-QC");
        must(await A("qc").db.rpc("record_qc_review", { p_case: id, p_kind: "pre", p_decision: "returned", p_remarks: "The NIC copy is too blurred to read. Please ask for a clearer scan." }), "Pre-QC return");
        must(await ops.db.rpc("create_client_request", { p_case: id, p_check: null as unknown as string, p_question: "The NIC copy is too blurred to read. Please send a clearer scan." }), "ask the client");
      }
      return;
    }
    if (p.stage === "cancelled") {
      must(await ops.db.rpc("cancel_case", { p_case: id, p_reason: pick(["Candidate withdrew the application", "Client withdrew the offer"]) }), "cancel");
      return;
    }
    for (const r of needed) await upload(p, ops, r);
    if (p.process === "candidate_collected") {
      must(await ops.db.rpc("log_contact", { p_case: id, p: { counterparty: p.person.full_name, channel: "phone", outcome: "Spoke to them and explained what is needed." } }), "log the call");
      must(await service.rpc("candidate_submit_consent", { p_link: links.get(id)!.id, p_method: "esign", p_signed_name: p.person.full_name, p_document: null as unknown as string, p_ip: "203.0.113.40" }), "consent");
    }
    must(await ops.db.rpc("case_transition", { p_case: id, p_event: "submit_pre_qc" }), "to Pre-QC");
    if (!reached(p, "data_entry")) return;
    must(
      await A("qc").db.rpc("record_qc_review", { p_case: id, p_kind: "pre", p_decision: "approved", p_remarks: "All documents present and readable.", p_checklist: [{ item: "Documents complete", ok: true }, { item: "Readable", ok: true }, { item: "Details consistent", ok: true }] }),
      "Pre-QC approve",
    );
    const { data: checks } = await service.from("case_checks").select("id, label, assigned_to, check_type_id, version:check_type_versions(schema)").eq("case_id", id).order("sort");
    const seedDate = p.stage === "released" ? new Date(p.received.getTime() + (p.end.getTime() - p.received.getTime()) * 0.3) : new Date();
    const halfway = p.stage === "data_entry" ? Math.ceil((checks?.length ?? 1) / 2) : (checks?.length ?? 0);
    for (const [n, k] of (checks ?? []).entries()) {
      if (n >= halfway) break;
      const schema = parseCheckTypeSchema((k.version as unknown as { schema: unknown }).schema);
      const key = typeKey.get(k.check_type_id) ?? "";
      const values = checkValues(key, p.person, seedDate);
      if (key === "education" && k.label.includes("Secondary")) Object.assign(values, { qualification_level: "secondary", qualification: "G.C.E. Advanced Level", institution: pick(COLLEGES), student_number: `${int(1000000, 9999999)}`, year_of_completion: Number(values.year_of_completion) - 4 });
      const v = validateCheckValues(schema.fields, values, "submit");
      if (!v.ok) throw new Error(`${key} values: ${JSON.stringify(v.errors)}`);
      must(await A("entry").db.rpc("save_check_values", { p_check: k.id, p_values: v.values as never, p_valid: true }), `values ${key}`);
    }
    if (!reached(p, "verification")) return;
    must(await A("entry").db.rpc("case_transition", { p_case: id, p_event: "start_verification" }), "start verification");
    const list = checks ?? [];
    const finish = p.stage === "verification" ? (p.finished ?? int(0, list.length - 1)) : list.length;
    // Each finding sits on the check it is about.
    const flagged = list.find((k) => typeKey.get(k.check_type_id) === (p.result === "red" ? "employment" : "education")) ?? list[list.length - 1];
    const notes: Record<string, string> = {
      nic: "NIC confirmed with the Department of Registration of Persons.",
      education: "The registrar confirmed the qualification and year of completion.",
      employment: "HR confirmed the designation, dates and employment type.",
      address: "Residence confirmed by the Grama Niladhari.",
      police: "Police clearance received with no adverse record.",
      reference: "Both referees gave positive feedback.",
      sanction: "No matches on the global sanction screening.",
    };
    const officerOf = (k: (typeof list)[number]) => (k.assigned_to && byId.get(k.assigned_to)) || ops;
    for (const [n, k] of list.entries()) {
      const officer = officerOf(k);
      const key = typeKey.get(k.check_type_id) ?? "";
      if (n >= finish) {
        if (n === finish && !p.asks) must(await officer.db.rpc("set_check_state", { p_check: k.id, p_state: "awaiting_response", p_note: "Email sent to the institution; waiting for their reply." }), "awaiting");
        continue;
      }
      // Each employer carries its own letter, as the check requires before it can finish.
      if (key === "employment") {
        const { data: row } = await service.from("case_checks").select("values").eq("id", k.id).single();
        const rows = (row?.values as { employers?: unknown[] } | null)?.employers ?? [];
        if (rows.length > 1) {
          const { data: letters } = await service.from("documents").select("id").eq("case_check_id", k.id).eq("category", "service_letter").limit(1);
          const second = await upload(p, ops, { case_check_id: k.id, category: "service_letter" });
          const tied = [letters?.[0]?.id ?? (await upload(p, ops, { case_check_id: k.id, category: "service_letter" })), second];
          for (const [i, document] of tied.entries()) must(await ops.db.rpc("set_document_record", { p_document: document, p_record: `employers.${i}` }), "tie the letter");
        }
      }
      const last = k.id === flagged?.id;
      if (p.result === "red" && last) must(await officer.db.rpc("set_check_state", { p_check: k.id, p_state: "discrepancy", p_note: "The dates given differ by eight months from the employer's records.", p_client_note: "The employment dates could not be matched to the employer's records." }), "discrepancy");
      else if (p.result === "amber" && last) must(await officer.db.rpc("set_check_state", { p_check: k.id, p_state: "unable_to_verify", p_note: "No reply after three follow-ups.", p_client_note: "The institution did not respond after three follow-ups." }), "unable");
      else must(await officer.db.rpc("set_check_state", { p_check: k.id, p_state: "completed", p_result: "clear", p_client_note: notes[key] ?? "Verified." }), "complete");
    }
    if (p.asks) {
      const waiting = list[finish];
      must(await officerOf(waiting).db.rpc("set_check_state", { p_check: waiting.id, p_state: "pending_info", p_note: "The dates on the letter can't be read." }), "needs information");
      must(await ops.db.rpc("create_client_request", { p_case: id, p_check: waiting.id, p_question: "Please confirm the candidate's last day at this employer." }), "ask the client");
    }
    if (!reached(p, "post_qc")) return;
    must(await ops.db.rpc("case_transition", { p_case: id, p_event: "submit_post_qc" }), "to Post-QC");
    if (!reached(p, "report")) return;
    must(await A("qc").db.rpc("record_qc_review", { p_case: id, p_kind: "post", p_decision: "approved", p_remarks: "Findings match the evidence on file.", p_checklist: [{ item: "Findings match the evidence", ok: true }] }), "Post-QC approve");
  });
  await drain("after the checks");

  log("Reports");
  const toReport = all.filter((p) => reached(p, "approval"));
  const drafts = new Map<string, string>();
  for (const p of toReport) drafts.set(p.caseId!, must(await A("ops").db.rpc("request_report_draft", { p_case: p.caseId! }), "draft") as string);
  await drain("report drafts");
  const finals: Plan[] = [];
  for (const p of toReport) {
    must(await A("ops").db.rpc("submit_report", { p_case: p.caseId! }), "submit report");
    if (p.stage !== "released" && !p.approved) continue;
    const { hash } = await currentSnapshot(service, p.caseId!);
    must(await A("ops").db.rpc("approve_report", { p_case: p.caseId!, p_draft: drafts.get(p.caseId!)!, p_final_result: p.result!, p_current_hash: hash, p_share_sensitive: true }), `approve ${p.reference}`);
    finals.push(p);
  }
  await drain("final reports");
  for (const p of finals.filter((f) => f.stage === "released")) {
    const reader = portalActor(p.client);
    must(await A("admin").db.rpc("release_report", { p_case: p.caseId!, p_recipients: reader ? [reader.id] : [] }), `release ${p.reference}`);
  }
  await drain("invoice drafts");

  // ------------------------------------------------------------ open-case colour
  log("Holds, notes and candidate activity");
  const verifying = all.filter((p) => p.stage === "verification");
  for (const p of verifying.filter((v) => v.hold || v === verifying.find((x) => !x.pinned))) must(await A("ops").db.rpc("set_case_hold", { p_case: p.caseId!, p_hold: true, p_reason: "Client asked to pause until the offer is confirmed." }), "hold");
  for (const p of verifying.slice(2, 7)) must(await A("ops").db.rpc("add_case_note", { p_case: p.caseId!, p_check: null as unknown as string, p_body: "Called the HR office; they promised a reply by Friday." }), "note");

  const collecting = all.filter((p) => p.process === "candidate_collected" && p.stage === "documents");
  let demoLink = "";
  for (const [n, p] of collecting.entries()) {
    const link = links.get(p.caseId!)!;
    const asked = must(await A("relations").db.rpc("create_candidate_request", { p_case: p.caseId!, p: { kind: "question", title: "When did you join your last employer?", help: "Month and year is enough." } }), "ask candidate") as string;
    if (n > 0) {
      must(await service.rpc("candidate_answer_request", { p_link: link.id, p_request: asked, p_answer: { value: "March 2021" } }), "answer");
      must(await service.rpc("candidate_post_message", { p_link: link.id, p_body: "I have uploaded my NIC. I will send the service letter tomorrow." }), "candidate message");
    } else demoLink = link.secret;
    must(await A("relations").db.rpc("post_candidate_message", { p_case: p.caseId!, p_body: "Thank you. Please upload your service letter when you can." }), "staff message");
  }

  // ------------------------------------------------------------ money
  log("Invoices and payments");
  const monthly = CLIENTS.filter((c) => c.policy === "monthly_consolidated");
  const month = `${iso(new Date()).slice(0, 7)}-01`;
  for (const c of monthly) {
    const r = await A("relations").db.rpc("draft_monthly_invoice", { p_client: clientIds.get(c.code)!, p_month: month });
    if (r.error) console.log(`  monthly invoice for ${c.code}: ${r.error.message}`);
  }
  const { data: draftInvoices } = await service.from("invoices").select("id, client_id, source_key, total, currency").eq("status", "draft").in("client_id", [...clientIds.values()]);
  const invoiceRows = (draftInvoices ?? []).map((inv) => {
    const caseId = inv.source_key?.startsWith("case:") ? inv.source_key.slice(5) : null;
    const plan = caseId ? all.find((p) => p.caseId === caseId) : null;
    return { ...inv, plan, issued: plan ? plan.end : daysAgo(3) };
  }).sort((a, b) => a.issued.getTime() - b.issued.getTime());
  const keepDraft = invoiceRows.slice(-2).map((r) => r.id);
  const ledger: { id: string; issued: string; due: string; paidOn: string | null; slipPending: boolean }[] = [];
  for (const inv of invoiceRows) {
    if (keepDraft.includes(inv.id)) continue;
    const conf = await A("relations").db.rpc("confirm_invoice", { p_invoice: inv.id });
    if (conf.error) {
      console.log(`  invoice left as draft: ${conf.error.message}`);
      continue;
    }
  }
  await drain("invoice PDFs");
  let pendingSlips = 0;
  for (const inv of invoiceRows) {
    if (keepDraft.includes(inv.id)) continue;
    const { data: fresh } = await service.from("invoices").select("id, status, total, balance, client_id").eq("id", inv.id).single();
    if (!fresh || fresh.status !== "confirmed") continue;
    must(await A("relations").db.rpc("mark_invoice_sent", { p_invoice: inv.id, p_to: [] }), "send invoice");
    const age = Math.round((Date.now() - inv.issued.getTime()) / DAY);
    const terms = CLIENTS.find((c) => clientIds.get(c.code) === inv.client_id)?.terms ?? 30;
    // Older invoices were paid within their terms; recent ones in the last few weeks, so the 30-day view has collections.
    const paidOn = age > 62 ? iso(new Date(inv.issued.getTime() + int(4, Math.max(5, terms - 2)) * DAY)) : iso(daysAgo(int(2, Math.min(25, Math.max(3, age - 3)))));
    let paid: string | null = null;
    if (age > 62 || (age > 28 && rnd() < 0.55)) {
      must(await A("relations").db.rpc("record_payment", { p_invoice: inv.id, p_amount: Number(fresh.balance), p_method: pick(["bank_transfer", "bank_transfer", "cheque"]), p_reference: `TRF${int(100000, 999999)}`, p_paid_on: paidOn }), "payment");
      paid = paidOn;
    } else if (age > 16 && rnd() < 0.35) {
      must(await A("relations").db.rpc("record_payment", { p_invoice: inv.id, p_amount: Math.round(Number(fresh.balance) / 2), p_method: "bank_transfer", p_reference: `TRF${int(100000, 999999)}`, p_paid_on: paidOn }), "part payment");
      paid = paidOn;
    }
    const portal = [...actors.values()].find((a) => a.client && clientIds.get(a.client) === inv.client_id);
    let slip = false;
    if (!paid && portal && pendingSlips < 2 && age < 25) {
      const bytes = await samplePdf("bank_slip", { ...all[0].person, full_name: portal.name }, inv.id.slice(0, 8));
      const begun = must(await portal.db.rpc("portal_begin_slip", { p_invoice: inv.id, p_filename: "bank-slip.pdf", p_mime: "application/pdf", p_size: bytes.length }), "begin slip") as { id: string; bucket: string; path: string };
      await putFile(begun.bucket, begun.path, bytes);
      must(await portal.db.rpc("portal_finalize_slip", { p_slip: begun.id }), "finalize slip");
      pendingSlips++;
      slip = true;
    }
    const due = new Date(inv.issued.getTime() + terms * DAY);
    ledger.push({ id: inv.id, issued: iso(inv.issued), due: iso(due), paidOn: paid, slipPending: slip });
  }
  const unpaid = ledger.find((l) => !l.paidOn && !l.slipPending);
  if (unpaid) {
    const fresh = (await service.from("invoices").select("balance").eq("id", unpaid.id).single()).data;
    if (fresh) await A("relations").db.rpc("issue_credit_note", { p_invoice: unpaid.id, p_amount: Math.min(1500, Number(fresh.balance)), p_reason: "One check was withdrawn by the client." });
  }
  await drain("receipts and notices");

  // ------------------------------------------------------------ sample AI output (no model is called)
  log("Sample AI suggestions and usage");
  const models: Record<string, [string, number, number]> = {
    "document.classify": ["claude-haiku-5-5", 2200, 950],
    "document.extract": ["claude-sonnet-5-5", 5000, 700],
    "case.consistency": ["claude-sonnet-5-5", 12000, 1000],
    "case.preqc": ["claude-sonnet-5-5", 8000, 1200],
    "case.postqc": ["claude-opus-5-5", 25000, 6000],
    "report.narrative": ["claude-sonnet-5-5", 15000, 3000],
  };
  const suggestions: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];
  for (const p of all) {
    const id = p.caseId!;
    const add = (capability: string, entity_type: string, entity_id: string, value: unknown, rationale?: string, field_key?: string, confidence?: number) =>
      suggestions.push({ org_id: ORG, capability, entity_type, entity_id, value, rationale: rationale ?? null, field_key: field_key ?? null, confidence: confidence ?? null, source_refs: ["demo-seed"] });
    if (p.stage === "pre_qc") {
      add("case.consistency", "case", id, { issues: p.i % 2 ? [{ severity: "medium", topic: "name", description: `The service letter spells the name "${p.person.full_name.split(" ")[0]} ${p.person.full_name.split(" ")[1]?.[0]}." while the NIC gives it in full. This is probably initials, not a different person.`, documents: ["service-letter.pdf", "nic-copy.pdf"] }] : [], summary: p.i % 2 ? "One small name difference to confirm." : "Names, NIC and dates agree across the documents." }, "Compared the documents with the details declared.");
      add("case.preqc", "case", id, { summary: "Documents are complete and readable.", checklist: [{ item: "All required documents received", ok: true, note: null }, { item: "Documents readable", ok: true, note: null }, { item: "Names match across documents", ok: p.i % 2 === 0, note: p.i % 2 ? "Initials used on one letter" : null }], requests: p.i % 2 ? [{ to: "candidate", kind: "question", title: "Confirm your name on the service letter", message: "Your service letter shows your initials. Please confirm this is you.", category: null }] : [] }, "Documents are complete and readable.");
    }
    if (p.stage === "post_qc") {
      add("case.postqc", "case", id, { checks: [], missing: [], proposed_result: "green", reasoning: "Every check is complete and the results match the evidence on file." }, "Every check is complete and the results match the evidence on file.");
    }
    if (p.stage === "report") {
      add("report.narrative", "case", id, { text: `All checks for ${p.person.full_name} were completed. No discrepancies were found.` }, undefined, "executive_summary");
    }
    const count = p.stage === "released" ? int(10, 22) : reached(p, "pre_qc") ? int(3, 8) : int(0, 2);
    for (let n = 0; n < count; n++) {
      const capability = pick(Object.keys(models));
      const [model, input, output] = models[capability];
      const when = new Date(p.received.getTime() + rnd() * Math.max(1, p.end.getTime() - p.received.getTime()));
      runs.push({ org_id: ORG, capability, model, prompt_version: "demo", source: "demo-seed", case_id: id, input_tokens: Math.round(input * (0.7 + rnd() * 0.6)), output_tokens: Math.round(output * (0.7 + rnd() * 0.6)), duration_ms: int(1200, 9000), status: "ok", created_at: new Date(Math.min(when.getTime(), Date.now() - 3_600_000)).toISOString() });
    }
  }
  const dataEntryCases = all.filter((p) => p.stage === "data_entry");
  for (const p of dataEntryCases) {
    const { data: checks } = await service.from("case_checks").select("id, check_type_id, values").eq("case_id", p.caseId!).order("sort");
    for (const k of checks ?? []) {
      if (typeKey.get(k.check_type_id) !== "nic" || Object.keys((k.values ?? {}) as object).length) continue;
      suggestions.push({ org_id: ORG, capability: "document.extract", entity_type: "case_check", entity_id: k.id, field_key: "nic_number", value: { value: p.person.nic, source: "nic-copy.pdf" }, confidence: 0.96, source_refs: ["demo-seed"] });
      suggestions.push({ org_id: ORG, capability: "document.extract", entity_type: "case_check", entity_id: k.id, field_key: "name_on_nic", value: { value: p.person.full_name, source: "nic-copy.pdf" }, confidence: 0.93, source_refs: ["demo-seed"] });
    }
  }
  suggestions.push({
    org_id: ORG, capability: "briefing.daily", entity_type: "org", entity_id: ORG, source_refs: ["demo-seed"],
    value: { headline: `${all.filter((p) => !["released", "cancelled"].includes(p.stage)).length} cases open, ${verifying.length} in verification.`, bullets: [`${all.filter((p) => p.stage === "approval").length} reports are waiting for final approval.`, `${all.filter((p) => p.stage === "intake").length} new requests came in from the client portal.`, `${all.filter((p) => p.stage === "post_qc").length} cases are ready for Post-QC review.`], risks: ["Two cases are on hold waiting for client confirmation.", "Payment slips are waiting to be matched in Payments."], day: iso(new Date()) },
  });
  must(await service.from("ai_suggestions").insert(suggestions as never), "AI suggestions");
  for (let i = 0; i < runs.length; i += 200) must(await service.from("ai_runs").insert(runs.slice(i, i + 200) as never), "AI runs");

  // ------------------------------------------------------------ spread the dates over the last three months
  log("Spreading dates over the last three months");
  const timeline = all.map((p) => {
    const tat = p.pkg === "ESSENTIAL" ? 7 : p.pkg === "STANDARD" ? 7 : 10;
    // Open work: most cases are on track, a handful are late so the overdue views have something to show.
    const due = new Date(p.received.getTime() + tat * DAY);
    return { case_id: p.caseId, a: p.received.toISOString(), b: p.end.toISOString(), due: due.toISOString() };
  });
  const sql = backdateSql(timeline, ledger, quotes.map((q) => q.id), [...clientIds.values()]);
  runSql(sql);

  // The PDFs were drawn before the dates moved, so draw them again to match the case.
  log("Redrawing reports with their dates");
  const { buildReportFiles } = await import("../src/jobs/handlers/report-render");
  const redrawn: Record<string, unknown>[] = [];
  await mapLimit(toReport, 3, async (p) => {
    const { data: v } = await service.from("report_versions").select("id, case_id, org_id, version, kind, final_result, approved_by, approved_at, revision_reason").eq("case_id", p.caseId!).not("storage_path", "is", null).order("version", { ascending: false }).limit(1).single();
    if (!v) throw new Error(`no report for ${p.reference}`);
    const { snapshot, hash } = await currentSnapshot(service, p.caseId!);
    const built = await buildReportFiles(service, v as never, snapshot, { run: 2, heartbeat: async () => undefined, issue: 1 });
    redrawn.push({ id: v.id, snapshot, hash, path: built.path, sha256: built.sha256, pages: built.assembled.pages, size: built.assembled.bytes.byteLength });
  });
  runSql(`alter table public.report_versions disable trigger user;
    update public.report_versions v set snapshot = r.snapshot, snapshot_hash = r.hash, storage_path = r.path, sha256 = r.sha256, page_count = r.pages, size_bytes = r.size
      from jsonb_to_recordset('${JSON.stringify(redrawn).replace(/'/g, "''")}'::jsonb) as r(id uuid, snapshot jsonb, hash text, path text, sha256 text, pages int, size bigint) where v.id = r.id;
    alter table public.report_versions enable trigger user;`);
  const pushNote = "Hi Nimal, a couple of items are running past their due date. Could you take a look today, and tell me if anything is blocking you?";
  await A("ops").db.rpc("send_nudge", { p_to: A("staff").id, p_message: pushNote, p_channels: ["in_app"] });
  const second = await A("ops").db.rpc("send_nudge", { p_to: A("officer3").id, p_message: "Hi Kavindu, three checks are overdue this week. Is there anything I can help with?", p_channels: ["in_app"] });
  if (second.data) await A("officer3").db.rpc("acknowledge_nudge", { p_nudge: second.data as string, p_reply: "On it. The university replies tomorrow." });

  log("Performance history");
  for (let d = 95; d >= 1; d--) await service.rpc("performance_rollup", { p_day: iso(daysAgo(d)) });

  await drain("everything left in the queue");

  // ------------------------------------------------------------ hand-over
  const app = (arg("app") ?? process.env.APP_ORIGIN ?? "http://localhost:3200").replace(/\/+$/, "");
  const loginsPath = arg("logins");
  if (loginsPath) {
    const line = (k: string, what: string) => `| ${what} | \`${A(k).email}\` | \`${A(k).password}\` |`;
    const first = all.find((p) => p.client === "LHH" && p.stage === "released");
    writeFileSync(
      loginsPath,
      [
        "# Ontriq demo sign-ins",
        "",
        "Throwaway accounts for showing the system. This file is git-ignored; delete it when the demo data is removed.",
        "",
        `Sign in at ${app}/login`,
        "",
        "| Who | Email | Password |",
        "|---|---|---|",
        line("super", "Super Admin (Nadeesha Wickramasinghe)"),
        line("admin", "Admin (Amaya Perera)"),
        line("ops", "Operations Manager (Ruwan Herath): approves reports"),
        line("relations", "Client Relations (Shehani de Silva): quotes and invoices"),
        line("qc", "QC Officer (Priyanka Nair): Pre-QC and Post-QC"),
        line("entry", "Data Entry Officer (Mohamed Rizwan)"),
        line("staff", "Verification Officer (Nimal Fernando)"),
        line("viewer", "Viewer (Sunil Gamage): read only"),
        line("client", "Client Admin: Lanka Horizon Holdings (Dilani Jayawardena)"),
        line("clientuser", "Client User: Lanka Horizon Holdings (Kamal Rodrigo)"),
        line("clientviewer", "Client Viewer: Lanka Horizon Holdings (Anoma Peiris)"),
        line("aurora", "Client Admin: Aurora Lanka Finance (Rohan Abeysekera)"),
        "",
        "Your own Super Admin login sees everything, including the Command page.",
        "",
        "## More to show",
        "",
        demoLink ? `- **Candidate's page, no login:** ${app}/c/${demoLink}` : "",
        first ? `- **A released report for Lanka Horizon:** ${first.reference}` : "",
        "",
        "## Taking it all out",
        "",
        "```bash",
        "npx tsx scripts/seed-demo.ts --env .env.hosted --clean",
        "```",
        "",
      ].join("\n"),
    );
    chmodSync(loginsPath, 0o600);
    console.log(`Sign-ins written to ${loginsPath}`);
  }
  console.log(`Done: ${CLIENTS.length} clients, ${all.length} cases, ${ledger.length} invoices sent, ${suggestions.length} AI suggestions.`);
}

// ---------------------------------------------------------------- dates (runs as SQL: confirmed rows are locked to the app)

function backdateSql(timeline: { case_id?: string; a: string; b: string; due: string }[], ledger: { id: string; issued: string; due: string; paidOn: string | null }[], quoteIds: string[], clientIds: string[]) {
  const q = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  const tables = ["cases", "case_checks", "documents", "report_versions", "invoices", "invoice_items", "quotes", "quote_items", "consent_forms", "candidate_requests", "clients", "payments"];
  const map = (col: string) => `${col} = case when ${col} is null then null else w.a + (w.b - w.a) * power(least(1, greatest(0, extract(epoch from ${col} - w.s0) / nullif(extract(epoch from w.s1 - w.s0), 0))), 0.3) end`;
  return `
do $$
declare t text;
begin
  foreach t in array array[${tables.map((x) => `'${x}'`).join(", ")}] loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  create temp table _w on commit drop as
    select d.case_id, d.a, d.b, d.due, c.created_at as s0,
           greatest(c.created_at + interval '1 second', (select max(e.at) from public.case_events e where e.case_id = d.case_id)) as s1
      from jsonb_to_recordset(${q(timeline)}) as d(case_id uuid, a timestamptz, b timestamptz, due timestamptz)
      join public.cases c on c.id = d.case_id;

  update public.stage_history x set ${map("at")} from _w w where x.case_id = w.case_id;
  update public.case_events x set ${map("at")} from _w w where x.case_id = w.case_id;
  update public.assignment_events x set ${map("at")} from _w w where x.case_id = w.case_id;
  update public.qc_reviews x set ${map("created_at")} from _w w where x.case_id = w.case_id;
  update public.documents x set ${map("created_at")}, ${map("updated_at")} from _w w where x.case_id = w.case_id;
  update public.report_versions x set ${map("created_at")}, ${map("updated_at")}, ${map("approved_at")}, ${map("released_at")} from _w w where x.case_id = w.case_id;
  update public.candidate_requests x set ${map("created_at")}, ${map("answered_at")} from _w w where x.case_id = w.case_id;
  update public.candidate_messages x set ${map("created_at")} from _w w where x.case_id = w.case_id;
  update public.consent_forms x set ${map("created_at")}, ${map("signed_at")} from _w w where x.case_id = w.case_id;
  update public.notifications x set ${map("created_at")} from _w w where x.entity_id = w.case_id;
  update public.ai_suggestions x set created_at = w.b from _w w where x.entity_id = w.case_id or x.entity_id in (select k.id from public.case_checks k where k.case_id = w.case_id);
  update public.case_checks x set ${map("created_at")}, ${map("assigned_at")}, ${map("started_at")}, ${map("completed_at")}, ${map("updated_at")}, due_at = w.due from _w w where x.case_id = w.case_id;
  update public.cases x set ${map("assigned_at")}, ${map("completed_at")}, ${map("released_at")}, ${map("cancelled_at")}, ${map("held_at")}, ${map("returned_at")}, due_at = w.due, received_at = w.a, created_at = w.a, updated_at = w.b from _w w where x.id = w.case_id;

  update public.invoices i set issue_date = l.issued, due_date = l.due, created_at = l.issued::timestamptz, sent_at = l.issued::timestamptz + interval '9 hours',
         paid_at = case when i.status = 'paid' then coalesce(l."paidOn", l.issued)::timestamptz else null end
    from jsonb_to_recordset(${q(ledger)}) as l(id uuid, issued date, due date, "paidOn" date) where i.id = l.id;
  update public.invoice_events e set at = i.created_at + interval '1 hour' from public.invoices i where e.invoice_id = i.id;
  update public.payments p set created_at = p.paid_on::timestamptz + interval '10 hours' where p.invoice_id in (select (x ->> 'id')::uuid from jsonb_array_elements(${q(ledger)}) x);

  update public.quotes q set created_at = now() - interval '100 days', sent_at = case when sent_at is null then null else now() - interval '99 days' end,
         viewed_at = case when viewed_at is null then null else now() - interval '98 days' end, accepted_at = case when accepted_at is null then null else now() - interval '96 days' end
   where q.id = any (array[${quoteIds.map((x) => `'${x}'`).join(", ")}]::uuid[]) and q.status in ('accepted', 'declined');
  update public.client_price_lists p set valid_from = (now() - interval '96 days')::date where p.source_quote_id = any (array[${quoteIds.map((x) => `'${x}'`).join(", ")}]::uuid[]);
  update public.clients c set created_at = now() - interval '110 days' where c.id = any (array[${clientIds.map((x) => `'${x}'`).join(", ")}]::uuid[]);

  foreach t in array array[${tables.map((x) => `'${x}'`).join(", ")}] loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;
`;
}

function runSql(sql: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "ontriq-demo-"));
  const file = path.join(dir, "demo.sql");
  writeFileSync(file, sql);
  const dbUrl = arg("db-url");
  if (dbUrl) execFileSync("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  else execFileSync("supabase", ["db", "query", "--linked", "--file", file], { stdio: ["ignore", "ignore", "inherit"] });
}

// ---------------------------------------------------------------- clean-up

async function clean() {
  const { data: clients } = await service.from("clients").select("id").like("notes", "[demo-seed]%");
  const ids = (clients ?? []).map((c) => c.id);
  const { data: cases } = ids.length ? await service.from("cases").select("id, candidate_id").in("client_id", ids) : { data: [] };
  const caseIds = (cases ?? []).map((c) => c.id);
  const candidateIds = [...new Set((cases ?? []).map((c) => c.candidate_id))];
  const remove = async (bucket: string, paths: (string | null)[]) => {
    const list = paths.filter(Boolean) as string[];
    for (let i = 0; i < list.length; i += 100) await service.storage.from(bucket).remove(list.slice(i, i + 100));
  };
  const chunks = <T,>(list: T[], n = 100) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
  console.log(`Removing ${ids.length} clients and ${caseIds.length} cases`);

  if (ids.length) {
    const { data: invoices } = await service.from("invoices").select("id").in("client_id", ids);
    const { data: quotes } = await service.from("quotes").select("id").in("client_id", ids);
    const { data: pays } = await service.from("payments").select("id").in("client_id", ids);
    const { data: notes } = await service.from("credit_notes").select("id").in("client_id", ids);
    const { data: slips } = await service.from("payment_slips").select("id, storage_path").in("client_id", ids);
    const entityIds = [...(invoices ?? []), ...(quotes ?? []), ...(pays ?? []), ...(notes ?? [])].map((x) => x.id);
    for (const part of chunks(entityIds)) {
      const { data: gd } = await service.from("generated_documents").select("id, storage_path").in("entity_id", part);
      await remove("documents", (gd ?? []).map((g) => g.storage_path));
      await service.from("generated_documents").delete().in("id", (gd ?? []).map((g) => g.id));
      await service.from("jobs").delete().in("entity_id", (gd ?? []).map((g) => g.id));
    }
    await remove("documents", (slips ?? []).map((s) => s.storage_path));
    await service.from("payments").delete().in("client_id", ids);
    await service.from("credit_notes").delete().in("client_id", ids);
    await service.from("payment_slips").delete().in("client_id", ids);
    await service.from("invoices").delete().in("client_id", ids);
    await service.from("client_price_lists").delete().in("client_id", ids);
    await service.from("quotes").delete().in("client_id", ids);
  }
  for (const part of chunks(caseIds)) {
    const { data: docs } = await service.from("documents").select("id, storage_bucket, storage_path").in("case_id", part);
    for (const bucket of new Set((docs ?? []).map((d) => d.storage_bucket))) await remove(bucket, (docs ?? []).filter((d) => d.storage_bucket === bucket).map((d) => d.storage_path));
    const { data: reports } = await service.from("report_versions").select("storage_path").in("case_id", part);
    await remove("reports", (reports ?? []).map((r) => r.storage_path));
    const { data: checks } = await service.from("case_checks").select("id").in("case_id", part);
    for (const ids2 of chunks([...part, ...(checks ?? []).map((k) => k.id), ...(docs ?? []).map((d) => d.id)], 40)) {
      await service.from("ai_suggestions").delete().in("entity_id", ids2);
      await service.from("jobs").delete().in("entity_id", ids2);
    }
    await service.from("ai_runs").delete().in("case_id", part);
    await service.from("cases").delete().in("id", part);
  }
  await service.from("ai_runs").delete().eq("source", "demo-seed");
  await service.from("ai_suggestions").delete().contains("source_refs", ["demo-seed"]);
  for (const part of chunks(candidateIds)) await service.from("candidates").delete().in("id", part);
  if (ids.length) await service.from("clients").delete().in("id", ids);

  const { data: people } = await service.auth.admin.listUsers({ perPage: 1000 });
  const demoUsers = (people?.users ?? []).filter((u) => (u.app_metadata as { demo?: boolean } | undefined)?.demo);
  for (const u of demoUsers) await service.auth.admin.deleteUser(u.id);

  await service.from("package_items").update({ unit_price: 0 }).in("package_id", ((await service.from("packages").select("id").eq("org_id", ORG).eq("owner_scope", "org")).data ?? []).map((p) => p.id));
  const year = new Date().getFullYear();
  // A number series goes back to the start only when nothing in it remains.
  const left: Record<string, number> = {
    quote: (await service.from("quotes").select("id", { count: "exact", head: true }).not("number", "is", null)).count ?? 0,
    invoice: (await service.from("invoices").select("id", { count: "exact", head: true }).not("number", "is", null)).count ?? 0,
    receipt: (await service.from("payments").select("id", { count: "exact", head: true })).count ?? 0,
    credit_note: (await service.from("credit_notes").select("id", { count: "exact", head: true })).count ?? 0,
  };
  for (const [kind, n] of Object.entries(left)) {
    if (n === 0) await service.from("document_counters").delete().eq("org_id", ORG).eq("kind", kind).eq("year", year);
    else console.log(`Kept the ${kind} numbering: ${n} other record(s) remain.`);
  }
  const { data: rest } = await service.from("cases").select("reference").eq("org_id", ORG).like("reference", `ONT-${year}-%`);
  const max = Math.max(0, ...(rest ?? []).map((r) => Number(r.reference.split("-").pop())));
  if (max === 0) await service.from("case_counters").delete().eq("org_id", ORG).eq("year", year);
  else await service.from("case_counters").update({ value: max }).eq("org_id", ORG).eq("year", year);
  await service.from("staff_performance_daily").delete().eq("org_id", ORG);
  console.log(`Removed ${demoUsers.length} demo sign-ins; numbering and prices are back to their starting point.`);
}

(process.argv.includes("--clean") ? clean() : seed())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
