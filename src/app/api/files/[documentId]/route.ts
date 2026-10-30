import { connection, NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadViewerState } from "@/lib/server/viewer";
import { clientIp } from "@/lib/server/request-meta";

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Open or download a case document. The row is read as the signed-in person,
 * so row level security decides access (sensitive evidence for staff, shared
 * documents and their own uploads for client users); then
 * the view is logged and the browser is sent to a 60-second signed URL.
 *   /api/files/<id>            view inline
 *   /api/files/<id>?download=1 save as the original filename
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[documentId]">) {
  await connection();
  const { documentId } = await ctx.params;
  const state = await loadViewerState();
  // Staff and client users alike: row level security (documents_select, documents_select_client) decides.
  if (state.state !== "ready") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_bucket, storage_path, filename, status")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.status === "pending_upload") return NextResponse.json({ error: "not found" }, { status: 404, headers: PRIVATE });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const signed = await createAdminClient()
    .storage.from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, 60, download ? { download: doc.filename } : undefined);
  if (signed.error || !signed.data) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE });

  await supabase.rpc("log_document_access", { p_document: doc.id, p_action: download ? "download" : "view", p_ip: await clientIp() });
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: PRIVATE });
}
