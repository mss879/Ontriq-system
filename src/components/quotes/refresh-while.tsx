"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-read the page every few seconds while something is being prepared (e.g. a PDF), for up to two minutes. */
export function RefreshWhile({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > 120_000) clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
