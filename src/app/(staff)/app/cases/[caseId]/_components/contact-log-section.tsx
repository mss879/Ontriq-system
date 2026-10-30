"use client";

import type { ContactEntry } from "@/lib/server/cases/detail-queries";
import { ContactLog } from "./contact-log";

/** The case-wide log: server components can't pass a lookup function, so labels arrive as a map. */
export function ContactLogSection({ caseId, entries, canLog, labels, candidate }: { caseId: string; entries: ContactEntry[]; canLog: boolean; labels: Record<string, string>; candidate: string }) {
  return <ContactLog caseId={caseId} entries={entries} canLog={canLog} checkLabel={(id) => labels[id]} people={[candidate]} />;
}
