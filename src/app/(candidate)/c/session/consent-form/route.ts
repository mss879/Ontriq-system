import { connection, NextResponse } from "next/server";
import { loadCandidateView, readCandidateSession } from "@/lib/server/candidate/session";
import { buildConsentPdf } from "@/lib/server/candidate/consent-pdf";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

/** The consent form as a PDF for the signed-in candidate, filled with their case details. */
export async function GET() {
  await connection();
  const session = await readCandidateSession();
  const view = session ? await loadCandidateView(session.linkId) : null;
  if (!view) return NextResponse.json({ error: "This link has expired." }, { status: 401, headers: PRIVATE });
  const pdf = await buildConsentPdf(view);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      ...PRIVATE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ontriq-consent-form-${view.case.reference}.pdf"`,
    },
  });
}
