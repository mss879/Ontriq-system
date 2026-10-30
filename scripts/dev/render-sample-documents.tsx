/**
 * Development helper: render a sample quotation and invoice in every design.
 *   npx tsx scripts/dev/render-sample-documents.tsx <out-dir>
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { invoiceModel, issuerFromBranding, quoteModel, TEMPLATE_KEYS } from "../../src/domain/documents/model";
import { renderDocumentPdf } from "../../src/jobs/documents/templates";

const issuer = issuerFromBranding({
  name: "Ontriq (Pvt) Ltd",
  branding: { display_name: "Ontriq", legal_name: "Ontriq (Pvt) Ltd", address: "107 Colombo - Galle Main Rd, Dehiwala-Mount Lavinia", phone: "+94 77 999 6940", email: "info@ontriq.com", website: "https://www.ontriq.com" },
});
const client = { name: "Hemas Holdings PLC", address: { line1: "36 Bristol Street", city: "Colombo 01", country: "Sri Lanka" }, email: "hr@hemas.lk", phone: null };
const items = [
  { description: "Comprehensive package (7 checks) per candidate", quantity: 1, unit_price: 18500, discount_pct: 10, total: 16650 },
  { description: "Reference check (additional referee)", quantity: 2, unit_price: 2500, discount_pct: 0, total: 5000 },
  { description: "Global sanction screening", quantity: 1, unit_price: 3000, discount_pct: 0, total: 3000 },
];

async function main() {
  const out = process.argv[2] ?? ".";
  for (const t of TEMPLATE_KEYS) {
    const q = quoteModel({
      issuer,
      client,
      contact: { name: "Nadeesha Perera", title: "Head of Talent", email: "nadeesha@hemas.lk" },
      quote: {
        number: "QT-2026-0007", version: 1, status: "sent", title: "Background verification services for 2027", currency: "LKR", issue_date: "2026-10-30", valid_until: "2026-11-29",
        payment_terms_days: 30, intro: "Thank you for the opportunity to support Hemas with pre-employment screening. This quotation covers the checks your team asked about and the turnaround we commit to.",
        scope: "Identity, education, employment, address, police clearance, two referees and global sanction screening for each candidate, with a consolidated report and annexures.",
        assumptions: "Candidates provide documents within three working days of our request. Police clearance timelines depend on the station.", tat_text: "Seven working days from receipt of all documents; NIC checks within two working days.",
        closing: "We look forward to working with you.", subtotal: 26500, discount_total: 1850, total: 24650,
      },
      items,
      tiers: [{ min_volume: 51, max_volume: 200, discount_pct: 5, note: "applied monthly" }, { min_volume: 201, max_volume: null, discount_pct: 10, note: "" }],
    });
    writeFileSync(path.join(out, `quote-${t}.pdf`), await renderDocumentPdf(q, t));
  }
  const inv = invoiceModel({
    issuer,
    client,
    contact: null,
    invoice: { number: "INV-2026-0012", status: "partially_paid", currency: "LKR", issue_date: "2026-10-30", due_date: "2026-11-29", period_from: null, period_to: null, message: "Thank you for your business.", subtotal: 26500, discount_total: 1850, net_total: 24650, tax_lines: [{ code: "VAT", name: "VAT", rate: 18, inclusive: false, amount: 4437 }], total: 29087, amount_paid: 10000, amount_credited: 0, balance: 19087 },
    items,
  });
  writeFileSync(path.join(out, "invoice-modern.pdf"), await renderDocumentPdf(inv, "modern"));
  console.log("done");
}
main();
