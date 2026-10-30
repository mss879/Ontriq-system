"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { keepAlive } from "@/app/(candidate)/c/session/actions";

/** Renews the candidate's session every few minutes while the page is in view; shows the expired screen when it can't. */
export function KeepAlive() {
  const router = useRouter();
  useEffect(() => {
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await keepAlive();
      if (!r.ok) router.refresh();
    };
    const timer = window.setInterval(beat, 9 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
