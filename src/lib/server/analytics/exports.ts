import "server-only";
import { NextResponse } from "next/server";
import { loadViewerState, type Viewer } from "@/lib/server/viewer";
import { toCsv, type CsvCell } from "@/domain/analytics/csv";

/** Shared pieces of the CSV export routes (/api/exports/*). */

export const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export function csvResponse(rows: CsvCell[][], filename: string): NextResponse {
  return new NextResponse(toCsv(rows), {
    headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

/** The signed-in staff member, or the refusal to send back (401 signed out, 403 without permission). */
export async function exportViewer(allowed: (v: Viewer) => boolean): Promise<Viewer | NextResponse> {
  const state = await loadViewerState();
  if (state.state !== "ready") return NextResponse.json({ error: "Sign in to download this." }, { status: 401, headers: PRIVATE });
  if (state.viewer.kind !== "staff" || !allowed(state.viewer)) return NextResponse.json({ error: "You don't have access to this export." }, { status: 403, headers: PRIVATE });
  return state.viewer;
}

/** Read up to `max` rows in pages of 1000 (the API's page size), stopping at the first short page. */
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max: number): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const to = Math.min(from + 1000, max) - 1;
    const { data, error } = await page(from, to);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < to - from + 1) return { rows, capped: false };
  }
  return { rows, capped: rows.length >= max };
}
