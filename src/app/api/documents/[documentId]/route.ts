import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * A generated PDF (quotation, invoice, receipt, credit note). The row is read
 * as the signed-in person, so row level security decides: staff in the org,
 * or the client company it was sent to (0014/0015 client_can_see_document).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/documents/[documentId]">) {
  await connection();
  const { documentId } = await ctx.params;
  const state = await loadViewerState();
  if (state.state !== "ready") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });
  const supabase = await createClient();
  const { data: doc } = await supabase.from("generated_documents").select("id, title, status, storage_path, kind").eq("id", documentId).maybeSingle();
  if (!doc?.storage_path || doc.status !== "ready") return NextResponse.json({ error: "not ready" }, { status: 404, headers: PRIVATE });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `${(doc.title || doc.kind).split(" · ")[0].replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  const signed = await createAdminClient().storage.from("documents").createSignedUrl(doc.storage_path, 60, download ? { download: filename } : undefined);
  if (signed.error || !signed.data) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: PRIVATE });
}
