"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { SegmentedTabs } from "@/components/layout/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { PortalStatusFilter } from "@/domain/portal/types";
import { portalCasesHref } from "./url";

const TABS: { key: PortalStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Needs action" },
  { key: "active", label: "In progress" },
  { key: "released", label: "Released" },
  { key: "cancelled", label: "Cancelled" },
];

/** Search box, status tabs and sort. The URL is the source of truth. */
export function PortalCasesFilters({ query, q: urlQ, status, sort, base = "/portal/cases", tabs = true }: { query: string; q: string; status: PortalStatusFilter; sort: "recent" | "due"; base?: string; tabs?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ);
    if (q.trim() === syncedQ.trim()) setQ(urlQ);
  }

  useEffect(() => {
    const value = q.trim();
    if (value === urlQ) return;
    const timer = setTimeout(() => start(() => router.push(portalCasesHref(query, { q: value || null }, base))), 350);
    return () => clearTimeout(timer);
  }, [q, urlQ, query, router, base]);

  return (
    <div className="space-y-3">
      {tabs ? <SegmentedTabs label="Status" active={status} items={TABS.map((t) => ({ key: t.key, label: t.label, href: portalCasesHref(query, { status: t.key }, base) }))} /> : null}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, candidate, position or your ref" aria-label="Search cases" className="h-9 bg-card pl-8" />
          {pending ? <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" /> : null}
        </div>
        <Select value={sort} onValueChange={(v) => start(() => router.push(portalCasesHref(query, { sort: v }, base)))}>
          <SelectTrigger className="h-9 w-[9.5rem] shrink-0 bg-card" aria-label="Sort">
            <SelectValue>{sort === "due" ? "Due soonest" : "Newest first"}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="recent">Newest first</SelectItem>
            <SelectItem value="due">Due soonest</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
