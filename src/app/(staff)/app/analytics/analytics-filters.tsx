"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PERIOD_PRESETS, type PeriodPreset } from "@/domain/analytics/period";
import { DateField } from "@/components/forms/date-field";

/** Period, client and export controls; everything lives in the URL. */
export function AnalyticsFilters({
  preset,
  from,
  to,
  today,
  clients,
  showClient,
  exportHref,
}: {
  preset: PeriodPreset;
  from: string;
  to: string;
  today: string;
  clients: { id: string; name: string }[];
  showClient: boolean;
  exportHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState({ from, to });

  const push = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const applyCustom = (next: { from: string; to: string }) => {
    setCustom(next);
    if (next.from && next.to && next.from <= next.to) push({ period: "custom", from: next.from, to: next.to });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select
        value={preset}
        onValueChange={(v) => {
          if (v === "custom") push({ period: "custom", from: custom.from, to: custom.to });
          else push({ period: v === "30d" ? null : v, from: null, to: null });
        }}
      >
        <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((p) => (
            <SelectItem key={p.key} value={p.key}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" ? (
        <div className="flex items-center gap-2">
          <DateField aria-label="From" className="h-9 w-full sm:w-40" max={custom.to || today} value={custom.from} onChange={(e) => applyCustom({ ...custom, from: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <DateField aria-label="To" className="h-9 w-full sm:w-40" min={custom.from} max={today} value={custom.to} onChange={(e) => applyCustom({ ...custom, to: e.target.value })} />
        </div>
      ) : null}
      {showClient ? (
        <Select value={params.get("client") ?? "__all"} onValueChange={(v) => push({ client: v === "__all" ? null : v })}>
          <SelectTrigger className="h-9 w-full sm:w-56" aria-label="Client">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {pending ? <Spinner className="size-4 text-muted-foreground" /> : null}
      <Button asChild variant="outline" size="sm" className="h-9 sm:ml-auto">
        <a href={exportHref} download>
          <Download /> Export CSV
        </a>
      </Button>
    </div>
  );
}
