"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useCaseTabs } from "./case-tabs";

export type SectionLink = { href: string; label: string; note?: string; alert?: boolean; phoneOnly?: boolean };

/**
 * Tabs for the case page's areas. Once the header scrolls away, the bar holds
 * in place and says which case this is, so the context never leaves the screen.
 */
export function CaseSectionsBar({ reference, candidate, status, links }: { reference: string; candidate: string; status: React.ReactNode; links: SectionLink[] }) {
  const marker = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const tabs = useCaseTabs();
  const ids = links.filter((l) => !l.phoneOnly).map((l) => l.href.slice(1));
  const key = ids.join(" ");
  const register = tabs?.register;

  useEffect(() => {
    register?.(key.split(" "));
  }, [register, key]);

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
      <nav aria-label="Case sections" className={cn("sticky top-14 z-10 -mx-4 -mt-5 border-b bg-background/95 px-4 backdrop-blur md:-mx-8 md:px-8", held && "shadow-sm")}>
        <div className="flex h-12 min-w-0 items-end gap-3">
          {held ? (
            <div className="hidden min-w-0 shrink items-center gap-2 self-center text-sm lg:flex">
              <span className="shrink-0 font-mono text-[13px] font-semibold text-primary dark:text-brand-sky">{reference}</span>
              <span className="max-w-40 truncate font-medium">{candidate}</span>
              <span className="flex shrink-0 items-center gap-1.5">{status}</span>
              <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            </div>
          ) : null}
          <ul role="tablist" className="flex min-w-0 items-end gap-1 overflow-x-auto no-scrollbar">
            {links.map((l) => {
              const id = l.href.slice(1);
              const current = !l.phoneOnly && tabs?.shown === id;
              return (
                <li key={l.href} role="presentation" className={l.phoneOnly ? "lg:hidden" : undefined}>
                  <a
                    id={l.phoneOnly ? undefined : `tab-${id}`}
                    href={l.href}
                    role={l.phoneOnly ? undefined : "tab"}
                    aria-selected={l.phoneOnly ? undefined : current}
                    onClick={(e) => {
                      if (l.phoneOnly || !tabs) return;
                      e.preventDefault();
                      tabs.open(id, held);
                    }}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 rounded-t-lg px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      current && "text-foreground after:absolute after:inset-x-2.5 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-orange",
                    )}
                  >
                    {l.label}
                    {l.note ? (
                      <span className={cn("rounded-full px-1.5 text-[11px] leading-5 tabular-nums", l.alert ? "bg-brand-orange/15 text-brand-orange-ink" : "bg-foreground/[0.06] text-muted-foreground")}>{l.note}</span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
