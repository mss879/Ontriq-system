/** Storage helpers shared by jobs and server code. Plain Node: relative imports only. */
import type { ServiceClient } from "./admin-client";

/** Delete Storage objects grouped by bucket, 100 at a time; returns how many were asked for. */
export async function removeObjects(admin: ServiceClient, objects: { bucket: string; path: string }[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const o of objects) if (o.path) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.path]);
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
  return objects.length;
}
