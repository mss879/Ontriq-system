import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse, exportViewer, PRIVATE } from "@/lib/server/analytics/exports";
import { fetchAi, fetchOperations, fetchRevenue } from "@/lib/server/analytics/queries";
import { analyticsAccess } from "@/domain/analytics/access";
import { csvFilename } from "@/domain/analytics/csv";
import { parsePeriod } from "@/domain/analytics/period";
import { aiCsv, operationsCsv, revenueCsv } from "@/domain/analytics/shape";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One Analytics tab as CSV: /api/exports/analytics?section=operations|revenue|ai
 * with the page's period (period, from, to) and client. The 0034 functions
 * decide access; this only turns their summary into rows.
 */
export async function GET(request: NextRequest) {
  await connection();
  const sp = request.nextUrl.searchParams;
  const section = sp.get("section") ?? "operations";
  if (!["operations", "revenue", "ai"].includes(section)) return NextResponse.json({ error: "Unknown section." }, { status: 400, headers: PRIVATE });
  const viewer = await exportViewer((v) => analyticsAccess(v)[section as "operations" | "revenue" | "ai"]);
  if (viewer instanceof Response) return viewer;

  const period = parsePeriod(Object.fromEntries(sp.entries()));
  const rawClient = sp.get("client");
  const client = rawClient && UUID.test(rawClient) ? rawClient : null;
  const supabase = await createClient();
  try {
    if (section === "revenue") {
      const d = await fetchRevenue(supabase, period.from, period.to, client);
      if (!d) return NextResponse.json({ error: "You don't have access to this export." }, { status: 403, headers: PRIVATE });
      return csvResponse(revenueCsv(d), csvFilename("revenue", period.from, "to", period.to));
    }
    if (section === "ai") {
      const d = await fetchAi(supabase, period.from, period.to);
      if (!d) return NextResponse.json({ error: "You don't have access to this export." }, { status: 403, headers: PRIVATE });
      return csvResponse(aiCsv(d), csvFilename("ai-cost", period.from, "to", period.to));
    }
    const d = await fetchOperations(supabase, period.from, period.to, client);
    if (!d) return NextResponse.json({ error: "You don't have access to this export." }, { status: 403, headers: PRIVATE });
    return csvResponse(operationsCsv(d), csvFilename("operations", period.from, "to", period.to));
  } catch {
    return NextResponse.json({ error: "The export isn't available right now." }, { status: 503, headers: PRIVATE });
  }
}
