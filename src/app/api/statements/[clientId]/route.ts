import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { clientIp, rateLimit } from "@/lib/server/request-meta";
import { toCsv, type CsvCell } from "@/domain/analytics/csv";
import { issuerFromBranding, statementModel, type TemplateKey } from "@/domain/documents/model";
import { renderDocumentPdf } from "@/jobs/documents/templates";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * A client's statement of account. public.client_statement (0015) checks the
 * caller (finance staff, or the client's own users with invoice access).
 *   /api/statements/<client>?from=YYYY-MM-DD&to=YYYY-MM-DD            PDF
 *   /api/statements/<client>?from=…&to=…&format=csv                    CSV
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/statements/[clientId]">) {
  await connection();
  const { clientId } = await ctx.params;
  const state = await loadViewerState();
  if (state.state !== "ready") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  // A statement is rendered on demand (PDF): limit how often one person can ask.
  if (!(await rateLimit(`statement:${state.viewer.userId}:${await clientIp()}`, 600, 30))) return NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429, headers: PRIVATE });
  const sp = request.nextUrl.searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = isDate(sp.get("to")) ?? today;
  const from = isDate(sp.get("from")) ?? `${to.slice(0, 4)}-01-01`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_statement", { p_client: clientId, p_from: from, p_to: to });
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  const st = data as { client: { name: string; code: string }; opening: number; closing: number; lines: { date: string; kind: string; reference: string; debit: number; credit: number; balance: number }[] };

  if (sp.get("format") === "csv") {
    const rows: CsvCell[][] = [["Date", "Type", "Reference", "Debit", "Credit", "Balance"], ["", "Opening balance", "", "", "", st.opening], ...st.lines.map((l) => [l.date, l.kind, l.reference, l.debit || "", l.credit || "", l.balance])];
    return new NextResponse(toCsv(rows), {
      headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="statement-${st.client.code}-${from}-${to}.csv"` },
    });
  }

  const admin = createAdminClient();
  const [{ data: org }, { data: client }] = await Promise.all([
    admin.from("orgs").select("name, branding").eq("id", state.viewer.orgId).single(),
    admin.from("clients").select("name, address, email, phone, default_template").eq("id", clientId).single(),
  ]);
  const model = statementModel({
    issuer: issuerFromBranding({ name: org?.name ?? "Ontriq", branding: (org?.branding ?? {}) as Record<string, unknown> }),
    client: { name: client?.name ?? st.client.name, address: (client?.address ?? null) as Record<string, string> | null, email: client?.email ?? null },
    currency: "LKR",
    statement: { from, to, opening: Number(st.opening), closing: Number(st.closing), lines: st.lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), balance: Number(l.balance) })) },
  });
  const template = (["executive", "modern", "classic"].includes(client?.default_template ?? "") ? client?.default_template : "executive") as TemplateKey;
  const pdf = await renderDocumentPdf(model, template);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `${sp.get("download") === "1" ? "attachment" : "inline"}; filename="statement-${st.client.code}-${to}.pdf"` },
  });
}
