"use client";

import { useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import NextLink, { useLinkStatus } from "next/link";

/** A thin bar at the top of the window, so a click shows at once while the page loads. */
function PendingBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return createPortal(<div aria-hidden className="fixed inset-x-0 top-0 z-[100] h-0.5 animate-pulse bg-brand-orange" />, document.body);
}

/**
 * next/link, but a page loads in advance only once someone hovers or touches
 * its link, because a table of links shouldn't fetch before anyone shows
 * interest. Menus pass prefetch="auto": their shells are static, so they are
 * ready before the first click and cost no function call.
 */
export default function Link({ prefetch, onMouseEnter, onTouchStart, children, ...props }: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch ?? (intent ? null : false)}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
    >
      {children}
      <PendingBar />
    </NextLink>
  );
}
