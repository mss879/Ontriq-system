"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SectionLink = { href: string; label: string; note?: string; alert?: boolean; phoneOnly?: boolean };

/**
 * Jump links for the long case page. Once the header scrolls away, the bar holds
 * in place and says which case this is, so the context never leaves the screen.
 */
export function CaseSectionsBar({ reference, candidate, status, links }: { reference: string; candidate: string; status: React.ReactNode; links: SectionLink[] }) {
  const marker = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const el = marker.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setHeld(!entry.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={marker} aria-hidden className="h-px" />
      <nav aria-label="Case sections" className={cn("sticky top-14 z-10 -mx-4 -mt-5 border-b bg-background/95 px-4 backdrop-blur md:-mx-8 md:px-8", held ? "shadow-sm" : "border-transparent")}>
        <div className="flex h-11 min-w-0 items-center gap-3">
          {held ? (
            <div className="hidden min-w-0 shrink items-center gap-2 text-sm lg:flex">
              <span className="shrink-0 font-mono text-[13px] font-semibold text-primary dark:text-brand-sky">{reference}</span>
              <span className="truncate font-medium">{candidate}</span>
              <span className="flex shrink-0 items-center gap-1.5">{status}</span>
              <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            </div>
          ) : null}
          <ul className="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar">
            {links.map((l) => (
              <li key={l.href} className={l.phoneOnly ? "lg:hidden" : undefined}>
                <a href={l.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                  {l.label}
                  {l.note ? <span className={cn("text-xs tabular-nums", l.alert ? "text-brand-orange-ink" : "text-muted-foreground/80")}>{l.note}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}
