/**
 * A small in-memory cache with a lifetime and a size limit. It lives on one
 * server instance, so entries aren't shared and vanish when the instance does.
 */
export function ttlMemo<T>(ttlMs: number, maxEntries: number) {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string, now = Date.now()): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires > now) return entry.value;
      entries.delete(key);
      return undefined;
    },
    set(key: string, value: T, now = Date.now()) {
      // A Map keeps insertion order, so the first key is the oldest.
      if (!entries.has(key) && entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(key, { value, expires: now + ttlMs });
    },
    delete(key: string) {
      entries.delete(key);
    },
  };
}
