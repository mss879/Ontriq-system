/** Build a cases-list URL from the current query with some keys changed. Empty values remove the key. */
export function casesHref(query: string, changes: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  if (!opts.keepPage && !("page" in changes)) params.delete("page");
  const s = params.toString();
  return s ? `/app/cases?${s}` : "/app/cases";
}

/** The filter keys that make a saved view (view mode and paging are not part of it). */
export const FILTER_KEYS = ["q", "stage", "client", "assignee", "priority", "due"] as const;

export function hasFilters(query: string): boolean {
  const params = new URLSearchParams(query);
  return FILTER_KEYS.some((k) => params.get(k));
}
