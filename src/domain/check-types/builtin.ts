/**
 * The seven checks Ontriq runs today (requirements §4 and the BGV flowchart),
 * as check type schemas. They ship as data in 0024_seed_catalog.sql and stay
 * editable in Settings → Check types; tests/unit/check-types.test.ts keeps the
 * migration in step with this file. Pure module.
 */
import { DEFAULT_RESULT_OPTIONS, type CheckTypeSchemaInput } from "./schema";

export type DocumentCategory = {
  key: string;
  name: string;
  /** Plain-language guidance shown to clients and candidates when uploading. */
  guide: string;
  /** Only staff with "View sensitive evidence" may open these. */
  sensitive: boolean;
  sort: number;
};

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  { key: "cv", name: "CV / résumé", guide: "The candidate's latest CV, as a PDF or a clear photo of each page.", sensitive: false, sort: 10 },
  { key: "consent_form", name: "Signed consent form", guide: "The consent and authorisation form, signed by the candidate. A clear photo of the signed page is fine.", sensitive: false, sort: 20 },
  { key: "nic_copy", name: "NIC copy", guide: "Both sides of the National Identity Card, readable and uncropped.", sensitive: false, sort: 30 },
  { key: "education_certificate", name: "Education certificate", guide: "O/L, A/L, diploma or degree certificates. Upload each certificate separately.", sensitive: false, sort: 40 },
  { key: "transcript", name: "Academic transcript", guide: "The transcript or results sheet issued by the institution, if available.", sensitive: false, sort: 50 },
  { key: "service_letter", name: "Service letter", guide: "A service or experience letter from each previous employer.", sensitive: false, sort: 60 },
  { key: "resignation_letter", name: "Resignation and acceptance letters", guide: "The resignation letter and the employer's acceptance, if you have them.", sensitive: false, sort: 70 },
  { key: "gn_certificate", name: "Grama Niladhari certificate", guide: "The residence certificate issued by your Grama Niladhari.", sensitive: false, sort: 80 },
  { key: "field_verification", name: "Field verification record", guide: "Photos and notes from the address visit (Ontriq staff).", sensitive: false, sort: 90 },
  { key: "police_report", name: "Police clearance report", guide: "The police clearance report or the station's confirmation.", sensitive: true, sort: 100 },
  { key: "reference_form", name: "Reference form", guide: "Completed reference forms or written feedback from referees.", sensitive: false, sort: 110 },
  { key: "sanction_report", name: "Global sanction screening report", guide: "The screening platform's report (for example Cfirst), attached to the final report unchanged.", sensitive: true, sort: 120 },
  { key: "other", name: "Other document", guide: "Anything else that supports a check.", sensitive: false, sort: 999 },
];

export type BuiltinCheckType = { key: string; name: string; description: string; icon: string; sort: number; schema: CheckTypeSchemaInput };

const staffOnly = { client: false, report: false, candidate: false };
const reportOnly = { client: false, report: true, candidate: false };
const shared = { client: true, report: true, candidate: true };

export const BUILTIN_CHECK_TYPES: BuiltinCheckType[] = [
  {
    key: "education",
    name: "Education",
    description: "Confirms qualifications with the issuing school, university or institute.",
    icon: "graduation-cap",
    sort: 10,
    schema: {
      fields: [
        { key: "candidate_name", label: "Candidate name (as on certificate)", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "qualification_level", label: "Level", type: "select", required: true, visibility: shared, options: [
          { value: "ol", label: "G.C.E. O/L" },
          { value: "al", label: "G.C.E. A/L" },
          { value: "diploma", label: "Diploma" },
          { value: "degree", label: "Degree" },
          { value: "postgraduate", label: "Postgraduate" },
          { value: "professional", label: "Professional qualification" },
          { value: "other", label: "Other" },
        ] },
        { key: "qualification", label: "Degree or qualification", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "institution", label: "Institution", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "student_number", label: "Student, roll or index number", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "year_of_completion", label: "Year of completion", type: "number", required: true, visibility: shared, validation: { min: 1950, max: 2100 }, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "confirmed_by", label: "Confirmed by (name and title)", type: "text", visibility: reportOnly },
        { key: "confirmation_channel", label: "Confirmation channel", type: "select", visibility: reportOnly, options: [
          { value: "email", label: "Email" },
          { value: "letter", label: "Letter" },
          { value: "phone", label: "Phone" },
          { value: "portal", label: "Online verification portal" },
          { value: "in_person", label: "In person" },
        ] },
        { key: "confirmed_on", label: "Confirmed on", type: "date", visibility: reportOnly },
      ],
      documents: [
        { category: "education_certificate", label: "Certificates", description: "O/L, A/L, diploma or degree certificates.", min: 1, client_visible: true },
        { category: "transcript", label: "Transcript", min: 0 },
      ],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 7,
    },
  },
  {
    key: "employment",
    name: "Employment",
    description: "Confirms each previous employer, role, dates and employment type with HR.",
    icon: "briefcase",
    sort: 20,
    schema: {
      fields: [
        { key: "candidate_name", label: "Candidate name", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"] },
        {
          key: "employers",
          label: "Employment history",
          type: "repeatable_group",
          required: true,
          width: "full",
          visibility: shared,
          group: { min: 1, max: 10, item_label: "Employer" },
          fields: [
            { key: "company", label: "Company", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
            { key: "designation", label: "Designation", type: "text", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
            { key: "period", label: "Period of employment", type: "date_range", required: true, visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
            { key: "employee_code", label: "Employee code or NIC", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "employment_type", label: "Employment type", type: "select", required: true, visibility: shared, options: [
              { value: "permanent", label: "Permanent" },
              { value: "temporary", label: "Temporary" },
              { value: "internship", label: "Internship" },
              { value: "contract", label: "Contract" },
            ] },
            { key: "hr_contact", label: "HR contact person", type: "text", visibility: staffOnly },
            { key: "hr_email", label: "HR email", type: "email", visibility: staffOnly },
            { key: "hr_phone", label: "HR phone", type: "phone", visibility: staffOnly },
            { key: "reason_for_leaving", label: "Reason for leaving", type: "textarea", visibility: reportOnly },
            { key: "confirmed_by", label: "Confirmed by", type: "text", visibility: reportOnly },
          ],
        },
      ],
      documents: [
        { category: "service_letter", label: "Service letters", description: "One per previous employer.", min: 1, client_visible: true },
        { category: "resignation_letter", label: "Resignation and acceptance letters", min: 0 },
      ],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 7,
    },
  },
  {
    key: "address",
    name: "Address",
    description: "Confirms where the candidate lives, with the Grama Niladhari and a field visit when needed.",
    icon: "map-pin",
    sort: 30,
    schema: {
      fields: [
        { key: "address", label: "Address", type: "address", required: true, width: "full", visibility: shared, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "district", label: "District", type: "district", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
        { key: "residence_period", label: "Period of residency", type: "date_range", required: true, visibility: shared, fill_by: ["staff", "candidate"] },
        { key: "verified_by", label: "Verified by", type: "text", required: true, visibility: reportOnly },
        { key: "gn_name", label: "Grama Niladhari name", type: "text", visibility: reportOnly },
        { key: "gn_division", label: "Grama Niladhari division", type: "text", visibility: reportOnly },
        { key: "gn_contact", label: "Grama Niladhari contact", type: "phone", visibility: staffOnly },
        { key: "visit_date", label: "Field visit date", type: "date", visibility: reportOnly },
        { key: "visit_notes", label: "Field visit notes", type: "textarea", width: "full", visibility: reportOnly },
      ],
      documents: [
        { category: "gn_certificate", label: "Grama Niladhari certificate", min: 1 },
        { category: "field_verification", label: "Field verification record", min: 0, stage: "verification" },
      ],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 5,
      location_bound: true,
    },
  },
  {
    key: "police",
    name: "Criminal / police clearance",
    description: "Police clearance for the candidate's area of residence, confirmed with the station.",
    icon: "shield",
    sort: 40,
    schema: {
      fields: [
        { key: "nic", label: "NIC number", type: "nic", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
        { key: "permanent_address", label: "Permanent address", type: "address", required: true, width: "full", visibility: reportOnly, fill_by: ["staff", "candidate"] },
        { key: "district", label: "District", type: "district", visibility: reportOnly, fill_by: ["staff", "candidate"] },
        { key: "residence_period", label: "Period of residency", type: "date_range", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
        { key: "police_station_area", label: "Police station area", type: "text", required: true, visibility: reportOnly },
        { key: "verified_by", label: "Verified by", type: "text", required: true, visibility: reportOnly },
        { key: "oic_name", label: "OIC name", type: "text", visibility: reportOnly },
        { key: "station_contact", label: "Station contact number", type: "phone", visibility: staffOnly },
      ],
      documents: [{ category: "police_report", label: "Police clearance report", min: 1, stage: "verification" }],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 10,
      location_bound: true,
    },
  },
  {
    key: "nic",
    name: "NIC verification",
    description: "Validates the National Identity Card against official sources.",
    icon: "id-card",
    sort: 50,
    schema: {
      fields: [
        { key: "nic_number", label: "NIC number", type: "nic", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"], ai: { extract: true } },
        { key: "name_on_nic", label: "Name on NIC", type: "text", required: true, visibility: reportOnly, ai: { extract: true } },
        { key: "date_of_birth", label: "Date of birth", type: "date", visibility: reportOnly, ai: { extract: true } },
        { key: "validation_source", label: "Validated through", type: "select", required: true, visibility: reportOnly, options: [
          { value: "drp", label: "Department for Registration of Persons" },
          { value: "online", label: "Official online validation" },
          { value: "physical", label: "Physical inspection of the card" },
        ] },
      ],
      documents: [{ category: "nic_copy", label: "NIC copy (both sides)", min: 1, client_visible: true }],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 2,
    },
  },
  {
    key: "reference",
    name: "Reference check",
    description: "Speaks to two referees about the candidate's work and conduct.",
    icon: "users",
    sort: 60,
    schema: {
      fields: [
        {
          key: "referees",
          label: "Referees",
          type: "repeatable_group",
          required: true,
          width: "full",
          visibility: reportOnly,
          group: { min: 2, max: 2, item_label: "Referee" },
          fields: [
            { key: "full_name", label: "Full name", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "current_employer", label: "Current employer", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "current_job_title", label: "Current job title", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "worked_together_at", label: "Company where they worked with the candidate", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "relationship", label: "Relationship to the candidate", type: "select", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"], options: [
              { value: "line_manager", label: "Line manager" },
              { value: "senior_colleague", label: "Senior colleague" },
              { value: "colleague", label: "Colleague" },
              { value: "client", label: "Client" },
              { value: "academic", label: "Academic" },
              { value: "other", label: "Other" },
            ] },
            { key: "acquaintance_duration", label: "Known the candidate for", type: "text", required: true, visibility: reportOnly, fill_by: ["staff", "candidate"] },
            { key: "contact_number", label: "Contact number", type: "phone", required: true, visibility: staffOnly, fill_by: ["staff", "candidate"] },
            { key: "email", label: "Email", type: "email", required: true, visibility: staffOnly, fill_by: ["staff", "candidate"] },
            { key: "feedback", label: "Feedback", type: "textarea", visibility: reportOnly },
          ],
        },
      ],
      documents: [{ category: "reference_form", label: "Reference forms or feedback", min: 0, stage: "verification" }],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 5,
    },
  },
  {
    key: "sanction",
    name: "Global sanction screening",
    description: "Screens the candidate against international sanction and watch lists.",
    icon: "globe",
    sort: 70,
    schema: {
      fields: [
        { key: "sanctions_found", label: "Sanctions found", type: "select", required: true, visibility: reportOnly, options: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ] },
        { key: "details", label: "Details", type: "textarea", width: "full", visibility: reportOnly },
        { key: "screening_platform", label: "Screening platform", type: "text", visibility: reportOnly, placeholder: "Cfirst" },
        { key: "screened_on", label: "Screened on", type: "date", visibility: reportOnly },
      ],
      documents: [{ category: "sanction_report", label: "Screening report", min: 1, stage: "verification" }],
      result: { options: DEFAULT_RESULT_OPTIONS },
      sla_days: 2,
      fixed_annexure: { category: "sanction_report", untouched: true },
    },
  },
];

/** Packages Ontriq starts with. Prices are left at 0 until Ontriq sets them. */
export const BUILTIN_PACKAGES = [
  { code: "ESSENTIAL", name: "Essential", description: "Identity and police clearance for fast, high-volume hiring.", tat_days: 7, checks: ["nic", "police"], sort: 10 },
  { code: "STANDARD", name: "Standard", description: "Identity, education and employment history.", tat_days: 7, checks: ["nic", "education", "employment"], sort: 20 },
  { code: "COMPREHENSIVE", name: "Comprehensive", description: "All seven checks, for senior and sensitive roles.", tat_days: 10, checks: ["nic", "education", "employment", "address", "police", "reference", "sanction"], sort: 30 },
] as const;
