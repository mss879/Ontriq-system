"use client";

import { useRealtimeRefresh, type RealtimeSource } from "@/hooks/use-realtime-refresh";

/** Drop into a page to keep it live: <RealtimeRefresh sources={[{ table: "cases", filter: `id=eq.${id}` }]} />. */
export function RealtimeRefresh({ sources }: { sources: RealtimeSource[] }) {
  useRealtimeRefresh(sources, sources.map((s) => `${s.table}:${s.filter ?? "*"}`).join("|"));
  return null;
}
