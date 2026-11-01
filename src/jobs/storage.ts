/** Storage helpers shared by jobs and server code. Plain Node: relative imports only. */
import type { ServiceClient } from "./admin-client";

/** How many times a file is retried before someone is told it won't go. */
const WARN_AFTER = 5;

async function folderFiles(admin: ServiceClient, bucket: string, folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id !== null).map((f) => `${folder}/${f.name}`);
}

/**
 * Remove the files an erasure queued (public.storage_deletions, 0049). Nothing
 * counts as gone until Storage says so: a failure stays on the list, and the
 * nightly retention job tries again. Pass a case to clear just that one.
 */
export async function drainStorageDeletions(admin: ServiceClient, opts: { caseId?: string; limit?: number } = {}): Promise<{ removed: number; failed: number }> {
  let query = admin.from("storage_deletions").select("id, org_id, case_id, bucket, path, is_folder, attempts").is("done_at", null).order("created_at").limit(opts.limit ?? 500);
  if (opts.caseId) query = query.eq("case_id", opts.caseId);
  const { data, error } = await query;
  if (error) throw new Error(`storage_deletions: ${error.message}`);
  let removed = 0;
  let failed = 0;
  for (const row of data ?? []) {
    try {
      const paths = row.is_folder ? await folderFiles(admin, row.bucket, row.path) : [row.path];
      if (paths.length) {
        const gone = await admin.storage.from(row.bucket).remove(paths);
        if (gone.error) throw new Error(gone.error.message);
      }
      await admin.from("storage_deletions").update({ done_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      removed += paths.length;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("storage_deletions").update({ attempts: row.attempts + 1, last_error: message.slice(0, 500) }).eq("id", row.id);
      if (row.attempts + 1 === WARN_AFTER) {
        await admin.from("system_events").insert({ org_id: row.org_id, kind: "storage.delete_failed", severity: "error", message: `An erased file is still in Storage: ${row.bucket}`, context: { case_id: row.case_id, path: row.path, error: message.slice(0, 500) } });
      }
    }
  }
  return { removed, failed };
}
