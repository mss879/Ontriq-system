"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The case page shows one area at a time. The address's #hash holds the choice, so
 * links such as /app/cases/…#report and in-page anchors like #contacts open their tab.
 */
type Tabs = { shown: string; tabs: string[]; open: (id: string, scroll?: boolean) => void; register: (ids: string[]) => void };

const CaseTabsContext = createContext<Tabs | null>(null);

const hashId = () => decodeURIComponent(window.location.hash.slice(1));

export function CaseTabsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  const open = useCallback((id: string, scroll = false) => {
    setActive(id);
    if (window.location.hash.slice(1) !== id) history.replaceState(history.state, "", `#${id}`);
    // Once the page has scrolled down, bring the opened area's top back under the bar.
    if (scroll) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, []);

  const register = useCallback((ids: string[]) => {
    setTabs(ids);
    const id = hashId();
    if (ids.includes(id)) setActive(id);
  }, []);

  useEffect(() => {
    // An in-page link (#contacts in a banner, #report in the actions) opens its tab.
    const onHash = () => {
      const id = hashId();
      if (tabs.includes(id)) open(id, true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tabs, open]);

  // Until the bar knows the tabs, the checks show, as they always come first after the report.
  const shown = active && tabs.includes(active) ? active : (tabs[0] ?? "checks");
  const value = useMemo(() => ({ shown, tabs, open, register }), [shown, tabs, open, register]);
  return <CaseTabsContext.Provider value={value}>{children}</CaseTabsContext.Provider>;
}

export function useCaseTabs() {
  return useContext(CaseTabsContext);
}

/** One area of the case page. Hidden areas stay mounted, so a half-written note survives a switch. */
export function CaseTabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const tabs = useCaseTabs();
  const hidden = tabs ? tabs.shown !== id : false;
  return (
    <div role="tabpanel" aria-labelledby={`tab-${id}`} hidden={hidden} className="min-w-0 space-y-5">
      {children}
    </div>
  );
}
