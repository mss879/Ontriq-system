"use client";

import { useEffect, useRef } from "react";

/**
 * Marks a sent quotation or invoice viewed once it is actually on someone's
 * screen (never on a server read or a link prefetch). `markViewed` is a
 * server action bound to the document.
 */
export function MarkViewed({ markViewed }: { markViewed: () => Promise<void> }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markViewed();
  }, [markViewed]);
  return null;
}
