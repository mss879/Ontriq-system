/**
 * Predictable matching for the command palette: every typed word must appear
 * in the title or keywords; title matches rank above keyword matches.
 * (cmdk's default fuzzy subsequence match lets "sign out" hit "Settings".)
 */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const title = value.toLowerCase();
  const haystack = `${title} ${(keywords ?? []).join(" ").toLowerCase()}`;
  const terms = query.split(/\s+/);
  if (!terms.every((t) => haystack.includes(t))) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 0.9;
  if (terms.every((t) => title.includes(t))) return 0.8;
  return 0.5;
}
