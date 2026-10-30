"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type RealtimeSource = { table: string; filter?: string };

/**
 * Re-render the page when rows it shows change elsewhere (another officer, a
 * QC decision, the assignment job). Realtime honours row level security, so a
 * person only hears about rows they may read. Refreshes are debounced and at
 * most one every 3 seconds.
 */
export function useRealtimeRefresh(sources: RealtimeSource[], key: string) {
  const router = useRouter();
  useEffect(() => {
    // The local stack has no Realtime server; it sets NEXT_PUBLIC_REALTIME=off.
    if (!sources.length || process.env.NEXT_PUBLIC_REALTIME === "off") return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(600, 3000 - (Date.now() - last));
      timer = setTimeout(() => {
        timer = undefined;
        last = Date.now();
        router.refresh();
      }, wait);
    };
    const channel = supabase.channel(`live:${key}`);
    for (const s of sources) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: s.table, ...(s.filter ? { filter: s.filter } : {}) }, schedule);
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // The sources are described by `key`; re-subscribe only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router]);
}
