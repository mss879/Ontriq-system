"use client";

import { useState } from "react";

type Day = { key: string; runs: number; cost_usd: number };

const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Daily AI spend over the last 30 days: one bar per day, hover for the figures. */
export function UsageChart({ days, today }: { days: Day[]; today: string }) {
  const byKey = new Map(days.map((d) => [d.key, d]));
  const parsed = Date.parse(`${today}T00:00:00Z`);
  const end = Number.isNaN(parsed) ? Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) : parsed;
  const series: Day[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(end - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return byKey.get(d) ?? { key: d, runs: 0, cost_usd: 0 };
  });
  const max = Math.max(...series.map((d) => d.cost_usd), 0.0001);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover === null ? null : series[hover];

  return (
    <figure className="px-5 pt-3 pb-4">
      <div className="mb-2 flex h-5 items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{max === 0.0001 ? "No spend yet" : `Peak ${usd(max)} a day`}</span>
        {shown ? (
          <span className="font-medium tabular-nums">
            {dayLabel(shown.key)} · {usd(shown.cost_usd)} · {shown.runs} {shown.runs === 1 ? "call" : "calls"}
          </span>
        ) : null}
      </div>
      <div className="relative h-32 border-b border-border" onMouseLeave={() => setHover(null)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {series.map((d, i) => (
            <button
              key={d.key}
              type="button"
              className="group flex h-full flex-1 items-end outline-none"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${dayLabel(d.key)}: ${usd(d.cost_usd)}, ${d.runs} calls`}
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-primary" : "bg-primary/70"} ${d.cost_usd > 0 ? "" : "bg-transparent"}`}
                style={{ height: d.cost_usd > 0 ? `${Math.max(3, (d.cost_usd / max) * 100)}%` : 0 }}
              />
            </button>
          ))}
        </div>
      </div>
      <figcaption className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{dayLabel(series[0]!.key)}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
