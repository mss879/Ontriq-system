import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { clientIp } from "@/lib/server/request-meta";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Open or download a report version. public.report_download (0012) decides:
 * staff with reports.preview on the case, or the client's users for the
 * released version. It logs the download; then a 60-second signed URL.
 *   /api/reports/<id>             view inline
 *   /api/reports/<id>?download=1  save as <reference>.pdf
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/reports/[versionId]">) {
  await connection();
  const { versionId } = await ctx.params;
  const state = await loadViewerState();
  if (state.state !== "ready") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_download", { p_version: versionId, p_ip: await clientIp() });
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  const file = data as { bucket: string; path: string; filename: string };
  const download = request.nextUrl.searchParams.get("download") === "1";
  const signed = await createAdminClient().storage.from(file.bucket).createSignedUrl(file.path, 60, download ? { download: file.filename } : undefined);
  if (signed.error || !signed.data) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: PRIVATE });
}
