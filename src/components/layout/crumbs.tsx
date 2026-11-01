"use client";

import { Fragment, createContext, use, useEffect, useMemo, useState } from "react";
import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SETTINGS_NAV, STAFF_NAV } from "./nav";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

const CrumbsContext = createContext<{ record: Crumb[]; setRecord: (c: Crumb[]) => void } | null>(null);

/** Holds what the current page says about itself, for the top bar to show. */
export function CrumbsProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ record, setRecord }), [record]);
  return <CrumbsContext.Provider value={value}>{children}</CrumbsContext.Provider>;
}

/** Rendered by a detail page: adds the record's own name after the section in the top bar. */
export function SetCrumbs({ items }: { items: Crumb[] }) {
  const ctx = use(CrumbsContext);
  const setRecord = ctx?.setRecord;
  const key = JSON.stringify(items);
  useEffect(() => {
    if (!setRecord) return;
    setRecord(JSON.parse(key) as Crumb[]);
    return () => setRecord([]);
  }, [key, setRecord]);
  return null;
}

const SECTIONS = [...STAFF_NAV.flatMap((s) => s.items), ...SETTINGS_NAV];
const EXTRA: Record<string, string> = { "/app/cases/new": "New case", "/app/cases/import": "Import cases" };

/** The section this path belongs to: the longest matching nav item. */
export function sectionTrail(pathname: string): Crumb[] {
  const matches = SECTIONS.filter((i) => (i.href === "/app" ? pathname === "/app" : pathname === i.href || pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length);
  const item = matches[0];
  if (!item) return [{ label: "Dashboard", href: "/app" }];
  const trail: Crumb[] = [];
  if (item.href.startsWith("/app/settings/")) trail.push({ label: "Settings", href: "/app/settings" });
  trail.push({ label: item.title, href: item.href });
  const extra = EXTRA[pathname];
  if (extra) trail.push({ label: extra });
  return trail;
}

/** Where you are, in the top bar. Earlier steps link back; phones show the last step only. */
export function TopbarCrumbs() {
  const pathname = usePathname();
  const ctx = use(CrumbsContext);
  const trail = [...sectionTrail(pathname), ...(ctx?.record ?? [])];
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 ? <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground/60 sm:block" /> : null}
              <li className={cn("min-w-0", !last && "hidden sm:block", i === 0 && !last && "shrink-0")}>
                {c.href && !last ? (
                  <Link href={c.href} className="block truncate rounded text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="block truncate font-medium">
                    {c.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
