/**
 * One file holding several documents: what the AI saw in it, and which slots a
 * person can fill from it. Pure: the jobs, the documents panel and the report
 * all share it.
 */

/** Categories that aren't about one check: a CV, or one PDF holding a candidate's details. */
export const GENERAL_CATEGORIES = new Set(["cv", "other"]);

export type DocumentPart = { category: string; pages: string | null; name: string | null };

const joined = (a: string | null, b: string | null) => [...new Set([a, b].filter(Boolean))].join(", ") || null;

/** What else a file holds: known document types other than its own, one entry each. */
export function otherDocuments(parts: DocumentPart[], own: string, known: string[]): DocumentPart[] {
  const found = new Map<string, DocumentPart>();
  for (const p of parts) {
    if (p.category === own || GENERAL_CATEGORIES.has(p.category) || !known.includes(p.category)) continue;
    const seen = found.get(p.category);
    found.set(p.category, seen ? { category: p.category, pages: joined(seen.pages, p.pages), name: joined(seen.name, p.name) } : p);
  }
  return [...found.values()];
}

/** "3" → "page 3", "3-4" → "pages 3-4". */
export function pagesLabel(pages: string | null | undefined): string | null {
  const p = pages?.trim();
  if (!p) return null;
  return `${/^\d+$/.test(p) ? "page" : "pages"} ${p}`;
}

type Slot = { id: string; category: string; status: string; receivedCount: number; files: { documentId: string }[] };

/** A slot can take a combined file while it is open. A fixed annexure has to stay a file of its own. */
export const canTakeFile = (r: Pick<Slot, "category" | "status" | "receivedCount">, fixed: string[]) =>
  !fixed.includes(r.category) && (r.status === "pending" || (r.status === "optional" && r.receivedCount === 0));

/** The open slots a file seems to fill, each with the part of the file that fills it. */
export function slotOffers<R extends Slot>(parts: DocumentPart[], requirements: R[], documentId: string, fixed: string[]): { requirement: R; part: DocumentPart }[] {
  return requirements.flatMap((requirement) => {
    const part = parts.find((p) => p.category === requirement.category);
    return part && canTakeFile(requirement, fixed) && !requirement.files.some((f) => f.documentId === documentId) ? [{ requirement, part }] : [];
  });
}
