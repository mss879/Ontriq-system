/** Build a portal cases URL from the current query with some keys changed. Empty values remove the key. */
export function portalCasesHref(query: string, changes: Record<string, string | null | undefined>, base = "/portal/cases"): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "" || (key === "status" && value === "all") || (key === "sort" && value === "recent")) params.delete(key);
    else params.set(key, value);
  }
  if (!("page" in changes)) params.delete("page");
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
