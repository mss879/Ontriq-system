import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { can } from "@/domain/permissions";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * A client's payment slip, for finance staff matching it (payments.record).
 * The row is read through row level security first; then a 60-second signed URL.
 *   /api/slips/<id>             view inline
 *   /api/slips/<id>?download=1  save with the original filename
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/slips/[slipId]">) {
  await connection();
  const { slipId } = await ctx.params;
  const state = await loadViewerState();
  if (state.state !== "ready" || state.viewer.kind !== "staff" || !can(state.viewer, "payments.record")) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  }
  const supabase = await createClient();
  const { data: slip } = await supabase.from("payment_slips").select("storage_bucket, storage_path, filename, status").eq("id", slipId).maybeSingle();
  if (!slip || slip.status === "pending_upload") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const signed = await createAdminClient().storage.from(slip.storage_bucket).createSignedUrl(slip.storage_path, 60, download ? { download: slip.filename } : undefined);
  if (signed.error || !signed.data) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: PRIVATE });
}
